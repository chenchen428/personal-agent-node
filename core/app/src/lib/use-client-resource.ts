"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "./client-json";
import { clientResourceCache, PAGE_REFRESH_EVENT } from "./client-resource-cache";
import { getPrefetchError } from "./desktop-prefetch";

export function usePageRefresh(refresh: () => void) {
  useEffect(() => {
    const update = () => refresh();
    const updateWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(updateWhenVisible, 60_000);
    window.addEventListener(PAGE_REFRESH_EVENT, update);
    window.addEventListener("online", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () => { window.clearInterval(timer); window.removeEventListener(PAGE_REFRESH_EVENT, update); window.removeEventListener("online", update); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", updateWhenVisible); };
  }, [refresh]);
}

export function useClientResource<T>(url: string) {
  const [snapshot, setSnapshot] = useState<{ url: string; value: T | null; error: string; refreshing: boolean }>(() => ({
    url, value: typeof window === "undefined" ? null : clientResourceCache.get<T>(url)?.value ?? null, error: getPrefetchError(url), refreshing: true,
  }));
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setSnapshot((previous) => ({ url, value: previous.url === url ? previous.value : clientResourceCache.get<T>(url)?.value ?? null, error: previous.url === url ? previous.error : getPrefetchError(url), refreshing: true }));
    try {
      const value = await fetchJson<T>(url, { signal: controller.signal });
      if (!controller.signal.aborted) setSnapshot({ url, value, error: "", refreshing: false });
    } catch (cause) {
      if (!controller.signal.aborted) setSnapshot((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : "暂时无法更新", refreshing: false }));
    }
  }, [url]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  usePageRefresh(refresh);
  const value = snapshot.url === url ? snapshot.value : clientResourceCache.get<T>(url)?.value ?? null;
  return { value, loading: value === null && !snapshot.error && (snapshot.refreshing || snapshot.url !== url), refreshing: snapshot.refreshing,
    error: value === null ? snapshot.error : "", staleError: value !== null ? snapshot.error : "", refresh };
}
