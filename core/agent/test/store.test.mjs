import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mapMessage } from "../src/agent/app-server-mapper.ts";
import { BridgeStore } from "../src/store/store.js";

test("creates parent and worker sessions with events", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });

  const main = store.getOrCreateMainSessionForChannel({
    channel: "wechat",
    senderId: "alice@im.wechat",
    senderName: "alice",
    workspaceRoot: dataDir,
  });
  const worker = store.createSession({
    role: "worker",
    parentSessionId: main.id,
    taskDescription: "inspect repository",
    workspaceRoot: dataDir,
  });
  store.appendEvent(worker.id, "session.assistant_message", { content: "done" });

  const hydratedMain = store.getSession(main.id);
  const hydratedWorker = store.getSession(worker.id);
  assert.equal(hydratedMain.childSessions.length, 1);
  assert.equal(hydratedMain.childSessions[0].id, worker.id);
  assert.equal(hydratedWorker.messages[0].role, "assistant");
  assert.equal(hydratedWorker.internalUrl, `/app/chat/session/${worker.id}/live`);
  assert.equal(hydratedWorker.url, `https://agent.example.test/app/mobile/workers/${worker.id}`);
  assert.equal(hydratedWorker.path, `/app/chat/session/${worker.id}/live`);
  assert.equal(hydratedWorker.linkNotice, "");
});

test("lists only in-progress workers with a persisted parent for restart recovery", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-recoverable-workers-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const main = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
    const starting = store.createSession({ parentSessionId: main.id, status: "start", title: "Starting", workspaceRoot: dataDir });
    const running = store.createSession({ parentSessionId: main.id, status: "running", title: "Running", workspaceRoot: dataDir });
    store.createSession({ parentSessionId: main.id, status: "idle", title: "Finished", workspaceRoot: dataDir });
    store.createSession({ status: "running", title: "No parent", workspaceRoot: dataDir });
    store.updateSession(main.id, { status: "running" });

    assert.deepEqual(
      store.listRecoverableWorkerSessions().map((session) => session.id).sort(),
      [starting.id, running.id].sort(),
    );
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("returns the internal task path and an explicit notice while remote access is unavailable", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-store-local-only-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test", externalAccess: () => ({ ready: false, reason: "local-only" }) });
  const session = store.createSession({ role: "worker", taskDescription: "local task", workspaceRoot: dataDir });
  const hydrated = store.getSession(session.id);
  assert.equal(hydrated.internalUrl, `/app/chat/session/${session.id}/live`);
  assert.equal(hydrated.url, "");
  assert.equal(hydrated.path, `/app/chat/session/${session.id}/live`);
  assert.equal(hydrated.linkNotice, "暂未配置可访问的公网域名，无法在线查看任务进度。");
});

test("explains when an existing managed task link is temporarily offline", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-store-tunnel-offline-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test", externalAccess: () => ({ ready: false, reason: "tunnel-offline", origin: "" }) });
  const session = store.createSession({ role: "worker", taskDescription: "offline task", workspaceRoot: dataDir });
  assert.equal(session.url, "");
  assert.equal(session.linkNotice, "远程连接暂时离线，当前无法在线查看任务进度。");
});

test("persists and deduplicates deferred WeChat notifications", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-wechat-pending-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const session = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "pending-user",
      senderName: "pending",
      workspaceRoot: dataDir,
    });
    const first = store.enqueuePendingWechatNotification({
      sessionId: session.id,
      recipientId: "pending-user",
      content: "任务已完成",
    });
    const duplicate = store.enqueuePendingWechatNotification({
      sessionId: session.id,
      recipientId: "pending-user",
      content: "任务已完成",
    });

    assert.equal(first.id, duplicate.id);
    assert.deepEqual(store.listPendingWechatNotifications("pending-user").map((item) => item.content), ["任务已完成"]);
    assert.equal(store.deletePendingWechatNotification(first.id), true);
    assert.deepEqual(store.listPendingWechatNotifications("pending-user"), []);
  } finally {
    store.close();
  }
});

test("shares one reusable main session between desktop and WeChat while generic sessions stay workers", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-main-invariant-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const desktop = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
    store.appendEvent(desktop.id, "session.assistant_message", { content: "desktop history" });
    const first = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "alice",
      workspaceRoot: dataDir,
    });
    assert.equal(first.id, desktop.id);
    store.appendEvent(first.id, "session.status", { content: "thread ready", cliSessionId: "thread-main-1" });
    store.db.prepare("DELETE FROM channel_sessions WHERE key = ?").run("wechat:alice@im.wechat");
    const resumed = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "Alice",
      workspaceRoot: dataDir,
    });
    const generic = store.createSession({
      role: "main",
      channel: "custom-channel",
      senderId: "alice",
      workspaceRoot: dataDir,
    });

    assert.equal(resumed.id, first.id);
    assert.equal(resumed.cliSessionId, "thread-main-1");
    assert.equal(resumed.role, "main");
    assert.equal(store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir }).id, first.id);
    assert.equal(store.getSession(first.id).messages.some((message) => message.content === "desktop history"), true);
    assert.deepEqual(store.listMainSessions().map((session) => session.id), [first.id]);
    assert.equal(store.listSessionsPage({ limit: 20 }).sessions.filter((session) => session.role === "main").length, 1);
    assert.equal(generic.role, "worker");
    assert.throws(() => store.getOrCreateMainSessionForChannel({
      channel: "custom-channel",
      senderId: "alice",
      workspaceRoot: dataDir,
    }), /only WeChat/);
  } finally {
    store.close();
  }
});

test("personal WeChat owns a main session independently from WeChat claw", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-personal-wechat-main-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const personal = store.getOrCreateMainSessionForChannel({
      channel: "wechat-personal",
      senderId: "family@chatroom",
      senderName: "Family",
      workspaceRoot: dataDir,
    });
    const claw = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "family@chatroom",
      senderName: "Family claw",
      workspaceRoot: dataDir,
    });
    assert.equal(personal.role, "main");
    assert.equal(personal.channel, "wechat-personal");
    assert.equal(claw.channel, "wechat");
    assert.notEqual(personal.id, claw.id);
    assert.equal(store.getOrCreateMainSessionForChannel({ channel: "wechat-personal", senderId: "family@chatroom", workspaceRoot: dataDir }).id, personal.id);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rebinds a migrated WeChat main session and clears only its stale Codex thread", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-workspace-rebind-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const original = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "alice",
      workspaceRoot: "/opt/private-site/current",
    });
    store.appendEvent(original.id, "session.status", { content: "thread ready", cliSessionId: "thread-from-edge" });
    store.appendEvent(original.id, "session.assistant_message", { content: "preserved history" });

    const rebound = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "Alice",
      workspaceRoot: dataDir,
    });

    assert.equal(rebound.id, original.id);
    assert.equal(rebound.workspaceRoot, dataDir);
    assert.equal(rebound.cliSessionId, null);
    assert.equal(rebound.metadata.previousWorkspaceRoot, "/opt/private-site/current");
    assert.ok(rebound.metadata.workspaceReboundAt);
    assert.equal(store.getSession(rebound.id).messages.some((message) => message.content === "preserved history"), true);

    store.appendEvent(rebound.id, "session.status", { content: "new thread", cliSessionId: "thread-on-node" });
    const unchanged = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "Alice",
      workspaceRoot: dataDir,
    });
    assert.equal(unchanged.cliSessionId, "thread-on-node");
  } finally {
    store.close();
  }
});

test("paginates and searches chat sessions with a stable cursor", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-page-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    for (let index = 0; index < 3; index += 1) {
      store.createSession({
        id: `session-${index}`,
        title: index === 1 ? "Needle conversation" : `Conversation ${index}`,
        workspaceRoot: dataDir,
        createdAt: `2026-07-10T0${index}:00:00.000Z`,
        updatedAt: `2026-07-10T0${index}:00:00.000Z`,
      });
    }
    const first = store.listSessionsPage({ limit: 2 });
    assert.deepEqual(first.sessions.map((session) => session.id), ["session-2", "session-1"]);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    const second = store.listSessionsPage({ limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.sessions.map((session) => session.id), ["session-0"]);
    assert.equal(second.hasMore, false);
    const search = store.listSessionsPage({ query: "Needle", limit: 20 });
    assert.deepEqual(search.sessions.map((session) => session.id), ["session-1"]);
    assert.equal(search.hasMore, false);
  } finally {
    store.close();
  }
});

test("mobile task display ledger opens at the tail and paginates earlier events with task-bound cursors", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-store-mobile-detail-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const session = store.createSession({ role: "worker", title: "Long task", workspaceRoot: dataDir });
    const other = store.createSession({ role: "worker", title: "Other task", workspaceRoot: dataDir });
    store.updateTaskDisplayPlan(session.id, [{ step: "Keep latest plan", status: "in_progress" }], { createdAt: "2026-07-20T08:00:00.000Z" });
    for (let index = 1; index <= 65; index += 1) {
      store.appendTaskDisplayEvent(session.id, {
        sourceEventId: `visible-${index}`,
        kind: index === 1 ? "requirement" : "message",
        role: index === 1 ? "user" : "assistant",
        content: `visible-${index}`,
        createdAt: `2026-07-20T08:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const first = store.listTaskDisplayEvents(session.id, { limit: 20 });
    assert.deepEqual(first.items.map((item) => item.sequence), Array.from({ length: 20 }, (_, index) => index + 46));
    assert.equal(first.items.at(-1).content, "visible-65");
    assert.equal(first.hasEarlier, true);
    assert.ok(first.beforeCursor);
    assert.deepEqual(first.latestPlan.steps, [{ step: "Keep latest plan", status: "inProgress" }]);
    assert.equal("workspaceRoot" in first.task, false);
    assert.equal("cliSessionId" in first.task, false);

    const second = store.listTaskDisplayEvents(session.id, { limit: 20, before: first.beforeCursor });
    const third = store.listTaskDisplayEvents(session.id, { limit: 20, before: second.beforeCursor });
    const fourth = store.listTaskDisplayEvents(session.id, { limit: 20, before: third.beforeCursor });
    const sequences = [...fourth.items, ...third.items, ...second.items, ...first.items].map((item) => item.sequence);
    assert.deepEqual(sequences, Array.from({ length: 65 }, (_, index) => index + 1));
    assert.equal(new Set(sequences).size, sequences.length);
    assert.equal(fourth.hasEarlier, false);
    assert.equal(fourth.beforeCursor, "");

    assert.throws(() => store.listTaskDisplayEvents(other.id, { before: first.beforeCursor }), /cursor is invalid/);
    assert.throws(() => store.listTaskDisplayEvents(session.id, { before: `${first.beforeCursor}x` }), /cursor is invalid/);
    const detail = store.getMobileSessionDetail(session.id, { messageLimit: 20 });
    assert.equal(detail.messages.length, 20);
    assert.equal(detail.messages.at(-1).content, "visible-65");
    assert.equal(detail.events[0].payload.metadata.plan[0].step, "Keep latest plan");
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("task display projection stores only completed visible worker content and remains independent of raw history volume", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-store-display-projection-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const worker = store.createSession({ role: "worker", title: "Projection", workspaceRoot: dataDir });
    const main = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
    const project = (kind, content, metadata = {}, id = `raw-${Math.random()}`) => store.projectTaskDisplayEvent({
      id,
      sessionId: worker.id,
      kind,
      createdAt: "2026-07-20T10:00:00.000Z",
      payload: { content, metadata },
    });

    assert.equal(project("session.tool_result", "secret command output"), null);
    assert.equal(project("session.reasoning", "private reasoning"), null);
    assert.equal(project("session.assistant_message", "partial", { streamState: "streaming" }), null);
    assert.equal(project("session.assistant_message", "[worker-hook:internal] hidden", { streamState: "completed" }), null);
    assert.equal(project("session.error", "retry transport detail", { willRetry: true }), null);
    const completed = project("session.assistant_message", "visible answer", { streamState: "completed" }, "completed-1");
    assert.equal(completed.item.content, "visible answer");
    const duplicate = project("session.assistant_message", "visible answer", { streamState: "completed" }, "completed-1");
    assert.equal(duplicate.item.displayEventId, completed.item.displayEventId);
    const artifactReply = project("session.assistant_message", '<personal-agent-artifacts>{"schemaVersion":1,"summary":"safe summary","artifacts":[]}</personal-agent-artifacts>\n\nVisible conclusion', { streamState: "completed" }, "completed-2");
    assert.equal(artifactReply.item.content, "Visible conclusion");
    const artifactOnly = project("session.assistant_message", '<personal-agent-artifacts>{"schemaVersion":1,"summary":"summary fallback","artifacts":[]}</personal-agent-artifacts>', { streamState: "completed" }, "completed-3");
    assert.equal(artifactOnly.item.content, "summary fallback");
    const objectId = "obj_0123456789abcdef01234567";
    const withAttachment = project("session.assistant_message", "attachment reply", {
      streamState: "completed",
      finalReply: { idempotencyKey: "delivery-key" },
      attachments: [{ objectId, kind: "file", name: "result.pdf", previewUrl: `/api/chat/attachments/${objectId}`, downloadUrl: `/api/chat/attachments/${objectId}?download=1`, deliveryState: "pending" }],
    }, "completed-4");
    assert.equal(withAttachment.item.metadata._deliveryKey, undefined);
    const delivered = store.updateTaskDisplayAttachmentDelivery(worker.id, { idempotencyKey: "delivery-key", objectId, state: "sent" });
    assert.equal(delivered.metadata.attachments[0].deliveryState, "sent");
    assert.equal(delivered.metadata._deliveryKey, undefined);
    const plan = project("session.status", "raw plan rendering", {
      eventType: "turn/plan/updated",
      plan: [{ step: "Only latest", status: "inProgress" }],
    }, "plan-1");
    assert.deepEqual(plan.latestPlan.steps, [{ step: "Only latest", status: "inProgress" }]);
    assert.equal(store.projectTaskDisplayEvent({ id: "main-1", sessionId: main.id, kind: "session.assistant_message", payload: { content: "main" } }), null);
    assert.throws(() => store.appendTaskDisplayEvent(main.id, { kind: "message", role: "assistant", content: "forbidden" }), /Worker session/);

    const insertRaw = store.db.prepare("INSERT INTO events (id, session_id, seq, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    store.db.exec("BEGIN");
    for (let index = 1; index <= 10_000; index += 1) {
      insertRaw.run(`stress-raw-${index}`, worker.id, index, "session.tool_result", JSON.stringify({ content: `internal-${index}` }), "2026-07-20T10:00:00.000Z");
    }
    store.db.exec("COMMIT");
    for (let index = 2; index <= 600; index += 1) {
      store.appendTaskDisplayEvent(worker.id, {
        sourceEventId: `display-${index}`,
        kind: "message",
        role: "assistant",
        content: `display-${index}`,
      });
    }

    const startedAt = performance.now();
    const page = store.listTaskDisplayEvents(worker.id, { limit: 20 });
    const elapsed = performance.now() - startedAt;
    assert.equal(page.items.length, 20);
    assert.equal(page.items.at(-1).content, "display-600");
    assert.equal(page.items.some((item) => item.content.startsWith("internal-")), false);
    assert.ok(JSON.stringify(page).length < 20_000);
    assert.ok(elapsed < 250, `display query took ${elapsed.toFixed(1)}ms`);
    const queryPlan = store.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM task_display_events WHERE session_id = ? ORDER BY display_seq DESC LIMIT 21").all(worker.id);
    assert.match(queryPlan.map((row) => row.detail).join("\n"), /idx_task_display_events_session_seq/);
  } finally {
    try { store.db.exec("ROLLBACK"); } catch {}
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("coalesces streaming assistant deltas by persisted message id", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const session = store.createSession({ role: "worker", workspaceRoot: dataDir });

  store.appendEvent(session.id, "session.assistant_message", {
    persistedMessageId: "agent-message-1",
    content: "O",
  });
  store.appendEvent(session.id, "session.assistant_message", {
    persistedMessageId: "agent-message-1",
    content: "OAB_LOCAL_SMOKE",
  });

  const messages = store.getSession(session.id).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "agent-message-1");
  assert.equal(messages[0].content, "OAB_LOCAL_SMOKE");
});

test("keeps retrying transport errors out of user history and preserves final failures", () => {
  assert.deepEqual(mapMessage({
    method: "error",
    params: { error: { message: "Reconnecting... 2/5" }, willRetry: true, threadId: "thread-1", turnId: "turn-1" },
  }), []);

  const finalFrame = mapMessage({
    method: "error",
    params: { error: { message: "Connection failed" }, willRetry: false, threadId: "thread-1", turnId: "turn-1" },
  })[0];
  assert.equal(finalFrame.kind, "session.error");
  assert.equal(finalFrame.payload.metadata.willRetry, false);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-store-retry-error-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const session = store.createSession({ role: "worker", workspaceRoot: dataDir });
    store.appendEvent(session.id, "session.error", {
      content: "Reconnecting... 2/5",
      metadata: { willRetry: true },
    });
    store.appendEvent(session.id, finalFrame.kind, finalFrame.payload);
    assert.deepEqual(store.getSession(session.id).messages.map((message) => message.content), ["Connection failed"]);
  } finally {
    store.close();
  }
});

test("replaces per-thread token snapshots and aggregates usage", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-token-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const first = store.createSession({ id: "session-token-1", title: "Token one", workspaceRoot: dataDir });
    const second = store.createSession({ id: "session-token-2", title: "Token two", workspaceRoot: dataDir });
    const frame = mapMessage({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 3, totalTokens: 90 },
          total: { inputTokens: 800, cachedInputTokens: 200, outputTokens: 100, reasoningOutputTokens: 30, totalTokens: 900 },
          modelContextWindow: 200000,
        },
      },
    })[0];
    assert.equal(frame.kind, "session.token_usage");
    assert.equal(frame.payload.tokenUsage.total.totalTokens, 900);
    store.appendEvent(first.id, frame.kind, {
      ...frame.payload,
      createdAt: "2026-07-10T11:59:58.000Z",
    });
    store.appendEvent(first.id, frame.kind, {
      ...frame.payload,
      createdAt: "2026-07-10T11:59:59.000Z",
      tokenUsage: {
        ...frame.payload.tokenUsage,
        total: { ...frame.payload.tokenUsage.total, inputTokens: 1000, outputTokens: 150, totalTokens: 1150 },
      },
    });
    store.appendEvent(second.id, "session.token_usage", {
      threadId: "thread-2",
      tokenUsage: {
        last: { totalTokens: 50 },
        total: { inputTokens: 400, cachedInputTokens: 50, outputTokens: 100, reasoningOutputTokens: 20, totalTokens: 500 },
      },
      createdAt: "2026-07-10T12:00:00.000Z",
    });

    const summary = store.getTokenUsageSummary({ range: "all" });
    assert.equal(summary.totalTokens, 1650);
    assert.equal(summary.inputTokens, 1400);
    assert.equal(summary.outputTokens, 250);
    assert.equal(summary.cachedInputTokens, 250);
    assert.equal(summary.sessionCount, 2);
    assert.equal(summary.threadCount, 2);
    assert.equal(summary.requestCount, 3);
    assert.equal(store.getTokenUsageSummary({ range: "today" }).totalTokens, 0);
    assert.equal(summary.dailyUsage.length, 84);
    assert.deepEqual(summary.recentSessions.map((entry) => entry.sessionId), [second.id, first.id]);
    assert.equal(store.getSession(first.id).messages.length, 0);
  } finally {
    store.close();
  }
});

test("prunes month-old execution history while retaining the main session", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-retention-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const main = store.getOrCreateMainSessionForChannel({ channel: "wechat", senderId: "retention-user", workspaceRoot: dataDir });
    const worker = store.createSession({ title: "old worker", workspaceRoot: dataDir, status: "done", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" });
    store.appendEvent(main.id, "session.started", { cliSessionId: "old-main-thread", createdAt: "2026-05-01T00:00:00.000Z" });
    store.appendEvent(main.id, "session.complete", { idle: true, createdAt: "2026-05-01T00:01:00.000Z" });
    store.appendEvent(worker.id, "session.assistant_message", { content: "old", createdAt: "2026-05-01T00:00:00.000Z" });

    const result = store.pruneHistory({ retentionDays: 30, now: new Date("2026-07-11T00:00:00.000Z") });
    assert.ok(result.changed >= 3);
    assert.equal(store.getSession(worker.id), null);
    assert.equal(store.getSessionRecord(main.id).cliSessionId, null);
    assert.equal(store.listEvents(main.id).length, 0);
  } finally {
    store.close();
  }
});

test("archives the legacy Memory table separately from the Space-isolated product Memory store", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-legacy-memory-"));
  const databasePath = path.join(dataDir, "state.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO memories VALUES (
      'mem_legacy', 'sess_legacy', 'fact', 'legacy content', 0, NULL, '{}',
      '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'
    );
  `);
  legacy.close();
  const store = new BridgeStore({ dataDir, databasePath, consoleBaseUrl: "https://agent.example.test" });
  try {
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.equal(tables.includes("memories"), false);
    assert.equal(tables.includes("legacy_memories_readonly"), true);
    assert.equal(store.db.prepare("SELECT content FROM legacy_memories_readonly WHERE id = 'mem_legacy'").get().content, "legacy content");
    assert.equal(typeof store.createMemory, "undefined");
    assert.equal(typeof store.listMemories, "undefined");
  } finally {
    store.close();
  }
});
