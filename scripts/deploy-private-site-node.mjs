#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write("Usage: node scripts/deploy-private-site-node.mjs [--profile <name>] [--install-root <path>] [--data-root <path>]\n");
  process.exit(0);
}

const homeRoot = path.resolve(args.home || process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
const installRoot = path.resolve(args.installRoot || path.join(homeRoot, "core"));
const dataRoot = path.resolve(args.dataRoot || process.env.PRIVATE_SITE_DATA_ROOT || path.join(homeRoot, "workspace"));
const releaseOpsRoot = path.join(root, ".local", "release-ops");
const lockPath = path.join(releaseOpsRoot, "private-site-node.lock");
const environment = {
  ...process.env,
  PERSONAL_AGENT_HOME: homeRoot,
  PRIVATE_SITE_INSTALL_ROOT: installRoot,
  PRIVATE_SITE_DATA_ROOT: dataRoot,
};

fs.mkdirSync(releaseOpsRoot, { recursive: true });
const lock = acquireLock(lockPath);
let previousRoot = pointerTarget(path.join(installRoot, "current"));
let installed = false;

try {
  requireCleanWorktree();
  const previousManifest = readManifest(previousRoot);
  const profile = args.profile || previousManifest?.profile || "universal";
  const build = runJson(process.execPath, [path.join(root, "scripts", "build-private-site-node-dist.mjs"), "--profile", profile], { timeout: 30 * 60_000 });
  const releaseRoot = path.resolve(build.outputRoot);
  const verified = runJson(process.execPath, [path.join(root, "scripts", "verify-private-site-node-dist.mjs"), releaseRoot], { timeout: 10 * 60_000 });

  stopPlatformService(previousRoot);
  const installation = runJson(process.execPath, [path.join(root, "scripts", "install-private-site-node-release.mjs"), releaseRoot, "--home", homeRoot, "--install-root", installRoot, "--data-root", dataRoot]);
  installed = true;
  const activeRoot = pointerTarget(path.join(installRoot, "current"));
  const activeCli = nodeCli(activeRoot);
  runJson(process.execPath, [activeCli, "prepare"], { env: environment, timeout: 20 * 60_000 });
  const service = runJson(process.execPath, [activeCli, "service-prepare"], { env: environment });
  activatePlatformService(service);
  const status = waitForNode(activeCli);
  const acceptance = runJson(process.execPath, [activeCli, "verify", "--json"], { env: environment, timeout: 180_000 });
  if (!acceptance.ok) throw new Error("Installed private Site Node route acceptance failed");

  if (previousManifest) writeJson(path.join(releaseOpsRoot, "previous-manifest.json"), previousManifest);
  const currentManifest = readManifest(activeRoot);
  writeJson(path.join(releaseOpsRoot, "current-manifest.json"), currentManifest);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId: currentManifest.releaseId,
    previousReleaseId: previousManifest?.releaseId || "",
    profile,
    activeRoot,
    build: { files: build.files, retention: build.retention },
    verified: verified.ok === true,
    installation,
    service: { platform: service.platform, serviceId: service.serviceId },
    supervisor: { alive: status.supervisor.alive, components: Object.keys(status.supervisor.components || {}).sort() },
    acceptance: { ok: acceptance.ok, checks: acceptance.checks.length },
  }, null, 2)}\n`);
} catch (error) {
  if (installed && previousRoot && fs.existsSync(previousRoot)) {
    try {
      stopPlatformService(pointerTarget(path.join(installRoot, "current")));
      runJson(process.execPath, [path.join(root, "scripts", "install-private-site-node-release.mjs"), previousRoot, "--home", homeRoot, "--install-root", installRoot, "--data-root", dataRoot]);
      const rollbackCli = nodeCli(pointerTarget(path.join(installRoot, "current")));
      runJson(process.execPath, [rollbackCli, "prepare"], { env: environment, timeout: 20 * 60_000 });
      activatePlatformService(runJson(process.execPath, [rollbackCli, "service-prepare"], { env: environment }));
      waitForNode(rollbackCli);
    } catch (rollbackError) {
      error.message = `${error.message}; rollback failed: ${rollbackError.message}`;
    }
  }
  throw error;
} finally {
  fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
}

function stopPlatformService(activeRoot) {
  if (process.platform === "win32") {
    spawnSync("schtasks.exe", ["/End", "/TN", "PrivateSiteNode"], { stdio: "ignore", windowsHide: true });
  } else if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/site.personal-agent.private-site-node`], { stdio: "ignore" });
  } else if (process.platform === "linux") {
    spawnSync("systemctl", ["--user", "stop", "private-site-node.service"], { stdio: "ignore" });
  } else {
    throw new Error(`Unsupported private Site Node platform: ${process.platform}`);
  }
  if (activeRoot && fs.existsSync(nodeCli(activeRoot))) {
    spawnSync(process.execPath, [nodeCli(activeRoot), "stop"], { env: environment, stdio: "ignore", windowsHide: true, timeout: 60_000 });
  }
}

function activatePlatformService(service) {
  if (service.platform === "win32") {
    run("schtasks.exe", ["/Create", "/TN", service.taskName, "/XML", service.taskXmlPath, "/F"]);
    run("schtasks.exe", ["/Run", "/TN", service.taskName]);
    return;
  }
  fs.mkdirSync(path.dirname(service.installPath), { recursive: true });
  fs.copyFileSync(service.filePath, service.installPath);
  if (service.platform === "darwin") {
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${service.serviceId}`], { stdio: "ignore" });
    run("launchctl", ["bootstrap", `gui/${process.getuid()}`, service.installPath]);
    return;
  }
  if (service.platform === "linux") {
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", service.serviceId]);
    return;
  }
  throw new Error(`Unsupported private Site Node platform: ${service.platform}`);
}

function waitForNode(cliPath) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const status = runJson(process.execPath, [cliPath, "status", "--json"], { env: environment, timeout: 20_000 });
      const required = ["open-agent-bridge", "open-agent-bridge-worker", "personal-agent-control-api", "personal-agent-app", "private-site-gateway"];
      if (status.supervisor?.alive && required.every((name) => status.supervisor.components?.[name])) return status;
    } catch (error) {
      lastError = error;
    }
    sleep(1000);
  }
  throw new Error(`Private Site Node did not recover within 120 seconds${lastError ? `: ${lastError.message}` : ""}`);
}

function requireCleanWorktree() {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (status.trim()) throw new Error("Private Site Node deployment requires a clean worktree");
}

function acquireLock(filePath) {
  try {
    const descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return descriptor;
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another Node deployment owns ${filePath}; inspect the lock before removing it`);
    throw error;
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: options.env || environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 120_000,
  });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${String(result.stderr || result.stdout || "unknown error").trim().slice(0, 500)}`);
  return result.stdout;
}

function runJson(command, commandArgs, options = {}) {
  const output = run(command, commandArgs, options);
  const trimmed = output.trim();
  for (let index = trimmed.lastIndexOf("{"); index >= 0; index = trimmed.lastIndexOf("{", index - 1)) {
    try { return JSON.parse(trimmed.slice(index)); } catch {}
  }
  throw new Error(`${path.basename(command)} returned invalid JSON`);
}

function readManifest(releaseRoot) {
  if (!releaseRoot) return null;
  const manifestPath = path.join(releaseRoot, "release-manifest.json");
  return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function pointerTarget(pointer) {
  try { return fs.realpathSync(pointer); } catch { return ""; }
}

function nodeCli(releaseRoot) {
  return path.join(releaseRoot, "core", "runtime", "bin", "private-site.mjs");
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (["--help", "-h"].includes(argv[index])) parsed.help = true;
    else if (argv[index] === "--profile") parsed.profile = argv[++index];
    else if (argv[index] === "--home") parsed.home = argv[++index];
    else if (argv[index] === "--install-root") parsed.installRoot = argv[++index];
    else if (argv[index] === "--data-root") parsed.dataRoot = argv[++index];
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  return parsed;
}
