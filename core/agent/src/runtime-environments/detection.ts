import { execFile } from "node:child_process";
import { protocolFor, validateEngine } from "./validation.ts";
import type { RuntimeDetection, RuntimeEngine, RuntimeExecution } from "./types.ts";

export type DetectionOptions = {
  commands?: Partial<Record<RuntimeEngine, string | { command: string; args?: string[] }>>;
  detectAccount?: (engine: RuntimeEngine, execution: RuntimeExecution) => Promise<Partial<RuntimeDetection>>;
  exec?: (command: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>;
};
function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024, shell: false },
    (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
}
export async function detectRuntimeEnvironment(execution: RuntimeExecution, options: DetectionOptions = {}): Promise<RuntimeDetection> {
  const engine = validateEngine(execution.engine);
  const fallback: RuntimeDetection = { engine, installed: false, version: "", authentication: "unknown", protocol: protocolFor(engine), models: [], protocolReady: false, message: "未检测到运行基座，请先安装。" };
  const spec = options.commands?.[engine] || (engine === "codex" ? "codex" : "claude");
  const command = typeof spec === "string" ? spec : spec.command;
  const prefix = typeof spec === "string" ? [] : spec.args || [];
  try {
    const version = await (options.exec || run)(command, [...prefix, "--version"]);
    // Only a version number reaches the UI; CLI diagnostics and account details are discarded.
    fallback.version = String(version.stdout).match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] || "";
    fallback.installed = true;
    fallback.message = "已检测到运行基座。";
  } catch { /* custom app-server commands may still be detected by the injected account adapter */ }
  if (fallback.installed && execution.profile.mode === "account") {
    try {
      const auth = await (options.exec || run)(command, [...prefix, ...(engine === "codex" ? ["login", "status"] : ["auth", "status"])]);
      if (engine === "codex") fallback.authentication = /logged in/i.test(`${auth.stdout}\n${auth.stderr || ""}`) ? "authenticated" : "unknown";
      else fallback.authentication = JSON.parse(auth.stdout)?.loggedIn === true ? "authenticated" : "missing";
    } catch { fallback.authentication = "missing"; }
  }
  if (options.detectAccount) {
    try {
      const detected = await options.detectAccount(engine, execution);
      fallback.installed = typeof detected.installed === "boolean" ? detected.installed : fallback.installed;
      fallback.version = String(detected.version || fallback.version).match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] || "";
      if (["authenticated", "missing", "unknown"].includes(detected.authentication)) fallback.authentication = detected.authentication!;
      fallback.protocolReady = detected.protocolReady === true;
      fallback.models = (Array.isArray(detected.models) ? detected.models : []).slice(0, 300).flatMap((model) => {
        if (typeof model.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(model.id)) return [];
        return [{ id: model.id, label: model.id, ...(Array.isArray(model.reasoningEfforts) ? { reasoningEfforts: model.reasoningEfforts.filter(value => /^[a-z0-9_-]{1,40}$/.test(value)) } : {}) }];
      });
      const defaultId = detected.defaultModel?.id;
      if (typeof defaultId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(defaultId)) {
        fallback.defaultModel = fallback.models.find(model => model.id === defaultId) || { id: defaultId, label: defaultId };
      }
      if (Array.isArray(detected.reasoningEfforts)) fallback.reasoningEfforts = detected.reasoningEfforts.filter(value => /^[a-z0-9_-]{1,40}$/.test(value));
    } catch { /* no raw adapter exception is exposed */ }
  }
  fallback.message = !fallback.installed ? "未检测到运行基座，请先安装。"
    : execution.profile.mode === "custom" ? "已检测到运行基座；请使用连接检测验证自定义模型。"
    : fallback.authentication === "authenticated" ? "已检测到运行基座及账号授权。"
    : fallback.authentication === "missing" ? "已检测到运行基座，请先完成账号登录。" : "已检测到运行基座，账号状态尚未确认。";
  return fallback;
}
