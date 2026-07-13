import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, normalizeApexDomain, normalizeConnectionMode, normalizeRoutingMode, resolveCodexAppServer, resolveCodexCli, resolveNodeConfig } from "../src/config.mjs";
import { buildRoutes } from "../src/gateway.mjs";

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
    for (const prefix of ["/", "/app", "/app/chat", "/app/channels", "/app/files", "/app/mail", "/app/automations", "/app/data", "/app/schedules", "/app/releases", "/api/app", "/api/chat", "/api/channels", "/api/managed-platforms", "/api/publications", "/api/system", "/api/extensions", "/pages", "/resources", "/blog", "/docs"]) {
      assert.ok(routes.has(prefix), prefix);
    }
    for (const legacy of ["/admin", "/agent", "/api/agent", "/api/files"]) assert.equal(routes.has(legacy), false, legacy);
    assert.equal(config.routingMode, "path");
    assert.equal(config.site.connectionMode, "local-only");
    assert.equal(config.site.schemaVersion, 2);
    assert.equal("edgeMode" in config.site, false);
    assert.deepEqual(config.allowedHosts, ["example.site", "example.site.local", "localhost", "127.0.0.1"]);
    assert.ok(fs.existsSync(config.envPath));
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("connection modes are canonical and managed Cloud cannot be declared before enrollment", () => {
  for (const mode of ["local-only", "managed-cloud", "self-hosted-edge"]) assert.equal(normalizeConnectionMode(mode), mode);
  assert.throws(() => normalizeConnectionMode("managed"), /connection mode/i);
  assert.throws(() => initializeSite({ domain: "example.site", connectionMode: "managed-cloud" }), /completed personal-agent cloud connect/i);
});

test("migrates legacy connection state without reporting incomplete Cloud enrollment as managed", () => {
  for (const [completed, expected] of [[false, "local-only"], [true, "managed-cloud"]]) {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mode-migration-"));
    try {
      const configDir = path.join(dataRoot, "config");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "site.json"), `${JSON.stringify({ schemaVersion: 1, siteId: "site_old", nodeId: "node_old", asciiDomain: "legacy.example", displayDomain: "legacy.example", edgeMode: "managed", routingMode: "path" })}\n`);
      if (completed) fs.writeFileSync(path.join(configDir, "cloud.json"), `${JSON.stringify({ schemaVersion: 1, cloudUrl: "https://personal-agent.cn", managedHost: "legacy.personal-agent.cn", siteId: "site_cloud", enrolledAt: "2026-07-13T00:00:00.000Z", tunnel: { address: "10.77.0.2/32", endpoint: "edge.personal-agent.cn:51821" } })}\n`);
      const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot });
      assert.equal(config.site.connectionMode, expected);
      assert.equal(config.site.schemaVersion, 2);
      assert.equal("edgeMode" in config.site, false);
      assert.deepEqual(JSON.parse(fs.readFileSync(config.configPath, "utf8")), config.site);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  }
});

test("routing is path-only without a host compatibility mode", () => {
  assert.equal(normalizeRoutingMode("path"), "path");
  assert.throws(() => normalizeRoutingMode("host"), /only path routing/i);
  assert.throws(() => normalizeRoutingMode("auto"), /routing mode/i);
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
