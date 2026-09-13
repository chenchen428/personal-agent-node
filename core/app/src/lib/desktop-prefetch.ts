import { fetchJson } from "./client-json";
import { clientResourceCache } from "./client-resource-cache";

const errors = new Map<string, { generation: number; message: string }>();
export function readPrefetched<T>(url: string): T | null {
  return typeof window === "undefined" ? null : clientResourceCache.get<T>(url)?.value ?? null;
}
export function getPrefetchError(url: string) {
  const error = errors.get(url);
  return error?.generation === clientResourceCache.generation ? error.message : "";
}

export function desktopPrefetchUrls(now = new Date()) {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return [
    "/api/node/v1/client/overview", "/api/chat/desktop/conversation?limit=40",
    "/api/connections", "/api/chat/sessions?limit=50", "/api/app/mail/messages",
    "/api/app/data/schema?counts=0&preview=1", "/api/node/v1/client/pages",
    `/api/calendar?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: "50", offset: "0" })}`,
    "/api/token-usage?range=7d", "/api/node/v1/client/runtime", "/api/skills",
    "/api/system/authorization", "/api/system/token-limit", "/api/system/update",
    "/api/system/mail/status", "/api/system/agent-runtime", "/api/system/setup",
    "/api/memories?status=active&query=&limit=200", "/api/plans?limit=50&offset=0&query=", "/api/calendar?view=upcoming&limit=1",
  ];
}

/** Hydrate the Space's first menu views before enabling desktop navigation. */
export async function prefetchDesktopData({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
  const generation = clientResourceCache.generation;
  const scopeController = new AbortController();
  let timedOut = false;
  const untrack = clientResourceCache.track(scopeController);
  const abort = () => scopeController.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const queue = desktopPrefetchUrls();
  const unfinished = new Set(queue);
  const deadline = setTimeout(() => { timedOut = true; scopeController.abort(); }, 8_000);
  async function read(url: string) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    scopeController.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 8_000);
    try {
      const headers = url === "/api/system/agent-runtime" ? { "x-personal-agent-surface": "desktop" } : undefined;
      const value = await fetchJson(url, { signal: controller.signal, ...(headers ? { headers } : {}) });
      if (generation !== clientResourceCache.generation || scopeController.signal.aborted) return;
      if (headers) clientResourceCache.set(url, value, generation, "/app/runtime");
      errors.delete(url); unfinished.delete(url);
      // Workers open with the first task selected. Fetch that governed detail too.
      if (url === "/api/chat/sessions?limit=50") {
        const first = (value as { sessions?: { id: string; role: string }[] }).sessions?.find((entry) => entry.role === "worker");
        if (first) { const detail = `/api/chat/sessions/${encodeURIComponent(first.id)}`; queue.push(detail); unfinished.add(detail); }
      }
    } catch (cause) {
      if (generation === clientResourceCache.generation && (!scopeController.signal.aborted || timedOut)) {
        errors.set(url, { generation, message: controller.signal.aborted ? "读取超时，请点击重新加载。" : cause instanceof Error ? cause.message : "暂时无法读取，请重新加载。" });
      }
    } finally { clearTimeout(timer); scopeController.signal.removeEventListener("abort", cancel); }
  }
  async function worker() {
    while (queue.length && !scopeController.signal.aborted && generation === clientResourceCache.generation) {
      const url = queue.shift();
      if (url) await read(url);
    }
  }
  try { await Promise.all(Array.from({ length: 4 }, worker)); }
  finally {
    clearTimeout(deadline); untrack(); signal?.removeEventListener("abort", abort);
    if (timedOut && generation === clientResourceCache.generation && !signal?.aborted) {
      for (const url of unfinished) if (!errors.has(url) || errors.get(url)?.generation !== generation) {
        errors.set(url, { generation, message: "本机数据暂未就绪，请点击重新加载。" });
      }
    }
  }
}
