import { fetchJson } from "../../lib/client-json";
import { startConnectionPolling } from "../connection-polling";
import type { Connection } from "./connection-types";

export function browserPlatformStatus(connection: Connection) {
  const browserReady = connection.details?.browserReady === true;
  const loginState = connection.details?.loginState || "unknown";
  const searchReady = browserReady && loginState === "logged_in" && connection.details?.searchReady === true;
  const connected = connection.state === "connected" && searchReady && connection.details?.readReady === true;
  return { browserReady, loginState, searchReady, connected,
    label: connected ? "已连接" : connection.state === "needs_setup" ? "环境待修复" : connection.state === "error" ? "环境不可用" : loginState === "logged_out" ? "未连接 · 请登录" : "未连接 · 状态待确认",
  };
}

export type BrowserConnectionSnapshot = { connection: Connection; phase: "idle" | "opening" | "checking" | "waiting"; message: string };

export function createBrowserPlatformConnection({ initial, publish, refresh, request = fetchJson, timeoutMs = 2 * 60_000, intervalMs = 2500 }: {
  initial: Connection;
  publish: (snapshot: BrowserConnectionSnapshot) => void;
  refresh: () => Promise<void>;
  request?: typeof fetchJson;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  let snapshot: BrowserConnectionSnapshot = { connection: initial, phase: "idle", message: "" };
  let revision = 0;
  let controller: AbortController | null = null;
  let stop: (() => void) | undefined;
  const update = (next: Partial<BrowserConnectionSnapshot>) => { snapshot = { ...snapshot, ...next }; publish(snapshot); };
  const invalidate = () => { revision += 1; controller?.abort(); stop?.(); controller = new AbortController(); return revision; };
  const status = (signal: AbortSignal) => request<{ connection: Connection }>(`/api/connections/${initial.id}/status`, { signal });
  const unavailable = () => ({ ...snapshot.connection, state: "degraded", statusLabel: "状态暂时无法确认", details: { ...snapshot.connection.details, loginState: "unknown" as const, searchReady: false } });
  const check = async () => {
    const attempt = invalidate();
    update({ phase: "checking", message: "正在检测浏览器与平台登录状态…" });
    try {
      const result = await status(controller!.signal);
      if (attempt !== revision) return;
      update({ connection: result.connection, phase: "idle", message: browserPlatformStatus(result.connection).connected ? "平台登录已确认，可以搜索和阅读。" : result.connection.statusLabel });
      await refresh().catch(() => {});
    } catch {
      if (attempt === revision) update({ connection: unavailable(), phase: "idle", message: "状态暂时无法读取，请稍后重新检测。" });
    }
  };
  const open = async (waitForLogin: boolean) => {
    const attempt = invalidate();
    update({ phase: "opening", message: "正在打开平台页面…" });
    try {
      await request(`/api/connections/${initial.id}/open`, { method: "POST", signal: controller!.signal });
      if (attempt !== revision) return;
      if (!waitForLogin) { update({ phase: "idle", message: "已在浏览器打开。" }); return; }
      update({ phase: "waiting", message: "请在打开的浏览器页面中登录。完成后会自动检测，也可以点击重新检测。" });
      stop = startConnectionPolling({ deadline: Date.now() + timeoutMs, initialDelayMs: intervalMs, intervalMs,
        probe: async (signal) => {
          const result = await status(signal);
          return { state: browserPlatformStatus(result.connection).connected ? "completed" as const : ["error", "needs_setup"].includes(result.connection.state) ? "failed" as const : "pending" as const, connection: result.connection };
        },
        onResult: (result) => {
          if (attempt !== revision) return;
          update({ connection: result.connection, phase: result.state === "pending" ? "waiting" : "idle", message: result.state === "completed" ? "平台登录已确认，可以搜索和阅读。" : result.state === "failed" ? result.connection.statusLabel : "等待你在浏览器完成登录。" });
          if (result.state !== "pending") void refresh().catch(() => {});
        },
        onError: () => { if (attempt === revision) update({ connection: unavailable(), message: "状态暂时无法读取，正在重试；无需重复登录。" }); },
        onTimeout: () => { if (attempt === revision) update({ phase: "idle", message: "暂未确认登录。请在浏览器完成登录后重新检测。" }); },
      });
    } catch {
      if (attempt === revision) update({ phase: "idle", message: "未能打开平台页面，请检测浏览器连接后重试。" });
    }
  };
  return {
    check, open,
    observe(connection: Connection) { if (snapshot.phase === "idle") update({ connection }); },
    cancel() { invalidate(); update({ phase: "idle", message: "已停止等待。浏览器中的登录状态保持不变，完成后可重新检测。" }); },
    dispose() { invalidate(); },
  };
}
