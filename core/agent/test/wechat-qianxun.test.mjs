import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createOperationStore } from "../../runtime/src/operations.ts";
import { QianxunProtocolClient, validateQianxunBaseUrl } from "../src/connections/wechat-qianxun/client.ts";
import { QianxunCallbackStore } from "../src/connections/wechat-qianxun/callback-store.ts";
import { WeChatQianxunConnector } from "../src/connections/wechat-qianxun/connector.ts";
import { qianxunEnvelope } from "../src/connections/wechat-qianxun/protocol.ts";

const execFileAsync = promisify(execFile);
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Qianxun Pro client only permits loopback origins and uses the documented HTTP API routes", async () => {
  assert.equal(validateQianxunBaseUrl("http://127.0.0.1:8055").origin, "http://127.0.0.1:8055");
  assert.throws(() => validateQianxunBaseUrl("https://127.0.0.1:8055"), /must use http/);
  assert.throws(() => validateQianxunBaseUrl("http://192.168.1.20:8055"), /must use 127\.0\.0\.1 or ::1/);
  assert.throws(() => validateQianxunBaseUrl("http://127.0.0.1:8055/wechat/httpapi"), /must be an origin/);

  let captured;
  const client = new QianxunProtocolClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return Response.json({ code: 200, result: { wxid: "wxid_owner" } });
    },
  });
  const result = await client.invoke({ baseUrl: "http://127.0.0.1:8055", safeKey: "local-secret" }, qianxunEnvelope("checkWeChat"));
  assert.equal(result.endpointStyle, "wechat");
  assert.equal(captured.url, "http://127.0.0.1:8055/wechat/httpapi");
  assert.equal(captured.options.headers.safekey, undefined);
  assert.equal(captured.options.redirect, "error");

  const framework = await client.invoke({ baseUrl: "http://127.0.0.1:7777", endpointStyle: "qianxun", bindWxid: "wxid_owner", safeKey: "local-secret" }, qianxunEnvelope("checkWeChat"));
  assert.equal(framework.endpointStyle, "qianxun");
  assert.equal(captured.url, "http://127.0.0.1:7777/qianxun/httpapi?wxid=wxid_owner&safekey=local-secret");
});

test("Qianxun Pro configuration rejects an expired authorization even when checkWeChat returns code 200", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-expired-"));
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    fetchImpl: async () => Response.json({ code: 200, result: { wxid: "wxid_owner", isExpire: 1 } }),
  });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const plan = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(plan.operation.id, {
    digest: plan.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  await assert.rejects(() => connector.execute(plan.operation.id, plan.operation.digest), /授权已到期/);
  assert.equal(connector.publicConfig(), null);
});

test("Qianxun connector binds configuration and writes to an approved operation digest", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-test-"));
  const calls = [];
  let authorizationExpired = false;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body, safeKey: options.headers.safekey });
    if (body.type === "checkWeChat") return Response.json({ code: 200, result: { wxid: "wxid_owner", nick: "Owner", isExpire: authorizationExpired ? 1 : 0 } });
    return Response.json({ code: 200, result: { accepted: true } });
  };
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({ dataRoot, fetchImpl, operationStore });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

  const configured = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055", safeKey: "safe", endpointStyle: "auto" });
  assert.equal(configured.operation.risk, "R2");
  operationStore.approve(configured.operation.id, {
    digest: configured.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  const configureResult = await connector.execute(configured.operation.id, configured.operation.digest);
  assert.equal(configureResult.status, "succeeded");
  assert.deepEqual(connector.publicConfig(), {
    schemaVersion: 1,
    baseUrl: "http://127.0.0.1:8055",
    endpointStyle: "auto",
    learnedEndpointStyle: "wechat",
    bindWxid: "wxid_owner",
    safeKeyConfigured: true,
    configuredAt: connector.publicConfig().configuredAt,
  });

  await connector.detect({ baseUrl: "http://127.0.0.1:8099", endpointStyle: "auto" });
  assert.equal(connector.publicConfig().baseUrl, "http://127.0.0.1:8099");
  assert.equal(connector.publicConfig().safeKeyConfigured, true);
  assert.equal(calls.at(-1).url, "http://127.0.0.1:8099/wechat/httpapi");

  const readCases = [
    ["profile", {}, "getSelfInfo", { type: "1" }],
    ["lookup", { wxid: "filehelper" }, "queryObj", { wxid: "filehelper", type: "1" }],
    ["friends", { refresh: true }, "getFriendList", { type: "2" }],
    ["groups", { refresh: true }, "getGroupList", { type: "2" }],
    ["official-accounts", { refresh: true }, "getPublicList", { type: "2" }],
    ["members", { groupWxid: "family@chatroom", refresh: true }, "getMemberList", { wxid: "family@chatroom", type: "2", getNick: "1" }],
    ["stranger", { pq: "example" }, "queryNewFriend", { obj: "example" }],
  ];
  for (const [operation, input, type, data] of readCases) {
    await connector.read(operation, input);
    assert.equal(calls.at(-1).body.type, type);
    assert.deepEqual(calls.at(-1).body.data, data);
  }

  const send = connector.planAction("send-text", { wxid: "wxid_friend", text: "hello" });
  await assert.rejects(() => connector.execute(send.operation.id, send.operation.digest), /not approved/);
  const sendAgain = connector.planAction("send-text", { wxid: "wxid_friend", text: "hello" });
  operationStore.approve(sendAgain.operation.id, {
    digest: sendAgain.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  await connector.execute(sendAgain.operation.id, sendAgain.operation.digest);
  assert.equal(calls.at(-1).body.type, "sendText");
  assert.deepEqual(calls.at(-1).body.data, { wxid: "wxid_friend", msg: "hello" });
  assert.equal(calls.at(-1).safeKey, undefined);

  const imageFile = path.join(dataRoot, "image.png");
  const documentFile = path.join(dataRoot, "document.txt");
  fs.writeFileSync(imageFile, "image");
  fs.writeFileSync(documentFile, "document");
  const writeCases = [
    ["send-image", { wxid: "wxid_friend", filePath: imageFile }, "sendImage", { wxid: "wxid_friend", path: imageFile, fileName: "image.png" }, "R2"],
    ["send-file", { wxid: "wxid_friend", filePath: documentFile }, "sendFile", { wxid: "wxid_friend", path: documentFile, fileName: "document.txt" }, "R2"],
    ["set-remark", { wxid: "wxid_friend", remark: "Friend" }, "editObjRemark", { wxid: "wxid_friend", remark: "Friend" }, "R2"],
    ["accept-friend", { scene: "30", v3: "v3_value", v4: "v4_value", role: 8 }, "agreeFriendReq", { scene: "30", v3: "v3_value", v4: "v4_value", role: "8" }, "R2"],
    ["add-friend-v3", { v3: "v3_value", content: "hello", scene: "30" }, "addFriendByV3", { v3: "v3_value", content: "hello", scene: "30" }, "R2"],
    ["add-friend-group", { groupWxid: "family@chatroom", memberWxid: "wxid_member", content: "hello" }, "addFriendByGroupWxid", { wxid: "wxid_member", gid: "family@chatroom", content: "hello", scene: "14" }, "R2"],
    ["invite-group", { groupWxid: "family@chatroom", memberWxid: "wxid_friend" }, "inviteMembers", { wxid: "family@chatroom", objWxid: "wxid_friend" }, "R2"],
    ["remove-contact", { wxid: "wxid_friend" }, "delFriend", { wxid: "wxid_friend" }, "R3"],
  ];
  for (const [action, input, type, data, risk] of writeCases) {
    const planned = connector.planAction(action, input);
    assert.equal(planned.operation.risk, risk);
    operationStore.approve(planned.operation.id, {
      digest: planned.operation.digest,
      actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
    });
    await connector.execute(planned.operation.id, planned.operation.digest);
    assert.equal(calls.at(-1).body.type, type);
    assert.deepEqual(calls.at(-1).body.data, data);
  }

  authorizationExpired = true;
  await assert.rejects(
    () => connector.detect(),
    (error) => error.code === "QIANXUN_AUTHORIZATION_EXPIRED" && /授权已到期/.test(error.message),
  );
});

test("Qianxun Pro callback journal rejects unpinned accounts and normalizes recvMsg", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-callback-"));
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    fetchImpl: async () => Response.json({ code: 200, result: { wxid: "wxid_owner" } }),
  });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const plan = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(plan.operation.id, {
    digest: plan.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  await connector.execute(plan.operation.id, plan.operation.digest);

  const mismatch = await connector.acceptCallback({ event: 10008, wxid: "wxid_other", data: { type: "recvMsg", data: { msg: "wrong account" } } });
  assert.deepEqual(mismatch, { accepted: false, reason: "account_mismatch" });
  const accepted = await connector.acceptCallback({
    event: 10008,
    wxid: "wxid_owner",
    data: {
      type: "recvMsg",
      port: 8055,
      data: { msgType: 1, msgSource: 0, fromType: 2, fromWxid: "group@chatroom", finalFromWxid: "wxid_friend", signature: "sig", msg: "hello" },
    },
  });
  assert.equal(accepted.accepted, true);
  const events = connector.listEvents(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].accountWxid, "wxid_owner");
  assert.equal(events[0].message.msg, "hello");
  assert.equal(events[0].message.fromWxid, "group@chatroom");
});

test("personal WeChat connectivity test verifies a File Transfer Assistant callback and an explicitly confirmed reply", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-personal-wechat-connectivity-"));
  const sent = [];
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.type === "checkWeChat") return Response.json({ code: 200, result: { wxid: "wxid_owner", isExpire: 0 } });
      if (body.type === "getSelfInfo") return Response.json({ code: 200, result: { wxid: "wxid_owner", nickname: "Owner" } });
      if (body.type === "getFriendList" || body.type === "getGroupList") return Response.json({ code: 200, result: [] });
      if (body.type === "sendText") { sent.push(body.data); return Response.json({ code: 200, result: { accepted: true } }); }
      return Response.json({ code: 200, result: {} });
    },
  });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const configure = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(configure.operation.id, { digest: configure.operation.digest, actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" } });
  await connector.execute(configure.operation.id, configure.operation.digest);
  await connector.updateAccessPolicy({ schemaVersion: 1, enabled: true, contacts: [], groups: [] });

  const started = await connector.startConnectivityTest();
  assert.equal(started.phase, "waiting_message");
  assert.match(started.testText, /^Personal Agent 连通测试 PA-[A-F0-9]{6}$/);
  assert.equal(JSON.stringify(started).includes("filehelper"), false);

  const ignored = await connector.acceptCallback({ event: 10008, wxid: "wxid_owner", data: { type: "recvMsg", data: { msgType: 1, msgSource: 1, fromType: 1, fromWxid: "wxid_owner", finalFromWxid: "wxid_owner", toWxid: "filehelper", signature: "wrong-test", msg: "wrong text" } } });
  assert.equal(ignored.reason, "self_message");
  assert.equal(connector.connectivityTestStatus().phase, "waiting_message");

  const received = await connector.acceptCallback({ event: 10008, wxid: "wxid_owner", data: { type: "recvMsg", data: { msgType: 1, msgSource: 1, fromType: 1, fromWxid: "wxid_owner", finalFromWxid: "wxid_owner", toWxid: "filehelper", signature: "matching-test", msg: started.testText } } });
  assert.equal(received.reason, "self_message");
  assert.equal(connector.connectivityTestStatus().phase, "message_received");
  assert.equal(connector.listConversations().some((conversation) => conversation.messageCount === 2), true);

  const planned = connector.planConnectivityTestReply();
  assert.equal(planned.state.phase, "reply_planned");
  assert.equal(planned.operation.risk, "R2");
  assert.equal(JSON.stringify(planned).includes("filehelper"), false);
  await assert.rejects(() => connector.executeConnectivityTestReply("op_wrong", planned.operation.digest), /不匹配/);
  const completed = await connector.executeConnectivityTestReply(planned.operation.id, planned.operation.digest);
  assert.equal(completed.phase, "complete");
  assert.deepEqual(sent, [{ wxid: "filehelper", msg: started.replyText }]);
  assert.equal(JSON.stringify(connector.connectivityTestStatus()).includes("filehelper"), false);
});

test("personal WeChat history imports retained callback journal records", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-personal-wechat-history-import-"));
  const events = new QianxunCallbackStore(dataRoot);
  events.append({
    type: "recvMsg",
    accountWxid: "wxid_owner",
    data: { msgType: 1, msgSource: 0, fromType: 1, fromWxid: "wxid_friend", finalFromWxid: "wxid_friend", signature: "legacy-sig", msg: "retained message" },
  });
  const connector = new WeChatQianxunConnector({ dataRoot, fetchImpl: async () => Response.json({ code: 200, result: {} }) });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

  const conversations = connector.listConversations();
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].messageCount, 1);
  assert.deepEqual(connector.conversationHistory(conversations[0].id).map((message) => message.text), ["retained message"]);
});

test("personal WeChat policy defaults to deny and only dispatches allowed Qianxun messages", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-personal-wechat-policy-"));
  const inbound = [];
  const sent = [];
  const sentImages = [];
  const sentFiles = [];
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    onInboundMessage: async (message) => inbound.push(message),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.type === "checkWeChat") return Response.json({ code: 200, result: { wxid: "wxid_owner", nickname: "Owner", isExpire: 0 } });
      if (body.type === "getSelfInfo") return Response.json({ code: 200, result: { wxid: "wxid_owner", nickname: "Owner" } });
      if (body.type === "getFriendList") return Response.json({ code: 200, result: [{ wxid: "wxid_friend", nickname: "Alice" }, { wxid: "wxid_other", nickname: "Bob" }] });
      if (body.type === "getGroupList") return Response.json({ code: 200, result: [{ wxid: "family@chatroom", nickname: "Family" }] });
      if (body.type === "sendText") { sent.push(body.data); return Response.json({ code: 200, result: { accepted: true } }); }
      if (body.type === "sendImage") { sentImages.push(body.data); return Response.json({ code: 200, result: { accepted: true } }); }
      if (body.type === "sendFile") { sentFiles.push(body.data); return Response.json({ code: 200, result: { accepted: true } }); }
      return Response.json({ code: 200, result: {} });
    },
  });
  t.after(() => { connector.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const plan = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(plan.operation.id, { digest: plan.operation.digest, actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" } });
  await connector.execute(plan.operation.id, plan.operation.digest);

  const direct = (signature, fromWxid = "wxid_friend", msg = "hello", msgSource = 0) => ({ event: 10008, wxid: "wxid_owner", data: { type: "recvMsg", data: { msgType: 1, msgSource, fromType: 1, fromWxid, finalFromWxid: fromWxid, signature, msg } } });
  const denied = await connector.acceptCallback(direct("before-policy", "wxid_friend", "earlier context"));
  assert.equal(denied.reason, "policy_disabled");
  assert.equal(inbound.length, 0);

  const directory = await connector.directory();
  assert.deepEqual(directory.contacts.map((item) => [item.name, item.maskedId]), [["Alice", "wxi***end"], ["Bob", "wxi***her"]]);
  assert.equal(directory.contacts.every((item) => /^pwc_[a-f0-9]{32}$/.test(item.id)), true);
  assert.equal(JSON.stringify(directory).includes("wxid_friend"), false);
  await assert.rejects(() => connector.updateAccessPolicy({ schemaVersion: 1, contacts: [{ wxid: "injected", scope: "direct_only" }], groups: [] }), /not read from Qianxun/);
  const allowedContactId = directory.contacts.find((item) => item.name === "Alice").id;
  const allowedGroupId = directory.groups.find((item) => item.name === "Family").id;
  await connector.updateAccessPolicy({
    schemaVersion: 1,
    enabled: true,
    contacts: [{ wxid: allowedContactId, scope: "direct_and_group" }],
    groups: [{ wxid: allowedGroupId, trigger: "allowed_members_mention" }],
  });

  assert.equal((await connector.acceptCallback(direct("direct-allowed", "wxid_friend", "current question"))).dispatched, true);
  assert.deepEqual(inbound[0].conversationHistory.map((item) => item.text), ["earlier context"]);
  assert.equal((await connector.acceptCallback(direct("direct-denied", "wxid_other"))).reason, "contact_not_allowed");
  const groupWithoutMention = await connector.acceptCallback({ event: 10008, wxid: "wxid_owner", data: { type: "recvMsg", data: { msgType: 1, fromType: 2, fromWxid: "family@chatroom", finalFromWxid: "wxid_friend", signature: "group-no-at", msg: "hello" } } });
  assert.equal(groupWithoutMention.reason, "mention_required");
  const groupAllowedBody = { event: 10008, wxid: "wxid_owner", data: { type: "recvMsg", data: { msgType: 1, fromType: 2, fromWxid: "family@chatroom", finalFromWxid: "wxid_friend", atWxidList: ["wxid_owner"], signature: "group-at", msg: "hello owner" } } };
  assert.equal((await connector.acceptCallback(groupAllowedBody)).dispatched, true);
  assert.equal((await connector.acceptCallback(groupAllowedBody)).reason, "duplicate");
  assert.deepEqual(inbound.map((item) => item.senderId), ["wxid_friend", "family@chatroom"]);

  assert.equal((await connector.acceptCallback(direct("self-message", "wxid_friend", "my earlier reply", 1))).reason, "self_message");
  const directHistory = connector.conversationHistory(allowedContactId, { limit: 100 });
  assert.deepEqual(directHistory.map((item) => [item.direction, item.text]), [
    ["inbound", "earlier context"],
    ["inbound", "current question"],
    ["outbound", "my earlier reply"],
  ]);
  assert.deepEqual(directHistory.map((item) => item.senderName), ["Alice", "Alice", "Owner"]);
  const namedConversations = connector.listConversations();
  assert.equal(namedConversations.some((item) => item.id === allowedContactId && item.name === "Alice" && item.messageCount === 3), true);
  assert.equal(namedConversations.some((item) => item.id === allowedGroupId && item.name === "Family" && item.lastMessage.senderName === "Alice"), true);
  assert.equal(JSON.stringify({ namedConversations, directHistory }).includes("wxid_friend"), false);

  for (let index = 0; index < 101; index += 1) {
    await connector.acceptCallback(direct(`context-${index}`, "wxid_friend", `history ${index}`));
  }
  assert.equal(inbound.at(-1).conversationHistory.length, 100);
  assert.equal(inbound.at(-1).conversationHistory.at(-1).text, "history 99");
  const newestConversationPage = connector.listConversations(1);
  const olderConversationPage = connector.listConversations(1, newestConversationPage[0].latestSeq);
  assert.equal(newestConversationPage.length, 1);
  assert.equal(olderConversationPage.length, 1);
  assert.notEqual(newestConversationPage[0].id, olderConversationPage[0].id);

  await connector.sendText("family@chatroom", "reply");
  assert.deepEqual(sent, [{ wxid: "family@chatroom", msg: "reply" }]);
  const replyImage = path.join(dataRoot, "reply.png");
  fs.writeFileSync(replyImage, "native-image-fixture");
  await connector.sendImage("family@chatroom", replyImage, "caption");
  assert.deepEqual(sent.at(-1), { wxid: "family@chatroom", msg: "caption" });
  assert.deepEqual(sentImages, [{ wxid: "family@chatroom", path: replyImage, fileName: "reply.png" }]);
  const replyFile = path.join(dataRoot, "report.pdf");
  fs.writeFileSync(replyFile, "%PDF-1.7\n%%EOF");
  await connector.sendFile("family@chatroom", replyFile, "Q2 Report.pdf", "file caption");
  assert.deepEqual(sent.at(-1), { wxid: "family@chatroom", msg: "file caption" });
  assert.deepEqual(sentFiles, [{ wxid: "family@chatroom", path: replyFile, fileName: "Q2 Report.pdf" }]);
});

test("Qianxun CLI reads SafeKey from a file and maps semantic commands", async (t) => {
  const working = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-cli-"));
  const safeKeyFile = path.join(working, "safe-key.txt");
  fs.writeFileSync(safeKeyFile, "super-secret\n", { encoding: "utf8", mode: 0o600 });
  t.after(() => fs.rmSync(working, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ url: request.url, body });
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify(request.url.startsWith("/api/connections/wechat-personal/conversations")
      ? { ok: true, conversations: [] }
      : request.url.startsWith("/api/connections/wechat-personal/history")
        ? { ok: true, messages: [] }
        : { ok: true, operation: { id: "op_test", digest: "digest", risk: "R2" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "test" };

  await execFileAsync(process.execPath, [
    path.join(agentRoot, "bin", "pa-cli.mjs"), "connection", "wechat", "qianxun", "plan-configure",
    "--url", "http://127.0.0.1:8055", "--safe-key-file", safeKeyFile, "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    path.join(agentRoot, "bin", "pa-cli.mjs"), "connection", "wechat", "qianxun", "plan-send-text",
    "--to", "wxid_friend", "--text", "hello", "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    path.join(agentRoot, "bin", "pa-cli.mjs"), "connection", "wechat-personal", "detect",
    "--url", "http://127.0.0.1:8055", "--safe-key-file", safeKeyFile, "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    path.join(agentRoot, "bin", "pa-cli.mjs"), "connection", "wechat-personal", "conversations",
    "--limit", "20", "--before", "500", "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    path.join(agentRoot, "bin", "pa-cli.mjs"), "connection", "wechat-personal", "history",
    "--conversation", "pwc_0123456789abcdef0123456789abcdef", "--limit", "100", "--before", "42", "--json",
  ], { cwd: working, env });

  assert.deepEqual(requests, [
    { url: "/api/connections/wechat/qianxun/plan-configure", body: { baseUrl: "http://127.0.0.1:8055", endpointStyle: "auto", bindWxid: "", safeKey: "super-secret" } },
    { url: "/api/connections/wechat/qianxun/plan-action", body: { action: "send-text", input: { wxid: "wxid_friend", text: "hello" } } },
    { url: "/api/connections/wechat-personal/detect", body: { baseUrl: "http://127.0.0.1:8055", endpointStyle: "auto", bindWxid: "", safeKey: "super-secret" } },
    { url: "/api/connections/wechat-personal/conversations?limit=20&before=500", body: {} },
    { url: "/api/connections/wechat-personal/history?conversation=pwc_0123456789abcdef0123456789abcdef&limit=100&before=42", body: {} },
  ]);
});
