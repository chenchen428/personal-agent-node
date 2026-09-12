import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeClientStartup } from "../core/app/src/components/desktop-cache/safe-client-startup.tsx";
import { initializeSite } from "../core/runtime/src/config.ts";
import { createSpace } from "../core/runtime/src/space-registry.ts";
import { clientScopeKey, CLIENT_SCOPE_ENDPOINT, startupSurface } from "../core/app/src/lib/client-scope.ts";
import { releaseVerificationEnvironment } from "../scripts/lib/release-verification-env.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("Control supplies only its authenticated current scope when Agent is unavailable", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cove-control-scope-"));
  const { config } = initializeSite({ domain: "personal-agent.local", dataRoot });
  const other = createSpace({ dataRoot, slug: "other-private", displayName: "Other private Space" });
  let agentCalls = 0;
  const unavailableAgent = http.createServer((_request, response) => { agentCalls += 1; response.writeHead(503); response.end("Agent is down"); });
  await new Promise((resolve) => unavailableAgent.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  const env = releaseVerificationEnvironment(process.env, { PRIVATE_SITE_DATA_ROOT: dataRoot, PERSONAL_AGENT_DATA_ROOT: dataRoot,
    PERSONAL_AGENT_SPACE_ID: config.space.id, PERSONAL_AGENT_CONTROL_PORT: String(port),
    OPEN_AGENT_BRIDGE_INTERNAL_URL: `http://127.0.0.1:${unavailableAgent.address().port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "fixture-token" });
  const control = spawn(process.execPath, ["--import", "tsx", "core/control/server.ts"], { cwd: root, env, stdio: "ignore" });
  t.after(async () => {
    control.kill("SIGTERM");
    await new Promise((resolve) => { if (control.exitCode !== null) resolve(); else control.once("exit", resolve); });
    unavailableAgent.closeAllConnections(); await new Promise((resolve) => unavailableAgent.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitReady(base, control);
  assert.equal((await fetch(`${base}/api/client-scope`)).status, 401);
  const headers = { "x-personal-agent-authenticated": "1", "user-agent": "Mobile Safari", "x-forwarded-host": "space.example.test" };
  const response = await fetch(`${base}/api/client-scope`, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const scope = await response.json();
  assert.deepEqual(Object.keys(scope).sort(), ["installationId", "ok", "schemaVersion", "spaceId"]);
  assert.equal(scope.spaceId, config.space.id); assert.match(scope.installationId, /^ins_/);
  assert.equal(clientScopeKey(scope, "https://space.example.test"), JSON.stringify(["https://space.example.test", scope.installationId, config.space.id]));
  assert.doesNotMatch(JSON.stringify(scope), /Other private Space|other-private|workspace|agent-workspace|token/);
  const forged = await fetch(`${base}/api/client-scope?spaceId=${other.id}`, { headers });
  assert.equal(forged.status, 400);
  assert.equal((await fetch(`${base}/api/client-scope`, { headers, method: "POST" })).status, 405);
  const head = await fetch(`${base}/api/client-scope`, { headers, method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(agentCalls, 0, "Scope identity must not call the unavailable Agent");
});

test("startup shell exposes real fixed recovery paths without unverified private content", () => {
  assert.deepEqual(startupSurface("/app/setup"), { eyebrow: "首次设置", title: "完成 Cove 初始化", setup: true });
  assert.equal(startupSurface("/app/runtime").title, "运行设置");
  const html = renderToStaticMarkup(React.createElement(SafeClientStartup, { pathname: "/app/setup", failed: false, onRetry() {} }, "old-space-private-content"));
  assert.match(html, /首次设置/); assert.match(html, /完成 Cove 初始化/);
  assert.match(html, /href="\/app\/runtime"/);
  assert.doesNotMatch(html, /old-space-private-content/);
  const shell = fs.readFileSync(path.join(root, "core/app/src/components/desktop-cache/safe-client-startup.tsx"), "utf8");
  assert.match(shell, /href="\/app\/setup"/); assert.match(shell, /href="\/app\/runtime"/); assert.match(shell, /href="\/app\/settings"/);
  assert.doesNotMatch(shell, /clientResourceCache|\{children\}|fetch\(/);
  const boundary = fs.readFileSync(path.join(root, "core/app/src/components/desktop-cache/client-session-boundary.tsx"), "utf8");
  assert.match(boundary, /if \(!state\.scope\) return <SafeClientStartup/);
  assert.match(boundary, /fetch\(CLIENT_SCOPE_ENDPOINT/);
  assert.doesNotMatch(boundary, /client\/overview|value\.machine/);
  assert.equal(CLIENT_SCOPE_ENDPOINT, "/api/system/client-scope");
  for (const value of [{}, { schemaVersion: 1, installationId: "installation", spaceId: "" }, { schemaVersion: 1, spaceId: "space" }]) {
    assert.throws(() => clientScopeKey(value, "https://example.test"), /Missing verified/);
  }
});

function freePort() { return new Promise((resolve) => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const port = socket.address().port; socket.close(() => resolve(port)); }); }); }
async function waitReady(base, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Control process exited before readiness");
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Control startup timeout");
}
