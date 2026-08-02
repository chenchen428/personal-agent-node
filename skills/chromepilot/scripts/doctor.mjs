#!/usr/bin/env node
import { constants as fsConstants, accessSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);

export function executableNames(platform, pathExt = "") {
  if (platform !== "win32") return ["chromepilot"];
  const extensions = (pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^\.[a-z0-9]+$/.test(value));
  return [...new Set([...extensions.map((extension) => `chromepilot${extension}`), "chromepilot"])];
}

export function resolveChromePilotBinary({
  platform = process.platform,
  env = process.env,
  pathValue,
  pathExt,
  isUsable = defaultIsUsable,
} = {}) {
  const explicit = env.CHROMEPILOT_BIN?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) return null;
    return isUsable(explicit, platform) ? explicit : null;
  }

  const resolvedPath = pathValue ?? readEnvCaseInsensitive(env, "PATH") ?? "";
  const resolvedPathExt = pathExt ?? readEnvCaseInsensitive(env, "PATHEXT") ?? "";
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const directories = resolvedPath
    .split(delimiter)
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  for (const directory of directories) {
    for (const name of executableNames(platform, resolvedPathExt)) {
      const candidate = path.resolve(directory, name);
      if (isUsable(candidate, platform)) return candidate;
    }
  }
  return null;
}

export function buildProbeInvocation(binary, args, platform = process.platform) {
  const needsWindowsShell = platform === "win32" && /\.(?:cmd|bat)$/i.test(binary);
  return {
    command: binary,
    args,
    options: {
      encoding: "utf8",
      shell: needsWindowsShell,
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  };
}

export function runFixedProbe(binary, args, {
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const invocation = buildProbeInvocation(binary, args, platform);
  const result = spawn(invocation.command, invocation.args, invocation.options);
  return {
    ok: !result.error && result.status === 0,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

export function createDoctorReport({
  platform = process.platform,
  env = process.env,
  pathValue,
  pathExt,
  skipLive = false,
  spawn = spawnSync,
} = {}) {
  const supported = SUPPORTED_PLATFORMS.has(platform);
  const binary = supported
    ? resolveChromePilotBinary({ platform, env, pathValue, pathExt })
    : null;
  const report = {
    schemaVersion: 1,
    platform,
    supported,
    dependency: "external-authorized-distribution",
    cli: {
      found: Boolean(binary),
      executable: binary ? path.basename(binary) : null,
      commandProbe: "not-run",
    },
    runtime: {
      doctorProbe: "not-run",
    },
    ready: false,
    guidance: [],
  };

  if (!supported) {
    report.guidance.push("ChromePilot skill supports macOS, Linux, and Windows only.");
    return report;
  }
  if (!binary) {
    report.guidance.push("Install ChromePilot from an authorized distribution and add chromepilot to PATH.");
    report.guidance.push("Personal Agent does not install the external CLI automatically.");
    return report;
  }
  if (skipLive) {
    report.cli.commandProbe = "skipped";
    report.runtime.doctorProbe = "skipped";
    report.ready = true;
    return report;
  }

  const command = runFixedProbe(binary, ["help"], { platform, spawn });
  report.cli.commandProbe = command.ok ? "passed" : command.timedOut ? "timed-out" : "failed";
  if (!command.ok) {
    report.guidance.push(`ChromePilot command probe failed with exit code ${command.exitCode ?? "unknown"}.`);
    return report;
  }

  const doctor = runFixedProbe(binary, ["doctor"], { platform, spawn });
  report.runtime.doctorProbe = doctor.ok ? "passed" : doctor.timedOut ? "timed-out" : "failed";
  if (!doctor.ok) {
    report.guidance.push(`ChromePilot doctor failed with exit code ${doctor.exitCode ?? "unknown"}; verify the bridge and Chrome extension.`);
    return report;
  }

  report.ready = true;
  return report;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = createDoctorReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else renderText(report);
  return report.ready ? 0 : 2;
}

function parseArgs(argv) {
  const options = { json: false, skipLive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--skip-live") options.skipLive = true;
    else if (arg === "--platform") options.platform = requireValue(argv, ++index, arg);
    else if (arg === "--path-value") options.pathValue = requireValue(argv, ++index, arg);
    else if (arg === "--path-ext") options.pathExt = requireValue(argv, ++index, arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function readEnvCaseInsensitive(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key ? env[key] : undefined;
}

function defaultIsUsable(candidate, platform) {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (platform !== "win32") accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function renderText(report) {
  process.stdout.write(`ChromePilot platform: ${report.platform} (${report.supported ? "supported" : "unsupported"})\n`);
  process.stdout.write(`CLI: ${report.cli.found ? report.cli.executable : "missing"}; command ${report.cli.commandProbe}\n`);
  process.stdout.write(`Runtime doctor: ${report.runtime.doctorProbe}\n`);
  for (const item of report.guidance) process.stdout.write(`- ${item}\n`);
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[chromepilot-doctor] ${error.message}\n`);
    process.exitCode = 1;
  }
}
