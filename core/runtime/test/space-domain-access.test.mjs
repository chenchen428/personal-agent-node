import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import { createSpace, updateSpaceRuntimeState } from "../src/space-registry.ts";
import { readCustomDomainBindings, startCustomDomainForwarder, removeCustomDomainBinding } from "../src/custom-domain.ts";
import { resolveInheritedSpaceDomain, verifyInheritedSpaceDomain } from "../src/space-domain-access.ts";
import { createPrivateSiteGateway, resolveRelaySpaceProxyTarget } from "../src/gateway.ts";
import { resolveExternalAccess } from "../../agent/src/config.js";
import { buildManagedPageAccess } from "../../agent/src/server/managed-links.js";
import { buildManagedTaskAccess } from "../../agent/src/managed-access.js";

const now = new Date("2026-09-13T12:00:00Z");
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-inherited-domain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config: owner } = initializeSite({ dataRoot: root, domain: "personal-agent.local" });
  const child = (slug) => { const space = createSpace({ dataRoot: root, slug, displayName: slug }); initializeSite({ dataRoot: root, spaceId: space.id, domain: "personal-agent.local" }); updateSpaceRuntimeState(root, space.id, "running"); return space; };
  const existing = child("work");
  const activate = async (domain = "owner.example.net", { legacy = false } = {}) => {
    await startCustomDomainForwarder({ dataRoot: owner.dataRoot, env: {}, input: { kind: "sites", domain, relayToken: "x".repeat(43) } });
    write(path.join(owner.runtimeDir, "reverse-tunnel.json"), { protocol: "pa-reverse-ws-v1", state: "ready", endpointOrigin: `wss://${domain}`, generation: 1, lastPongAt: now.toISOString() });
    if (!legacy) write(path.join(owner.runtimeDir, "domain-binding-verification.json"), { schemaVersion: 1, sites: { phase: "verified", binding: "custom", resource: domain, updatedAt: now.toISOString() } });
  };
  const access = (space = existing) => resolveInheritedSpaceDomain({ dataRoot: space.root, now });
  const verify = (space = existing, fetchImpl = async (url, options) => {
    assert.equal(options.redirect, "error"); assert.equal(options.headers.authorization, undefined);
    const host = new URL(url).hostname;
    return Response.json({ ok: true, service: "private-site-gateway", site: host, spaceId: host === access(space).inheritedBaseDomain ? owner.space.id : space.id });
  }) => verifyInheritedSpaceDomain({ dataRoot: space.root, fetchImpl, now: () => now });
  return { root, owner, child, existing, activate, access, verify };
}

test("existing and newly created Spaces inherit verified parent routing without copying credentials", async (t) => {
  const f = fixture(t); await f.activate();
  assert.equal(f.access().reason, "space-domain-verifying");
  assert.equal(f.access().ready, false, "an apex proof alone does not prove wildcard DNS/TLS");
  await f.verify();
  const created = f.child("reading"); await f.verify(created);
  for (const space of [f.existing, created]) {
    const access = f.access(space);
    assert.equal(access.domain, `${space.slug}.owner.example.net`);
    assert.equal(access.ready, true);
    assert.equal(resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: f.root, PRIVATE_SITE_DATA_ROOT: space.root, PERSONAL_AGENT_SPACE_ID: space.id }).domain, access.domain);
    assert.equal(resolveExternalAccess({ dataRoot: space.root, now }).origin, `https://${access.domain}`);
    assert.equal(buildManagedPageAccess("/app/mobile/pages/private-demo", access).url, `https://${access.domain}/app/mobile/pages/private-demo`);
    assert.equal(new URL(buildManagedTaskAccess("sess_demo", access).url).hostname, access.domain);
    assert.equal(fs.existsSync(path.join(space.root, "secrets", "custom-domain", "relay-token")), false);
    assert.equal(fs.existsSync(path.join(space.root, "config", "cloud.json")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(space.root, "config", "site.json"))).connectionMode, "local-only");
  }
  assert.throws(() => removeCustomDomainBinding({ dataRoot: f.existing.root, kind: "sites", env: {} }), { code: "CUSTOM_DOMAIN_INHERITED" });
});

test("parent rotation, same-domain Relay replacement, heartbeat expiry and disconnect invalidate inherited access", async (t) => {
  const f = fixture(t); await f.activate(); await f.verify();
  await f.activate("new.example.net");
  assert.equal(f.access().domain, "work.new.example.net"); assert.equal(f.access().ready, false);
  await f.verify(); assert.equal(f.access().ready, true);
  updateSpaceRuntimeState(f.root, f.existing.id, "stopped");
  assert.equal(f.access().reason, "space-offline"); assert.equal(f.access().ready, false);
  updateSpaceRuntimeState(f.root, f.existing.id, "running");
  assert.equal(f.access().ready, true);
  const bindings = path.join(f.root, "installation", "custom-domain-bindings.json");
  const replacement = JSON.parse(fs.readFileSync(bindings)); replacement.sites.tunnel.generation += 1;
  write(bindings, replacement); assert.equal(f.access().ready, false); assert.equal(f.access().tunnelReady, false);
  write(path.join(f.owner.runtimeDir, "reverse-tunnel.json"), { protocol: "pa-reverse-ws-v1", state: "ready", endpointOrigin: "wss://new.example.net", generation: 2, lastPongAt: now.toISOString() });
  await f.verify(); assert.equal(f.access().ready, true);
  write(path.join(f.owner.runtimeDir, "reverse-tunnel.json"), { protocol: "pa-reverse-ws-v1", state: "ready", lastPongAt: "2026-09-12T12:00:00Z" });
  assert.equal(f.access().reason, "tunnel-offline"); assert.equal(resolveExternalAccess({ dataRoot: f.existing.root, now }).origin, "");
  removeCustomDomainBinding({ dataRoot: f.owner.dataRoot, kind: "sites", env: {} });
  assert.equal(f.access(), null);
  assert.equal(resolveExternalAccess({ dataRoot: f.existing.root, now }).ready, false);
});

test("legacy parent metadata is repaired by real parent and child HTTPS probes, never assumed ready", async (t) => {
  const f = fixture(t); await f.activate(undefined, { legacy: true });
  assert.equal(f.access().reason, "parent-domain-unverified");
  const requested = [];
  await f.verify(f.existing, async (url) => { requested.push(url); return Response.json({ ok: true, service: "private-site-gateway", site: new URL(url).hostname, spaceId: requested.length === 1 ? f.owner.space.id : f.existing.id }); });
  assert.equal(requested.length, 2); assert.equal(f.access().ready, true);
  assert.equal(fs.existsSync(path.join(f.owner.runtimeDir, "domain-binding-verification.json")), false, "no parent metadata or credential was copied/mutated");
});

test("independent bindings and installation identity remain isolated", async (t) => {
  const f = fixture(t); await f.activate();
  const localPath = path.join(f.existing.root, "config", "custom-domain-bindings.json");
  write(localPath, { schemaVersion: 1, sites: { kind: "sites", domain: "independent.example.org", ownerSpaceId: f.existing.id } });
  assert.equal(f.access(), null);
  assert.equal(readCustomDomainBindings({ dataRoot: f.existing.root, env: {} }).sites.domain, "independent.example.org");
  assert.equal(resolveRelaySpaceProxyTarget({ headers: { "x-personal-agent-space-route": "work" } }, { installationDataRoot: f.root, space: f.owner.space }).statusCode, 404, "the parent wildcard cannot alias an independently bound child");
  fs.unlinkSync(localPath);
  const childSite = path.join(f.existing.root, "config", "site.json");
  const site = JSON.parse(fs.readFileSync(childSite)); write(childSite, { ...site, connectionMode: "managed-cloud" });
  write(path.join(f.existing.root, "config", "cloud.json"), { schemaVersion: 2, cloudUrl: "https://platform.example", siteId: "site_child", enrolledAt: now.toISOString(), managedHost: "work--owner.platform.example", tunnel: { protocol: "pa-reverse-ws-v1", endpoint: "wss://platform.example/v1/connect", generation: 1 } });
  assert.equal(f.access(), null); assert.equal(readCustomDomainBindings({ dataRoot: f.existing.root, env: {} }).sites, null);
  assert.equal(resolveRelaySpaceProxyTarget({ headers: { "x-personal-agent-space-route": "work" } }, { installationDataRoot: f.root, space: f.owner.space }).statusCode, 404);
  write(childSite, site);
  const bindings = path.join(f.root, "installation", "custom-domain-bindings.json");
  const document = JSON.parse(fs.readFileSync(bindings)); document.sites.ownerSpaceId = "sp_other_installation"; write(bindings, document);
  assert.equal(f.access(), null);
});

test("mismatched, oversized and racing domain probes do not publish ready evidence", async (t) => {
  const f = fixture(t); await f.activate();
  await f.verify(f.existing, async () => Response.json({ ok: true, service: "private-site-gateway", site: "work.owner.example.net", spaceId: f.owner.space.id }));
  assert.equal(f.access().ready, false);
  let cancelled = false;
  await f.verify(f.existing, async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(9000)); }, cancel() { cancelled = true; } })));
  assert.equal(cancelled, true); assert.equal(f.access().ready, false);
  await f.verify(f.existing, async (url) => {
    await f.activate("changed.example.net");
    return Response.json({ ok: true, service: "private-site-gateway", site: new URL(url).hostname, spaceId: f.existing.id });
  });
  assert.equal(f.access().ready, false); assert.equal(f.access().domain, "work.changed.example.net");
});

test("inherited gateway routes the correct Space, rotates live hosts and still requires Space authentication", async (t) => {
  const f = fixture(t); await f.activate();
  const config = resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: f.root, PRIVATE_SITE_DATA_ROOT: f.existing.root, PERSONAL_AGENT_SPACE_ID: f.existing.id });
  const auth = http.createServer((_request, response) => { response.writeHead(401); response.end(); });
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve));
  const gateway = createPrivateSiteGateway({ config: { ...config, ports: { ...config.ports, bridge: auth.address().port } } });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { gateway.server.closeAllConnections(); await new Promise((resolve) => gateway.server.close(resolve)); await new Promise((resolve) => auth.close(resolve)); });
  const request = (host, route) => new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: gateway.server.address().port, path: route, headers: { host, cookie: "parent-session=not-child-auth" } }, (res) => { let body = ""; res.on("data", (data) => body += data); res.on("end", () => resolve({ status: res.statusCode, body })); }); req.on("error", reject);
  });
  const health = await request(f.access().domain, "/__private-site/health"); assert.equal(health.status, 200); assert.equal(JSON.parse(health.body).spaceId, f.existing.id);
  assert.equal((await request(f.access().domain, "/app/mobile/calendar")).status, 302);
  assert.equal((await request("unknown.owner.example.net", "/__private-site/health")).status, 404);
  const target = resolveRelaySpaceProxyTarget({ headers: { "x-personal-agent-space-route": "work" } }, { installationDataRoot: f.root, space: f.owner.space });
  assert.equal(target.host, f.access().domain); assert.equal(target.spaceId, f.existing.id);
  await f.activate("rotated.example.net");
  assert.equal((await request("work.owner.example.net", "/__private-site/health")).status, 404);
  assert.equal((await request("work.rotated.example.net", "/__private-site/health")).status, 200);
});
