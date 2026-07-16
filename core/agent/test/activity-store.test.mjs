import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ActivityStore, activityLimits } from "../src/activity/store.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-activity-"));
  const sessions = new Map([
    ["main-1", { id: "main-1", role: "main", channel: "wechat" }],
    ["worker-1", { id: "worker-1", role: "worker", parentSessionId: "main-1" }],
  ]);
  const objects = new Map(Array.from({ length: 11 }, (_, index) => {
    const objectId = `obj_${String(index + 1).padStart(24, "0")}`;
    return [objectId, {
      objectId,
      status: "ready",
      visibility: "private",
      originalName: index === 0 ? "周末活动候选.xlsx" : `附件-${index + 1}.png`,
      contentType: index === 0 ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "image/png",
      sizeBytes: 1024 + index,
      localPath: `C:\\private\\must-not-leak-${index}`,
    }];
  }));
  const store = new ActivityStore({
    dataDir: root,
    sessionResolver: (sessionId) => sessions.get(sessionId) || null,
    attachmentResolver: (objectId) => objects.get(objectId) || null,
  });
  return {
    root,
    store,
    main: { sessionId: "main-1" },
    worker: { sessionId: "worker-1" },
    objects,
    objectIds: [...objects.keys()],
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("only the verified main Agent can operate global Activity", () => {
  const ctx = fixture();
  try {
    assert.throws(() => ctx.store.create(ctx.worker, input()), (error) => error.code === "MAIN_AGENT_REQUIRED");
    ctx.store.create({ sessionId: "main-1", role: "main" }, input());
    assert.throws(() => ctx.store.create({ sessionId: "missing", role: "main" }, input({ idempotencyKey: "missing" })), (error) => error.code === "MAIN_AGENT_REQUIRED");
    assert.equal(ctx.store.listForMainAgent(ctx.main).items.length, 1);
  } finally {
    ctx.close();
  }
});

test("Activity enforces a 30-character title and ten total attachments", () => {
  const ctx = fixture();
  try {
    const exact = "动".repeat(activityLimits.titleCharacters);
    const created = ctx.store.create(ctx.main, input({
      title: exact,
      attachments: ctx.objectIds.slice(0, 10),
    }));
    assert.equal(created.title, exact);
    assert.equal(created.attachments.length, 10);
    assert.equal(created.attachments[0].name, "周末活动候选.xlsx");
    assert.equal("localPath" in created.attachments[0], false);

    assert.throws(() => ctx.store.create(ctx.main, input({
      title: `${exact}多`,
      idempotencyKey: "title-too-long",
    })), (error) => error.code === "TITLE_TOO_LONG");
    assert.throws(() => ctx.store.create(ctx.main, input({
      attachments: ctx.objectIds,
      idempotencyKey: "too-many-attachments",
    })), (error) => error.code === "TOO_MANY_ATTACHMENTS");
  } finally {
    ctx.close();
  }
});

test("main Agent can search, update, hide and restore an evolving Activity story", () => {
  const ctx = fixture();
  try {
    const created = ctx.store.create(ctx.main, input({
      title: "上海周末活动开始核验",
      detail: "正在核对预约入口与儿童博物馆公告。",
      correlationKey: "work:weekend-shanghai",
      attachments: [ctx.objectIds[0]],
      target: { type: "work", id: "worker-1" },
    }));
    assert.equal(created.revision, 1);
    assert.equal(ctx.store.listForMainAgent(ctx.main, { query: "博物馆" }).items[0].id, created.id);
    assert.equal(ctx.store.listForReader({ query: "xlsx" }).items[0].id, created.id);

    const updated = ctx.store.update(ctx.main, created.id, {
      expectedRevision: created.revision,
      title: "上海周末活动有了新进展",
      detail: "已确认科技馆预约入口，保留 7 个候选。",
      idempotencyKey: "weekend-update-1",
    });
    assert.equal(updated.revision, 2);
    assert.match(updated.detail, /7 个候选/);
    assert.throws(() => ctx.store.update(ctx.main, created.id, {
      expectedRevision: 1,
      detail: "过期更新",
      idempotencyKey: "stale-update",
    }), (error) => error.code === "REVISION_CONFLICT");

    const hidden = ctx.store.hide(ctx.main, created.id, { expectedRevision: 2, reason: "内容已被更准确的动态替代" });
    assert.equal(hidden.state, "hidden");
    assert.equal(ctx.store.listForReader().items.length, 0);
    const restored = ctx.store.restore(ctx.main, created.id, { expectedRevision: 3 });
    assert.equal(restored.state, "visible");
    assert.equal(restored.revision, 4);
  } finally {
    ctx.close();
  }
});

test("Activity creation is idempotent and rejects changed replay content", () => {
  const ctx = fixture();
  try {
    const first = ctx.store.create(ctx.main, input({ idempotencyKey: "same-request" }));
    const replay = ctx.store.create(ctx.main, input({ idempotencyKey: "same-request" }));
    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotentReplay, true);
    assert.throws(() => ctx.store.create(ctx.main, input({
      idempotencyKey: "same-request",
      detail: "不同的内容",
    })), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  } finally {
    ctx.close();
  }
});

test("Activity uses stable opaque cursors and never creates items from system facts", () => {
  const ctx = fixture();
  try {
    for (let index = 0; index < 3; index += 1) {
      ctx.store.create(ctx.main, input({
        title: `动态 ${index + 1}`,
        idempotencyKey: `page-${index + 1}`,
        occurredAt: `2026-07-16T0${index}:00:00.000Z`,
      }));
    }
    const first = ctx.store.listForMainAgent(ctx.main, { limit: 2 });
    const second = ctx.store.listForMainAgent(ctx.main, { limit: 2, cursor: first.nextCursor });
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 1);
    assert.notEqual(first.nextCursor, "");
    assert.throws(() => ctx.store.create({ sessionId: "system" }, input({ idempotencyKey: "system" })), (error) => error.code === "MAIN_AGENT_REQUIRED");
    assert.equal(ctx.store.listForReader().items.length, 3);
  } finally {
    ctx.close();
  }
});

test("Activity rechecks attachment availability and keeps audit evidence redacted", () => {
  const ctx = fixture();
  try {
    const created = ctx.store.create(ctx.main, input({
      attachments: [ctx.objectIds[0]],
      detail: "用户可读详情中包含不应进入审计的内容。",
    }));
    assert.equal(ctx.store.getAttachmentForReader(created.id, 0).attachment.name, created.attachments[0].name);
    ctx.objects.set(ctx.objectIds[0], { ...ctx.objects.get(ctx.objectIds[0]), status: "revoked" });
    assert.equal(ctx.store.getAttachmentForReader(created.id, 0), null);

    const audit = ctx.store.db.prepare("SELECT * FROM activity_audit WHERE activity_id = ? ORDER BY created_at DESC").get(created.id);
    assert.equal(audit.action, "create");
    assert.equal(audit.main_session_id, "main-1");
    assert.equal(audit.revision, 1);
    assert.equal(JSON.stringify(audit).includes("用户可读详情"), false);
    assert.equal(JSON.stringify(audit).includes("must-not-leak"), false);
  } finally {
    ctx.close();
  }
});

function input(overrides = {}) {
  return {
    type: "work",
    title: "上海周末活动开始核验",
    detail: "正在核对适合孩子的活动与预约信息。",
    attachments: [],
    target: { type: "work", id: "worker-1" },
    correlationKey: "work:weekend",
    idempotencyKey: "activity-create-1",
    occurredAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}
