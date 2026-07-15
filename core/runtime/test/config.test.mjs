import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureMailIngressSecret, initializeSite, migrateLegacyMailData, normalizeApexDomain, normalizeConnectionMode, normalizeRoutingMode, readEnvFile, resolveCodexAppServer, resolveCodexCli, resolveNodeConfig } from "../src/config.ts";
import { buildRoutes } from "../src/gateway.ts";

test("normalizes Unicode apex domains to ASCII", () => {
  assert.equal(normalizeApexDomain("陈建辉.site"), "xn--b0tw49h8he.site");
});

test("rejects paths, ports, and wildcards as apex domains", () => {
  for (const value of ["https://example.site", "example.site:443", "*.example.site", "localhost"]) {
    assert.throws(() => normalizeApexDomain(value));
  }
});

test("initializes one stable Site identity and fixed path routes", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-node-"));
  try {
    const first = initializeSite({ domain: "example.site", dataRoot });
    const second = initializeSite({ domain: "example.site", dataRoot });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.config.site.siteId, second.config.site.siteId);
    const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot });
    const routes = buildRoutes(config);
    for (const prefix of ["/", "/_next/static", "/app", "/app/chat", "/app/channels", "/app/files", "/app/mail", "/app/automations", "/app/data", "/app/schedules", "/app/pages", "/app/releases", "/app/skills", "/app/setup", "/app/update", "/api/app", "/api/chat", "/api/channels", "/api/managed-platforms", "/api/publications", "/api/system", "/api/extensions", "/pages", "/resources", "/blog", "/docs"]) {
      assert.ok(routes.has(prefix), prefix);
    }
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/_next/static")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "public", targetKey: "console", upstreamPath: "/_next/static" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/setup")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "local-admin", targetKey: "console", upstreamPath: "/app/setup" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/pages")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/pages" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/channels")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/channels" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/skills")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/skills" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/chat")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/chat" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/mail")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/mail" },
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/app/update")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "local-admin", targetKey: "console", upstreamPath: "/app/update" },
    );
    for (const legacy of ["/admin", "/agent", "/api/agent", "/api/files"]) assert.equal(routes.has(legacy), false, legacy);
    assert.equal(config.routingMode, "path");
    assert.equal(config.site.connectionMode, "local-only");
    assert.equal(config.site.schemaVersion, 2);
    assert.equal("edgeMode" in config.site, false);
    assert.equal(config.mailDir, path.join(dataRoot, "mail"));
    assert.ok(readEnvFile(config.envPath).OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN);
    assert.deepEqual(config.allowedHosts, ["example.site", "example.site.local", "localhost", "127.0.0.1"]);
    assert.ok(fs.existsSync(config.envPath));
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("provisions a missing mail ingress token only at an explicit initialization or upgrade boundary", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mail-secret-"));
  try {
    const initialized = initializeSite({ domain: "example.site", dataRoot });
    const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot });
    const env = readEnvFile(config.envPath);
    delete env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN;
    fs.writeFileSync(config.envPath, `${Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, { mode: 0o600 });
    assert.equal(readEnvFile(config.envPath).OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN, undefined);
    assert.equal(ensureMailIngressSecret(config), true);
    const token = readEnvFile(config.envPath).OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN;
    assert.ok(token);
    assert.equal(ensureMailIngressSecret(resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot })), false);
    assert.equal(readEnvFile(config.envPath).OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN, token);
    assert.equal(initialized.created, true);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("connection modes are canonical and managed Cloud cannot be declared before enrollment", () => {
  for (const mode of ["local-only", "managed-cloud", "self-hosted-edge"]) assert.equal(normalizeConnectionMode(mode), mode);
  assert.throws(() => normalizeConnectionMode("managed"), /connection mode/i);
  assert.throws(() => initializeSite({ domain: "example.site", connectionMode: "managed-cloud" }), /completed personal-agent cloud connect/i);
});

test("reads legacy connection state without mutation and migrates only at an explicit boundary", () => {
  for (const [completed, expected] of [[false, "local-only"], [true, "managed-cloud"]]) {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mode-migration-"));
    try {
      const configDir = path.join(dataRoot, "config");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "site.json"), `${JSON.stringify({ schemaVersion: 1, siteId: "site_old", nodeId: "node_old", asciiDomain: "legacy.example", displayDomain: "legacy.example", edgeMode: "managed", routingMode: "path" })}\n`);
      if (completed) fs.writeFileSync(path.join(configDir, "cloud.json"), `${JSON.stringify({ schemaVersion: 1, cloudUrl: "https://personal-agent.cn", managedHost: "legacy.personal-agent.cn", siteId: "site_cloud", enrolledAt: "2026-07-13T00:00:00.000Z", tunnel: { address: "10.77.0.2/32", endpoint: "edge.personal-agent.cn:51821" } })}\n`);
      const sitePath = path.join(configDir, "site.json");
      const before = fs.readFileSync(sitePath);
      const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot });
      assert.equal(config.site.connectionMode, expected);
      assert.equal(config.site.schemaVersion, 2);
      assert.equal("edgeMode" in config.site, false);
      assert.deepEqual(fs.readFileSync(sitePath), before);
      const migrated = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot }, { migrateSite: true });
      assert.deepEqual(JSON.parse(fs.readFileSync(migrated.configPath, "utf8")), migrated.site);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  }
});

test("migrates beta mail roots into mail without deleting rollback sources and fails closed on conflicts", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mail-migration-"));
  try {
    const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot });
    const firstLegacy = path.join(dataRoot, "mail-ingress", "archive", "2026-07-13");
    const secondLegacy = path.join(dataRoot, "channels", "mail", "archive", "2026-07-13");
    fs.mkdirSync(firstLegacy, { recursive: true });
    fs.mkdirSync(secondLegacy, { recursive: true });
    fs.writeFileSync(path.join(firstLegacy, "one.eml"), "Subject: one\r\n\r\nfirst", { mode: 0o644 });
    fs.writeFileSync(path.join(secondLegacy, "one.eml"), "Subject: one\r\n\r\nfirst", { mode: 0o644 });
    fs.writeFileSync(path.join(secondLegacy, "two.eml"), "Subject: two\r\n\r\nsecond", { mode: 0o644 });

    const first = migrateLegacyMailData(config);
    assert.equal(first.copied, 2);
    assert.equal(first.sourcesRetained, true);
    assert.equal(first.rollbackSafe, true);
    assert.equal(fs.existsSync(path.join(firstLegacy, "one.eml")), true);
    assert.equal(fs.readFileSync(path.join(config.mailDir, "archive", "2026-07-13", "two.eml"), "utf8"), "Subject: two\r\n\r\nsecond");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(config.mailDir, "archive", "2026-07-13", "one.eml")).mode & 0o777, 0o600);

    const second = migrateLegacyMailData(config);
    assert.equal(second.copied, 0);
    assert.equal(second.identical, 2);

    fs.writeFileSync(path.join(firstLegacy, "conflict.eml"), "legacy");
    fs.writeFileSync(path.join(config.mailDir, "archive", "2026-07-13", "conflict.eml"), "different");
    fs.writeFileSync(path.join(firstLegacy, "not-copied.eml"), "must remain only in legacy");
    assert.throws(() => migrateLegacyMailData(config), /target conflict/);
    assert.equal(fs.existsSync(path.join(config.mailDir, "archive", "2026-07-13", "not-copied.eml")), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("routing is path-only without a host compatibility mode", () => {
  assert.equal(normalizeRoutingMode("path"), "path");
  assert.throws(() => normalizeRoutingMode("host"), /only path routing/i);
  assert.throws(() => normalizeRoutingMode("auto"), /routing mode/i);
});

test("finds a user-installed Codex when a background service has a minimal PATH", () => {
  const target = "/Users/example/.npm-global/bin/codex";
  const cli = resolveCodexCli({ HOME: "/Users/example", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, {
    platform: "darwin",
    nodeExecutable: "/Applications/Personal Agent/runtime/node",
    exists: (candidate) => candidate === target,
    realpath: (candidate) => candidate === target ? "/Users/example/.npm-global/lib/node_modules/@openai/codex/bin/codex.js" : candidate,
  });
  assert.deepEqual(cli, { command: "/Applications/Personal Agent/runtime/node", prefixArgs: [target] });
});

test("prefers the Windows desktop Codex executable over a stale npm installation", () => {
  const desktop = "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe";
  const npmModule = "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
  const options = {
    platform: "win32",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    exists: (candidate) => candidate === desktop || candidate === npmModule,
    listDesktopExecutables: () => [desktop],
  };
  const cli = resolveCodexCli({ APPDATA: "C:\\Users\\example\\AppData\\Roaming" }, options);
  assert.deepEqual(cli, { command: desktop, prefixArgs: [] });
  assert.deepEqual(resolveCodexAppServer({ APPDATA: "C:\\Users\\example\\AppData\\Roaming" }, options), {
    appServerCommand: desktop,
    appServerArgs: ["app-server"],
  });
});

test("falls back to the npm Codex module when no desktop executable exists", () => {
  const npmModule = "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
  const cli = resolveCodexCli({ APPDATA: "C:\\Users\\example\\AppData\\Roaming" }, {
    platform: "win32",
    nodeExecutable: "C:\\node.exe",
    exists: (candidate) => candidate === npmModule,
    listDesktopExecutables: () => [],
  });
  assert.deepEqual(cli, { command: "C:\\node.exe", prefixArgs: [npmModule] });
});
