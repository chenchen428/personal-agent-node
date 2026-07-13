import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentDataStore } from "../src/data/agent-data.js";

test("Agent data supports dynamic DDL, writes, filters, aggregation, and destructive snapshots", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-agent-data-"));
  const audits = [];
  const managedSnapshots = [];
  const data = new AgentDataStore({
    dataDir,
    audit: (operation) => audits.push(operation),
    onSnapshot: async (snapshot) => {
      managedSnapshots.push(snapshot);
      return { ok: true, objectId: `managed-${snapshot.id}` };
    },
  });
  try {
    await data.execute(`
      CREATE TABLE expenses (id INTEGER PRIMARY KEY, category TEXT, amount INTEGER, occurred_on TEXT);
      INSERT INTO expenses (category, amount, occurred_on) VALUES
        ('餐饮', 1200, '2026-07-01'), ('交通', 800, '2026-07-02'), ('餐饮', 3000, '2026-07-03');
    `, { actor: "main-agent" });
    assert.deepEqual(data.listObjects().map((object) => object.name), ["expenses"]);
    assert.deepEqual(data.describeObject("expenses").columns.map((column) => column.name), ["id", "category", "amount", "occurred_on"]);

    const filtered = data.query({
      object: "expenses",
      filters: [{ field: "category", operator: "eq", value: "餐饮" }],
      sort: [{ field: "amount", direction: "desc" }],
    });
    assert.deepEqual(filtered.rows.map((row) => row.amount), [3000, 1200]);
    const aggregate = data.query({
      object: "expenses",
      groupBy: ["category"],
      metrics: [{ function: "sum", field: "amount", alias: "total" }],
      sort: [{ field: "total", direction: "desc" }],
    });
    assert.deepEqual(aggregate.rows, [{ category: "餐饮", total: 4200 }, { category: "交通", total: 800 }]);
    assert.deepEqual(data.distinct({ object: "expenses", field: "category" }).map((item) => item.value), ["餐饮", "交通"]);

    const destructive = await data.execute("ALTER TABLE expenses DROP COLUMN occurred_on", { actor: "main-agent" });
    assert.ok(destructive.operation.snapshotId);
    assert.equal(data.listSnapshots().length, 1);
    assert.equal(managedSnapshots.length, 1);
    assert.equal(fs.statSync(managedSnapshots[0].filePath).isFile(), true);
    assert.equal(data.describeObject("expenses").columns.some((column) => column.name === "occurred_on"), false);
    assert.ok(audits.some((operation) => operation.kind === "destructive" && operation.status === "succeeded"));
    await assert.rejects(() => data.execute("ATTACH DATABASE '/tmp/other.sqlite' AS other"), /escapes/);
  } finally {
    data.close();
  }
});

test("Agent data blocks unknown browser fields and keeps SQL reads available to the Agent", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-agent-data-read-"));
  const data = new AgentDataStore({ dataDir });
  try {
    await data.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES ('one')");
    assert.throws(() => data.query({ object: "notes", filters: [{ field: "missing", operator: "eq", value: 1 }] }), /unknown data field/);
    const result = await data.execute("SELECT body FROM notes");
    assert.deepEqual(result.rows, [{ body: "one" }]);
  } finally {
    data.close();
  }
});
