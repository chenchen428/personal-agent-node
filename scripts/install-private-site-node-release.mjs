#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pruneInactiveRelease } from "../projects/core/node/src/release-pruning.mjs";
import { materializeHarnessLinks, verifyHarnessLinks } from "./harness-links.mjs";
import { canonicalInstallRoot } from "./install-root.mjs";
import { installPersonalAgentCommand } from "./personal-agent-command.mjs";

const args = parseArgs(process.argv.slice(2));
const source = path.resolve(args._[0] || "");
if (!source || !fs.existsSync(source)) throw new Error("Usage: install-private-site-node-release.mjs <release-root> [--install-root <path>]");
const verifier = path.join(source, "scripts", "verify-private-site-node-dist.mjs");
if (!fs.existsSync(verifier)) throw new Error("Release verifier is missing");
materializeHarnessLinks(source);
verifyHarnessLinks(source);
const verified = spawnSync(process.execPath, [verifier, source], { encoding: "utf8", timeout: 10 * 60_000 });
if (verified.status !== 0) throw new Error(`Release verification failed: ${String(verified.stderr || verified.stdout || "unknown error").trim()}`);
const manifest = JSON.parse(fs.readFileSync(path.join(source, "release-manifest.json"), "utf8"));
if (manifest.releaseType !== "private-site-node" || !manifest.releaseId) throw new Error("Source is not a private Site Node release");
const installRoot = canonicalInstallRoot(args.installRoot || path.join(os.homedir(), ".private-site-node"));
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
materializeHarnessLinks(target);
verifyHarnessLinks(target);

const oldCurrent = pointerTarget(current);
if (oldCurrent && path.resolve(oldCurrent) !== path.resolve(target)) replacePointer(previous, oldCurrent);
replacePointer(current, target);
const personalAgentCommand = installPersonalAgentCommand({ installRoot });
const installation = {
  schemaVersion: 1,
  activeReleaseId: manifest.releaseId,
  profile: manifest.profile,
  revision: manifest.revision,
  activatedAt: new Date().toISOString(),
  current,
  previous: oldCurrent && path.resolve(oldCurrent) !== path.resolve(target) ? oldCurrent : pointerTarget(previous),
  personalAgentCommand: personalAgentCommand.commandPath,
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

process.stdout.write(`${JSON.stringify({ ok: true, releaseId: manifest.releaseId, profile: manifest.profile, installRoot, current, target, previous: pointerTarget(previous) || "", personalAgentCommand: personalAgentCommand.commandPath, deferredPrune }, null, 2)}\n`);

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
    else result._.push(argv[index]);
  }
  return result;
}
