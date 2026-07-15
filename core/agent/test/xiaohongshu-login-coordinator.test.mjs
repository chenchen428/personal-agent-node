import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { XiaohongshuLoginCoordinator, extractVerificationCode } from "../src/channels/xiaohongshu/login-coordinator.js";
import { VerificationCapabilityUnavailableError } from "../src/channels/xiaohongshu/verification-client.js";

test("login coordinator sends the QR and monitors through success without another user message", async () => {
  const sent = [];
  let imagePath = "";
  let polls = 0;
  const statuses = ["pending", "scanned", "scanned", "verification_required", "confirmed"];
  const coordinator = new XiaohongshuLoginCoordinator({
    channel: {
      startLogin: async () => ({
        ok: true,
        provider: "xiaohongshu",
        session: "session-1",
        status: "pending",
        expiresAt: "2026-07-11T20:10:00.000Z",
        qrImage: "data:image/png;base64,QUJD",
      }),
      pollLogin: async () => ({ status: statuses[polls++] }),
    },
    wechat: {
      getDefaultRecipientId: () => "wechat-user",
      sendImage: async (recipientId, file, caption) => {
        imagePath = file;
        assert.equal(recipientId, "wechat-user");
        assert.deepEqual(fs.readFileSync(file), Buffer.from("ABC"));
        assert.match(caption, /自动监听/);
        assert.match(caption, /确认登录/);
        sent.push(caption);
      },
      sendText: async (_recipientId, content) => sent.push(content),
    },
    wait: async () => {},
  });

  const started = await coordinator.start();
  assert.equal(started.delivered, true);
  assert.equal(started.monitoring, true);
  assert.equal("qrImage" in started, false);
  await waitFor(() => sent.some((message) => message.includes("登录成功")));
  assert.equal(polls, 5);
  assert.equal(sent.filter((message) => message.includes("已检测到扫码")).length, 1);
  assert.equal(sent.filter((message) => message.includes("等待短信验证码")).length, 1);
  assert.equal(fs.existsSync(imagePath), false);
});

test("verification code is consumed only for the matching active WeChat login", async () => {
  const submitted = [];
  const sent = [];
  let releaseMonitor;
  const coordinator = new XiaohongshuLoginCoordinator({
    channel: {
      startLogin: async () => ({
        ok: true,
        provider: "xiaohongshu",
        session: "session-2",
        status: "pending",
        expiresAt: "2026-07-11T20:10:00.000Z",
        qrImage: "data:image/png;base64,QUJD",
      }),
      pollLogin: async () => ({ status: "pending" }),
      submitVerificationCode: async (session, code) => submitted.push({ session, code }),
    },
    wechat: {
      getDefaultRecipientId: () => "wechat-user",
      sendImage: async () => {},
      sendText: async (_recipientId, content) => sent.push(content),
    },
    wait: async () => new Promise((resolve) => { releaseMonitor = resolve; }),
  });
  await coordinator.start();

  assert.equal(await coordinator.consumeWechatMessage({ senderId: "other-user", text: "123456" }), false);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: "wechat-user", text: "normal text" }), false);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: "wechat-user", text: "验证码：123456" }), true);
  assert.deepEqual(submitted, [{ session: "session-2", code: "123456" }]);
  assert.equal(sent.some((message) => message.includes("验证码已提交")), true);
  assert.equal(sent.some((message) => message.includes("123456")), false);
  coordinator.stop();
  releaseMonitor?.();
});

test("missing runtime verification capability ends the active collaboration without echoing the code", async () => {
  const sent = [];
  let releaseMonitor;
  const coordinator = new XiaohongshuLoginCoordinator({
    channel: {
      startLogin: async () => ({
        ok: true,
        provider: "xiaohongshu",
        session: "session-3",
        status: "pending",
        expiresAt: "2026-07-11T20:10:00.000Z",
        qrImage: "data:image/png;base64,QUJD",
      }),
      pollLogin: async () => ({ status: "pending" }),
      submitVerificationCode: async () => {
        throw new VerificationCapabilityUnavailableError("tool missing");
      },
    },
    wechat: {
      getDefaultRecipientId: () => "wechat-user",
      sendImage: async () => {},
      sendText: async (_recipientId, content) => sent.push(content),
    },
    wait: async () => new Promise((resolve) => { releaseMonitor = resolve; }),
  });
  await coordinator.start();
  assert.equal(await coordinator.consumeWechatMessage({ senderId: "wechat-user", text: "654321" }), true);
  assert.equal(sent.some((message) => message.includes("运行时尚不支持代填")), true);
  assert.equal(sent.some((message) => message.includes("654321")), false);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: "wechat-user", text: "654321" }), false);
  coordinator.stop();
  releaseMonitor?.();
});

test("verification code parser accepts only a bounded standalone code", () => {
  assert.equal(extractVerificationCode("123456"), "123456");
  assert.equal(extractVerificationCode("验证码: 123456"), "123456");
  assert.equal(extractVerificationCode("订单 123456"), "");
  assert.equal(extractVerificationCode("123"), "");
  assert.equal(extractVerificationCode("123456789"), "");
});

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
