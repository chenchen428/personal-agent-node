#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pruneLocalDist } from "./prune-local-dist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const source = sourceRevision();
const releaseId = args.releaseId || `${timestamp()}-${source.commit.slice(0, 12)}${source.dirty ? "-dirty" : ""}`;
const outputRoot = path.resolve(args.output || path.join(root, "dist", "private-site-edge", releaseId));

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const relative of [
  "projects/core/edge/bin",
  "projects/core/edge/config",
  "projects/core/edge/scripts",
  "projects/core/edge/src",
  "projects/core/edge/package.json",
  "projects/core/edge/README.md",
  "infra/edge",
  "infra/acme/install-acme.sh",
  "infra/nginx/conf.d/05-private-site-edge.conf",
  "registry/site-distribution.json",
  "schemas/private-site",
  "scripts/install-private-site-edge-release.sh",
]) copy(relative);

const manifest = {
  schemaVersion: 1,
  releaseType: "private-site-edge",
  releaseId,
  revision: source.commit,
  dirty: source.dirty,
  createdAt: new Date().toISOString(),
  protocolVersion: "1.0",
  distributionVersion: "0.1.0",
};
fs.writeFileSync(path.join(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const checksums = listFiles(outputRoot)
  .filter((file) => path.basename(file) !== "SHA256SUMS")
  .map((file) => `${sha256(file)}  ${path.relative(outputRoot, file).replaceAll("\\", "/")}`)
  .join("\n");
fs.writeFileSync(path.join(outputRoot, "SHA256SUMS"), `${checksums}\n`);
const retention = pruneLocalDist(path.dirname(outputRoot), { keep: 2, preserve: [outputRoot] });
process.stdout.write(`${JSON.stringify({ ok: true, releaseId, revision: source.commit, dirty: source.dirty, outputRoot, files: listFiles(outputRoot).length, retention }, null, 2)}\n`);

function copy(relative) {
  const source = path.join(root, relative);
  const target = path.join(outputRoot, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing Edge release input: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, filter: (candidate) => !candidate.includes(`${path.sep}test${path.sep}`) });
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  walk(directory);
  return files.sort();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sourceRevision() {
  try {
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
    };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-id") result.releaseId = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
  }
  return result;
}
