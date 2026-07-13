import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mapMessage } from "../src/agent/app-server-mapper.mjs";
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
  assert.equal(hydratedWorker.url, `https://agent.example.test/agent/session/${worker.id}/live`);
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

test("reserves reusable main sessions for WeChat and forces every generic session to worker", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-main-invariant-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const first = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "alice@im.wechat",
      senderName: "alice",
      workspaceRoot: dataDir,
    });
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

test("prunes month-old history while retaining main-session memories", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-retention-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const main = store.getOrCreateMainSessionForChannel({ channel: "wechat", senderId: "retention-user", workspaceRoot: dataDir });
    const worker = store.createSession({ title: "old worker", workspaceRoot: dataDir, status: "done", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" });
    store.createMemory({ sessionId: main.id, type: "preference", content: "保留长期记忆", createdAt: "2026-05-01T00:00:00.000Z" });
    store.appendEvent(main.id, "session.started", { cliSessionId: "old-main-thread", createdAt: "2026-05-01T00:00:00.000Z" });
    store.appendEvent(main.id, "session.complete", { idle: true, createdAt: "2026-05-01T00:01:00.000Z" });
    store.appendEvent(worker.id, "session.assistant_message", { content: "old", createdAt: "2026-05-01T00:00:00.000Z" });

    const result = store.pruneHistory({ retentionDays: 30, now: new Date("2026-07-11T00:00:00.000Z") });
    assert.ok(result.changed >= 3);
    assert.equal(store.getSession(worker.id), null);
    assert.equal(store.getSessionRecord(main.id).cliSessionId, null);
    assert.equal(store.listEvents(main.id).length, 0);
    assert.equal(store.listMemories({ sessionId: main.id }).length, 1);
  } finally {
    store.close();
  }
});

test("stores session-scoped memories and counts recalls separately from page reads", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-store-memory-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  try {
    const main = store.getOrCreateMainSessionForChannel({
      channel: "wechat",
      senderId: "memory-user",
      senderName: "Memory user",
      workspaceRoot: dataDir,
    });
    const worker = store.createSession({
      parentSessionId: main.id,
      title: "Memory worker",
      workspaceRoot: dataDir,
    });
    const preference = store.createMemory({
      sessionId: main.id,
      type: "preference",
      content: "用户偏好深色编辑器",
      createdAt: "2026-07-10T09:00:00.000Z",
    });
    store.createMemory({
      sessionId: main.id,
      type: "decision",
      content: "生产服务器只部署 dist",
      createdAt: "2026-07-10T10:00:00.000Z",
    });
    store.createMemory({ sessionId: worker.id, type: "context", content: "worker only" });

    assert.equal(store.getDefaultMemorySessionId(), main.id);
    assert.equal(store.listMemories({ sessionId: main.id }).length, 2);
    assert.equal(store.getMemory(preference.id).hitCount, 0);

    const recalled = store.recallMemories({ sessionId: main.id, query: "深色", limit: 8 });
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].hitCount, 1);
    assert.equal(store.getMemory(preference.id).hitCount, 1);

    const updated = store.updateMemory(preference.id, { type: "instruction", content: "默认使用深色编辑器" });
    assert.equal(updated.type, "instruction");
    assert.equal(updated.content, "默认使用深色编辑器");
    assert.equal(store.getMemoryStats(main.id).totalHits, 1);

    const memorySessions = store.listMemorySessions();
    assert.equal(memorySessions[0].id, main.id);
    assert.equal(memorySessions.find((session) => session.id === worker.id).memoryCount, 1);
    assert.equal(store.deleteMemory(preference.id), true);
    assert.equal(store.getMemory(preference.id), null);
    assert.throws(() => store.createMemory({ sessionId: main.id, type: "secret", content: "no" }), /unsupported memory type/);
  } finally {
    store.close();
  }
});
