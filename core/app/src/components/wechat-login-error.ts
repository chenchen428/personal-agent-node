export type WechatLoginErrorPayload = {
  ok?: boolean;
  code?: string;
  error?: string;
};

export class WechatLoginRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WechatLoginRequestError";
  }
}

export async function readWechatLoginPayload<T extends WechatLoginErrorPayload>(response: Response): Promise<T> {
  let payload: T;
  try {
    payload = await response.json() as T;
  } catch {
    throw new WechatLoginRequestError(response.status, "WECHAT_RESPONSE_INVALID", "微信连接服务返回了无效响应，请重试。");
  }
  if (!response.ok || payload.ok === false) {
    throw new WechatLoginRequestError(
      response.status,
      String(payload.code || "WECHAT_REQUEST_FAILED"),
      safeMessage(payload.error),
    );
  }
  return payload;
}

export function describeWechatLoginError(error: unknown): string {
  if (!(error instanceof WechatLoginRequestError)) {
    return "无法连接到当前节点，请检查网络后重试。";
  }
  const message = safeMessage(error.message);
  if (error.code === "WECHAT_REQUEST_TIMEOUT" || error.status === 504) {
    return "微信连接服务响应超时，请重新生成二维码。";
  }
  if (error.code === "WECHAT_RATE_LIMITED" || error.status === 429) {
    return "生成请求过于频繁，请稍后再试。";
  }
  if (["WECHAT_NETWORK_UNREACHABLE", "WECHAT_NETWORK_POLICY_BLOCKED"].includes(error.code)) {
    return message || "当前节点无法访问微信连接服务，请检查网络或代理设置后重试。";
  }
  if (error.status >= 500) {
    return message || "微信连接服务暂时不可用，请稍后重试。";
  }
  return message || "暂时无法生成二维码，请稍后重试。";
}

function safeMessage(value: unknown): string {
  if (typeof value !== "string") return "暂时无法生成二维码，请稍后重试。";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 240 || /(?:bearer|token|cookie|qrcode=|session=)/i.test(normalized)) {
    return "暂时无法生成二维码，请稍后重试。";
  }
  return normalized;
}
