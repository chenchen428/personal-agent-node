import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppHistoryStore } from "../src/apps/history-store.js";

test("App history stays inside the matching trusted Personal App", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-app-history-"));
  try {
    createApp(root, "example.daily-brief");
    createApp(root, "example.other");
    const store = new AppHistoryStore({ appsDir: root });
    const created = store.append("example.daily-brief", {
      kind: "refresh",
      title: "Refresh daily brief",
      summary: "Mail, shared data and Pages were refreshed.",
      sources: ["mail", "data", "pages", "unknown"],
    });
    assert.match(created.id, /^apphist_/);
    assert.deepEqual(created.sources, ["mail", "data", "pages"]);
    assert.equal(store.list("example.daily-brief").items[0].title, "Refresh daily brief");
    assert.equal(store.list("example.other").total, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "example.daily-brief", "data", "history.json"), "utf8")).schemaVersion, 1);
    assert.throws(() => store.append("../outside", { title: "No" }), /Invalid App id/);
    assert.throws(() => store.append("example.missing", { title: "No" }), /App was not found/);
    assert.throws(() => store.append("example.daily-brief", { kind: "sql", title: "No" }), /Unsupported history kind/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createApp(appsDir, id) {
  const root = path.join(appsDir, id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "personal-agent.app.json"), `${JSON.stringify({
    apiVersion: "personal-agent/app-v1",
    id,
    name: id,
    entry: "dist/index.html",
    requires: { nodeApi: "1" },
  })}\n`);
}
