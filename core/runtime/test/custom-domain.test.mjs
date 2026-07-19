import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeSite } from "../src/config.ts";
import { customDomainInputFingerprint, normalizeCustomDomainInput, readCustomDomainBindings, removeCustomDomainBinding, startCustomDomainForwarder } from "../src/custom-domain.ts";
import { createSpace } from "../src/space-registry.ts";

test("custom-domain input only accepts a kind and normalized domain", () => {
  assert.deepEqual(normalizeCustomDomainInput({ kind: "sites", domain: "Agent.Example.NET.", server: "ignored.example.net", sshUser: "root" }), {
    kind: "sites", domain: "agent.example.net",
  });
  assert.equal(customDomainInputFingerprint({ kind: "mail", domain: "mail.example.net" }), "mail:mail.example.net");
  assert.throws(() => normalizeCustomDomainInput({ kind: "sites", domain: "example.net; reboot" }), /有效的自定义域名/);
});

test("starting a custom-domain binding prepares one protected Relay key and projects domains to every Space", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-custom-domain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config } = initializeSite({ dataRoot: root, domain: "personal-agent.local" });
  const second = createSpace({ dataRoot: root, slug: "work", displayName: "Work" });
  initializeSite({ dataRoot: root, spaceId: second.id, domain: "work.personal-agent.local" });
  const result = await startCustomDomainForwarder({
    dataRoot: config.dataRoot,
    input: { kind: "sites", domain: "agent.example.net" },
  });
  assert.equal(result.tunnel.protocol, "pa-reverse-ws-v1");
  assert.equal(result.tunnel.routePolicy, "gateway");
  assert.equal(result.relay.serverPreparationRequired, true);
  assert.deepEqual(result.spaceRoutes.map((route) => route.domain), ["agent.example.net", "work.agent.example.net"]);
  const conflictingEnv = {
    ...process.env,
    PERSONAL_AGENT_DATA_ROOT: second.root,
    PERSONAL_AGENT_SPACE_ID: second.id,
    PERSONAL_AGENT_SPACE_ROOT: second.root,
  };
  const stored = readCustomDomainBindings({ dataRoot: config.dataRoot, env: conflictingEnv });
  assert.equal(stored.sites.domain, "agent.example.net");
  assert.equal(stored.sites.serviceReady, false);
  const inherited = readCustomDomainBindings({ dataRoot: second.root });
  assert.equal(inherited.sites.domain, "work.agent.example.net");
  assert.equal(inherited.sites.inherited, true);
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).connectionMode, "self-hosted-edge");
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).asciiDomain, "agent.example.net");
  assert.equal(JSON.parse(fs.readFileSync(path.join(second.root, "config", "site.json"), "utf8")).asciiDomain, "work.agent.example.net");
  assert.match(fs.readFileSync(path.join(second.root, "secrets", "applications", "site.env"), "utf8"), /SITE_DOMAIN="work\.agent\.example\.net"/);
  assert.match(fs.readFileSync(config.envPath, "utf8"), /PERSONAL_AGENT_CUSTOM_DOMAIN_TOKEN="[A-Za-z0-9_-]{43}"/);
  const relayToken = fs.readFileSync(path.join(config.dataRoot, "secrets", "custom-domain", "relay-token"), "utf8").trim();
  assert.match(relayToken, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(relayToken));
  assert.deepEqual(removeCustomDomainBinding({ dataRoot: config.dataRoot, kind: "sites" }), { removed: true, kind: "sites", domain: "agent.example.net", localDataPreserved: true });
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).connectionMode, "local-only");
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).asciiDomain, "personal-agent.local");
  assert.equal(JSON.parse(fs.readFileSync(path.join(second.root, "config", "site.json"), "utf8")).asciiDomain, "work.personal-agent.local");
  assert.match(fs.readFileSync(path.join(second.root, "secrets", "applications", "site.env"), "utf8"), /SITE_DOMAIN="work\.personal-agent\.local"/);
});
