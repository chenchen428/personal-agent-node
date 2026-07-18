import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const LOGIN_TIMEOUT_MS = 2 * 60_000;

export class NotionCliConnection {
  constructor({ command, env = process.env, platform = process.platform, run = runCommand, openBrowser = openExternalUrl, now = () => Date.now() } = {}) {
    this.command = command || resolveNotionCli(env, { platform });
    this.environment = resolveNotionEnvironment(env);
    this.run = run;
    this.openBrowser = openBrowser;
    this.now = now;
    this.lastStatus = null;
    this.pendingLogin = null;
  }

  catalogStatus() {
    return this.lastStatus || {
      state: isExecutablePathAvailable(this.command) ? "needs_setup" : "missing",
      statusLabel: isExecutablePathAvailable(this.command) ? "需要浏览器授权" : "官方 CLI 未安装",
      details: { cliReady: isExecutablePathAvailable(this.command) },
    };
  }

  async status() {
    try {
      const result = await this.run(this.command, ["doctor"], { env: this.environment });
      const output = `${result.stdout}\n${result.stderr}`;
      this.lastStatus = result.code !== 0 || !doctorHasAuthenticatedWorkspace(output)
        ? { state: "needs_setup", statusLabel: "需要浏览器授权", details: { cliReady: true } }
        : { state: "connected", statusLabel: "已连接", details: { cliReady: true } };
      return this.lastStatus;
    } catch (error) {
      this.lastStatus = error?.code === "ENOENT"
        ? { state: "missing", statusLabel: "官方 CLI 未安装", details: { cliReady: false } }
        : { state: "error", statusLabel: "状态检查失败", error: safeError(error), details: { cliReady: true } };
      return this.lastStatus;
    }
  }

  async startLogin() {
    try {
      const result = await this.run(this.command, ["login", "--no-browser"], { timeoutMs: 15_000, env: this.environment });
      const authorization = parseLoginAuthorization(`${result.stdout}\n${result.stderr}`);
      if (result.code !== 0 || !authorization.verificationUrl) {
        throw Object.assign(new Error("Notion CLI 未返回可用的浏览器授权地址，请重试。"), { code: "NOTION_LOGIN_START_FAILED" });
      }
      const expiresAt = new Date(this.now() + LOGIN_TIMEOUT_MS).toISOString();
      const browserOpened = await this.openBrowser(authorization.verificationUrl);
      this.pendingLogin = { expiresAt };
      return {
        state: "authorizing",
        statusLabel: "等待浏览器确认",
        instructions: browserOpened
          ? "Notion 官方授权页已在默认浏览器中打开。请核对授权码并完成工作区授权。"
          : "未能自动打开默认浏览器，请使用下方入口继续授权。",
        verificationUrl: authorization.verificationUrl,
        userCode: authorization.userCode,
        expiresAt,
        browserOpened,
      };
    } catch (error) {
      if (error?.code === "ENOENT") throw Object.assign(new Error("Notion 官方 ntn CLI 尚未安装"), { statusCode: 503, code: "NOTION_CLI_MISSING" });
      throw error;
    }
  }

  async pollLogin() {
    if (this.pendingLogin && this.now() >= new Date(this.pendingLogin.expiresAt).getTime()) {
      this.pendingLogin = null;
      throw Object.assign(new Error("Notion 授权已超时，请重新连接。"), { statusCode: 410, code: "NOTION_LOGIN_EXPIRED" });
    }
    await this.run(this.command, ["login", "poll"], { timeoutMs: 15_000, env: this.environment }).catch(() => null);
    const status = await this.status();
    if (status.state !== "connected") throw Object.assign(new Error("Notion 授权尚未完成，请先在浏览器中确认工作区授权。"), { statusCode: 409, code: "NOTION_LOGIN_PENDING" });
    this.pendingLogin = null;
    return status;
  }
}

export function openExternalUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const target = validateAuthorizationUrl(url);
  const command = platform === "darwin" ? "open" : platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", target] : [target];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export function parseLoginAuthorization(value) {
  const output = String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
  const verificationUrl = (output.match(/https:\/\/[^\s<>"']+/i) || [""])[0].replace(/[),.;]+$/, "");
  const validatedUrl = verificationUrl ? validateAuthorizationUrl(verificationUrl) : "";
  const queryCode = validatedUrl ? new URL(validatedUrl).searchParams.get("verificationCode") || new URL(validatedUrl).searchParams.get("user_code") || "" : "";
  const codeMatch = output.match(/(?:verification|authorization)\s+code\s*[:：]?\s*([A-Z0-9-]{4,32})/i)
    || output.match(/\b([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)\b/);
  const userCode = /^[A-Z0-9-]{4,32}$/i.test(queryCode) ? queryCode : codeMatch?.[1] || "";
  return { verificationUrl: validatedUrl, userCode };
}

function validateAuthorizationUrl(value) {
  const parsed = new URL(String(value));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.toString().length > 2048) {
    throw new Error("Notion CLI 返回了无效的授权地址");
  }
  return parsed.toString();
}

export function resolveNotionCli(env = process.env, { platform = process.platform, exists = fs.existsSync, readDirectory = fs.readdirSync } = {}) {
  const configured = String(env.PERSONAL_AGENT_NOTION_CLI || "").trim();
  if (configured) return configured;
  if (platform !== "win32") return "ntn";
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "ntn";
  const link = path.join(localAppData, "Microsoft", "WinGet", "Links", "ntn.exe");
  if (exists(link)) return link;
  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    const packageDirectories = readDirectory(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("Notion.ntn_"))
      .map((entry) => path.join(packagesRoot, entry.name));
    for (const packageDirectory of packageDirectories) {
      const direct = path.join(packageDirectory, "ntn.exe");
      if (exists(direct)) return direct;
      for (const entry of readDirectory(packageDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(packageDirectory, entry.name, "ntn.exe");
        if (exists(nested)) return nested;
      }
    }
  } catch {
    // A missing WinGet package root is an ordinary "not installed" state.
  }
  return "ntn";
}

export function resolveNotionEnvironment(env = process.env) {
  const base = String(env.PRIVATE_SITE_DATA_ROOT || env.PERSONAL_AGENT_DATA_ROOT || env.LOCALAPPDATA || env.APPDATA || env.USERPROFILE || process.cwd()).trim();
  const notionHome = String(env.NOTION_HOME || path.join(base, "config", "notion")).trim();
  fs.mkdirSync(notionHome, { recursive: true });
  return { ...env, NOTION_HOME: notionHome };
}

export function runCommand(command, args, { timeoutMs = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes <= MAX_OUTPUT_BYTES) stdout.push(chunk); else child.kill(); });
    child.stderr.on("data", (chunk) => { bytes += chunk.length; if (bytes <= MAX_OUTPUT_BYTES) stderr.push(chunk); else child.kill(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (bytes > MAX_OUTPUT_BYTES) return reject(new Error("Notion CLI output exceeded the safe limit"));
      resolve({ code: Number(code ?? 1), stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function isExecutablePathAvailable(command) {
  return !path.isAbsolute(String(command || "")) || fs.existsSync(command);
}

function doctorHasAuthenticatedWorkspace(value) {
  const output = String(value || "").replace(/\u001b\[[0-9;]*m/g, "").toLowerCase();
  if (/no token found|no default workspace|no workspace selected|run [`']?ntn login/.test(output)) return false;
  return /token source\s+[^!\n]*[✔✓]|public api access\s+[^!\n]*[✔✓]|workers access\s+[^!\n]*[✔✓]/i.test(output)
    || (!output.includes("!") && /healthy|authenticated|connected/.test(output));
}
