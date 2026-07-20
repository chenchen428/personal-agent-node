import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InstallationConnectionOwnership } from "../src/connections/connection-ownership.ts";
import { DingTalkConnector } from "../src/connections/dingtalk/connector.ts";

class MockStreamClient {
  connected = false;
  callback = null;
  acknowledgements = [];
  constructor({ tokenError = false } = {}) { this.tokenError = tokenError; }
  async getAccessToken() { if (this.tokenError) throw new Error("rejected"); return "test-access-token"; }
  registerCallbackListener(_topic, callback) { this.callback = callback; return this; }
  async connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  socketCallBackResponse(messageId, result) { this.acknowledgements.push({ messageId, result }); }
  receive(message) { this.callback?.(message); }
}

test("DingTalk credentials stay in one Space and Stream messages reply only to their source conversation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ownership = new InstallationConnectionOwnership({ installationDataRoot: root });
  const clients = [];
  const requests = [];
  const inbound = [];
  const connector = new DingTalkConnector({
    dataRoot: path.join(root, "spaces", "sp_personal00000001"),
    logger: { log() {}, error() {} },
    ownership: { store: ownership, spaceId: "sp_personal00000001" },
    clientFactory: () => { const client = new MockStreamClient(); clients.push(client); return client; },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  connector.attach(async (message) => { inbound.push(message); });

  await connector.configure({ clientId: "ding-client-123456", clientSecret: "secret-value-123456789" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clients.length, 2, "configuration validates credentials before creating the Stream client");
  assert.equal(connector.status().connected, true);
  const configFile = path.join(root, "spaces", "sp_personal00000001", "secrets", "connections", "dingtalk.json");
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(connector.status()), /secret-value|test-access-token|sendBySession/);

  const downstream = robotDownstream({ messageId: "stream-message-1", conversationId: "conversation-1" });
  clients[1].receive(downstream);
  clients[1].receive(downstream);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inbound.length, 1, "redelivered Stream callbacks must not run the Agent twice");
  assert.equal(clients[1].acknowledgements.length, 2, "every delivery is acknowledged before Agent work");
  assert.equal(inbound[0].senderId, "conversation-1");

  await connector.sendText("conversation-1", "reply text");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).hostname, "oapi.dingtalk.com");
  assert.equal(requests[0].init.headers["x-acs-dingtalk-access-token"], "test-access-token");
  assert.deepEqual(JSON.parse(requests[0].init.body), { msgtype: "text", text: { content: "reply text" } });
  await assert.rejects(connector.sendText("other-conversation", "blocked"), (error) => error.code === "DINGTALK_REPLY_CONTEXT_EXPIRED");
});

test("a DingTalk internal app cannot be configured in two isolated Spaces", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-owner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ownership = new InstallationConnectionOwnership({ installationDataRoot: root });
  const create = (spaceId) => new DingTalkConnector({
    dataRoot: path.join(root, "spaces", spaceId),
    logger: { log() {}, error() {} },
    ownership: { store: ownership, spaceId },
    clientFactory: () => new MockStreamClient(),
  });
  const personal = create("sp_personal00000001");
  const work = create("sp_work000000000000");
  const credentials = { clientId: "ding-client-exclusive", clientSecret: "secret-value-123456789" };

  await personal.configure(credentials);
  await assert.rejects(work.configure(credentials), (error) => error.code === "CONNECTION_SPACE_CONFLICT" && error.statusCode === 409);
  assert.deepEqual(personal.clearConfiguration(), { cleared: true, configuredBefore: true });
  await work.configure(credentials);
  assert.equal(work.status().configured, true);
});

function robotDownstream({ messageId, conversationId }) {
  return {
    specVersion: "1.0",
    type: "CALLBACK",
    headers: { appId: "ding-client-123456", connectionId: "connection", contentType: "application/json", messageId, time: String(Date.now()), topic: "/v1.0/im/bot/messages/get" },
    data: JSON.stringify({
      conversationId,
      chatbotCorpId: "corp",
      chatbotUserId: "bot",
      msgId: messageId,
      senderNick: "Owner",
      isAdmin: true,
      senderStaffId: "staff-1",
      sessionWebhookExpiredTime: Date.now() + 60_000,
      createAt: Date.now(),
      senderCorpId: "corp",
      conversationType: "1",
      senderId: "sender-1",
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=opaque",
      robotCode: "robot",
      msgtype: "text",
      text: { content: "hello from DingTalk" },
    }),
  };
}
