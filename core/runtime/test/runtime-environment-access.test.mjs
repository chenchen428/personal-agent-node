import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isLocalRuntimeEnvironmentRequest, isRuntimeEnvironmentPath } from "../src/runtime-environment-access.ts";
import { isTunnelRouteAllowed } from "../src/reverse-tunnel.ts";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import { createPrivateSiteGateway } from "../src/gateway.ts";

const aliases = ["/api/", "/api/system/", "/api/node/v1/client/", "/api/chat/node/v1/client/"]
  .flatMap(prefix => ["agent-runtime", "codex-settings"].flatMap(name => ["", "/detect", "/test"].map(suffix => `${prefix}${name}${suffix}`)));
const desktop = { host: "127.0.0.1:8843", "x-personal-agent-surface": "desktop" };

test("runtime settings recognize all aliases and deny tunnel HTTP and websocket transport", () => {
  for (const route of aliases) {
    assert.equal(isRuntimeEnvironmentPath(route), true, route);
    for (const policy of ["gateway", "mobile-readonly"]) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        assert.equal(isTunnelRouteAllowed({}, route, "http", method, policy), false, `${method} ${route}`);
      }
      assert.equal(isTunnelRouteAllowed({}, route, "websocket", "GET", policy), false, route);
    }
  }
  assert.equal(isRuntimeEnvironmentPath("/api/node/v1/client/runtime"), false);
  assert.equal(isRuntimeEnvironmentPath("/api/node/v1/client/agent-runtime-other"), false);
});

test("runtime settings surface gate rejects mobile, remote hosts and cross-origin requests", () => {
  assert.equal(isLocalRuntimeEnvironmentRequest(desktop), true);
  assert.equal(isLocalRuntimeEnvironmentRequest(new Headers(desktop)), true);
  assert.equal(isLocalRuntimeEnvironmentRequest({ ...desktop, origin: "http://127.0.0.1:8843" }), true);
  for (const headers of [
    { host: "127.0.0.1:8843" }, { ...desktop, host: "example.site" },
    { ...desktop, "x-personal-agent-surface": "mobile" }, { ...desktop, "sec-ch-ua-mobile": "?1" },
    { ...desktop, "user-agent": "Mozilla/5.0 (iPhone)" }, { ...desktop, origin: "https://evil.example" },
    { ...desktop, origin: "http://127.0.0.1:8844" }, { ...desktop, origin: "null" },
    { ...desktop, "x-forwarded-for": "203.0.113.4" }, { ...desktop, "x-forwarded-for": "127.0.0.1, 203.0.113.4" },
    { ...desktop, "x-forwarded-host": "evil.example" },
  ]) assert.equal(isLocalRuntimeEnvironmentRequest(headers), false, JSON.stringify(headers));
});

test("gateway rejects remote and spoofed forwarded runtime settings before proxying", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-runtime-gateway-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const received = [];
  const upstream = http.createServer((request, response) => {
    received.push({ path: request.url, headers: request.headers });
    response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}');
  });
  await listen(upstream); t.after(() => close(upstream));
  initializeSite({ domain: "runtime.example.site", dataRoot: root });
  const base = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: root, SITE_DOMAIN: "runtime.example.site" });
  const { server } = createPrivateSiteGateway({ config: { ...base, ports: { ...base.ports, bridge: upstream.address().port, admin: upstream.address().port, control: upstream.address().port } } });
  await listen(server); t.after(() => close(server));
  const localHost = `127.0.0.1:${server.address().port}`;
  const route = "/api/chat/node/v1/client/agent-runtime";
  const accepted = await request(server, route, { host: localHost, "x-personal-agent-surface": "desktop", origin: `http://${localHost}` });
  assert.equal(accepted, 200);
  assert.equal(received.length, 1);
  for (const alias of aliases) {
    for (const headers of [
      { host: localHost },
      { host: localHost, "x-personal-agent-surface": "mobile" },
      { host: localHost, "x-personal-agent-surface": "desktop", origin: "https://evil.example" },
      { host: localHost, "x-personal-agent-surface": "desktop", "x-forwarded-for": "127.0.0.1" },
      { host: localHost, "x-personal-agent-surface": "desktop", "x-forwarded-host": localHost },
      { host: "runtime.example.site", "x-personal-agent-surface": "desktop", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": localHost, cookie: "session=ok" },
    ]) assert.equal(await request(server, alias, headers), 403, `${alias} ${JSON.stringify(headers)}`);
  }
  assert.equal(received.length, 1, "rejected requests must not reach any internal API");
});

function listen(server) { return new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }
function request(server, route, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: route, headers }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    req.on("error", reject); req.end();
  });
}
