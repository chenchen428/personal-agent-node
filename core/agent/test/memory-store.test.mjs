import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateMemoryHeat, MemoryStore } from "../src/memory/store.js";

function fixture(spaceId = "space-a") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-memory-"));
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const sessions = new Map([
    ["main-a", { id: "main-a", role: "main" }],
    ["worker-a", { id: "worker-a", role: "worker" }],
  ]);
  const store = new MemoryStore({
    dataDir,
    databasePath: path.join(dataDir, "state.sqlite"),
    spaceId,
    sessionResolver: (id) => sessions.get(id) || null,
    now: () => now,
  });
  return { dataDir, store, sessions, setNow: (value) => { now = Date.parse(value); } };
}

test("Memory is content-only, main-Agent controlled, revision-safe, and permanently deletable", () => {
  const context = fixture();
  try {
    assert.throws(() => context.store.create({ sessionId: "worker-a" }, { content: "worker fact" }), /main Agent/);
    const created = context.store.create({ sessionId: "main-a" }, { content: "用户偏好先给结论。", title: "ignored" });
    assert.deepEqual(Object.keys(created).sort(), ["content", "createdAt", "forgetAt", "heat", "hitCount", "id", "lastHitAt", "revision", "status", "updatedAt"].sort());
    assert.equal(created.status, "active");
    assert.equal(created.heat, 55);
    assert.equal(created.hitCount, 0);
    assert.equal(created.forgetAt, "2027-01-01T00:00:00.000Z");
    assert.throws(() => context.store.update({ sessionId: "main-a" }, created.id, { content: "冲突", expectedRevision: 9 }), /revision has changed/i);
    const updated = context.store.update({ sessionId: "main-a" }, created.id, { content: "用户偏好先给结论，再说明依据。", expectedRevision: 1 });
    assert.equal(updated.revision, 2);
    assert.equal(updated.content, "用户偏好先给结论，再说明依据。");
    assert.deepEqual(context.store.delete({ sessionId: "main-a" }, updated.id, { expectedRevision: 2 }), { id: updated.id, deleted: true });
    assert.equal(context.store.getForReader(updated.id), null);
  } finally {
    context.store.close();
    fs.rmSync(context.dataDir, { recursive: true, force: true });
  }
});

test("Recall caps at twelve, ranks relevance before heat, and counts one hit per turn", () => {
  const context = fixture();
  try {
    const matching = [];
    for (let index = 0; index < 13; index += 1) {
      matching.push(context.store.create({ sessionId: "main-a" }, { content: `旅行偏好 ${index + 1}：喜欢安静路线。` }));
    }
    const unrelated = context.store.create({ sessionId: "main-a" }, { content: "写作偏好：使用短句。" });
    context.store.recall({ sessionId: "main-a" }, { query: "写作短句", sessionId: "main-a", turnId: "warm", limit: 1 });
    const recalled = context.store.recall({ sessionId: "main-a" }, { query: "旅行安静", sessionId: "main-a", turnId: "turn-1", limit: 12 });
    assert.equal(recalled.items.length, 12);
    assert.equal(recalled.items.some((item) => item.id === unrelated.id), false);
    assert.equal(recalled.hitCount, 12);
    const replay = context.store.recall({ sessionId: "main-a" }, { query: "旅行安静", sessionId: "main-a", turnId: "turn-1", limit: 12 });
    assert.equal(replay.hitCount, 0);
    assert.equal(context.store.getForReader(recalled.items[0].id).hitCount, 1);
    assert.equal(context.store.getForReader(unrelated.id).hitCount, 1);
    assert.equal(matching.filter((memory) => context.store.getForReader(memory.id).hitCount === 1).length, 12);
  } finally {
    context.store.close();
    fs.rmSync(context.dataDir, { recursive: true, force: true });
  }
});

test("One-year forgetting excludes recall and update reactivates the record", () => {
  const context = fixture();
  try {
    const created = context.store.create({ sessionId: "main-a" }, { content: "长期偏好：避免红眼航班。" });
    context.setNow("2027-01-02T00:00:00.000Z");
    assert.equal(context.store.listForReader({ status: "active" }).items.length, 0);
    const forgotten = context.store.listForReader({ status: "forgotten" }).items[0];
    assert.equal(forgotten.id, created.id);
    assert.equal(forgotten.status, "forgotten");
    assert.equal(forgotten.heat, 0);
    assert.equal(context.store.recall({ sessionId: "main-a" }, { query: "红眼航班", turnId: "after-forget" }).items.length, 0);
    const reactivated = context.store.update({ sessionId: "main-a" }, forgotten.id, { content: forgotten.content, expectedRevision: forgotten.revision });
    assert.equal(reactivated.status, "active");
    assert.equal(reactivated.forgetAt, "2028-01-02T00:00:00.000Z");
  } finally {
    context.store.close();
    fs.rmSync(context.dataDir, { recursive: true, force: true });
  }
});

test("Memory records remain isolated when two Spaces share one SQLite file", () => {
  const context = fixture("space-a");
  const other = new MemoryStore({
    dataDir: context.dataDir,
    databasePath: path.join(context.dataDir, "state.sqlite"),
    spaceId: "space-b",
    sessionResolver: (id) => id === "main-b" ? { id, role: "main" } : null,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
  });
  try {
    const created = context.store.create({ sessionId: "main-a" }, { content: "仅属于 A 空间。" });
    assert.equal(other.listForReader({ status: "active" }).items.length, 0);
    assert.equal(other.getForMainAgent({ sessionId: "main-b" }, created.id), null);
    assert.throws(() => other.update({ sessionId: "main-b" }, created.id, { content: "越权", expectedRevision: 1 }), /current Space/);
  } finally {
    other.close();
    context.store.close();
    fs.rmSync(context.dataDir, { recursive: true, force: true });
  }
});

test("Heat follows the documented recency and logarithmic frequency formula", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  assert.equal(calculateMemoryHeat({ createdAt, hitCount: 0 }, Date.parse(createdAt)), 55);
  assert.equal(calculateMemoryHeat({ createdAt, hitCount: 0 }, Date.parse("2026-04-01T00:00:00.000Z")), 28);
  assert.equal(calculateMemoryHeat({ createdAt, lastHitAt: createdAt, hitCount: 255 }, Date.parse(createdAt)), 100);
});
