import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "./config.mjs";

const commandNames = ["open-abg", "oab", "open-agent-bridge"];

export function prepareBridgeCliShims(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = path.resolve(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(os.homedir(), ".private-site-node"));
  const currentEntrypoint = path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const developmentEntrypoint = path.join(workspaceRoot, "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const entrypoint = fs.existsSync(currentEntrypoint) ? currentEntrypoint : developmentEntrypoint;
  if (!fs.existsSync(entrypoint)) throw new Error("The bundled open-abg entrypoint is missing");
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const commandPaths = [];
  for (const name of commandNames) {
    const commandPath = path.join(binDir, platform === "win32" ? `${name}.cmd` : name);
    fs.writeFileSync(commandPath, renderShim({ platform, entrypoint, envPath: config.envPath }), { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
    if (platform !== "win32") fs.chmodSync(commandPath, 0o700);
    commandPaths.push(commandPath);
  }
  return bridgeCliStatus(config, { platform, env, installRoot, binDir, commandPaths, entrypoint });
}

export function bridgeCliStatus(config, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const installRoot = path.resolve(options.installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(os.homedir(), ".private-site-node"));
  const binDir = path.resolve(options.binDir || defaultUserBin({ platform, env, homeDir: options.homeDir }));
  const entrypoint = options.entrypoint || path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const commandPaths = options.commandPaths || commandNames.map((name) => path.join(binDir, platform === "win32" ? `${name}.cmd` : name));
  const pathReady = pathEntries(env.PATH || env.Path || "").some((entry) => samePath(entry, binDir, platform));
  return {
    ready: fs.existsSync(entrypoint) && commandPaths.every((commandPath) => fs.existsSync(commandPath)),
    followsCurrent: samePath(entrypoint, path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs"), platform),
    pathReady,
    binDir,
    commandPath: commandPaths[0],
  };
}

export function defaultUserBin({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
  if (env.PRIVATE_SITE_CLI_BIN) return path.resolve(env.PRIVATE_SITE_CLI_BIN);
  if (platform === "win32") return path.resolve(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "npm");
  const candidates = [path.join(homeDir, ".local", "bin"), path.join(homeDir, "bin")];
  const existing = pathEntries(env.PATH || "").find((entry) => candidates.some((candidate) => samePath(entry, candidate, platform)));
  return existing || candidates[0];
}

export function renderShim({ platform = process.platform, entrypoint, envPath }) {
  if (platform === "win32") {
    return `@echo off\r\nsetlocal\r\nset "OPEN_AGENT_BRIDGE_ENV_FILE=${cmdValue(envPath).replaceAll("/", "\\")}"\r\nnode "${cmdValue(entrypoint).replaceAll("/", "\\")}" %*\r\n`;
  }
  return `#!/bin/sh\nOPEN_AGENT_BRIDGE_ENV_FILE=${shellValue(envPath)} exec node ${shellValue(entrypoint)} "$@"\n`;
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

function shellValue(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
