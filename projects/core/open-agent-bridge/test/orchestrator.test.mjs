import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "../src/config.js";
import { progressFatigueDelay, progressTimerInterval, SessionOrchestrator } from "../src/server/orchestrator.js";
import { BridgeStore } from "../src/store/store.js";

test("checks worker progress frequently while preserving the notification interval", () => {
  assert.equal(progressTimerInterval(60_000), 10_000);
  assert.equal(progressTimerInterval(5_000), 5_000);
  assert.equal(progressTimerInterval(500), 1_000);
});

test("backs off quiet-task reminders from five to thirty minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((count) => progressFatigueDelay(300_000, count)), [
    300_000,
    600_000,
    1_200_000,
    1_800_000,
    1_800_000,
  ]);
});

test("queues inputs for a running session and drains them serially", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const session = store.createSession({
    role: "worker",
    workspaceRoot: dataDir,
    title: "Main session",
  });
  const broadcasts = [];
  const calls = [];
  const resolvers = [];

  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: (event) => broadcasts.push(event) },
    channels: {},
    runner: {
      steerActiveTurn: async () => false,
      runAppServerCommand: async (config) => {
        calls.push(config.stdin);
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: { content: `ran:${config.stdin}` },
        });
        return await new Promise((resolve) => resolvers.push(resolve));
      },
      stopAppServerCommand: () => false,
    },
    attachmentBatchQuietMs: 10,
    attachmentBatchMaxWaitMs: 50,
  });

  const first = orchestrator.runTurn(session.id, "first");
  assert.equal(calls.length, 1);

  const queued = await orchestrator.runTurn(session.id, "second", { steerIfRunning: true });
  assert.equal(queued.queued, true);
  assert.equal(queued.queueLength, 1);
  assert.deepEqual(calls, ["first"]);

  resolvers.shift()({ ok: true });
  await first;
  await waitFor(() => calls.length === 2);
  assert.deepEqual(calls, ["first", "second"]);

  resolvers.shift()({ ok: true });
  await waitFor(() => store.getSession(session.id).messages.some((message) => message.content === "ran:second"));

  const hydrated = store.getSession(session.id);
  assert.equal(hydrated.messages.some((message) => message.content.includes("queued input #1")), true);
  assert.equal(hydrated.messages.some((message) => message.content === "ran:first"), true);
  assert.equal(hydrated.messages.some((message) => message.content === "ran:second"), true);
  assert.equal(broadcasts.some((event) => event.type === "session.delta"), true);
});

test("routes non-WeChat channel messages directly to worker sessions", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-channel-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const calls = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: {},
    runner: {
      runAppServerCommand: async (config) => {
        calls.push(config);
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });

  const session = await orchestrator.handleChannelMessage("custom-channel", {
    senderId: "dt-user",
    senderName: "外部渠道用户",
    text: "生成一份报告",
    attachments: [],
  });

  await waitFor(() => calls.length === 1);
  assert.equal(session.role, "worker");
  assert.equal(session.channel, "custom-channel");
  assert.equal(calls[0].stdin, "生成一份报告");
  assert.doesNotMatch(calls[0].stdin, /open-abg session start/);
});

test("acknowledges WeChat immediately and queues the completed reply behind the receipt", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  let releaseSend;
  const sendPending = new Promise((resolve) => { releaseSend = resolve; });
  const calls = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: {
      wechat: {
        sendText: async (recipientId, content) => {
          sent.push({ recipientId, content });
          await sendPending;
        },
      },
    },
    runner: {
      runAppServerCommand: async (config) => {
        calls.push(config);
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: {
            content: "我",
            persistedMessageId: "reply-1",
            metadata: { streamState: "streaming" },
          },
        });
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: {
            content: "我先看看。",
            persistedMessageId: "reply-progress",
            metadata: { streamState: "completed" },
          },
        });
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: {
            content: "我在。",
            persistedMessageId: "reply-1",
            metadata: { streamState: "completed" },
          },
        });
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });

  const session = await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-user",
    senderName: "测试用户",
    text: "你好，在吗",
    attachments: [],
  });

  await waitFor(() => sent.length === 1);
  assert.deepEqual(sent, [{
    recipientId: "wechat-user",
    content: "收到",
  }]);
  assert.equal(calls[0].stdin, "你好，在吗");
  assert.doesNotMatch(calls[0].stdin, /open-abg session start/);
  assert.match(calls[0].appServerDeveloperInstructions, /简单问答.*直接自然地回答/);
  assert.match(calls[0].appServerDeveloperInstructions, /不要轮询/);
  assert.match(calls[0].appServerDeveloperInstructions, /1 至 3 句话/);
  assert.doesNotMatch(calls[0].appServerDeveloperInstructions, /你好，在吗/);
  await waitFor(() => !orchestrator.running.has(session.id));
  assert.equal(orchestrator.running.has(session.id), false);
  releaseSend();
  await waitFor(() => sent.length === 2);
  assert.deepEqual(sent[1], { recipientId: "wechat-user", content: "我在。" });
});

test("names an inbound file in one receipt without exposing its local path", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-file-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    runner: {
      runAppServerCommand: async () => ({ ok: true }),
      stopAppServerCommand: () => false,
    },
    attachmentBatchQuietMs: 10,
    attachmentBatchMaxWaitMs: 50,
  });

  const session = await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-file-user",
    senderName: "文件用户",
    text: "",
    attachments: [{ kind: "file", fileName: "需求说明.docx", path: "/private/inbound/file" }],
  });

  await waitFor(() => sent.length === 1);
  assert.deepEqual(sent[0], {
    recipientId: "wechat-file-user",
    content: "收到文件 需求说明.docx",
  });
  assert.doesNotMatch(sent[0].content, /private\/inbound/);
  await waitFor(() => !orchestrator.running.has(session.id));
});

test("groups many inbound attachments into one reference-friendly receipt", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-batch-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const calls = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    runner: { runAppServerCommand: async (input) => { calls.push(input.stdin); return { ok: true }; }, stopAppServerCommand: () => false },
    attachmentBatchQuietMs: 10,
    attachmentBatchMaxWaitMs: 50,
  });

  const session = await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-batch-user",
    senderName: "批量文件用户",
    text: "",
    attachments: [
      { kind: "image", fileName: "客厅.jpg", path: path.join(config.inboundAttachmentsDir, "wechat/user-test/2026-07-11/one.jpg") },
      { kind: "image", fileName: "餐桌.jpg", path: path.join(config.inboundAttachmentsDir, "wechat/user-test/2026-07-11/two.jpg") },
      { kind: "file", fileName: "清单.xlsx", path: path.join(config.inboundAttachmentsDir, "wechat/user-test/2026-07-11/three.xlsx") },
    ],
  });

  await waitFor(() => sent.length === 1);
  assert.match(sent[0].content, /^收到 3 个文件，已整理为「.+文件包 01」/);
  assert.match(sent[0].content, /图1 客厅\.jpg · 图2 餐桌\.jpg · 文件1 清单\.xlsx/);
  assert.match(sent[0].content, /查看与引用：https:\/\/personal-agent\.local\/files\/batches\/files_/);
  assert.equal(sent.length, 1);
  assert.match(calls[0], /\[图1\] image: 客厅\.jpg/);
  assert.match(calls[0], /privateFileBatch:/);
  await waitFor(() => !orchestrator.running.has(session.id));
});

test("collects consecutive attachment messages and sends one compact receipt after a quiet window", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-collection-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const calls = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    runner: { runAppServerCommand: async (input) => { calls.push(input.stdin); return { ok: true }; }, stopAppServerCommand: () => false },
    attachmentBatchQuietMs: 40,
    attachmentBatchMaxWaitMs: 200,
  });
  const filePath = (name) => path.join(config.inboundAttachmentsDir, "wechat/user-collection/2026-07-11", name);

  await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-collection-user",
    senderName: "连续文件用户",
    text: "",
    attachments: [
      { kind: "image", fileName: "客厅.jpg", path: filePath("one.jpg") },
      { kind: "image", fileName: "餐桌.jpg", path: filePath("two.jpg") },
    ],
  });
  await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-collection-user",
    senderName: "连续文件用户",
    text: "",
    attachments: [
      { kind: "image", fileName: "卧室.jpg", path: filePath("three.jpg") },
      { kind: "file", fileName: "清单.xlsx", path: filePath("four.xlsx") },
      { kind: "file", fileName: "说明.docx", path: filePath("five.docx") },
    ],
  });

  assert.equal(sent.length, 0);
  assert.equal(calls.length, 0);
  await waitFor(() => sent.length === 1);
  assert.match(sent[0].content, /^收到 5 个文件，已整理为「.+文件包 01」\n图片 3 · 文件 2/);
  assert.doesNotMatch(sent[0].content, /客厅|餐桌|卧室|清单|说明/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\[图3\] image: 卧室\.jpg/);
  assert.match(calls[0], /\[文件2\] file: 说明\.docx/);
  orchestrator.stop();
  store.close();
});

test("acknowledges consecutive WeChat messages and steers new input into the active turn", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-queue-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const calls = [];
  const resolvers = [];
  const steered = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    runner: {
      steerActiveTurn: async (sessionId, content, onSessionEvent, options) => {
        steered.push({ sessionId, content, options });
        return true;
      },
      runAppServerCommand: async (config) => {
        calls.push(config.stdin);
        return await new Promise((resolve) => {
          resolvers.push(async () => {
            await config.onSessionEvent({
              sessionId: config.sessionId,
              kind: "session.assistant_message",
              payload: {
                content: `完成：${config.stdin}`,
                persistedMessageId: `reply-${calls.length}`,
                metadata: { streamState: "completed" },
              },
            });
            resolve({ ok: true });
          });
        });
      },
      stopAppServerCommand: () => false,
    },
  });

  await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-queue-user",
    senderName: "队列用户",
    text: "第一条",
    attachments: [],
  });
  await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-queue-user",
    senderName: "队列用户",
    text: "第二条",
    attachments: [],
  });

  await waitFor(() => sent.length === 2);
  assert.deepEqual(sent.map((item) => item.content), ["收到", "收到"]);
  assert.deepEqual(calls, ["第一条"]);
  await waitFor(() => steered.length === 1);
  assert.equal(steered[0].content, "第二条");
  assert.equal(steered[0].options.emitUserMessage, false);

  await resolvers.shift()();
  await waitFor(() => sent.length === 3);
  assert.deepEqual(calls, ["第一条"]);
  assert.deepEqual(sent.map((item) => item.content), ["收到", "收到", "完成：第一条"]);
});

test("defers a stale final WeChat reply and replays it after the next receipt", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-wechat-replay-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const attempts = [];
  let rejectFirstFinal = true;
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: {
      wechat: {
        sendText: async (recipientId, content) => {
          attempts.push({ recipientId, content });
          if (content === "第一条完成" && rejectFirstFinal) {
            rejectFirstFinal = false;
            const error = new Error("sendmessage failed: ret=-2 errcode=undefined errmsg=");
            error.ret = -2;
            throw error;
          }
        },
      },
    },
    runner: {
      runAppServerCommand: async (config) => {
        if (config.stdin === "第一条") {
          await config.onSessionEvent({
            sessionId: config.sessionId,
            kind: "session.assistant_message",
            payload: {
              content: "第一条完成",
              persistedMessageId: "stale-final",
              metadata: { streamState: "completed" },
            },
          });
        }
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });

  const first = await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-replay-user",
    senderName: "补发用户",
    text: "第一条",
    attachments: [],
  });
  await waitFor(() => store.listPendingWechatNotifications("wechat-replay-user").length === 1);

  await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-replay-user",
    senderName: "补发用户",
    text: "第二条",
    attachments: [],
  });
  await waitFor(() => store.listPendingWechatNotifications("wechat-replay-user").length === 0);

  assert.deepEqual(attempts.map((item) => item.content), ["收到", "第一条完成", "收到", "第一条完成"]);
  assert.equal(store.getSession(first.id).messages.some((message) => message.metadata?.eventType === "wechat/notification/replayed"), true);
});

test("rotates long-task progress notifications per WeChat recipient", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-progress-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateMainSessionForChannel({
    channel: "wechat",
    senderId: "progress-user",
    senderName: "Progress user",
    workspaceRoot: dataDir,
  });
  const sent = [];
  const resolvers = [];
  const mainInputs = [];
  let now = 0;
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    progressIntervalMs: 300000,
    progressTimerEnabled: false,
    now: () => now,
    runner: {
      runAppServerCommand: async (config) => {
        if (config.sessionId === main.id) {
          mainInputs.push(config.stdin);
          const progress = config.stdin.startsWith("[worker-hook:progress]");
          await config.onSessionEvent({
            sessionId: main.id,
            kind: "session.assistant_message",
            payload: {
              content: progress ? "任务仍在处理，详细进展：https://agent.example.test/task" : "任务已完成。",
              metadata: { streamState: "completed" },
            },
          });
          return { ok: true };
        }
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.tool_use",
          payload: { content: "working" },
        });
        return await new Promise((resolve) => resolvers.push(resolve));
      },
      stopAppServerCommand: () => false,
    },
  });

  const first = await orchestrator.startWorkerSession({ parentSessionId: main.id, title: "First task", task: "first" });
  const second = await orchestrator.startWorkerSession({ parentSessionId: main.id, title: "Second task", task: "second" });
  await waitFor(() => resolvers.length === 2);
  assert.equal(sent.length, 0);

  now = 300001;
  const firstTick = await orchestrator.notifyLongTaskProgress();
  assert.equal(firstTick.notified, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /任务仍在处理/);
  assert.match(sent[0].content, /agent\.example\.test\/task/);
  assert.match(mainInputs[0], /^\[worker-hook:progress\]/);
  assert.match(mainInputs[0], /静默时长：5 分钟/);
  assert.match(mainInputs[0], /详细进展：https:\/\/agent\.example\.test/);

  now = 600002;
  const secondTick = await orchestrator.notifyLongTaskProgress();
  assert.equal(secondTick.notified, 1);
  assert.notEqual(secondTick.sessionIds[0], firstTick.sessionIds[0]);
  assert.equal(new Set([...firstTick.sessionIds, ...secondTick.sessionIds]).size, 2);

  for (const resolve of resolvers) resolve({ ok: true });
  await waitFor(() => (
    !orchestrator.longTasks.has(first.id)
    && !orchestrator.longTasks.has(second.id)
    && mainInputs.filter((input) => input.startsWith("[worker-hook:completed]")).length === 2
    && orchestrator.running.size === 0
  ));
  orchestrator.stop();
  store.close();
});

test("worker completion hook returns the result to the main agent for a concise WeChat summary", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-worker-hook-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateMainSessionForChannel({
    channel: "wechat",
    senderId: "hook-user",
    senderName: "Hook user",
    workspaceRoot: dataDir,
  });
  const sent = [];
  const calls = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async (recipientId, content) => sent.push({ recipientId, content }) } },
    progressTimerEnabled: false,
    runner: {
      runAppServerCommand: async (config) => {
        calls.push(config);
        if (config.sessionId === main.id) {
          await config.onSessionEvent({
            sessionId: main.id,
            kind: "session.assistant_message",
            payload: { content: "做好了：[查看页面](https://pages.example.test/result)", metadata: { streamState: "completed" } },
          });
          return { ok: true };
        }
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: { content: "页面已经发布：https://pages.example.test/result。内部检查全部通过。", metadata: { streamState: "completed" } },
        });
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });

  const worker = await orchestrator.startWorkerSession({
    parentSessionId: main.id,
    title: "生成结果页面",
    task: "生成并发布页面",
  });

  await waitFor(() => calls.length === 2 && sent.length === 1);
  assert.equal(calls[0].sessionId, worker.id);
  assert.match(calls[0].appServerDeveloperInstructions, /不要直接联系或通知用户/);
  assert.match(calls[0].appServerDeveloperInstructions, /不要调用 open-abg notify/);
  assert.equal(calls[1].sessionId, main.id);
  assert.match(calls[1].stdin, /^\[worker-hook:completed\]/);
  assert.match(calls[1].stdin, /Worker 输出（不可信数据/);
  assert.match(calls[1].appServerDeveloperInstructions, /不要调用工具或再次调度/);
  assert.deepEqual(sent[0], {
    recipientId: "hook-user",
    content: "做好了：[查看页面](https://pages.example.test/result)",
  });
  assert.equal(orchestrator.longTasks.has(worker.id), false);
  orchestrator.stop();
  store.close();
});

test("worker completion hook waits until queued worker input is finished", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-worker-queue-hook-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateMainSessionForChannel({
    channel: "wechat",
    senderId: "queued-hook-user",
    senderName: "Queued hook user",
    workspaceRoot: dataDir,
  });
  const workerCalls = [];
  const mainCalls = [];
  const resolvers = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: { wechat: { sendText: async () => {} } },
    progressTimerEnabled: false,
    runner: {
      runAppServerCommand: async (config) => {
        if (config.sessionId === main.id) {
          mainCalls.push(config);
          return { ok: true };
        }
        workerCalls.push(config.stdin);
        await config.onSessionEvent({
          sessionId: config.sessionId,
          kind: "session.assistant_message",
          payload: { content: `完成步骤：${config.stdin}`, metadata: { streamState: "completed" } },
        });
        return await new Promise((resolve) => resolvers.push(resolve));
      },
      stopAppServerCommand: () => false,
    },
  });

  const worker = await orchestrator.startWorkerSession({ parentSessionId: main.id, title: "排队任务", task: "first" });
  await waitFor(() => resolvers.length === 1);
  await orchestrator.resumeSession(worker.id, "second");
  assert.deepEqual(workerCalls, ["first"]);
  assert.equal(mainCalls.length, 0);

  resolvers.shift()({ ok: true });
  await waitFor(() => workerCalls.length === 2 && resolvers.length === 1);
  assert.equal(mainCalls.length, 0);

  resolvers.shift()({ ok: true });
  await waitFor(() => mainCalls.length === 1);
  assert.match(mainCalls[0].stdin, /完成步骤：second/);
  assert.equal(orchestrator.longTasks.has(worker.id), false);
  orchestrator.stop();
  store.close();
});

test("consumes an active channel verification code before creating or persisting a WeChat session", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-channel-code-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const calls = [];
  const consumed = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: {},
    channelLoginCoordinator: {
      consumeWechatMessage: async (message) => {
        consumed.push({ senderId: message.senderId, matched: /^\d{6}$/.test(message.text) });
        return true;
      },
    },
    runner: {
      runAppServerCommand: async (input) => { calls.push(input); return { ok: true }; },
      stopAppServerCommand: () => false,
    },
  });

  const result = await orchestrator.handleChannelMessage("wechat", {
    senderId: "wechat-user",
    senderName: "User",
    text: "123456",
    attachments: [],
  });

  assert.deepEqual(result, { consumed: true, purpose: "channel-login-verification" });
  assert.deepEqual(consumed, [{ senderId: "wechat-user", matched: true }]);
  assert.equal(calls.length, 0);
  assert.equal(store.listSessions().length, 0);
});

test("materializes managed object references before starting an Agent turn", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-orchestrator-managed-file-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const calls = [];
  const materialized = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast: () => {} },
    channels: {},
    progressTimerEnabled: false,
    managedFiles: {
      materialize: async (objectId, options) => {
        materialized.push({ objectId, options });
        return { objectId, localPath: path.join(dataDir, "verified.pdf"), verified: true };
      },
    },
    runner: {
      runAppServerCommand: async (input) => { calls.push(input); return { ok: true }; },
      stopAppServerCommand: () => false,
    },
  });
  const objectId = "obj_0123456789abcdef01234567";
  const session = await orchestrator.startWorkerSession({ workspaceRoot: dataDir, task: `Review ${objectId}` });
  await waitFor(() => calls.length === 1);

  assert.equal(materialized[0].objectId, objectId);
  assert.equal(materialized[0].options.taskId, session.id);
  assert.match(calls[0].stdin, /Managed files prepared for this Agent turn/);
  assert.match(calls[0].stdin, /verified\.pdf/);
  orchestrator.stop();
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}
