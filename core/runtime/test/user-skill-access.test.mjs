import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isLocalUserSkillRequest, isUserSkillManagementPath } from "../src/user-skill-access.ts";
import { isTunnelRouteAllowed } from "../src/reverse-tunnel.ts";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import { createPrivateSiteGateway } from "../src/gateway.ts";

const desktop = { host: "127.0.0.1:8843", origin: "http://127.0.0.1:8843", "sec-fetch-site": "same-origin", "x-personal-agent-surface": "desktop" };
const paths = ["/api/skills/user/import", "/api/skills/user/restore", "/api/skills/user/example", "/api/chat/skills/user/example"];
test("user skill mutation accepts same-origin desktop but not Agent credentials or cross-origin/mobile requests", () => {
  assert.equal(isLocalUserSkillRequest(desktop), true);
  assert.equal(isLocalUserSkillRequest(new Headers(desktop)), true);
  for (const overrides of [{ origin: "" }, { origin: "null" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "" }, { authorization: "Bearer worker-fixture" }, { "x-cove-calendar-capability": "fixture" }, { "x-personal-agent-surface": "mobile" }, { "x-forwarded-for": "203.0.113.8" }, { host: "example.test" }]) assert.equal(isLocalUserSkillRequest({ ...desktop, ...overrides }), false);
  for (const route of paths) {
    assert.equal(isUserSkillManagementPath(route), true);
    for (const policy of ["gateway", "mobile-readonly"]) for (const method of ["GET", "POST", "DELETE"]) assert.equal(isTunnelRouteAllowed({}, route, "http", method, policy), false);
  }
  assert.equal(isUserSkillManagementPath("/api/skills"), false);
});

test("gateway blocks skill mutations before proxying unless the request is directly local and same-origin", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-skill-gateway-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let received = 0, bridgeReceived = 0;
  const upstream = http.createServer((_request, response) => { received++; response.end('{"ok":true}'); });
  const bridge = http.createServer((_request, response) => { bridgeReceived++; response.end('{"ok":true}'); });
  await listen(upstream); t.after(() => close(upstream));
  await listen(bridge); t.after(() => close(bridge));
  initializeSite({ domain: "skill.example.site", dataRoot: root });
  const base = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: root, SITE_DOMAIN: "skill.example.site" });
  const { server } = createPrivateSiteGateway({ config: { ...base, ports: { ...base.ports, bridge: bridge.address().port, admin: upstream.address().port, control: upstream.address().port } } });
  await listen(server); t.after(() => close(server));
  const host = `127.0.0.1:${server.address().port}`;
  const headers = { ...desktop, host, origin: `http://${host}` };
  assert.equal(await request(server, paths[0], headers), 200);
  for (const route of paths) for (const overrides of [{ authorization: "Bearer fixture" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "x-forwarded-for": "127.0.0.1" }, { host: "skill.example.site", "x-forwarded-host": host }, { "x-personal-agent-surface": "mobile" }]) assert.equal(await request(server, route, { ...headers, ...overrides }), 403);
  assert.equal(received, 1);
  assert.equal(bridgeReceived, 0, "skill management must pass through the Console BFF, not directly to the Agent");
});
function listen(server) { return new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }
function request(server, route, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: route, method: "POST", headers }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    req.on("error", reject); req.end("{}");
  });
}
