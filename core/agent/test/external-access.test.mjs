import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveExternalAccess } from "../src/config.js";

test("external access requires a configured mode and a fresh managed tunnel heartbeat", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-external-access-"));
  const configDir = path.join(root, "config");
  const runtimeDir = path.join(root, "runtime");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const now = new Date("2026-07-17T08:00:00.000Z");
  try {
    fs.writeFileSync(path.join(configDir, "site.json"), JSON.stringify({ connectionMode: "local-only" }));
    assert.equal(resolveExternalAccess({ dataRoot: root, now }).ready, false);

    fs.writeFileSync(path.join(configDir, "site.json"), JSON.stringify({ connectionMode: "managed-cloud" }));
    fs.writeFileSync(path.join(configDir, "cloud.json"), JSON.stringify({ managedHost: "owner.personal-agent.cn", tunnel: { heartbeatSeconds: 20 } }));
    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "ready", lastPongAt: "2026-07-17T07:58:00.000Z" }));
    assert.deepEqual(resolveExternalAccess({ dataRoot: root, now }), { ready: false, reason: "tunnel-offline", origin: "" });

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "authorizing" }));
    assert.deepEqual(resolveExternalAccess({ dataRoot: root, now }), { ready: false, reason: "authorizing", origin: "" });

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "reauth_required" }));
    assert.deepEqual(resolveExternalAccess({ dataRoot: root, now }), { ready: false, reason: "reauth_required", origin: "" });

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "ready", lastPongAt: "2026-07-17T07:59:40.000Z" }));
    assert.deepEqual(resolveExternalAccess({ dataRoot: root, now }), { ready: true, reason: "ready", origin: "https://owner.personal-agent.cn" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
