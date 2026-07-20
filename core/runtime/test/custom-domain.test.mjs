import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeSite } from "../src/config.ts";
import { customDomainInputFingerprint, normalizeCustomDomainInput, readCustomDomainBindings, removeCustomDomainBinding, startCustomDomainForwarder } from "../src/custom-domain.ts";
import { createSpace } from "../src/space-registry.ts";

test("custom-domain input accepts a normalized domain and a server-issued Relay key", () => {
  const relayToken = "a".repeat(43);
  assert.deepEqual(normalizeCustomDomainInput({ kind: "sites", domain: "Agent.Example.NET.", server: "ignored.example.net", sshUser: "root" }), {
    kind: "sites", domain: "agent.example.net", relayToken: "",
  });
  assert.equal(customDomainInputFingerprint({ kind: "mail", domain: "mail.example.net" }), "mail:mail.example.net:reuse");
  assert.equal(customDomainInputFingerprint({ kind: "mail", domain: "mail.example.net", relayToken }), `mail:mail.example.net:${crypto.createHash("sha256").update(relayToken).digest("hex")}`);
  assert.throws(() => normalizeCustomDomainInput({ kind: "sites", domain: "example.net; reboot" }), /有效的自定义域名/);
  assert.throws(() => normalizeCustomDomainInput({ kind: "sites", domain: "example.net", relayToken: "too-short" }), /有效连接密钥/);
});

test("starting a custom-domain binding prepares one protected Relay key and projects domains to every Space", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-custom-domain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config } = initializeSite({ dataRoot: root, domain: "personal-agent.local" });
  const second = createSpace({ dataRoot: root, slug: "work", displayName: "Work" });
  initializeSite({ dataRoot: root, spaceId: second.id, domain: "work.personal-agent.local" });
  await assert.rejects(startCustomDomainForwarder({
    dataRoot: config.dataRoot,
    input: { kind: "sites", domain: "agent.example.net" },
  }), /先在公网服务器安装 Relay/);
  const relayToken = crypto.randomBytes(32).toString("base64url");
  const result = await startCustomDomainForwarder({
    dataRoot: config.dataRoot,
    input: { kind: "sites", domain: "agent.example.net", relayToken },
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
  assert.equal(fs.readFileSync(path.join(config.dataRoot, "secrets", "custom-domain", "relay-token"), "utf8").trim(), relayToken);
  assert.doesNotMatch(fs.readFileSync(path.join(config.dataRoot, "config", "custom-domain-bindings.json"), "utf8"), new RegExp(relayToken));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(relayToken));
  assert.deepEqual(removeCustomDomainBinding({ dataRoot: config.dataRoot, kind: "sites" }), { removed: true, kind: "sites", domain: "agent.example.net", localDataPreserved: true });
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).connectionMode, "local-only");
  assert.equal(JSON.parse(fs.readFileSync(config.configPath, "utf8")).asciiDomain, "personal-agent.local");
  assert.equal(JSON.parse(fs.readFileSync(path.join(second.root, "config", "site.json"), "utf8")).asciiDomain, "work.personal-agent.local");
  assert.match(fs.readFileSync(path.join(second.root, "secrets", "applications", "site.env"), "utf8"), /SITE_DOMAIN="work\.personal-agent\.local"/);
});
