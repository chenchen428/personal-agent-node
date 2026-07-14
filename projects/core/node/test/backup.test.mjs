import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createEncryptedBackup, restoreEncryptedBackup, verifyEncryptedBackup } from "../src/backup.mjs";

test("creates and verifies an encrypted SQLite-aware backup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-backup-test-"));
  const dataRoot = path.join(root, "data");
  const databaseDir = path.join(dataRoot, "databases");
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "config", "site.json"), "{}");
  fs.mkdirSync(path.join(dataRoot, "mail", "archive", "2026-07-14"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "mail", "archive", "2026-07-14", "message.eml"), "Subject: retained\r\n\r\nmail body");
  const databasePath = path.join(databaseDir, "state.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO item(value) VALUES ('kept');");
  database.close();
  const config = {
    dataRoot,
    domain: "example.site",
    site: { siteId: "site_test", nodeId: "node_test", distributionVersion: "0.1.0" },
  };
  const archivePath = path.join(root, "backup.psb");
  const keyFile = path.join(root, "recovery.key");
  const target = path.join(root, "restored");
  try {
    const backup = await createEncryptedBackup(config, { outputPath: archivePath, keyFile });
    assert.equal(backup.ok, true);
    assert.notEqual(fs.readFileSync(archivePath).subarray(0, 16).toString(), "SQLite format 3");
    const restored = await verifyEncryptedBackup(config, { archivePath, keyFile, targetDir: target });
    assert.equal(restored.ok, true);
    assert.equal(fs.readFileSync(path.join(target, "mail", "archive", "2026-07-14", "message.eml"), "utf8"), "Subject: retained\r\n\r\nmail body");
    const restoredDatabase = new DatabaseSync(path.join(target, "databases", "state.sqlite"), { readOnly: true });
    assert.equal(restoredDatabase.prepare("SELECT value FROM item").get().value, "kept");
    restoredDatabase.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restores a protected backup with a new replacement Node identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-replacement-test-"));
  const dataRoot = path.join(root, "source");
  const target = path.join(root, "replacement");
  const site = {
    schemaVersion: 1,
    siteId: "site_stable",
    nodeId: "node_previous",
    displayDomain: "example.site",
    asciiDomain: "example.site",
    distributionVersion: "0.1.0",
  };
  fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "config", "site.json"), `${JSON.stringify(site)}\n`);
  fs.mkdirSync(path.join(dataRoot, "secrets", "node-identity"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "secrets", "node-identity", "wireguard.key"), "old-private-key");
  fs.mkdirSync(path.join(dataRoot, "secrets", "applications"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "secrets", "applications", "site.env"), "TOKEN=protected\n");
  fs.mkdirSync(path.join(dataRoot, "channels", "wechat"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "channels", "wechat", "session.dat"), "session");
  fs.mkdirSync(path.join(dataRoot, "extensions", "example"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "extensions", "example", "private-site-extension.json"), "{}");
  const config = { dataRoot, domain: site.asciiDomain, site };
  const archivePath = path.join(root, "full.psb");
  const keyFile = path.join(root, "recovery.key");
  try {
    await createEncryptedBackup(config, { outputPath: archivePath, keyFile, fullRecovery: true });
    const restored = await restoreEncryptedBackup({
      archivePath,
      keyFile,
      targetDataRoot: target,
      replacement: true,
      expectedDistributionVersion: "0.1.0",
    });
    const restoredSite = JSON.parse(fs.readFileSync(path.join(target, "config", "site.json"), "utf8"));
    const replacement = JSON.parse(fs.readFileSync(path.join(target, "config", "replacement.json"), "utf8"));
    assert.equal(restored.fullRecovery, true);
    assert.equal(restoredSite.siteId, site.siteId);
    assert.notEqual(restoredSite.nodeId, site.nodeId);
    assert.equal(replacement.previousNodeId, site.nodeId);
    assert.equal(replacement.nodeId, restoredSite.nodeId);
    assert.equal(replacement.status, "pending-edge-replacement");
    assert.equal(fs.existsSync(path.join(target, "secrets", "node-identity")), false);
    assert.equal(fs.readFileSync(path.join(target, "secrets", "applications", "site.env"), "utf8"), "TOKEN=protected\n");
    assert.equal(fs.readFileSync(path.join(target, "channels", "wechat", "session.dat"), "utf8"), "session");
    assert.equal(fs.readFileSync(path.join(target, "extensions", "example", "private-site-extension.json"), "utf8"), "{}");
    assert.equal(fs.existsSync(restored.reportPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses replacement from a data-only backup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-data-only-test-"));
  const dataRoot = path.join(root, "source");
  const site = { siteId: "site_test", nodeId: "node_test", distributionVersion: "0.1.0" };
  fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "config", "site.json"), JSON.stringify({ ...site, asciiDomain: "example.site" }));
  const archivePath = path.join(root, "data.psb");
  const keyFile = path.join(root, "recovery.key");
  try {
    await createEncryptedBackup({ dataRoot, domain: "example.site", site }, { outputPath: archivePath, keyFile });
    await assert.rejects(
      restoreEncryptedBackup({ archivePath, keyFile, targetDataRoot: path.join(root, "target"), replacement: true, expectedDistributionVersion: "0.1.0" }),
      /full-recovery backup/,
    );
    assert.equal(fs.existsSync(path.join(root, "target")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
