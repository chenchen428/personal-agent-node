type ControlError = Error & { code?: string; statusCode?: number };

export function bridgeResponseError(statusCode: number, responseText: string) {
  const payload = parseJson(responseText);
  const upstreamError = payload?.error;
  const message = typeof upstreamError === "string"
    ? upstreamError
    : typeof upstreamError?.message === "string"
      ? upstreamError.message
      : `主 Agent 请求失败（${statusCode}）`;
  const code = typeof upstreamError?.code === "string" ? upstreamError.code : "AGENT_REQUEST_FAILED";
  return taggedError(message, code, normalizeStatus(statusCode, 502));
}

export function bridgeInvalidResponseError() {
  return taggedError("主 Agent 返回了无法读取的响应，请重启本机服务后重试", "AGENT_INVALID_RESPONSE", 502);
}

export function bridgeTransportError(error: unknown) {
  if (isTaggedError(error)) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return taggedError("主 Agent 响应超时，请稍后重试", "AGENT_TIMEOUT", 504);
  }
  return taggedError("主 Agent 暂时无法连接，请确认本机服务正在运行", "AGENT_UNAVAILABLE", 503);
}

export function controlApiErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return {
      statusCode: 400,
      payload: { ok: false, error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON，请刷新页面后重试" } },
    };
  }
  const source = error as ControlError;
  if (isTaggedError(source)) {
    return {
      statusCode: normalizeStatus(source.statusCode, 500),
      payload: { ok: false, error: { code: source.code, message: source.message } },
    };
  }
  return {
    statusCode: 500,
    payload: { ok: false, error: { code: "CONTROL_REQUEST_FAILED", message: "本机服务暂时无法完成请求，请稍后重试" } },
  };
}

function taggedError(message: string, code: string, statusCode: number) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isTaggedError(error: unknown): error is ControlError & { code: string; statusCode: number } {
  const source = error as ControlError;
  return source instanceof Error && typeof source.code === "string" && Number.isInteger(source.statusCode);
}

function normalizeStatus(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 400 && parsed <= 599 ? parsed : fallback;
}

function parseJson(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}
