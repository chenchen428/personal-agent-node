import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import http from "node:http";
import { resolveExternalAccess } from "../src/config.js";
import { initializeSite, resolveNodeConfig } from "../../runtime/src/config.ts";
import { createSpace, updateSpaceRuntimeState } from "../../runtime/src/space-registry.ts";
import { buildManagedPageAccess } from "../src/server/managed-links.js";
import { buildCustomSitesConnectionStatus } from "../src/connections/sites-status.js";
import { BridgeStore } from "../src/store/store.js";
import { createPrivateSiteGateway } from "../../runtime/src/gateway.ts";

test("managed external access requires a verified domain and fresh tunnel heartbeat", () => {
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
    fs.writeFileSync(path.join(configDir, "cloud.json"), JSON.stringify({ managedHost: "owner.personal-agent.cn", tunnel: { protocol: "pa-reverse-ws-v1", endpoint: "wss://cloud.example.test/v1/connect", heartbeatSeconds: 20 } }));
    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ protocol: "pa-reverse-ws-v1", state: "ready", lastPongAt: "2026-07-17T07:58:00.000Z" }));
    assert.equal(resolveExternalAccess({ dataRoot: root, now }).reason, "domain-unverified");
    fs.writeFileSync(path.join(runtimeDir, "domain-binding-verification.json"), JSON.stringify({ sites: { phase: "verified", binding: "platform", resource: "owner.personal-agent.cn" } }));
    assert.equal(resolveExternalAccess({ dataRoot: root, now }).reason, "tunnel-offline");

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "authorizing" }));
    assert.equal(resolveExternalAccess({ dataRoot: root, now }).reason, "authorizing");

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ state: "reauth_required" }));
    assert.equal(resolveExternalAccess({ dataRoot: root, now }).reason, "reauth_required");

    fs.writeFileSync(path.join(runtimeDir, "reverse-tunnel.json"), JSON.stringify({ protocol: "pa-reverse-ws-v1", state: "ready", lastPongAt: "2026-07-17T07:59:40.000Z" }));
    const ready = resolveExternalAccess({ dataRoot: root, now });
    assert.equal(ready.ready, true); assert.equal(ready.origin, "https://owner.personal-agent.cn");
    assert.equal(ready.authenticationRequired, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verified independent custom domains drive Sites, session and Page links despite legacy local-only and stale display URLs", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-custom-domain-links-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config: owner } = initializeSite({ dataRoot: root, domain: "personal-agent.local" });
  const child = createSpace({ dataRoot: root, slug: "work", displayName: "Work" });
  initializeSite({ dataRoot: root, spaceId: child.id, domain: "personal-agent.local" });
  const now = new Date("2026-09-13T12:00:00Z");
  for (const space of [owner.space, child]) {
    updateSpaceRuntimeState(root, space.id, "running");
    const domain = space.kind === "personal" ? "main.example.net" : "independent.example.org";
    const binding = { kind: "sites", scope: "space", ownerSpaceId: space.id, domain,
      tunnel: { protocol: "pa-reverse-ws-v1", endpoint: `wss://${domain}/v1/connect`, heartbeatSeconds: 20, generation: 1 } };
    const verification = { phase: "verified", binding: "custom", resource: domain, verifiedAt: now.toISOString() };
    fs.writeFileSync(path.join(space.root, "config", "custom-domain-bindings.json"), JSON.stringify({ schemaVersion: 1, sites: binding }));
    fs.writeFileSync(path.join(space.root, "runtime", "domain-binding-verification.json"), JSON.stringify({ sites: verification }));
    fs.writeFileSync(path.join(space.root, "runtime", "reverse-tunnel.json"), JSON.stringify({ protocol: "pa-reverse-ws-v1", state: "ready", endpointOrigin: `wss://${domain}`, generation: 1, lastPongAt: now.toISOString() }));
    const access = () => resolveExternalAccess({ dataRoot: space.root, consoleBaseUrl: "http://localhost:8788", now });
    const facts = access(); assert.equal(facts.ready, true); assert.equal(facts.inherited, false);
    assert.equal(facts.authenticationRequired, true);
    const sites = buildCustomSitesConnectionStatus({ binding, external: facts, verification });
    assert.equal(sites.state, "connected"); assert.equal(sites.details.publicOrigin, `https://${domain}`);
    const store = new BridgeStore({ dataDir: path.join(space.root, "databases", "link-test"), consoleBaseUrl: "http://localhost:8788", externalAccess: access });
    try {
      const session = store.createSession({ title: "Progress", workspaceRoot: space.root });
      assert.equal(new URL(store.getSessionRecord(session.id).url).origin, sites.details.publicOrigin);
      assert.equal(store.getSessionRecord(session.id).linkNotice, "");
      assert.equal(new URL(buildManagedPageAccess("/app/mobile/pages/private-result", facts).url).origin, sites.details.publicOrigin);
      assert.equal(resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: root, PERSONAL_AGENT_SPACE_ID: space.id, PRIVATE_SITE_DATA_ROOT: space.root }).domain, domain);
      const auth = http.createServer((_request, response) => { response.writeHead(401); response.end(); });
      await new Promise(resolve => auth.listen(0, "127.0.0.1", resolve));
      const config = resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: root, PERSONAL_AGENT_SPACE_ID: space.id, PRIVATE_SITE_DATA_ROOT: space.root });
      const gateway = createPrivateSiteGateway({ config: { ...config, ports: { ...config.ports, bridge: auth.address().port } } });
      await new Promise(resolve => gateway.server.listen(0, "127.0.0.1", resolve));
      try {
        const response = await new Promise((resolve, reject) => {
          http.get({ hostname: "127.0.0.1", port: gateway.server.address().port, path: "/app/mobile", headers: { host: domain } }, res => { res.resume(); res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location })); }).on("error", reject);
        });
        assert.equal(response.status, 302); assert.match(response.location, /^\/login\?/);
        assert.equal(access().ready, true, "a login redirect is an access boundary, not an unavailable domain");
        assert.equal(new URL(store.getSessionRecord(session.id).url).origin, sites.details.publicOrigin);
      } finally {
        gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve));
        await new Promise(resolve => auth.close(resolve));
      }
      updateSpaceRuntimeState(root, space.id, "stopped");
      assert.equal(access().ready, false); assert.equal(store.getSessionRecord(session.id).url, "");
      assert.doesNotMatch(store.getSessionRecord(session.id).linkNotice, /暂未配置/);
    } finally { store.close(); }
  }
});
