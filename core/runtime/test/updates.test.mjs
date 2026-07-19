import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOperationStore } from "../src/operations.ts";
import { createUpdateManager, updateInternals } from "../src/updates.ts";

test("update manager checks, plans, autonomously authorizes, verifies, and hands off one immutable artifact", async () => {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-update-test-"));
  const dataRoot = path.join(homeRoot, "workspace");
  const runtimeDir = path.join(dataRoot, "runtime");
  const agentWorkspaceRoot = path.join(dataRoot, "agent-workspace");
  const productCheckout = path.join(agentWorkspaceRoot, "projects", "personal-agent");
  const installRoot = path.join(homeRoot, "core");
  fs.mkdirSync(path.join(installRoot, "bin"), { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(installRoot, "installation.json"), JSON.stringify({ schemaVersion: 2, activeReleaseId: "0.2.0-beta.13", previous: path.join(installRoot, "releases", "0.2.0-beta.12") }));
  const launcher = path.join(installRoot, "bin", process.platform === "win32" ? "personal-agent-ui.exe" : "personal-agent-ui");
  fs.writeFileSync(launcher, "launcher", { mode: 0o700 });
  const candidate = Buffer.from("verified candidate bytes");
  const digest = crypto.createHash("sha256").update(candidate).digest("hex");
  const tag = "v0.3.0-beta.1";
  const assetName = updateInternals.updaterAssetName(tag);
  const release = { tag_name: tag, draft: false, prerelease: true, published_at: "2026-07-17T00:00:00Z", html_url: `https://github.com/chenchen428/personal-agent-node/releases/tag/${tag}`, assets: [
    { name: assetName, size: candidate.length, browser_download_url: `https://github.com/chenchen428/personal-agent-node/releases/download/${tag}/${assetName}` },
    { name: "SHA256SUMS", browser_download_url: `https://github.com/chenchen428/personal-agent-node/releases/download/${tag}/SHA256SUMS` },
  ] };
  const fetchImpl = async (url) => {
    if (String(url).includes("api.github.com")) return Response.json([release]);
    if (String(url).endsWith("SHA256SUMS")) return new Response(`${digest}  ${assetName}\n`);
    return new Response(candidate, { headers: { "content-length": String(candidate.length) } });
  };
  const spawns = [];
  const operations = createOperationStore({ dataRoot });
  const manager = createUpdateManager({ config: { homeRoot, dataRoot, runtimeDir, agentWorkspaceRoot }, operations, fetchImpl, spawnImpl(command, args) { spawns.push({ command, args }); return { unref() {} }; } });
  try {
    const checked = await manager.check();
    assert.equal(checked.updateAvailable, true);
    assert.equal(checked.available.version, "0.3.0-beta.1");
    const planned = await manager.plan();
    await assert.rejects(manager.apply({ jobId: planned.job.id, operationId: planned.operation.id, digest: planned.operation.digest }), /not approved/i);
    await assert.rejects(
      manager.apply({ jobId: planned.job.id, operationId: planned.operation.id, digest: planned.operation.digest, authorizationPolicy: "product-development" }),
      (error) => error.code === "PRODUCT_DEVELOPMENT_REQUIRED",
    );
    fs.mkdirSync(productCheckout, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "product-development.json"), JSON.stringify({ schemaVersion: 1, repository: "chenchen428/personal-agent", checkoutPath: productCheckout, ready: true }));
    const applied = await manager.apply({ jobId: planned.job.id, operationId: planned.operation.id, digest: planned.operation.digest, authorizationPolicy: "product-development" });
    assert.equal(applied.job.status, "handoff");
    assert.deepEqual(applied.operation.approval, { kind: "policy", policy: "product-development" });
    assert.equal(spawns.length, 1);
    assert.deepEqual(spawns[0].args.slice(0, 2), ["--apply-update", planned.job.id]);
    const stored = manager.readJob(planned.job.id);
    assert.equal(fs.readFileSync(stored.artifactPath).toString(), candidate.toString());
    assert.ok(stored.handoffNonce.length >= 32);
  } finally {
    fs.rmSync(homeRoot, { recursive: true, force: true });
  }
});

test("update metadata comparison keeps stable ahead of prerelease", () => {
  assert.equal(updateInternals.compareVersions("0.3.0", "0.3.0-beta.1"), 1);
  assert.equal(updateInternals.compareVersions("0.3.1-beta.1", "0.3.0"), 1);
  assert.equal(updateInternals.channelFor("0.3.0-beta.1"), "beta");
});
