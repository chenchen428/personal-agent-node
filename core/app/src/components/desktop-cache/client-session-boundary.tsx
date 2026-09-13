"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { bindClientCache, CACHE_RESET_EVENT, clearClientCache } from "@/lib/client-resource-cache";
import { CLIENT_SCOPE_ENDPOINT, clientScopeKey } from "@/lib/client-scope";
import { SafeClientStartup } from "./safe-client-startup";
import { prefetchDesktopData } from "@/lib/desktop-prefetch";

export function ClientSessionBoundary({ children, desktop = false }: { children: ReactNode; desktop?: boolean }) {
  const pathname = usePathname();
  const [state, setState] = useState({ scope: "", error: false });
  const [preparing, setPreparing] = useState(false);
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
      const response = await fetch(CLIENT_SCOPE_ENDPOINT, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Current Space unavailable");
      const payload = await response.json();
      if (payload.ok === false) throw new Error("Current Space unavailable");
      if (controller.signal.aborted || revision !== generation.current) return;
      const scope = clientScopeKey(payload, window.location.origin);
      bindClientCache(scope);
      if (desktop) { setPreparing(true); await prefetchDesktopData({ signal: controller.signal }); }
      if (controller.signal.aborted || revision !== generation.current) return;
      setState({ scope, error: false });
    } catch { if (!controller.signal.aborted && revision === generation.current) setState((previous) => ({ ...previous, error: true })); }
    finally { if (revision === generation.current) setPreparing(false); signal?.removeEventListener("abort", abort); }
  }, [desktop]);
  useEffect(() => {
    const controller = new AbortController(); void connect(controller.signal);
    const clear = () => { clearClientCache("navigation"); setState({ scope: "", error: false }); };
    const reset = () => { generation.current += 1; pending.current?.abort(); setState({ scope: "", error: true }); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) void connect(controller.signal); };
    window.addEventListener("pagehide", clear); window.addEventListener(CACHE_RESET_EVENT, reset); window.addEventListener("pageshow", show);
    return () => { controller.abort(); generation.current += 1; pending.current?.abort(); window.removeEventListener("pagehide", clear); window.removeEventListener(CACHE_RESET_EVENT, reset); window.removeEventListener("pageshow", show); clearClientCache("unmount"); };
  }, [connect]);
  if (!state.scope) return <SafeClientStartup pathname={pathname} failed={state.error} preparing={preparing} onRetry={() => { setState({ scope: "", error: false }); void connect(); }} />;
  return <div key={state.scope} style={{ display: "contents" }}>{children}</div>;
}
