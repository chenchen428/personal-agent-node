import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-wechat-login-lifecycle-"));
const previous = process.env.CLI_BRIDGE_DATA_DIR;
process.env.CLI_BRIDGE_DATA_DIR = root;
const { WeChatConnector } = await import("../src/channels/wechat/connector.ts");
if (previous === undefined) delete process.env.CLI_BRIDGE_DATA_DIR;
else process.env.CLI_BRIDGE_DATA_DIR = previous;
after(() => fs.rmSync(root, { recursive: true, force: true }));
const logger = { log() {}, error() {} };
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function qr() { return Response.json({ qrcode: "fixture-qr", qrcode_img_content: "https://wechat.invalid/fixture" }); }
function confirmed() { return Response.json({ status: "confirmed", ilink_bot_id: "fixture-account", bot_token: "fixture-token" }); }

test("clearing WeChat configuration invalidates an already running confirmation", async (t) => {
  const pending = deferred(); const started = deferred();
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("get_bot_qrcode")) return qr();
    started.resolve(); return pending.promise;
  });
  const connector = new WeChatConnector(logger);
  const login = await connector.startLogin();
  const polling = connector.pollLoginStatus(login.session);
  await started.promise;
  connector.clearConfiguration();
  pending.resolve(confirmed());
  assert.deepEqual(await polling, { status: "missing", connected: false });
  assert.equal(fs.existsSync(path.join(root, "account.json")), false);
});

test("a replacement WeChat QR invalidates old confirmation while the new session remains usable", async (t) => {
  const pending = deferred(); const started = deferred(); let polls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("get_bot_qrcode")) return qr();
    if (++polls === 1) { started.resolve(); return pending.promise; }
    return confirmed();
  });
  const connector = new WeChatConnector(logger);
  const first = await connector.startLogin();
  const polling = connector.pollLoginStatus(first.session);
  await started.promise;
  const second = await connector.startLogin();
  pending.resolve(confirmed());
  assert.deepEqual(await polling, { status: "missing", connected: false });
  assert.equal((await connector.pollLoginStatus(second.session)).connected, true);
  assert.equal(connector.catalogStatus().connected, true);
  connector.clearConfiguration();
  assert.equal(connector.catalogStatus().connected, false);
});

test("a late QR generation cannot restore an authorization after clearing", async (t) => {
  const pending = deferred(); const started = deferred();
  t.mock.method(globalThis, "fetch", async () => { started.resolve(); return pending.promise; });
  const connector = new WeChatConnector(logger);
  const login = connector.startLogin();
  const rejected = assert.rejects(login, /replaced or cleared/);
  await started.promise;
  connector.clearConfiguration();
  pending.resolve(qr());
  await rejected;
  assert.equal(connector.catalogStatus().configured, false);
});

test("WeChat catalog retains a confirmed credential rejection through transient failures and recovers after new login", async (t) => {
  let health = 200;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("get_bot_qrcode")) return qr();
    if (String(url).includes("get_qrcode_status")) return confirmed();
    return new Response(health === 200 ? "{}" : "fixture upstream response", { status: health });
  });
  const connector = new WeChatConnector(logger);
  const first = await connector.startLogin();
  await connector.pollLoginStatus(first.session);
  health = 503;
  assert.equal((await connector.status()).connected, true);
  health = 401;
  assert.equal((await connector.status()).connected, false);
  assert.equal(connector.catalogStatus().connected, false);
  health = 503;
  assert.equal((await connector.status()).connected, false);
  assert.equal(connector.catalogStatus().configured, true);
  const replacement = await connector.startLogin();
  await connector.pollLoginStatus(replacement.session);
  assert.equal(connector.catalogStatus().connected, true);
  connector.clearConfiguration();
});
