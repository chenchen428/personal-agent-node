import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extensionComponentSpecs, installExtension, listExtensions, removeExtension } from "../src/extensions.mjs";

test("installs a portable Node extension from a validated manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-extension-"));
  const source = path.join(root, "source");
  const config = { extensionsDir: path.join(root, "installed") };
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "private-site-extension.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "example-tool",
    version: "1.0.0",
    entrypoint: "server.mjs",
    port: 19090,
    host: "127.0.0.1",
    hostKey: "tools",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(source, "server.mjs"), "export const ok = true;\n");
  try {
    const installed = installExtension(config, source);
    assert.equal(installed.id, "example-tool");
    assert.equal(listExtensions(config).length, 1);
    const [component] = extensionComponentSpecs(config);
    assert.equal(component.command, process.execPath);
    assert.equal(component.port, 19090);
    assert.equal(component.hostKey, "tools");
    assert.equal(removeExtension(config, "example-tool").removed, true);
    assert.equal(listExtensions(config).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects extensions that escape loopback or use unsafe entrypoints", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-extension-invalid-"));
  const config = { extensionsDir: path.join(root, "installed") };
  fs.writeFileSync(path.join(root, "private-site-extension.json"), JSON.stringify({
    schemaVersion: 1,
    id: "unsafe",
    version: "1.0.0",
    entrypoint: "../outside.mjs",
    port: 19091,
    host: "0.0.0.0",
  }));
  try {
    assert.throws(() => installExtension(config, root), /loopback|entrypoint/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
