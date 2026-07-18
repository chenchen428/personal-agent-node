import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "./config.ts";

const bridgeCommandNames = ["pa-cli"];
const obsoleteBridgeCommandNames = ["open-abg", "oab", "open-agent-bridge"];

export function prepareBridgeCliShims(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = canonicalDirectory(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"), "core"));
  const currentEntrypoint = path.join(resolveCurrentReleaseRoot(installRoot), "core", "agent", "bin", "pa-cli.mjs");
  const developmentEntrypoint = path.join(workspaceRoot, "core", "agent", "bin", "pa-cli.mjs");
  const entrypoint = fs.existsSync(currentEntrypoint) ? currentEntrypoint : developmentEntrypoint;
  if (!fs.existsSync(entrypoint)) throw new Error("The bundled pa-cli entrypoint is missing");
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  const nodeRuntime = resolveShimNodeRuntime({ platform, installRoot, configured: options.nodeRuntime });
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  for (const name of obsoleteBridgeCommandNames) {
    fs.rmSync(path.join(binDir, platform === "win32" ? `${name}.cmd` : name), { force: true, recursive: false });
  }
  fs.rmSync(path.join(binDir, platform === "win32" ? "open-abg-mail-ingest.cmd" : "open-abg-mail-ingest"), { force: true, recursive: false });
  const commandPaths = [];
  for (const name of bridgeCommandNames) {
    const commandPath = path.join(binDir, platform === "win32" ? `${name}.cmd` : name);
    replaceShim(commandPath, renderShim({ platform, nodeRuntime, entrypoint, envPath: config.envPath, environment: shimEnvironment(config) }), platform);
    commandPaths.push(commandPath);
  }
  return bridgeCliStatus(config, { platform, env, installRoot, binDir, commandPaths, entrypoint });
}

function replaceShim(commandPath, content, platform) {
  const temporary = `${commandPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
    if (platform !== "win32") fs.chmodSync(temporary, 0o700);
    fs.rmSync(commandPath, { force: true, recursive: false });
    fs.renameSync(temporary, commandPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function bridgeCliStatus(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = canonicalDirectory(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"), "core"));
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  const nodeRuntime = resolveShimNodeRuntime({ platform, installRoot, configured: options.nodeRuntime });
  const currentEntrypoint = path.join(resolveCurrentReleaseRoot(installRoot), "core", "agent", "bin", "pa-cli.mjs");
  const entrypoint = options.entrypoint || currentEntrypoint;
  const commandPaths = options.commandPaths || bridgeCommandNames.map((name) => path.join(binDir, platform === "win32" ? `${name}.cmd` : name));
  const expectedBridgeShims = commandPaths.map((commandPath) => ({
    commandPath,
    content: renderShim({ platform, nodeRuntime, entrypoint, envPath: config.envPath, environment: shimEnvironment(config) }),
  }));
  const bridgeShimsMatch = expectedBridgeShims.every(({ commandPath, content }) => shimMatches(commandPath, content));
  const bridgeFollowsCurrent = samePath(entrypoint, currentEntrypoint, platform) && bridgeShimsMatch;
  const pathReady = pathEntries(env.PATH || env.Path || "").some((entry) => samePath(entry, binDir, platform));
  return {
    ready: fs.existsSync(entrypoint) && bridgeShimsMatch,
    followsCurrent: bridgeFollowsCurrent,
    pathReady,
    binDir,
    commandPath: commandPaths[0],
    mailIngest: {
      ready: fs.existsSync(entrypoint) && bridgeShimsMatch,
      followsCurrent: bridgeFollowsCurrent,
      commandPath: commandPaths[0],
      command: "pa-cli mail ingest",
    },
  };
}

export function mailIngestCliStatus(config, options = {}) {
  return bridgeCliStatus(config, options).mailIngest;
}

export function defaultUserBin({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
  if (env.PRIVATE_SITE_CLI_BIN) return path.resolve(env.PRIVATE_SITE_CLI_BIN);
  if (platform === "win32") return path.resolve(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "npm");
  const candidates = [path.join(homeDir, ".local", "bin"), path.join(homeDir, "bin")];
  const existing = pathEntries(env.PATH || "").find((entry) => candidates.some((candidate) => samePath(entry, candidate, platform)));
  return existing || candidates[0];
}

export function renderShim({ platform = process.platform, nodeRuntime = process.execPath, entrypoint, envPath, environment = {} }) {
  const values = { OPEN_AGENT_BRIDGE_ENV_FILE: envPath, ...environment };
  if (platform === "win32") {
    const assignments = Object.entries(values).map(([key, value]) => `set "${key}=${windowsEnvironmentValue(value)}"`).join("\r\n");
    return `@echo off\r\nsetlocal\r\n${assignments}\r\n"${cmdValue(nodeRuntime).replaceAll("/", "\\")}" "${cmdValue(entrypoint).replaceAll("/", "\\")}" %*\r\n`;
  }
  const assignments = Object.entries(values).map(([key, value]) => `${key}=${shellValue(value)}`).join(" ");
  return `#!/bin/sh\n${assignments} exec ${shellValue(nodeRuntime)} ${shellValue(entrypoint)} "$@"\n`;
}

function shimEnvironment(config) {
  return {
    PRIVATE_SITE_DATA_ROOT: config.dataRoot,
    OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: config.mailDir || path.join(config.dataRoot, "mail"),
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${config.ports?.bridge || 8788}`,
  };
}

function resolveShimNodeRuntime({ platform, installRoot, configured }) {
  if (configured) return path.resolve(configured);
  const candidate = path.join(installRoot, "current", "runtime", platform === "win32" ? "node.exe" : "node");
  return fs.existsSync(candidate) ? candidate : process.execPath;
}

export function bridgeCliInvocation(commandPath, args, { platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    return { command: env.ComSpec || "cmd.exe", args: ["/d", "/c", "call", commandPath, ...args] };
  }
  return { command: commandPath, args };
}

function pathEntries(value) {
  return String(value).split(path.delimiter).map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

function canonicalDirectory(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function resolveCurrentReleaseRoot(installRoot) {
  const current = path.join(installRoot, "current");
  try {
    if (fs.lstatSync(current).isFile()) {
      const pointer = fs.readFileSync(current, "utf8").trim();
      if (pointer) return canonicalDirectory(path.isAbsolute(pointer) ? pointer : path.resolve(installRoot, pointer));
    }
  } catch {}
  return canonicalDirectory(current);
}

function samePath(left, right, platform = process.platform) {
  const normalize = (value) => {
    const normalized = path.resolve(String(value)).replace(/[\\/]+$/, "");
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

function cmdValue(value) {
  return String(value).replaceAll("%", "%%").replaceAll("\r", "").replaceAll("\n", "");
}

function windowsEnvironmentValue(value) {
  const escaped = cmdValue(value);
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(escaped) ? escaped : escaped.replaceAll("/", "\\");
}

function shellValue(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function shimMatches(filePath, expected) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 64 * 1024) return false;
    return fs.readFileSync(filePath, "utf8") === expected;
  } catch {
    return false;
  }
}
