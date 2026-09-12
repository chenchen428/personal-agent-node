import type { DraftProfile, Engine, Profile } from "./types";

export function profilePayload(profile: DraftProfile) {
  const { credentialConfigured: _configured, credential, clearCredential, ...values } = profile;
  return { ...values, ...(credential?.trim() ? { credential: credential.trim() } : {}), ...(clearCredential ? { clearCredential: true } : {}) };
}

export function profileChanged(profile: DraftProfile, saved: Profile) {
  return JSON.stringify(profilePayload(profile)) !== JSON.stringify(profilePayload(saved));
}

export function profileValidation(engine: Engine, draft: DraftProfile, saved: Profile) {
  if (draft.mode !== "custom") return "";
  if (!draft.model.trim()) return "请输入自定义模型 ID。";
  let endpoint: URL;
  try { endpoint = new URL(draft.baseUrl); } catch { return "请输入完整的服务 Base URL。"; }
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return "Base URL 必须是 HTTP(S) 地址，且不能包含账号、查询参数或片段。";
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(endpoint.hostname);
  if (endpoint.protocol === "http:" && !local) return "服务地址必须使用 HTTPS；本机服务可使用 HTTP。";
  if (!draft.credential?.trim() && (draft.clearCredential || !draft.credentialConfigured)) return "请输入 API Key / 授权 Token。";
  if (!draft.credential?.trim() && (!saved.baseUrl || endpoint.origin !== new URL(saved.baseUrl).origin)) return "服务地址已更改，请重新输入 API Key / 授权 Token。";
  if (engine === "claude-code" && draft.reasoningEffort && !["low", "medium", "high", "max"].includes(draft.reasoningEffort)) return "请选择此基座支持的推理强度。";
  return "";
}
