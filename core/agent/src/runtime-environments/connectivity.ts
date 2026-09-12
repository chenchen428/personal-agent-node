import { protocolFor, runtimeProviderBaseUrl } from "./validation.ts";
import type { ConnectivityResult, RuntimeExecution } from "./types.ts";

const MAX_BODY = 128 * 1024;
export type ConnectivityOptions = {
  timeoutMs?: number;
  fetch?: typeof fetch;
  accountConnectivity?: (execution: RuntimeExecution, signal: AbortSignal) => Promise<boolean>;
};
export async function testRuntimeConnectivity(execution: RuntimeExecution, options: ConnectivityOptions = {}): Promise<ConnectivityResult> {
  const started = Date.now();
  const result = (status: ConnectivityResult["status"], message: string): ConnectivityResult => ({
    ok: status === "connected", engine: execution.engine, protocol: protocolFor(execution.engine), status, message, durationMs: Date.now() - started,
  });
  const { profile, credential, engine } = execution;
  if (profile.mode === "custom" && (!profile.baseUrl || !profile.model)) return result("invalid-config", "请填写服务 URL 和模型名称。");
  if (profile.mode === "custom" && !credential) return result("missing-credential", "请填写授权凭据后检测。");
  const controller = new AbortController();
  const timeoutMs = Math.min(30_000, Math.max(50, options.timeoutMs || 15_000));
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs); });
  async function probe() {
    if (profile.mode === "account") {
      if (!options.accountConnectivity) return result("protocol-error", "尚无法验证当前基座账号的模型调用，请检查基座安装与登录状态。");
      const ok = await options.accountConnectivity(execution, controller.signal);
      return ok ? result("connected", "账号和模型调用正常。") : result("protocol-error", "基座未完成模型调用，请检查登录状态和模型配置。");
    }
    const codex = engine === "codex";
    const base = runtimeProviderBaseUrl(engine, profile.baseUrl);
    const endpoint = codex ? `${base}/responses` : `${base}/v1/messages`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    // Responses providers use Authorization for API keys and bearer tokens alike.
    if (codex || profile.authType === "bearer") headers.authorization = `Bearer ${credential}`;
    else headers["x-api-key"] = credential;
    if (!codex) headers["anthropic-version"] = "2023-06-01";
    const body = codex
      ? { model: profile.model, input: "Reply with OK only.", max_output_tokens: 512, stream: false, store: false,
        ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}) }
      : { model: profile.model, messages: [{ role: "user", content: "Reply with OK only." }], max_tokens: 64, stream: false };
    const response = await (options.fetch || fetch)(endpoint, {
      method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: controller.signal,
    });
    // All redirects are rejected, so no request can forward credentials to another origin.
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return result("unauthorized", "授权失败，请检查凭据及模型访问权限。"); }
    if (!response.ok) { await response.body?.cancel(); return result("protocol-error", `服务返回 HTTP ${response.status}，请检查协议、URL 和模型配置。`); }
    if (Number(response.headers.get("content-length")) > MAX_BODY) { await response.body?.cancel(); return result("protocol-error", "服务响应过大，无法验证协议。"); }
    const reader = response.body?.getReader();
    if (!reader) return result("protocol-error", "服务未返回模型响应。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); return result("protocol-error", "服务响应过大，无法验证协议。"); }
      chunks.push(item.value);
    }
    let payload: any;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return result("protocol-error", "服务未返回有效的模型协议响应。"); }
    const valid = codex
      ? payload?.object === "response" && payload?.status === "completed" && Array.isArray(payload.output)
        && payload.output.some((item: any) => item?.type === "message" && item.role === "assistant" && item.content?.some((part: any) => part?.type === "output_text" && typeof part.text === "string" && part.text.trim()))
      : payload?.type === "message" && payload?.role === "assistant" && Array.isArray(payload.content)
        && payload.content.some((part: any) => part?.type === "text" && typeof part.text === "string" && part.text.trim());
    return valid ? result("connected", "连接正常，模型已完成测试回复。") : result("protocol-error", "服务未完成预期协议的模型回复，请检查兼容性。");
  }
  try { return await Promise.race([probe(), deadline]); }
  catch { return controller.signal.aborted ? result("timeout", "连接检测超时，请检查服务状态后重试。") : result("network-error", "无法连接模型服务，请检查网络、证书及服务地址。"); }
  finally { clearTimeout(timer!); controller.abort(); }
}
