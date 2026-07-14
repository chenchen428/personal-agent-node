import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "./config.mjs";

const bridgeCommandNames = ["open-abg", "oab", "open-agent-bridge"];
const mailIngestCommandName = "open-abg-mail-ingest";

export function prepareBridgeCliShims(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = canonicalDirectory(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(os.homedir(), ".private-site-node"));
  const currentEntrypoint = path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const developmentEntrypoint = path.join(workspaceRoot, "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const entrypoint = fs.existsSync(currentEntrypoint) ? currentEntrypoint : developmentEntrypoint;
  if (!fs.existsSync(entrypoint)) throw new Error("The bundled open-abg entrypoint is missing");
  const currentMailEntrypoint = path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs");
  const developmentMailEntrypoint = path.join(workspaceRoot, "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs");
  const mailEntrypoint = fs.existsSync(currentMailEntrypoint) ? currentMailEntrypoint : developmentMailEntrypoint;
  if (!fs.existsSync(mailEntrypoint)) throw new Error("The bundled open-abg-mail-ingest entrypoint is missing");
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const commandPaths = [];
  for (const name of bridgeCommandNames) {
    const commandPath = path.join(binDir, platform === "win32" ? `${name}.cmd` : name);
    fs.writeFileSync(commandPath, renderShim({ platform, entrypoint, envPath: config.envPath }), { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
    if (platform !== "win32") fs.chmodSync(commandPath, 0o700);
    commandPaths.push(commandPath);
  }
  const mailCommandPath = path.join(binDir, platform === "win32" ? `${mailIngestCommandName}.cmd` : mailIngestCommandName);
  fs.writeFileSync(mailCommandPath, renderShim({
    platform,
    entrypoint: mailEntrypoint,
    envPath: config.envPath,
    environment: {
      PRIVATE_SITE_DATA_ROOT: config.dataRoot,
      OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: config.mailDir || path.join(config.dataRoot, "mail"),
      OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${config.ports?.bridge || 8788}`,
    },
  }), { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
  if (platform !== "win32") fs.chmodSync(mailCommandPath, 0o700);
  return bridgeCliStatus(config, { platform, env, installRoot, binDir, commandPaths, entrypoint, mailCommandPath, mailEntrypoint });
}

export function bridgeCliStatus(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = canonicalDirectory(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(os.homedir(), ".private-site-node"));
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  const entrypoint = options.entrypoint || path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const commandPaths = options.commandPaths || bridgeCommandNames.map((name) => path.join(binDir, platform === "win32" ? `${name}.cmd` : name));
  const mailEntrypoint = options.mailEntrypoint || path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs");
  const mailCommandPath = options.mailCommandPath || path.join(binDir, platform === "win32" ? `${mailIngestCommandName}.cmd` : mailIngestCommandName);
  const expectedBridgeShims = commandPaths.map((commandPath) => ({
    commandPath,
    content: renderShim({ platform, entrypoint, envPath: config.envPath }),
  }));
  const expectedMailShim = renderShim({
    platform,
    entrypoint: mailEntrypoint,
    envPath: config.envPath,
    environment: {
      PRIVATE_SITE_DATA_ROOT: config.dataRoot,
      OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: config.mailDir || path.join(config.dataRoot, "mail"),
      OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${config.ports?.bridge || 8788}`,
    },
  });
  const bridgeShimsMatch = expectedBridgeShims.every(({ commandPath, content }) => shimMatches(commandPath, content));
  const mailShimMatches = shimMatches(mailCommandPath, expectedMailShim);
  const bridgeFollowsCurrent = samePath(entrypoint, path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs"), platform) && bridgeShimsMatch;
  const mailFollowsCurrent = samePath(mailEntrypoint, path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs"), platform) && mailShimMatches;
  const pathReady = pathEntries(env.PATH || env.Path || "").some((entry) => samePath(entry, binDir, platform));
  return {
    ready: fs.existsSync(entrypoint) && fs.existsSync(mailEntrypoint) && bridgeShimsMatch && mailShimMatches,
    followsCurrent: bridgeFollowsCurrent,
    pathReady,
    binDir,
    commandPath: commandPaths[0],
    mailIngest: {
      ready: fs.existsSync(mailEntrypoint) && mailShimMatches,
      followsCurrent: mailFollowsCurrent,
      commandPath: mailCommandPath,
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

export function renderShim({ platform = process.platform, entrypoint, envPath, environment = {} }) {
  const values = { OPEN_AGENT_BRIDGE_ENV_FILE: envPath, ...environment };
  if (platform === "win32") {
    const assignments = Object.entries(values).map(([key, value]) => `set "${key}=${windowsEnvironmentValue(value)}"`).join("\r\n");
    return `@echo off\r\nsetlocal\r\n${assignments}\r\nnode "${cmdValue(entrypoint).replaceAll("/", "\\")}" %*\r\n`;
  }
  const assignments = Object.entries(values).map(([key, value]) => `${key}=${shellValue(value)}`).join(" ");
  return `#!/bin/sh\n${assignments} exec node ${shellValue(entrypoint)} "$@"\n`;
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
