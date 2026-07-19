#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pruneInactiveRelease } from "../core/runtime/src/release-pruning.ts";
import { canonicalInstallRoot } from "./install-root.mjs";
import { installPersonalAgentCommand } from "./personal-agent-command.mjs";

const args = parseArgs(process.argv.slice(2));
const source = path.resolve(args._[0] || "");
if (!source || !fs.existsSync(source)) throw new Error("Usage: install-private-site-node-release.mjs <release-root> [--install-root <path>] [--data-root <path>] [--domain <domain>]");
const verifier = path.join(source, "scripts", "verify-private-site-node-dist.mjs");
if (!fs.existsSync(verifier)) throw new Error("Release verifier is missing");
const verified = spawnSync(process.execPath, [verifier, source], { encoding: "utf8", timeout: 10 * 60_000 });
if (verified.status !== 0) throw new Error(`Release verification failed: ${String(verified.stderr || verified.stdout || "unknown error").trim()}`);
const manifest = JSON.parse(fs.readFileSync(path.join(source, "release-manifest.json"), "utf8"));
if (manifest.releaseType !== "personal-agent-node" || manifest.schemaVersion !== 2 || !manifest.releaseId) throw new Error("Source is not a Personal Agent Node release");
const homeRoot = path.resolve(args.home || process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
const installRoot = canonicalInstallRoot(args.installRoot || path.join(homeRoot, "core"));
const dataRoot = path.resolve(args.dataRoot || process.env.PRIVATE_SITE_DATA_ROOT || path.join(homeRoot, "workspace"));
const releasesRoot = path.join(installRoot, "releases");
const target = path.join(releasesRoot, manifest.releaseId);
const temporary = `${target}.${process.pid}.tmp`;
const current = path.join(installRoot, "current");
const previous = path.join(installRoot, "previous");

fs.mkdirSync(releasesRoot, { recursive: true });
if (!fs.existsSync(target)) {
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true, preserveTimestamps: true });
  fs.renameSync(temporary, target);
}
const preactivationEnvironment = {
  ...process.env,
  PERSONAL_AGENT_HOME: homeRoot,
  PRIVATE_SITE_INSTALL_ROOT: installRoot,
  PRIVATE_SITE_DATA_ROOT: dataRoot,
  PRIVATE_SITE_CLI_BIN: path.join(installRoot, "bin"),
};
const privateSite = path.join(target, "core", "runtime", "bin", "private-site.mjs");
runCandidate(privateSite, ["init", "--domain", args.domain || "personal-agent.local", "--data-root", dataRoot], preactivationEnvironment);
runCandidate(privateSite, ["app-compatibility", "--data-root", dataRoot], preactivationEnvironment);
const oldCurrent = pointerTarget(current);
if (oldCurrent && path.resolve(oldCurrent) !== path.resolve(target)) replacePointer(previous, oldCurrent);
replacePointer(current, target);
const personalAgentCommand = installPersonalAgentCommand({ installRoot, dataRoot, homeRoot });
const installation = {
  schemaVersion: 2,
  activeReleaseId: manifest.releaseId,
  profile: manifest.profile,
  revision: manifest.revision,
  homeRoot,
  dataRoot,
  activatedAt: new Date().toISOString(),
  current,
  previous: oldCurrent && path.resolve(oldCurrent) !== path.resolve(target) ? oldCurrent : pointerTarget(previous),
  personalAgentCommand: personalAgentCommand.commandPath,
  onboarding: {
    requiredAction: "open-setup-center",
    message: "Open the local Setup Center to finish the local environment and main Agent. WeChat and managed connectivity are optional connections.",
    setupPath: "/app/setup",
    wechatRequired: false,
    statusCommand: "personal-agent setup status --json",
  },
};
fs.writeFileSync(path.join(installRoot, "installation.json"), `${JSON.stringify(installation, null, 2)}\n`, { mode: 0o600 });

const deferredPrune = [];
for (const entry of fs.readdirSync(releasesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const releasePath = path.join(releasesRoot, entry.name);
  if (![path.resolve(target), path.resolve(pointerTarget(previous) || "")].includes(path.resolve(releasePath))) {
    const pruned = pruneInactiveRelease(releasePath);
    if (pruned.deferred) deferredPrune.push({ releaseId: entry.name, reason: pruned.code });
  }
}
if (deferredPrune.length) {
  installation.deferredPrune = deferredPrune;
  fs.writeFileSync(path.join(installRoot, "installation.json"), `${JSON.stringify(installation, null, 2)}\n`, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ ok: true, releaseId: manifest.releaseId, homeRoot, installRoot, dataRoot, current, target, previous: pointerTarget(previous) || "", personalAgentCommand: personalAgentCommand.commandPath, onboarding: installation.onboarding, deferredPrune }, null, 2)}\n`);

function runCandidate(entrypoint, candidateArgs, env) {
  const result = spawnSync(process.execPath, [entrypoint, ...candidateArgs], { env, encoding: "utf8", timeout: 10 * 60_000 });
  if (result.status !== 0) {
    throw new Error(`Candidate preactivation failed: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
  }
}

function replacePointer(linkPath, targetPath) {
  if (fs.existsSync(linkPath) || fs.lstatSync(path.dirname(linkPath)).isDirectory() && isDanglingLink(linkPath)) fs.rmSync(linkPath, { force: true, recursive: false });
  fs.symlinkSync(process.platform === "win32" ? targetPath : path.relative(path.dirname(linkPath), targetPath), linkPath, process.platform === "win32" ? "junction" : "dir");
}

function pointerTarget(linkPath) {
  try { return fs.realpathSync(linkPath); } catch { return ""; }
}

function isDanglingLink(linkPath) {
  try { return fs.lstatSync(linkPath).isSymbolicLink(); } catch { return false; }
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--install-root") result.installRoot = argv[++index];
    else if (argv[index] === "--data-root") result.dataRoot = argv[++index];
    else if (argv[index] === "--home") result.home = argv[++index];
    else if (argv[index] === "--domain") result.domain = argv[++index];
    else result._.push(argv[index]);
  }
  return result;
}
