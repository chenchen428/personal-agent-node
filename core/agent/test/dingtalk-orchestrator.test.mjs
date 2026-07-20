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

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
