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
import { WeChatQianxunConnector } from "../src/connections/wechat-qianxun/connector.ts";
import { qianxunEnvelope } from "../src/connections/wechat-qianxun/protocol.ts";

const execFileAsync = promisify(execFile);
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Qianxun client only permits loopback origins and sends SafeKey as a header", async () => {
  assert.equal(validateQianxunBaseUrl("http://127.0.0.1:8055").origin, "http://127.0.0.1:8055");
  assert.throws(() => validateQianxunBaseUrl("https://127.0.0.1:8055"), /must use http/);
  assert.throws(() => validateQianxunBaseUrl("http://192.168.1.20:8055"), /must use 127\.0\.0\.1 or ::1/);
  assert.throws(() => validateQianxunBaseUrl("http://127.0.0.1:8055/DaenWxHook/client/"), /must be an origin/);

  let captured;
  const client = new QianxunProtocolClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return Response.json({ code: 200, result: { wxid: "wxid_owner" } });
    },
  });
  const result = await client.invoke({ baseUrl: "http://127.0.0.1:8055", safeKey: "local-secret" }, qianxunEnvelope("Q0000"));
  assert.equal(result.endpointStyle, "client");
  assert.equal(captured.url, "http://127.0.0.1:8055/DaenWxHook/client/");
  assert.equal(captured.options.headers.safekey, "local-secret");
  assert.equal(captured.options.redirect, "error");
});

test("Qianxun connector binds configuration and writes to an approved operation digest", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-test-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body, safeKey: options.headers.safekey });
    if (body.type === "Q0000") return Response.json({ code: 200, result: { wxid: "wxid_owner", nick: "Owner" } });
    return Response.json({ code: 200, result: { accepted: true } });
  };
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({ dataRoot, fetchImpl, operationStore });

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
    learnedEndpointStyle: "client",
    bindWxid: "wxid_owner",
    safeKeyConfigured: true,
    configuredAt: connector.publicConfig().configuredAt,
  });

  const send = connector.planAction("send-text", { wxid: "wxid_friend", text: "hello" });
  await assert.rejects(() => connector.execute(send.operation.id, send.operation.digest), /not approved/);
  const sendAgain = connector.planAction("send-text", { wxid: "wxid_friend", text: "hello" });
  operationStore.approve(sendAgain.operation.id, {
    digest: sendAgain.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  await connector.execute(sendAgain.operation.id, sendAgain.operation.digest);
  assert.equal(calls.at(-1).body.type, "Q0001");
  assert.deepEqual(calls.at(-1).body.data, { wxid: "wxid_friend", msg: "hello" });
  assert.equal(calls.at(-1).safeKey, "safe");
});

test("Qianxun callback journal rejects unpinned accounts and normalizes D0003", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-qianxun-callback-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    fetchImpl: async () => Response.json({ code: 200, result: { wxid: "wxid_owner" } }),
  });
  const plan = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(plan.operation.id, {
    digest: plan.operation.digest,
    actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" },
  });
  await connector.execute(plan.operation.id, plan.operation.digest);

  const mismatch = await connector.acceptCallback({ event: 10008, wxid: "wxid_other", data: { type: "D0003", data: { msg: "wrong account" } } });
  assert.deepEqual(mismatch, { accepted: false, reason: "account_mismatch" });
  const accepted = await connector.acceptCallback({
    event: 10008,
    wxid: "wxid_owner",
    data: {
      type: "D0003",
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

test("personal WeChat policy defaults to deny and only dispatches allowed Qianxun messages", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-personal-wechat-policy-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const inbound = [];
  const sent = [];
  const operationStore = createOperationStore({ dataRoot });
  const connector = new WeChatQianxunConnector({
    dataRoot,
    operationStore,
    onInboundMessage: async (message) => inbound.push(message),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.type === "Q0000") return Response.json({ code: 200, result: { wxid: "wxid_owner", nickname: "Owner" } });
      if (body.type === "Q0003") return Response.json({ code: 200, result: { wxid: "wxid_owner", nickname: "Owner" } });
      if (body.type === "Q0005") return Response.json({ code: 200, result: [{ wxid: "wxid_friend", nickname: "Alice" }, { wxid: "wxid_other", nickname: "Bob" }] });
      if (body.type === "Q0006") return Response.json({ code: 200, result: [{ wxid: "family@chatroom", nickname: "Family" }] });
      if (body.type === "Q0001") { sent.push(body.data); return Response.json({ code: 200, result: { accepted: true } }); }
      return Response.json({ code: 200, result: {} });
    },
  });
  const plan = connector.planConfigure({ baseUrl: "http://127.0.0.1:8055" });
  operationStore.approve(plan.operation.id, { digest: plan.operation.digest, actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" } });
  await connector.execute(plan.operation.id, plan.operation.digest);

  const direct = (signature, fromWxid = "wxid_friend") => ({ event: 10008, wxid: "wxid_owner", data: { type: "D0003", data: { msgType: 1, fromType: 1, fromWxid, finalFromWxid: fromWxid, signature, msg: "hello" } } });
  const denied = await connector.acceptCallback(direct("before-policy"));
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

  assert.equal((await connector.acceptCallback(direct("direct-allowed"))).dispatched, true);
  assert.equal((await connector.acceptCallback(direct("direct-denied", "wxid_other"))).reason, "contact_not_allowed");
  const groupWithoutMention = await connector.acceptCallback({ event: 10008, wxid: "wxid_owner", data: { type: "D0003", data: { msgType: 1, fromType: 2, fromWxid: "family@chatroom", finalFromWxid: "wxid_friend", signature: "group-no-at", msg: "hello" } } });
  assert.equal(groupWithoutMention.reason, "mention_required");
  const groupAllowedBody = { event: 10008, wxid: "wxid_owner", data: { type: "D0003", data: { msgType: 1, fromType: 2, fromWxid: "family@chatroom", finalFromWxid: "wxid_friend", atWxidList: ["wxid_owner"], signature: "group-at", msg: "hello owner" } } };
  assert.equal((await connector.acceptCallback(groupAllowedBody)).dispatched, true);
  assert.equal((await connector.acceptCallback(groupAllowedBody)).reason, "duplicate");
  assert.deepEqual(inbound.map((item) => item.senderId), ["wxid_friend", "family@chatroom"]);

  await connector.sendText("family@chatroom", "reply");
  assert.deepEqual(sent, [{ wxid: "family@chatroom", msg: "reply" }]);
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
    response.end(JSON.stringify({ ok: true, operation: { id: "op_test", digest: "digest", risk: "R2" } }));
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

  assert.deepEqual(requests, [
    { url: "/api/connections/wechat/qianxun/plan-configure", body: { baseUrl: "http://127.0.0.1:8055", endpointStyle: "auto", bindWxid: "", safeKey: "super-secret" } },
    { url: "/api/connections/wechat/qianxun/plan-action", body: { action: "send-text", input: { wxid: "wxid_friend", text: "hello" } } },
    { url: "/api/connections/wechat-personal/detect", body: { baseUrl: "http://127.0.0.1:8055", endpointStyle: "auto", bindWxid: "", safeKey: "super-secret" } },
  ]);
});
