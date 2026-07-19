#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const releaseRoot = path.resolve(process.argv[2] || "");
if (!releaseRoot || !fs.existsSync(releaseRoot)) throw new Error("Usage: verify-private-site-edge-dist.mjs <release-root>");
const manifest = readJson(path.join(releaseRoot, "release-manifest.json"));
if (manifest.releaseType !== "private-site-edge" || !manifest.releaseId || !manifest.revision) throw new Error("Invalid Edge release manifest");
if (manifest.dirty !== false) throw new Error("Production Edge release must be built from a clean worktree");
for (const relative of [
  "core/edge/bin/private-site-edge.mjs",
  "core/edge/bin/self-hosted-relay.mjs",
  "core/edge/scripts/reconcile-certificates.sh",
  "infra/edge/migrate-current-site.sh",
  "infra/edge/bootstrap-host.sh",
  "infra/edge/logrotate/private-site-edge.conf",
  "infra/edge/wireguard/setup-hub.sh",
  "infra/edge/pki/init-origin-pki.sh",
  "infra/edge/install-self-hosted-relay.sh",
  "infra/nginx/conf.d/05-private-site-edge.conf",
  "registry/site-distribution.json",
  "SHA256SUMS",
]) {
  if (!fs.existsSync(path.join(releaseRoot, relative))) throw new Error(`Edge release is missing ${relative}`);
}
for (const line of fs.readFileSync(path.join(releaseRoot, "SHA256SUMS"), "utf8").trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw new Error(`Invalid checksum line: ${line}`);
  const file = path.resolve(releaseRoot, match[2]);
  if (!file.startsWith(`${releaseRoot}${path.sep}`) || !fs.existsSync(file)) throw new Error(`Unsafe checksum path: ${match[2]}`);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, releaseId: manifest.releaseId, revision: manifest.revision }, null, 2)}\n`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
