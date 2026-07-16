import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import {
  clearDefaultPersonalApp,
  publicPersonalApp,
  resolveDefaultPersonalApp,
  resolvePersonalAppAsset,
  scanPersonalApps,
  setDefaultPersonalApp,
  writePersonalAppCompatibilityReport,
} from "../src/apps.ts";

test("Personal Apps are cataloged, hosted from the entry directory, and selected without Cloud", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-apps-"));
  try {
    initializeSite({ domain: "local.example", dataRoot: root });
    const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: root, SITE_DOMAIN: "local.example" });
    createApp(config, "example.dashboard", "1", {
      "index.html": "<!doctype html><title>Dashboard</title>",
      "assets/app.12345678.js": "globalThis.appReady=true",
      "src/private.js": "not served",
      "assets/app.js.map": "not served",
    });
    createApp(config, "example.future", "2", { "index.html": "future" });
    fs.mkdirSync(path.join(config.appsDir, "example.invalid"), { recursive: true });
    fs.writeFileSync(path.join(config.appsDir, "example.invalid", "personal-agent.app.json"), "{}\n");

    const scan = scanPersonalApps(config);
    assert.deepEqual(scan.apps.map((app) => [app.id, app.compatible]), [["example.dashboard", true], ["example.future", false]]);
    assert.deepEqual(scan.invalid.map((entry) => entry.id), ["example.invalid"]);
    assert.equal(publicPersonalApp(scan.apps[0]).route, "/app/apps/example.dashboard");
    assert.equal(publicPersonalApp(scan.apps[0]).desktopRoute, "/app/apps/example.dashboard");
    assert.equal(publicPersonalApp(scan.apps[0]).mobileRoute, "/app/mobile/apps/example.dashboard");
    assert.equal(publicPersonalApp(scan.apps[0]).assetRoute, "/apps/example.dashboard/");

    const home = resolvePersonalAppAsset(config, "/apps/example.dashboard/");
    assert.equal(path.basename(home.filePath), "index.html");
    assert.equal(home.cacheControl, "no-cache");
    assert.equal(path.basename(resolvePersonalAppAsset(config, "/apps/example.dashboard/settings").filePath), "index.html");
    assert.equal(resolvePersonalAppAsset(config, "/apps/example.dashboard/assets/app.12345678.js").cacheControl, "public, max-age=31536000, immutable");
    assert.equal(resolvePersonalAppAsset(config, "/apps/example.dashboard/src/private.js"), null);
    assert.equal(resolvePersonalAppAsset(config, "/apps/example.dashboard/assets/app.js.map"), null);
    assert.equal(resolvePersonalAppAsset(config, "/apps/example.future/"), null);

    assert.equal(resolveDefaultPersonalApp(config).app, null);
    assert.equal(setDefaultPersonalApp(config, "example.dashboard").app.id, "example.dashboard");
    assert.equal(resolveDefaultPersonalApp(config).app.id, "example.dashboard");
    assert.throws(() => setDefaultPersonalApp(config, "example.future"), /unsupported Node API/);

    const report = writePersonalAppCompatibilityReport(config);
    assert.deepEqual(report.compatible, ["example.dashboard"]);
    assert.deepEqual(report.incompatible.map((entry) => entry.id), ["example.future"]);
    assert.deepEqual(report.invalid.map((entry) => entry.id), ["example.invalid"]);
    assert.equal(report.effectiveDefaultAppId, "example.dashboard");
    assert.equal(JSON.parse(fs.readFileSync(config.appsCompatibilityPath, "utf8")).schemaVersion, 1);

    clearDefaultPersonalApp(config);
    assert.equal(resolveDefaultPersonalApp(config).fallback, "official-console");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an invalid default App never removes the official Console fallback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-app-fallback-"));
  try {
    initializeSite({ domain: "local.example", dataRoot: root });
    const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: root, SITE_DOMAIN: "local.example" });
    fs.writeFileSync(config.appsConfigPath, `${JSON.stringify({ schemaVersion: 1, defaultAppId: "example.missing" })}\n`);
    assert.deepEqual(resolveDefaultPersonalApp(config), { configuredAppId: "example.missing", app: null, fallback: "missing-or-invalid-app" });
    fs.writeFileSync(config.appsConfigPath, "not json\n");
    assert.equal(resolveDefaultPersonalApp(config).fallback, "invalid-settings");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createApp(config, id, nodeApi, files) {
  const root = path.join(config.appsDir, id);
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(root, "personal-agent.app.json"), `${JSON.stringify({
    apiVersion: "personal-agent/app-v1",
    id,
    name: id,
    entry: "dist/index.html",
    requires: { nodeApi },
  }, null, 2)}\n`);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dist, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
