import type { RuntimeEngine, RuntimeProfile, ProfileDraft } from "./types.ts";

export const ENGINES: RuntimeEngine[] = ["codex", "claude-code"];
export function runtimeError(message: string, code = "INVALID_RUNTIME_ENVIRONMENT", statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function validateEngine(value: unknown): RuntimeEngine {
  if (value !== "codex" && value !== "claude-code") throw runtimeError("请选择有效的运行基座。");
  return value;
}
export function protocolFor(engine: RuntimeEngine) {
  return engine === "codex" ? "responses" as const : "anthropic-messages" as const;
}
export function validateBaseUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw runtimeError("请输入有效的服务 URL。");
  if (!value.trim()) return "";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw runtimeError("请输入有效的服务 URL。"); }
  if (url.username || url.password || url.search || url.hash || /[?#]/.test(value)) {
    throw runtimeError("服务 URL 不得包含用户名、密码、查询参数或片段。");
  }
  const local = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw runtimeError("服务 URL 必须使用 HTTPS；本机服务可使用 HTTP。");
  }
  return url.href.replace(/\/+$/, "");
}
/** Canonical provider roots match Codex's /responses and Anthropic's /v1/messages suffixes. */
export function runtimeProviderBaseUrl(engine: RuntimeEngine, value: unknown) {
  validateEngine(engine);
  const normalized = validateBaseUrl(value);
  if (!normalized) return "";
  const url = new URL(normalized);
  url.pathname = engine === "codex" ? url.pathname.replace(/\/responses\/?$/, "")
    : url.pathname.replace(/\/(?:v1\/)?messages\/?$/, "").replace(/\/v1\/?$/, "");
  return url.href.replace(/\/+$/, "");
}
function identifier(value: unknown, name: string, limit: number) {
  if (typeof value !== "string" || value.length > limit || (value.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(value.trim()))) {
    throw runtimeError(`${name}格式无效。`);
  }
  return value.trim();
}
export function normalizeProfile(input: ProfileDraft, previous: RuntimeProfile, engine: RuntimeEngine): RuntimeProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw runtimeError("运行配置格式无效。");
  const profile = { ...previous, ...input };
  if (profile.mode !== "account" && profile.mode !== "custom") throw runtimeError("请选择有效的授权方式。");
  if (profile.authType !== "api-key" && profile.authType !== "bearer") throw runtimeError("请选择有效的凭据类型。");
  if (input.clearCredential !== undefined && typeof input.clearCredential !== "boolean") throw runtimeError("清除凭据参数无效。");
  if (input.credential !== undefined && (typeof input.credential !== "string" || input.credential.length > 16384 || /[\r\n\x00-\x1f\x7f]/.test(input.credential))) {
    throw runtimeError("授权凭据格式无效。");
  }
  if (input.clearCredential && input.credential?.trim()) throw runtimeError("不能同时设置和清除凭据。");
  return {
    mode: profile.mode,
    model: identifier(profile.model, "模型", 200),
    reasoningEffort: identifier(profile.reasoningEffort, "推理强度", 40),
    baseUrl: runtimeProviderBaseUrl(engine, profile.baseUrl),
    authType: profile.authType,
    credentialConfigured: previous.credentialConfigured,
  };
}
export function sameCredentialOrigin(previous: RuntimeProfile, next: RuntimeProfile) {
  if (!previous.baseUrl || !next.baseUrl) return previous.baseUrl === next.baseUrl;
  return new URL(previous.baseUrl).origin === new URL(next.baseUrl).origin;
}
