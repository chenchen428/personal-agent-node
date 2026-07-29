import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionOrchestrator } from "../src/server/orchestrator.js";
import { BridgeStore } from "../src/store/store.js";

test("DingTalk messages use a persistent main conversation and reply through DingTalk", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-orchestrator-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast() {} },
    channels: { dingtalk: { sendText: async (recipientId, text) => sent.push({ recipientId, text }) } },
    progressTimerEnabled: false,
    runner: {
      runAppServerCommand: async (input) => {
        await input.onSessionEvent({ sessionId: input.sessionId, kind: "session.assistant_message", payload: { content: "DingTalk reply", metadata: { streamState: "completed" } } });
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });
  t.after(() => {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  });

  const session = await orchestrator.handleChannelMessage("dingtalk", {
    senderId: "conversation-1",
    senderName: "Owner",
    text: "hello",
    attachments: [],
    createdAt: new Date().toISOString(),
  });
  await waitFor(() => sent.some((item) => item.text === "DingTalk reply"));
  assert.equal(session.role, "main");
  assert.equal(session.channel, "dingtalk");
  assert.deepEqual(sent.map((item) => item.recipientId), ["conversation-1", "conversation-1"]);
  assert.equal(store.getSession(session.id).messages.some((message) => message.role === "user" && message.content === "hello"), true);
  store.enforceSessionRoleInvariants();
  assert.equal(store.getSessionRecord(session.id).role, "main");
});

test("DingTalk final replies preserve ordered native image and file delivery", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-final-media-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const orchestrator = new SessionOrchestrator({
    store,
    hub: { broadcast() {} },
    channels: { dingtalk: {
      sendText: async (recipientId, text) => sent.push({ type: "text", recipientId, text }),
      sendImage: async (recipientId, filePath) => sent.push({ type: "image", recipientId, filePath }),
      sendFile: async (recipientId, filePath, title) => sent.push({ type: "file", recipientId, filePath, title }),
    } },
    progressTimerEnabled: false,
  });
  t.after(() => {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  });
  const session = store.getOrCreateMainSessionForChannel({ channel: "dingtalk", senderId: "conversation-media", senderName: "Owner", workspaceRoot: dataDir });
  const result = await orchestrator.enqueueWechatReply(session.id, "conversation-media", {
    text: "附件如下",
    idempotencyKey: "dingtalk-media-reply",
    attachments: [
      { objectId: "obj_111111111111111111111111", kind: "image", localPath: path.join(dataDir, "result.png"), name: "result.png", caption: "效果图" },
      { objectId: "obj_222222222222222222222222", kind: "file", localPath: path.join(dataDir, "report.pdf"), name: "report.pdf" },
    ],
  });
  assert.equal(result.sent, true);
  assert.deepEqual(sent.map((item) => item.type), ["text", "text", "image", "file"]);
  assert.deepEqual(sent.map((item) => item.recipientId), Array(4).fill("conversation-media"));
  assert.equal(sent[3].title, "report.pdf");
});

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
