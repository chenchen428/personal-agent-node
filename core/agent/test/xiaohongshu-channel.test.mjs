import assert from "node:assert/strict";
import test from "node:test";
import { ChannelInputError, ChannelRuntimeError, XiaohongshuChannel } from "../src/channels/xiaohongshu/channel.js";

test("xiaohongshu channel reports offline without leaking transport details", async () => {
  const channel = new XiaohongshuChannel({ fetchImpl: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:18060"); } });
  const status = await channel.status();
  assert.equal(status.state, "offline");
  assert.equal(status.loggedIn, false);
  assert.equal(status.egress, "direct-required");
  assert.equal(status.readOnly, true);
});

test("xiaohongshu channel coalesces concurrent browser status checks", async () => {
  let statusRequests = 0;
  let releaseStatus;
  const pendingStatus = new Promise((resolve) => { releaseStatus = resolve; });
  const channel = new XiaohongshuChannel({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return jsonResponse({ success: true, data: { status: "healthy" } });
      if (url.endsWith("/api/v1/login/status")) {
        statusRequests += 1;
        await pendingStatus;
        return jsonResponse({ success: true, data: { is_logged_in: false } });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  const first = channel.status();
  const second = channel.status();
  releaseStatus();
  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.equal(statusRequests, 1);
  assert.equal(firstStatus.state, "needs_login");
  assert.deepEqual(secondStatus, firstStatus);
});

test("xiaohongshu channel treats the upstream unauthenticated 500 as needs login", async () => {
  const channel = new XiaohongshuChannel({
    fetchImpl: async (url) => url.endsWith("/health")
      ? jsonResponse({ success: true, data: { status: "healthy" } })
      : jsonResponse({ success: false, error: "服务器内部错误" }, 500),
  });
  const status = await channel.status();
  assert.equal(status.state, "needs_login");
  assert.equal(status.loggedIn, false);
  assert.equal(status.error, undefined);
});

test("xiaohongshu QR sessions use opaque nonces and confirm through status", async () => {
  let loggedIn = false;
  let loginState = "pending";
  const notifications = [];
  const requests = [];
  const channel = new XiaohongshuChannel({
    now: () => Date.parse("2026-07-11T08:00:00Z"),
    onSessionState: async (event) => notifications.push(event),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, method: options.method || "GET" });
      if (url.endsWith("/health")) return jsonResponse({ success: true, data: { status: "healthy" } });
      if (url.endsWith("/api/v1/login/qrcode")) return jsonResponse({ success: true, data: { timeout: "4m", is_logged_in: false, img: "data:image/png;base64,QUJD" } });
      if (url.endsWith("/api/v1/login/status")) return jsonResponse({ success: true, data: { is_logged_in: loggedIn, login_state: loginState } });
      throw new Error(`unexpected ${url}`);
    },
  });
  const login = await channel.startLogin();
  assert.match(login.session, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(login.qrImage, "data:image/png;base64,QUJD");
  assert.equal(login.expiresAt, "2026-07-11T08:02:00.000Z");
  assert.equal((await channel.pollLogin(login.session)).status, "pending");
  loginState = "scanned";
  assert.equal((await channel.pollLogin(login.session)).status, "scanned");
  loginState = "verification_required";
  assert.equal((await channel.pollLogin(login.session)).status, "verification_required");
  loggedIn = true;
  loginState = "confirmed";
  assert.equal((await channel.pollLogin(login.session)).status, "confirmed");
  assert.deepEqual(notifications.map((event) => event.status), ["confirmed"]);
  assert.equal(requests.some((item) => item.url.endsWith("/api/v1/login/status")), true);
});

test("xiaohongshu channel rejects invalid QR payloads", async () => {
  const channel = new XiaohongshuChannel({
    fetchImpl: async () => jsonResponse({ success: true, data: { timeout: "4m", is_logged_in: false, img: "https://example.com/qr.png" } }),
  });
  await assert.rejects(() => channel.startLogin(), ChannelRuntimeError);
});

test("xiaohongshu channel submits a verification code only for an active login session", async () => {
  const submitted = [];
  const channel = new XiaohongshuChannel({
    now: () => Date.parse("2026-07-11T08:00:00Z"),
    verificationClient: { submit: async (code) => submitted.push(code) },
    fetchImpl: async () => jsonResponse({ success: true, data: { timeout: "4m", is_logged_in: false, img: "data:image/png;base64,QUJD" } }),
  });
  const login = await channel.startLogin();
  const result = await channel.submitVerificationCode(login.session, "123456");
  assert.equal(result.status, "submitted");
  assert.deepEqual(submitted, ["123456"]);
  await assert.rejects(() => channel.submitVerificationCode("missing", "123456"), ChannelInputError);
  await assert.rejects(() => channel.submitVerificationCode(login.session, "not-a-code"), ChannelInputError);
});

test("xiaohongshu search normalizes safe read-only results", async () => {
  let requestBody;
  const channel = new XiaohongshuChannel({
    now: () => 10_000,
    fetchImpl: async (_url, options = {}) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ success: true, data: { count: 1, feeds: [{ id: "note-1", xsecToken: "token-1", noteCard: { displayTitle: "测试笔记", user: { nickname: "作者" }, cover: { urlDefault: "https://img.example/cover.jpg" }, interactInfo: { likedCount: "12", commentCount: "3" } } }] } });
    },
  });
  const result = await channel.search(" 测试 ");
  assert.deepEqual(requestBody, { keyword: "测试" });
  assert.deepEqual(result.feeds[0], {
    id: "note-1",
    xsecToken: "token-1",
    title: "测试笔记",
    author: "作者",
    avatar: "",
    cover: "https://img.example/cover.jpg",
    likedCount: "12",
    commentCount: "3",
  });
  await assert.rejects(() => channel.search(""), ChannelInputError);
});

test("xiaohongshu detail always disables full comment loading", async () => {
  let requestBody;
  const channel = new XiaohongshuChannel({
    now: () => 10_000,
    fetchImpl: async (_url, options = {}) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ success: true, data: { feed_id: "note-1", data: { note: { title: "详情" } } } });
    },
  });
  const result = await channel.detail({ feedId: "note-1", xsecToken: "token-1" });
  assert.deepEqual(requestBody, { feed_id: "note-1", xsec_token: "token-1", load_all_comments: false });
  assert.equal(result.detail.note.title, "详情");
});

function jsonResponse(value, status = 200) {
  const text = JSON.stringify(value);
  return new Response(text, { status, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) } });
}
