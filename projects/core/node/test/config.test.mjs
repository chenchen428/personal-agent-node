import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, normalizeApexDomain, normalizeRoutingMode, resolveCodexAppServer, resolveCodexCli, resolveNodeConfig } from "../src/config.mjs";
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
    assert.deepEqual(config.allowedHosts, ["example.site", "example.site.local", "localhost", "127.0.0.1"]);
    assert.ok(fs.existsSync(config.envPath));
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
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
