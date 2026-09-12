"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { bindClientCache, CACHE_RESET_EVENT, clearClientCache, clientResourceCache } from "@/lib/client-resource-cache";
import { RecoveryPanel } from "./recovery-panel";

export function ClientSessionBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ scope: "", error: false });
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const connect = useCallback(async (signal?: AbortSignal) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const revision = ++generation.current;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch("/api/node/v1/client/overview", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Current Space unavailable");
      const payload = await response.json();
      const value = payload.data ?? payload.result ?? payload;
      if (typeof value.space?.id !== "string" || !value.space.id) throw new Error("Missing Space identity");
      if (controller.signal.aborted || revision !== generation.current) return;
      const scope = `${window.location.origin}:${value.machine?.id || ""}:${value.space.id}`;
      bindClientCache(scope); clientResourceCache.set("/api/node/v1/client/overview", value);
      setState({ scope, error: false });
    } catch { if (!controller.signal.aborted && revision === generation.current) setState((previous) => ({ ...previous, error: true })); }
    finally { signal?.removeEventListener("abort", abort); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void connect(controller.signal);
    const clear = () => { clearClientCache("navigation"); setState({ scope: "", error: false }); };
    const reset = () => { generation.current += 1; pending.current?.abort(); setState({ scope: "", error: true }); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) void connect(controller.signal); };
    window.addEventListener("pagehide", clear); window.addEventListener(CACHE_RESET_EVENT, reset); window.addEventListener("pageshow", show);
    return () => { controller.abort(); generation.current += 1; pending.current?.abort(); window.removeEventListener("pagehide", clear); window.removeEventListener(CACHE_RESET_EVENT, reset); window.removeEventListener("pageshow", show); clearClientCache("unmount"); };
  }, [connect]);
  if (!state.scope) return state.error ? <RecoveryPanel full onRetry={() => { setState({ scope: "", error: false }); void connect(); }} /> : <main className="cove-first-load" role="status">正在连接当前空间…</main>;
  return <div key={state.scope} style={{ display: "contents" }}>{children}</div>;
}
