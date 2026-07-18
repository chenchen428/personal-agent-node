import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CHANNEL_MANAGEMENT_URL, runChannelHealthCheck } from "../src/channels/health-check.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("daily channel health check stays silent while Xiaohongshu is logged in", async () => {
  const requests = [];
  const result = await runChannelHealthCheck({
    apiToken: "test-token",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, channels: [{ provider: "xiaohongshu", label: "小红书", state: "logged_in", statusLabel: "已登录", readOnly: true }] });
    },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.notified, false);
  assert.equal(requests.length, 1);
});

test("daily channel health check requests confirmation without starting login", async () => {
  const requests = [];
  const result = await runChannelHealthCheck({
    apiToken: "test-token",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/api/channels")) {
        return jsonResponse({ ok: true, channels: [{ provider: "xiaohongshu", label: "小红书", state: "needs_login", statusLabel: "需要扫码登录", readOnly: true }] });
      }
      if (url.endsWith("/api/channels/wechat/notify")) return jsonResponse({ ok: true, recipientId: "redacted" });
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.notified, true);
  assert.equal(requests.length, 2);
  const notification = JSON.parse(requests[1].options.body);
  assert.match(notification.message, /【Agent 渠道协作请求】/);
  assert.match(notification.message, /小红书：需要扫码登录/);
  assert.match(notification.message, new RegExp(CHANNEL_MANAGEMENT_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(notification.message, /我不会自动生成二维码/);
  assert.match(notification.message, /回复：登录小红书/);
  assert.match(notification.message, /回复“确认开始”后，才会发送二维码图片/);
  assert.match(notification.message, /自动监听登录结果/);
  assert.match(notification.message, /直接在微信回复验证码/);
  assert.match(notification.message, /不进入普通 Agent 会话、动态或日志/);
  assert.doesNotMatch(notification.message, /完成后回复/);
  assert.ok(requests.every((request) => !String(request.url).includes("/login")));
});

test("daily channel health dry-run reports failure without notifying", async () => {
  let requestCount = 0;
  const result = await runChannelHealthCheck({
    notify: false,
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse({ ok: true, channels: [{ provider: "xiaohongshu", label: "小红书", state: "offline", statusLabel: "渠道运行时离线" }] });
    },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.notified, false);
  assert.equal(requestCount, 1);
});

test("channel health belongs to the local Node instead of an ECS systemd timer", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "registry", "capabilities.json"), "utf8"));
  const connections = registry.capabilities.find((capability) => capability.id === "connections");
  assert.equal(connections.owner, "personal-agent-node");
  assert.equal(connections.dataScope, "local-private");
  assert.equal(fs.existsSync(path.join(workspaceRoot, "infra", "systemd", "open-agent-bridge-channel-health.timer")), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "scripts", "install-open-agent-bridge-release.sh")), false);
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
