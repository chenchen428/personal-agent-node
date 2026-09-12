import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MINIMUM_VERSION = "1.8.6";
const BUNDLED_ENTRYPOINT = ["core", "agent", "vendor", "opencli-runtime", "node_modules", "@jackwener", "opencli", "dist", "src", "main.js"];

export class OpenCliRunner {
  constructor({
    command = process.env.PERSONAL_AGENT_OPENCLI_CLI || "",
    env = process.env,
    platform = process.platform,
    nodeCommand = process.execPath,
    execute = execFileAsync,
    executePlatform = executePlatformChild,
    fileExists = fs.existsSync,
    minimumVersion = MINIMUM_VERSION,
  } = {}) {
    this.invocation = resolveOpenCliInvocation({ command, env, platform, nodeCommand, fileExists });
    this.env = minimalChildEnvironment(env, { isolateRuntime: this.invocation.source === "bundled", platform });
    this.execute = execute;
    this.executePlatform = executePlatform;
    this.nodeCommand = nodeCommand;
    this.platformQueue = new Map();
    this.sessionNamespace = crypto.createHash("sha256").update(String(env.PRIVATE_SITE_DATA_ROOT || this.env.OPENCLI_CONFIG_DIR || "personal-agent")).digest("hex").slice(0, 24);
    this.platformScript = path.join(env.PRIVATE_SITE_RELEASE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.."), "scripts", "opencli-platform-session.mjs");
    this.minimumVersion = minimumVersion;
    this.probePromise = null;
    this.bridgeStatusPromise = null;
  }

  async probe() {
    if (!this.probePromise) {
      this.probePromise = this.run(["--version"], { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 })
        .then(({ stdout }) => {
          const version = parseVersion(stdout);
          if (!version) throw new OpenCliError("OPENCLI_INVALID_VERSION", "OpenCLI returned an invalid version.", 503);
          if (compareVersions(version, this.minimumVersion) < 0) {
            throw new OpenCliError("OPENCLI_VERSION_UNSUPPORTED", `OpenCLI ${this.minimumVersion} or newer is required.`, 503);
          }
          return { available: true, version, command: this.invocation.display, source: this.invocation.source };
        })
        .finally(() => {
          this.probePromise = null;
        });
    }
    return this.probePromise;
  }

  async browserBridgeStatus() {
    if (!this.bridgeStatusPromise) {
      this.bridgeStatusPromise = this.checkBrowserBridgeStatus().finally(() => {
        this.bridgeStatusPromise = null;
      });
    }
    return this.bridgeStatusPromise;
  }

  async checkBrowserBridgeStatus() {
    const { stdout } = await this.run(["daemon", "status"], { timeoutMs: 10_000, maxOutputBytes: 256 * 1024 });
    const daemon = /^Daemon:\s+([^\r\n]+)/mi.exec(stdout)?.[1]?.trim() || "unknown";
    const extension = /^Extension:\s+([^\r\n]+)/mi.exec(stdout)?.[1]?.trim() || "unknown";
    const daemonRunning = daemon.startsWith("running");
    const daemonIdle = daemon === "not running";
    const extensionConnected = extension.startsWith("connected");
    const ready = daemonRunning && extensionConnected;
    const needsSetup = (!daemonIdle && !daemonRunning) || (daemonRunning && !extensionConnected);
    return {
      ready,
      needsSetup,
      daemon: daemonIdle ? "idle" : daemonRunning ? "running" : "unavailable",
      browserBridge: extensionConnected ? "connected" : daemonIdle ? "unchecked" : "disconnected",
    };
  }

  async openBrowserSession(sessionName, url) {
    const session = String(sessionName || "").trim();
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(session)) throw new TypeError("Invalid OpenCLI browser session name.");
    const target = new URL(String(url || ""));
    if (target.protocol !== "https:") throw new TypeError("OpenCLI browser target URL must use HTTPS.");
    await this.run(["browser", session, "open", target.toString()], { timeoutMs: 30_000, maxOutputBytes: 512 * 1024 });
  }

  async json(args, options = {}) {
    const { stdout } = await this.run(args, options);
    let value;
    try {
      value = JSON.parse(stdout);
    } catch {
      throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI returned invalid JSON.", 502);
    }
    if (!value || typeof value !== "object") {
      throw new OpenCliError("OPENCLI_INVALID_OUTPUT", "OpenCLI returned an unsupported JSON value.", 502);
    }
    return value;
  }

  platformOperation(platform, operation, input = "") {
    if (!["xiaohongshu", "twitter"].includes(platform) || !["status", "open", "search", "read"].includes(operation)) throw new TypeError("Unsupported social platform operation");
    const previous = this.platformQueue.get(platform) || Promise.resolve();
    const request = previous.then(async () => {
      const entrypoint = this.invocation.prefixArgs[0];
      if (!entrypoint?.endsWith("main.js")) throw new OpenCliError("OPENCLI_NOT_READY", "The pinned browser session adapter is unavailable.", 503);
      let response;
      try {
        const { stdout } = await this.executePlatform(this.nodeCommand, [this.platformScript, entrypoint], {
          env: this.env, timeout: operation === "status" ? 20_000 : 120_000, maxBuffer: DEFAULT_MAX_OUTPUT_BYTES,
          input: JSON.stringify({ platform, operation, input, session: `pa-social-${this.sessionNamespace}-${platform}` }),
        });
        response = JSON.parse(stdout);
      } catch (error) { throw mapExecutionError(error); }
      if (response?.ok !== true) {
        const code = response?.error?.code;
        if (["AUTH_REQUIRED", "CONNECTION_LOGIN_REQUIRED"].includes(code)) throw new OpenCliError("CONNECTION_LOGIN_REQUIRED", "请先在平台官方页面登录，然后重新检测连接。", 409);
        if (code === "CONNECTION_LOGIN_UNCONFIRMED") throw new OpenCliError(code, "平台登录状态尚未确认，请在官方页面检查后重试。", 409);
        if (code === "SECURITY_BLOCK") throw new OpenCliError("OPENCLI_SECURITY_BLOCK", "请先在平台页面完成人工安全验证。", 429);
        if (code === "BROWSER_CONNECT") throw new OpenCliError("OPENCLI_BROWSER_UNAVAILABLE", "浏览器连接暂时不可用。", 503);
        if (code === "TIMEOUT") throw new OpenCliError("OPENCLI_TIMEOUT", "浏览器检测超时，请稍后重试。", 504);
        if (code === "EMPTY_RESULT") throw new OpenCliError("OPENCLI_EMPTY_RESULT", "未找到可读取的内容。", 404);
        throw new OpenCliError("OPENCLI_EXECUTION_FAILED", "平台读取暂时未完成，请稍后重试。", 502);
      }
      return response.result;
    });
    this.platformQueue.set(platform, request.catch(() => {}));
    return request;
  }

  async run(args, { timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}) {
    const normalizedArgs = validateArguments(args);
    try {
      const result = await this.execute(
        this.invocation.command,
        [...this.invocation.prefixArgs, ...normalizedArgs],
        {
          encoding: "utf8",
          env: this.env,
          timeout: boundedInteger(timeoutMs, 1_000, 300_000),
          maxBuffer: boundedInteger(maxOutputBytes, 1_024, DEFAULT_MAX_OUTPUT_BYTES),
          windowsHide: true,
          shell: false,
        },
      );
      return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
    } catch (error) {
      throw mapExecutionError(error);
    }
  }
}

export function executePlatformChild(command, args, { env, timeout, maxBuffer, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error("Browser operation timeout"), { code: "ETIMEDOUT" })); }, timeout);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > maxBuffer) { child.kill(); reject(new Error("Browser response exceeded limit")); } else output.push(chunk); });
    child.stderr.on("data", () => {});
    child.once("close", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error("Browser operation failed")); else resolve({ stdout: Buffer.concat(output).toString("utf8") }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export class OpenCliError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = "OpenCliError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function resolveOpenCliInvocation({ command = "", env = process.env, platform = process.platform, nodeCommand = process.execPath, fileExists = fs.existsSync } = {}) {
  const configured = String(command || "").trim();
  if (configured) return invocationForConfiguredCommand(configured, nodeCommand);

  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const releaseRoot = String(env.PRIVATE_SITE_RELEASE_ROOT || "").trim();
  const bundledEntrypoint = releaseRoot ? platformPath.join(releaseRoot, ...BUNDLED_ENTRYPOINT) : "";
  if (bundledEntrypoint && fileExists(bundledEntrypoint)) {
    return { command: nodeCommand, prefixArgs: [bundledEntrypoint], display: "bundled opencli", source: "bundled" };
  }

  if (platform === "win32") {
    const npmModule = env.APPDATA
      ? platformPath.join(env.APPDATA, "npm", "node_modules", "@jackwener", "opencli", "dist", "src", "main.js")
      : "";
    if (npmModule && fileExists(npmModule)) {
      return { command: nodeCommand, prefixArgs: [npmModule], display: "opencli", source: "global" };
    }
    return { command: "opencli.exe", prefixArgs: [], display: "opencli", source: "global" };
  }
  return { command: "opencli", prefixArgs: [], display: "opencli", source: "global" };
}

export function minimalChildEnvironment(source = process.env, { isolateRuntime = false, platform = process.platform } = {}) {
  const exact = new Set([
    "APPDATA", "CHROME_PATH", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
    "PATH", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME",
  ]);
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    const upper = key.toUpperCase();
    if (exact.has(upper) || upper.startsWith("OPENCLI_")) result[key] = value;
  }
  const dataRoot = String(source.PRIVATE_SITE_DATA_ROOT || "").trim();
  if (isolateRuntime && dataRoot) {
    const platformPath = platform === "win32" ? path.win32 : path.posix;
    const runtimeHome = platformPath.join(dataRoot, "runtime", "opencli-home");
    result.HOME = runtimeHome;
    result.USERPROFILE = runtimeHome;
    result.OPENCLI_CONFIG_DIR = platformPath.join(runtimeHome, ".opencli");
    result.OPENCLI_CACHE_DIR = platformPath.join(runtimeHome, ".opencli", "cache");
  }
  return result;
}

function invocationForConfiguredCommand(command, nodeCommand) {
  const resolved = path.resolve(command);
  if (/\.(?:c?js|mjs)$/i.test(command)) {
    return { command: nodeCommand, prefixArgs: [resolved], display: resolved, source: "configured" };
  }
  return { command, prefixArgs: [], display: command, source: "configured" };
}

function validateArguments(args) {
  if (!Array.isArray(args) || !args.length) throw new TypeError("OpenCLI arguments are required.");
  return args.map((value) => {
    const text = String(value);
    if (!text || text.includes("\0") || text.length > 8_192) throw new TypeError("Invalid OpenCLI argument.");
    return text;
  });
}

function mapExecutionError(error) {
  if (error instanceof OpenCliError) return error;
  if (error?.code === "ENOENT") return new OpenCliError("OPENCLI_NOT_INSTALLED", "The bundled browser runtime is unavailable.", 503);
  if (error?.killed || error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM") {
    return new OpenCliError("OPENCLI_TIMEOUT", "OpenCLI did not finish before the timeout.", 504);
  }

  const exitCode = Number(error?.code);
  const upstreamCode = parseUpstreamCode(error?.stderr);
  if (upstreamCode === "AUTH_REQUIRED" || exitCode === 77) {
    return new OpenCliError("OPENCLI_AUTH_REQUIRED", "The selected browser session needs user authentication.", 401);
  }
  if (upstreamCode === "SECURITY_BLOCK") {
    return new OpenCliError("OPENCLI_SECURITY_BLOCK", "The platform blocked this browser request; recover in the visible browser before retrying.", 429);
  }
  if (exitCode === 66 || upstreamCode === "EMPTY_RESULT") {
    return new OpenCliError("OPENCLI_EMPTY_RESULT", "OpenCLI did not find readable content.", 404);
  }
  if (exitCode === 69 || upstreamCode === "BROWSER_CONNECT") {
    return new OpenCliError("OPENCLI_BROWSER_UNAVAILABLE", "The OpenCLI browser service is unavailable.", 503);
  }
  if (exitCode === 75) return new OpenCliError("OPENCLI_TIMEOUT", "OpenCLI did not finish before the timeout.", 504);
  if (exitCode === 78) return new OpenCliError("OPENCLI_CONFIG_INVALID", "OpenCLI configuration is invalid.", 503);
  if (exitCode === 2) return new OpenCliError("OPENCLI_USAGE_ERROR", "OpenCLI rejected the provider command contract.", 502);
  return new OpenCliError("OPENCLI_EXECUTION_FAILED", "OpenCLI could not complete the browser operation.", 502);
}

function parseUpstreamCode(stderr) {
  const match = /(?:^|\n)\s*code:\s*['\"]?([A-Z][A-Z0-9_]{1,63})/m.exec(String(stderr || ""));
  return match?.[1] || "";
}

function parseVersion(value) {
  return /\b(\d+)\.(\d+)\.(\d+)\b/.exec(String(value || ""))?.[0] || "";
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function boundedInteger(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}
