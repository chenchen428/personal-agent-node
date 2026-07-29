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
  assert.equal(fs.existsSync(configFile), true);
  if (process.platform !== "win32") assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(connector.status()), /secret-value|test-access-token|sendBySession/);

  const downstream = robotDownstream({ messageId: "stream-message-1", conversationId: "conversation-1" });
  clients[1].receive(downstream);
  clients[1].receive(downstream);
  await waitFor(() => inbound.length === 1);
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

test("DingTalk receives supported media into managed Space storage and sends native images and files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-media-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inboundRoot = path.join(root, "workspace", "files", "inbound");
  const clients = [];
  const inbound = [];
  const registered = [];
  const requests = [];
  const connector = new DingTalkConnector({
    dataRoot: path.join(root, "workspace"),
    inboundAttachmentsDir: inboundRoot,
    logger: { log() {}, error() {} },
    clientFactory: () => { const client = new MockStreamClient(); clients.push(client); return client; },
    registerAttachment: async (input) => {
      registered.push(input);
      return { uploaded: true, objectId: `obj_${String(registered.length).padStart(24, "0")}`, objectKey: input.relativePath };
    },
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url));
      requests.push({ target, init });
      if (target.pathname === "/v1.0/robot/messageFiles/download") {
        const { downloadCode } = JSON.parse(init.body);
        return Response.json({ downloadUrl: `https://media.dingtalk.com/files/${encodeURIComponent(downloadCode)}` });
      }
      if (target.hostname === "media.dingtalk.com") {
        const name = decodeURIComponent(target.pathname.split("/").pop());
        const contentType = name.includes("picture") || name.includes("rich") ? "image/png"
          : name.includes("audio") ? "audio/amr"
            : name.includes("video") ? "video/mp4"
              : "application/pdf";
        return new Response(Buffer.from(`media:${name}`), { status: 200, headers: { "content-type": contentType } });
      }
      if (target.pathname === "/media/upload") {
        assert.equal(target.searchParams.get("access_token"), "test-access-token");
        assert.equal(init.body instanceof FormData, true);
        return Response.json({ errcode: 0, errmsg: "ok", media_id: `media-${target.searchParams.get("type")}` });
      }
      if (target.pathname === "/robot/sendBySession") return Response.json({ errcode: 0, errmsg: "ok" });
      throw new Error(`unexpected request ${target.origin}${target.pathname}`);
    },
  });
  connector.attach(async (message) => { inbound.push(message); });
  await connector.configure({ clientId: "ding-client-media", clientSecret: "secret-value-123456789" });
  await waitFor(() => clients[1]?.connected);

  const messages = [
    { id: "media-picture", msgtype: "picture", content: { downloadCode: "picture-code" } },
    { id: "media-file", msgtype: "file", content: { downloadCode: "file-code", fileName: "季度报告.pdf" } },
    { id: "media-audio", msgtype: "audio", content: { downloadCode: "audio-code", recognition: "语音识别内容" } },
    { id: "media-video", msgtype: "video", content: { downloadCode: "video-code", videoType: "mp4" } },
    { id: "media-rich", msgtype: "richText", content: { richText: [{ text: "富文本说明" }, { type: "picture", downloadCode: "rich-code" }] } },
  ];
  for (const message of messages) clients[1].receive(robotDownstream({ messageId: message.id, conversationId: "conversation-media", ...message }));
  await waitFor(() => inbound.length === messages.length);

  assert.deepEqual(inbound.map((message) => message.attachments[0]?.kind), ["image", "file", "file", "file", "image"]);
  assert.match(inbound[0].attachments[0].fileName, /\.png$/);
  assert.match(inbound[4].attachments[0].fileName, /\.png$/);
  assert.equal(inbound[2].text, "语音识别内容");
  assert.equal(inbound[4].text, "富文本说明");
  assert.equal(registered.length, 5);
  assert.equal(registered.every((item) => item.source === "dingtalk" && item.relativePath.startsWith("dingtalk/")), true);
  for (const message of inbound) {
    const attachment = message.attachments[0];
    assert.equal(path.resolve(attachment.path).startsWith(`${path.resolve(inboundRoot)}${path.sep}`), true);
    assert.equal(fs.statSync(attachment.path).size, attachment.sizeBytes);
    assert.match(attachment.managedObjectId, /^obj_/);
  }

  const imagePath = inbound[0].attachments[0].path;
  const filePath = inbound[1].attachments[0].path;
  await connector.sendImage("conversation-media", imagePath);
  await connector.sendFile("conversation-media", filePath, "季度报告.pdf");
  const webhookBodies = requests
    .filter((request) => request.target.pathname === "/robot/sendBySession")
    .map((request) => JSON.parse(request.init.body));
  assert.deepEqual(webhookBodies, [
    { msgtype: "image", image: { media_id: "media-image" } },
    { msgtype: "file", file: { media_id: "media-file" } },
  ]);
  assert.deepEqual(connector.status().capabilities, {
    inbound: ["text", "image", "file", "audio", "video", "richText"],
    outbound: ["text", "image", "file"],
  });
  assert.doesNotMatch(JSON.stringify(connector.status()), /test-access-token|media\.dingtalk\.com|sendBySession/);
});

test("DingTalk rejects untrusted signed media download hosts without fetching them", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dingtalk-media-host-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clients = [];
  const inbound = [];
  let localFetchAttempted = false;
  const connector = new DingTalkConnector({
    dataRoot: root,
    logger: { log() {}, error() {} },
    clientFactory: () => { const client = new MockStreamClient(); clients.push(client); return client; },
    fetchImpl: async (url) => {
      const target = new URL(String(url));
      if (target.pathname === "/v1.0/robot/messageFiles/download") return Response.json({ downloadUrl: "https://127.0.0.1/private" });
      localFetchAttempted = true;
      throw new Error("must not fetch untrusted media URL");
    },
  });
  connector.attach(async (message) => { inbound.push(message); });
  await connector.configure({ clientId: "ding-client-host", clientSecret: "secret-value-123456789" });
  clients[1].receive(robotDownstream({ messageId: "unsafe-media", conversationId: "conversation-host", msgtype: "file", content: { downloadCode: "unsafe-code", fileName: "private.txt" } }));
  await waitFor(() => inbound.length === 1);
  assert.equal(localFetchAttempted, false);
  assert.equal(inbound[0].attachments.length, 0);
  assert.match(inbound[0].text, /1 个钉钉附件未能下载/);
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

function robotDownstream({ messageId, conversationId, msgtype = "text", text = { content: "hello from DingTalk" }, content }) {
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
      msgtype,
      ...(msgtype === "text" ? { text } : { content }),
    }),
  };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
