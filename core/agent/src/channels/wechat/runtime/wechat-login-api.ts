import { wechatFetch } from "./wechat-fetch.ts";

export type WechatQrCodeResponse = {
  qrcode: string;
  qrcode_img_content: string;
};

export type WechatQrStatusResponse = {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class WechatLoginApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "WechatLoginApiError";
  }
}

export async function fetchWechatQrCode({
  baseUrl,
  botType,
  fetchImpl = wechatFetch,
  timeoutMs = 15_000,
  attempts = 2,
  retryDelayMs = 300,
}: {
  baseUrl: string;
  botType: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<WechatQrCodeResponse> {
  const base = normalizedBaseUrl(baseUrl);
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`;
  const boundedAttempts = Math.max(1, Math.min(3, Math.trunc(attempts)));

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw await responseError("二维码", response);
      const payload = await readJson(response);
      const qrcode = boundedString(payload.qrcode, 4096);
      const qrContent = boundedString(payload.qrcode_img_content, 16_384);
      if (!qrcode || !qrContent) {
        throw new WechatLoginApiError(
          "WECHAT_QR_RESPONSE_INVALID",
          "微信连接服务没有返回有效二维码，请重新生成。",
          502,
          true,
        );
      }
      return { qrcode, qrcode_img_content: qrContent };
    } catch (error) {
      const normalized = normalizeRequestError(error, "二维码");
      if (attempt >= boundedAttempts || !normalized.retryable) throw normalized;
      await delay(retryDelayMs * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new WechatLoginApiError("WECHAT_QR_UNAVAILABLE", "暂时无法生成微信二维码，请稍后重试。", 503, true);
}

export async function pollWechatQrStatus({
  baseUrl,
  qrcode,
  fetchImpl = wechatFetch,
  timeoutMs = 35_000,
}: {
  baseUrl: string;
  qrcode: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<WechatQrStatusResponse> {
  const url = `${normalizedBaseUrl(baseUrl)}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError("连接状态", response);
    const payload = await readJson(response);
    if (!["wait", "scaned", "confirmed", "expired"].includes(String(payload.status || ""))) {
      throw new WechatLoginApiError(
        "WECHAT_QR_STATUS_INVALID",
        "微信连接服务返回了无法识别的状态，请重新生成二维码。",
        502,
        true,
      );
    }
    return payload as WechatQrStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "wait" };
    throw normalizeRequestError(error, "连接状态");
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(action: string, response: Response): Promise<WechatLoginApiError> {
  const text = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 420);
  if (/不在安全策略默认允许的范围内|not allowed by the default security policy/i.test(text)) {
    return new WechatLoginApiError(
      "WECHAT_NETWORK_POLICY_BLOCKED",
      "当前节点的网络策略拦截了微信连接服务，请允许访问 ilinkai.weixin.qq.com 后重试。",
      503,
      true,
    );
  }
  if (response.status === 429) {
    return new WechatLoginApiError("WECHAT_RATE_LIMITED", "微信连接请求过于频繁，请稍后重试。", 429, true);
  }
  if (response.status >= 500) {
    return new WechatLoginApiError("WECHAT_UPSTREAM_UNAVAILABLE", `微信${action}服务暂时不可用，请稍后重试。`, 503, true);
  }
  return new WechatLoginApiError(
    "WECHAT_UPSTREAM_REJECTED",
    `微信${action}请求未被接受（HTTP ${response.status}），请稍后重试。`,
    502,
    false,
  );
}

function normalizeRequestError(error: unknown, action: string): WechatLoginApiError {
  if (error instanceof WechatLoginApiError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new WechatLoginApiError("WECHAT_REQUEST_TIMEOUT", `微信${action}服务响应超时，请重试。`, 504, true);
  }
  return new WechatLoginApiError(
    "WECHAT_NETWORK_UNREACHABLE",
    "当前节点无法访问微信连接服务，请检查网络或代理设置后重试。",
    503,
    true,
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Converted into a stable response error below.
  }
  throw new WechatLoginApiError("WECHAT_RESPONSE_INVALID", "微信连接服务返回了无效响应，请重试。", 502, true);
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : "";
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new WechatLoginApiError("WECHAT_BASE_URL_INVALID", "微信连接服务地址无效。", 500, false);
  }
  return url.toString().replace(/\/+$/, "") + "/";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
