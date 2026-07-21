import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchWechatQrCode,
  pollWechatQrStatus,
  WechatLoginApiError,
} from "../core/agent/src/channels/wechat/runtime/wechat-login-api.ts";
import { resolveWechatProxyConfig } from "../core/agent/src/channels/wechat/runtime/wechat-fetch.ts";
import {
  describeWechatLoginError,
  readWechatLoginPayload,
  WechatLoginRequestError,
} from "../core/app/src/components/wechat-login-error.ts";

const officialQrUrl = "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3";

test("official WeChat iLink bypasses an unrelated system proxy by default", () => {
  assert.deepEqual(resolveWechatProxyConfig(officialQrUrl, {
    HTTPS_PROXY: "http://127.0.0.1:17890",
    HTTP_PROXY: "http://127.0.0.1:17890",
  }), { httpProxy: "", httpsProxy: "", noProxy: "" });

  assert.deepEqual(resolveWechatProxyConfig(officialQrUrl, {
    HTTPS_PROXY: "http://system-proxy.test:8080",
    WECHAT_ILINK_USE_SYSTEM_PROXY: "1",
  }), {
    httpProxy: "",
    httpsProxy: "http://system-proxy.test:8080",
    noProxy: "127.0.0.1,localhost,::1",
  });
});

test("a dedicated WeChat proxy overrides the system proxy", () => {
  assert.deepEqual(resolveWechatProxyConfig(officialQrUrl, {
    HTTPS_PROXY: "http://system-proxy.test:8080",
    WECHAT_ILINK_HTTPS_PROXY: "http://wechat-proxy.test:8081",
    WECHAT_ILINK_NO_PROXY: "localhost",
  }), {
    httpProxy: "",
    httpsProxy: "http://wechat-proxy.test:8081",
    noProxy: "localhost",
  });
});

test("QR generation retries one transient upstream failure and validates the payload", async () => {
  let requests = 0;
  const result = await fetchWechatQrCode({
    baseUrl: "https://ilinkai.weixin.qq.com",
    botType: "3",
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return new Response("temporary", { status: 503 });
      return Response.json({ qrcode: "opaque-code", qrcode_img_content: "https://example.test/scan" });
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(result, { qrcode: "opaque-code", qrcode_img_content: "https://example.test/scan" });
});

test("QR generation reports a stable timeout without leaking transport details", async () => {
  await assert.rejects(() => fetchWechatQrCode({
    baseUrl: "https://ilinkai.weixin.qq.com",
    botType: "3",
    attempts: 1,
    timeoutMs: 5,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted with private proxy detail", "AbortError")), { once: true });
    }),
  }), (error) => {
    assert.equal(error instanceof WechatLoginApiError, true);
    assert.equal(error.code, "WECHAT_REQUEST_TIMEOUT");
    assert.equal(error.statusCode, 504);
    assert.doesNotMatch(error.message, /private|proxy detail/i);
    return true;
  });
});

test("QR status polling sends the iLink client header and normalizes scanned state", async () => {
  let header = "";
  const result = await pollWechatQrStatus({
    baseUrl: "https://ilinkai.weixin.qq.com",
    qrcode: "opaque-code",
    fetchImpl: async (_url, init) => {
      header = new Headers(init.headers).get("iLink-App-ClientVersion") || "";
      return Response.json({ status: "scaned" });
    },
  });
  assert.equal(header, "1");
  assert.equal(result.status, "scaned");
});

test("the browser keeps actionable safe WeChat errors", async () => {
  await assert.rejects(() => readWechatLoginPayload(new Response(JSON.stringify({
    ok: false,
    code: "WECHAT_NETWORK_POLICY_BLOCKED",
    error: "当前节点的网络策略拦截了微信连接服务，请允许访问 ilinkai.weixin.qq.com 后重试。",
  }), { status: 503, headers: { "content-type": "application/json" } })), (error) => {
    assert.equal(error instanceof WechatLoginRequestError, true);
    assert.match(describeWechatLoginError(error), /网络策略.*ilinkai\.weixin\.qq\.com/);
    return true;
  });

  const redacted = new WechatLoginRequestError(503, "WECHAT_REQUEST_FAILED", "Bearer private-token qrcode=private");
  assert.equal(describeWechatLoginError(redacted), "暂时无法生成二维码，请稍后重试。");
});
