import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { disableExtension, enableExtension, extensionComponentSpecs, installExtension, listExtensions, removeExtension, verifyExtension } from "../src/extensions.ts";

test("installs, verifies, disables and removes a confined Plugin v1 package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-plugin-"));
  const source = path.join(root, "source");
  const config = { pluginsDir: path.join(root, "workspace", "plugins"), pluginDataDir: path.join(root, "workspace", "data", "plugins"), coreVersion: "0.1.0" };
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "personal-agent.plugin.json"), `${JSON.stringify({
    apiVersion: "personal-agent/v1",
    id: "example.tool",
    version: "1.0.0",
    name: "Example Tool",
    compatibility: { core: "^0.0.0" },
    permissions: ["workspace.files:read"],
    contributes: { workers: [{ id: "indexer", entry: "worker.mjs" }] },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(source, "worker.mjs"), "export const ok = true;\n");
  fs.writeFileSync(path.join(source, ".env"), "SECRET=must-not-copy\n");
  try {
    const installed = installExtension(config, source);
    assert.equal(installed.id, "example.tool");
    assert.equal(installed.state, "enabled");
    assert.equal(fs.existsSync(path.join(installed.root, ".env")), false);
    assert.equal(verifyExtension(config, "example.tool").permissions[0], "workspace.files:read");
    const [component] = extensionComponentSpecs(config);
    assert.equal(component.command, process.execPath);
    assert.equal(component.env.PERSONAL_AGENT_PLUGIN_ID, "example.tool");
    assert.equal(component.env.PERSONAL_AGENT_PLUGIN_DATA_DIR.startsWith(path.join(root, "workspace")), true);
    assert.equal(disableExtension(config, "example.tool").state, "disabled");
    assert.equal(extensionComponentSpecs(config).length, 0);
    assert.equal(enableExtension(config, "example.tool").state, "enabled");
    assert.equal(removeExtension(config, "example.tool").removed, true);
    assert.equal(listExtensions(config).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects plugins with unsafe entrypoints, undeclared permissions, or incompatible Core", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-plugin-invalid-"));
  const config = { pluginsDir: path.join(root, "installed"), coreVersion: "0.1.0" };
  fs.writeFileSync(path.join(root, "personal-agent.plugin.json"), JSON.stringify({
    apiVersion: "personal-agent/v1",
    id: "unsafe.plugin",
    version: "1.0.0",
    name: "Unsafe",
    compatibility: { core: "9.x" },
    permissions: ["host:root"],
    contributes: { workers: [{ id: "escape", entry: "../outside.mjs" }] },
  }));
  try {
    assert.throws(() => installExtension(config, root), /permissions|entry|compatib|invalid/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
