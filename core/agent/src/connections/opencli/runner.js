import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

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
    fileExists = fs.existsSync,
    minimumVersion = MINIMUM_VERSION,
  } = {}) {
    this.invocation = resolveOpenCliInvocation({ command, env, platform, nodeCommand, fileExists });
    this.env = minimalChildEnvironment(env, { isolateRuntime: this.invocation.source === "bundled", platform });
    this.execute = execute;
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
