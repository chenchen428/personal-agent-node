import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { getDataExport, startDataExport } from "../core/control/data-export.js";
import { extractZipMember } from "../scripts/lib/zip-member.mjs";

test("data export creates a zip with mail, publications, planning history, and consistent SQLite snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-data-export-"));
  try {
    fs.mkdirSync(path.join(root, "mail"), { recursive: true });
    fs.writeFileSync(path.join(root, "mail", "message.eml"), "Subject: Test\r\n\r\nBody");
    fs.mkdirSync(path.join(root, "publications", "private"), { recursive: true });
    fs.writeFileSync(path.join(root, "publications", "private", "index.html"), "<h1>Page</h1>");
    const databaseDir = path.join(root, "databases", "bridge");
    fs.mkdirSync(databaseDir, { recursive: true });
    const database = new DatabaseSync(path.join(databaseDir, "state.sqlite"));
    database.exec("PRAGMA journal_mode=WAL");
    database.exec("CREATE TABLE sessions (id TEXT, parent_session_id TEXT, role TEXT, status TEXT, title TEXT, task_description TEXT, summary TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE events (session_id TEXT, seq INTEGER, payload_json TEXT, created_at TEXT)");
    database.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("s1", null, "main", "running", "Plan", "Task", "Summary", "2026-01-01", "2026-01-02");
    database.prepare("INSERT INTO events VALUES (?, ?, ?, ?)").run("s1", 1, JSON.stringify({ metadata: { eventType: "turn/plan/updated", plan: [{ step: "Do it", status: "in_progress" }] } }), "2026-01-02");
    const started = startDataExport(root);
    let current = started;
    for (let attempt = 0; attempt < 100 && current.state === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = getDataExport(started.id);
    }
    assert.equal(current.state, "completed");
    assert.equal(current.progress, 100);
    assert.equal(fs.statSync(current.path).isFile(), true);
    assert.match(current.revealUrl, /reveal-export/);
    const archive = fs.readFileSync(current.path);
    for (const entry of ["邮件/message.eml", "发布页/private/index.html", "历史规划/规划记录.json", "数据库/bridge/state.sqlite", "数据库/README.txt"]) {
      assert.notEqual(archive.indexOf(Buffer.from(entry)), -1, `zip should contain ${entry}`);
    }
    const snapshotPath = path.join(root, "snapshot.sqlite");
    fs.writeFileSync(snapshotPath, extractZipMember(archive, "数据库/bridge/state.sqlite"));
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 1);
    snapshot.close();
    const manifest = JSON.parse(extractZipMember(archive, "导出说明.json").toString("utf8"));
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(manifest.databaseFiles, ["bridge/state.sqlite"]);
    assert.match(manifest.databaseConsistency, /WAL\/SHM/);
    assert.equal(archive.indexOf(Buffer.from("state.sqlite-wal")), -1);
    assert.equal(archive.indexOf(Buffer.from("state.sqlite-shm")), -1);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
