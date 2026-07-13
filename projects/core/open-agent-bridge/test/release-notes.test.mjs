import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ReleaseNotesStore } from "../src/release-notes/store.js";

test("release notes store reads a sorted accepted ledger and stable details", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
  const releasesDir = path.join(rootDir, "releases");
  fs.mkdirSync(releasesDir, { recursive: true });
  const older = release("20260712T120000Z-aaaaaaaaaaaa", "2026-07-12T12:00:00.000Z", "Older release", "a");
  const newer = release("20260713T120000Z-bbbbbbbbbbbb", "2026-07-13T12:00:00.000Z", "Release Notes and WeChat notification", "b");
  fs.writeFileSync(path.join(releasesDir, `${newer.releaseId}.json`), JSON.stringify(newer));
  fs.writeFileSync(path.join(rootDir, "index.json"), JSON.stringify({
    schemaVersion: 1,
    releases: [summary(older), summary(newer)],
  }));

  const store = new ReleaseNotesStore({ rootDir });
  assert.deepEqual(store.list().map((item) => item.releaseId), [newer.releaseId, older.releaseId]);
  assert.equal(store.get(newer.releaseId)?.summary, newer.summary);
  assert.equal(store.get("../secrets"), null);
  assert.equal(store.get(older.releaseId), null);
});

test("release notes store rejects malformed records without returning partial data", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-invalid-"));
  fs.writeFileSync(path.join(rootDir, "index.json"), JSON.stringify({ schemaVersion: 1, releases: [{ releaseId: "../../bad" }] }));
  assert.throws(() => new ReleaseNotesStore({ rootDir }).list(), /Release Notes/);
});

function release(releaseId, releasedAt, releaseSummary, commitCharacter) {
  const commit = commitCharacter.repeat(40);
  return {
    schemaVersion: 1,
    project: "personal-agent.local",
    status: "success",
    releaseId,
    previousReleaseId: "",
    commit,
    previousCommit: "",
    versionChanged: true,
    builtAt: releasedAt,
    releasedAt,
    summary: releaseSummary,
    changes: [{ commit, subject: releaseSummary }],
    checks: ["Installed runtime acceptance passed"],
    services: ["Open Agent Bridge"],
    publicUrls: ["https://agent.personal-agent.local"],
  };
}

function summary(value) {
  return {
    releaseId: value.releaseId,
    releasedAt: value.releasedAt,
    summary: value.summary,
    commit: value.commit,
    status: value.status,
  };
}
