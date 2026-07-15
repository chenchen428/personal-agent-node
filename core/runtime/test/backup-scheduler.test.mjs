import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isBackupDue, readBackupState, runScheduledBackup } from "../src/backup-scheduler.ts";

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-backup-scheduler-"));
  const runtimeDir = path.join(dataRoot, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  return {
    dataRoot,
    runtimeDir,
    env: {},
    site: { siteId: "site_example" },
  };
}

test("runs a due online backup and retains only bounded automatic archives", async () => {
  const config = fixture();
  try {
    const backupDir = path.join(config.dataRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      const file = path.join(backupDir, `private-site-auto-2026070${index + 1}T000000Z.psb`);
      fs.writeFileSync(file, String(index));
      fs.utimesSync(file, index + 1, index + 1);
    }
    const result = await runScheduledBackup(config, {
      now: new Date("2026-07-12T10:00:00Z"),
      createBackup: async (_config, options) => {
        fs.writeFileSync(options.outputPath, "encrypted");
        return { ok: true, archivePath: options.outputPath, bytes: 9, sha256: "a".repeat(64) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.retained, 7);
    assert.equal(fs.readdirSync(backupDir).filter((name) => name.startsWith("private-site-auto-")).length, 7);
    assert.equal(readBackupState(config).status, "ok");
    assert.equal(isBackupDue(config, new Date()), false);
  } finally {
    fs.rmSync(config.dataRoot, { recursive: true, force: true });
  }
});

test("records failure without deleting the previous successful timestamp", async () => {
  const config = fixture();
  try {
    fs.writeFileSync(path.join(config.runtimeDir, "backup-state.json"), JSON.stringify({ lastSuccessAt: "2026-07-11T10:00:00.000Z" }));
    await assert.rejects(() => runScheduledBackup(config, {
      now: new Date("2026-07-12T10:00:00Z"),
      createBackup: async () => { throw new Error("destination unavailable"); },
    }), /destination unavailable/);
    const state = readBackupState(config);
    assert.equal(state.status, "failed");
    assert.equal(state.lastSuccessAt, "2026-07-11T10:00:00.000Z");
  } finally {
    fs.rmSync(config.dataRoot, { recursive: true, force: true });
  }
});

test("recovers an abandoned backup lock", async () => {
  const config = fixture();
  try {
    fs.writeFileSync(path.join(config.runtimeDir, "backup.lock"), "99999999\n");
    const result = await runScheduledBackup(config, {
      createBackup: async (_config, options) => {
        fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
        fs.writeFileSync(options.outputPath, "encrypted");
        return { archivePath: options.outputPath, bytes: 9, sha256: "b".repeat(64) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(config.runtimeDir, "backup.lock")), false);
  } finally {
    fs.rmSync(config.dataRoot, { recursive: true, force: true });
  }
});
