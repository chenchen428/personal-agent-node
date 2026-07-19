import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureMailIngressSecret, initializeSite, migrateLegacyMailData, normalizeApexDomain, normalizeConnectionMode, normalizeRoutingMode, readEnvFile, resolveCodexAppServer, resolveCodexCli, resolveNodeConfig } from "../src/config.ts";
import { buildRoutes } from "../src/gateway.ts";
import { createSpace } from "../src/space-registry.ts";

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
    for (const prefix of ["/", "/login", "/logout", "/_next/static", "/public", "/app", "/app/chat", "/app/connections", "/app/channels", "/app/files", "/app/mail", "/app/data", "/app/schedules", "/app/pages", "/app/releases", "/app/skills", "/app/settings", "/app/setup", "/app/update", "/api/app", "/api/chat", "/api/connections", "/api/channels", "/api/managed-platforms", "/api/publications", "/api/system/setup/actions", "/api/system", "/api/extensions", "/pages", "/resources", "/blog", "/docs"]) {
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
      Object.fromEntries(Object.entries(routes.get("/app/connections")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "authenticated", targetKey: "console", upstreamPath: "/app/connections" },
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
    assert.deepEqual(
      Object.fromEntries(Object.entries(routes.get("/public")).filter(([key]) => ["access", "targetKey", "upstreamPath"].includes(key))),
      { access: "public", targetKey: "agent", upstreamPath: "/pages" },
    );
    for (const legacy of ["/admin", "/agent", "/api/agent", "/api/files"]) assert.equal(routes.has(legacy), false, legacy);
    assert.equal(config.routingMode, "path");
    assert.equal(config.site.connectionMode, "local-only");
    assert.equal(config.site.schemaVersion, 2);
    assert.equal("edgeMode" in config.site, false);
    assert.equal(config.installationDataRoot, dataRoot);
    assert.equal(config.space.kind, "personal");
    assert.equal(config.mailDir, path.join(config.dataRoot, "mail"));
    assert.equal(config.agentWorkspaceRoot, path.join(config.dataRoot, "agent-workspace"));
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

test("each Space resolves an independent Site, secrets, mail, apps, Token database, and Agent workspace", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-space-config-"));
  try {
    const personal = initializeSite({ domain: "personal-agent.local", dataRoot }).config;
    const customSpace = createSpace({ dataRoot, slug: "work", displayName: "工作" });
    const custom = initializeSite({ domain: "personal-agent.local", dataRoot, spaceId: customSpace.id }).config;
    assert.notEqual(personal.dataRoot, custom.dataRoot);
    assert.notEqual(personal.configPath, custom.configPath);
    assert.notEqual(personal.envPath, custom.envPath);
    assert.notEqual(personal.mailDir, custom.mailDir);
    assert.notEqual(personal.appsDir, custom.appsDir);
    assert.notEqual(personal.agentWorkspaceRoot, custom.agentWorkspaceRoot);
    assert.notEqual(personal.gateway.port, custom.gateway.port);
    assert.equal(path.join(personal.dataRoot, "databases", "usage").startsWith(personal.dataRoot), true);
    assert.equal(path.join(custom.dataRoot, "databases", "usage").startsWith(custom.dataRoot), true);
    assert.equal(fs.existsSync(path.join(dataRoot, "mail")), false, "mutable mail must never fall back to the installation root");
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
