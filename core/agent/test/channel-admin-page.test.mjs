import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderChannelsPage } from "../src/web/channels-page.js";

test("channel page is status-only and explains the Agent collaboration workflow", () => {
  const html = renderChannelsPage();
  assert.match(html, /<h1>小红书<\/h1>/);
  assert.match(html, /Personal Agent \/app\/channels/);
  assert.match(html, /href="\/app\/chat"/);
  assert.match(html, /direct-required · 只读/);
  assert.match(html, /在微信中发起登录协作/);
  assert.match(html, /登录小红书/);
  assert.match(html, /确认开始/);
  assert.match(html, /自动监听服务器浏览器/);
  assert.match(html, /短信验证码只会由当前登录会话一次性代填/);
  assert.match(html, /不进入普通 Agent 会话、动态或日志/);
  assert.doesNotMatch(html, /完成后回复/);
  assert.match(html, /\/api\/channels\/xiaohongshu\/status/);
  assert.doesNotMatch(html, /href="\/(?:admin|agent)|\/api\/agent/);
  assert.doesNotMatch(html, /\/api\/channels\/xiaohongshu\/(?:login|logout|search|detail)/);
  assert.doesNotMatch(html, /data-login|data-logout|data-search-form|<form|<dialog/);
  assert.doesNotMatch(html, /Twitter|Facebook|Instagram|YouTube|Reddit|LinkedIn/);
  assert.doesNotMatch(html, /\/publish|\/feeds\/comment|\/like|\/collect|\/follow/);
});

test("channel page uses an interactive private CSP without external origins", () => {
  const serverSource = fs.readFileSync(fileURLToPath(new URL("../src/server/server.ts", import.meta.url)), "utf8");
  assert.match(serverSource, /sendPrivateAppHtml\(response, 200, renderChannelsPage\(\)/);
  assert.match(serverSource, /script-src 'unsafe-inline'/);
  assert.match(serverSource, /connect-src 'self'/);
  assert.match(serverSource, /img-src 'self' data:/);
  assert.doesNotMatch(serverSource, /sendPrivateAppHtml[\s\S]{0,800}https?:/);
});

test("Node distribution verification targets the unified Next.js application contract", () => {
  const verifier = fs.readFileSync(fileURLToPath(new URL("../../../scripts/verify-private-site-node-dist.mjs", import.meta.url)), "utf8");
  assert.match(verifier, /health\.architecture === "core-workspace"/);
  assert.match(verifier, /\/api\/system\/setup/);
  assert.match(verifier, /page\.includes\("首次设置"\)/);
  assert.match(verifier, /page\.includes\("完成 Personal Agent 初始化"\)/);
  assert.doesNotMatch(verifier, /server\.includes\("data-status"\)/);
});
