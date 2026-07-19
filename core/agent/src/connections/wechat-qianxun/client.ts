import { isQianxunOperationType, type QianxunEndpointStyle, type QianxunEnvelope, type QianxunResponse } from "./protocol.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type QianxunClientConfig = {
  baseUrl: string;
  endpointStyle?: QianxunEndpointStyle;
  learnedEndpointStyle?: "wechat" | "qianxun";
  bindWxid?: string;
  safeKey?: string;
  timeoutMs?: number;
};

export class QianxunProtocolClient {
  private readonly fetchImpl: typeof fetch;
  private readonly onStyleLearned?: (style: Exclude<QianxunEndpointStyle, "auto">) => void;

  constructor({ fetchImpl = fetch, onStyleLearned }: { fetchImpl?: typeof fetch; onStyleLearned?: (style: "wechat" | "qianxun") => void } = {}) {
    this.fetchImpl = fetchImpl;
    this.onStyleLearned = onStyleLearned;
  }

  async invoke(config: QianxunClientConfig, envelope: QianxunEnvelope) {
    if (!isQianxunOperationType(envelope.type)) throw connectorError("INVALID_ARGUMENT", "Unsupported Qianxun Pro operation", 400);
    const base = validateQianxunBaseUrl(config.baseUrl);
    const attempts = endpointAttempts(config.endpointStyle || "auto", String(config.bindWxid || "").trim(), config.learnedEndpointStyle);
    let lastError: unknown = null;

    for (const style of attempts) {
      try {
        const response = await this.invokeOnce(base, style, config, envelope);
        this.onStyleLearned?.(style);
        return { ...response, endpointStyle: style };
      } catch (error) {
        lastError = error;
        if (config.endpointStyle && config.endpointStyle !== "auto") throw error;
      }
    }
    throw lastError || connectorError("QIANXUN_UNAVAILABLE", "Qianxun endpoint is unavailable", 502);
  }

  private async invokeOnce(base: URL, style: "wechat" | "qianxun", config: QianxunClientConfig, envelope: QianxunEnvelope) {
    if (style === "qianxun" && !String(config.bindWxid || "").trim()) {
      throw connectorError("QIANXUN_ACCOUNT_REQUIRED", "Qianxun Pro framework mode requires a pinned wxid", 409);
    }
    const target = new URL(style === "wechat" ? "/wechat/httpapi" : "/qianxun/httpapi", base);
    if (style === "qianxun") {
      target.searchParams.set("wxid", String(config.bindWxid).trim());
      if (config.safeKey) target.searchParams.set("safekey", config.safeKey);
    }
    const abort = new AbortController();
    const timeoutMs = Math.min(Math.max(Number(config.timeoutMs || DEFAULT_TIMEOUT_MS), 500), 30_000);
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(envelope),
        redirect: "error",
        signal: abort.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw connectorError("QIANXUN_TIMEOUT", `Qianxun request timed out after ${timeoutMs} ms`, 504);
      }
      throw connectorError("QIANXUN_UNAVAILABLE", "Could not reach the local Qianxun endpoint", 502);
    } finally {
      clearTimeout(timer);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw connectorError("QIANXUN_RESPONSE_TOO_LARGE", "Qianxun response is too large", 502);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESPONSE_BYTES) throw connectorError("QIANXUN_RESPONSE_TOO_LARGE", "Qianxun response is too large", 502);
    let body: QianxunResponse;
    try {
      body = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw connectorError("QIANXUN_INVALID_RESPONSE", `Qianxun returned non-JSON HTTP ${response.status}`, 502);
    }
    if (!response.ok) throw connectorError("QIANXUN_HTTP_ERROR", `Qianxun returned HTTP ${response.status}`, 502);
    if (body?.code !== 200) {
      const detail = typeof body?.msg === "string" && body.msg.trim() ? body.msg.trim().slice(0, 200) : `business code ${String(body?.code ?? "missing")}`;
      throw connectorError("QIANXUN_OPERATION_FAILED", `Qianxun rejected ${envelope.type}: ${detail}`, 502);
    }
    return { response: body, result: body.result };
  }
}

export function validateQianxunBaseUrl(input: unknown) {
  let url: URL;
  try { url = new URL(String(input || "")); }
  catch { throw connectorError("INVALID_ARGUMENT", "Qianxun base URL must be a valid URL", 400); }
  if (url.protocol !== "http:") throw connectorError("INVALID_ARGUMENT", "Qianxun base URL must use http", 400);
  if (!isLoopbackHostname(url.hostname)) throw connectorError("INVALID_ARGUMENT", "Qianxun base URL must use 127.0.0.1 or ::1", 400);
  if (!url.port) throw connectorError("INVALID_ARGUMENT", "Qianxun base URL must include its local port", 400);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw connectorError("INVALID_ARGUMENT", "Qianxun base URL must be an origin without credentials, path, query, or fragment", 400);
  }
  url.pathname = "/";
  return url;
}

function endpointAttempts(style: QianxunEndpointStyle, bindWxid: string, learned?: "wechat" | "qianxun"): Array<"wechat" | "qianxun"> {
  if (style === "wechat") return ["wechat"];
  if (style === "qianxun") return ["qianxun"];
  if (!bindWxid) return ["wechat"];
  return learned === "qianxun" ? ["qianxun", "wechat"] : ["wechat", "qianxun"];
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function connectorError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
