import { clientResourceCache, clearClientCache, requestCacheStatus } from "./client-resource-cache";

const pendingGets = new Map<string, Promise<unknown>>();

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || "GET").toUpperCase();
  if (method !== "GET" || init?.signal || typeof window === "undefined") return requestJson<T>(url, init);
  const key = `${clientResourceCache.generation}:${url}:${JSON.stringify([...new Headers(init?.headers).entries()])}`;
  for (const entry of pendingGets.keys()) if (!entry.startsWith(`${clientResourceCache.generation}:`)) pendingGets.delete(entry);
  const pending = pendingGets.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = requestJson<T>(url, init).finally(() => pendingGets.delete(key));
  pendingGets.set(key, request);
  while (pendingGets.size > 64) pendingGets.delete(pendingGets.keys().next().value!);
  return request;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const browser = typeof window !== "undefined";
  const route = browser ? window.location.pathname : undefined;
  const generation = clientResourceCache.generation;
  const cacheable = browser && !init?.headers && String(init?.method || "GET").toUpperCase() === "GET";
  const latestRead = cacheable ? clientResourceCache.beginRead(url) : () => true;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  const untrack = browser ? clientResourceCache.track(controller) : () => {};
  const requestId = `${url}:${Math.random()}`;
  requestCacheStatus(requestId, "pending");
  try {
  const response = await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  // Gateways may return HTML or plain text for expired authentication.
  if (browser && (response.status === 401 || response.status === 403)) clearClientCache("authentication");
  const text = await response.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { throw new Error("本机服务返回了无法读取的内容"); }
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `请求失败（${response.status}）`);
  }
  if (controller.signal.aborted || (browser && generation !== clientResourceCache.generation)) throw new DOMException("Request superseded", "AbortError");
  const value = (payload.data ?? payload.result ?? payload) as T;
  if (cacheable && latestRead()) clientResourceCache.set(url, value, generation, route);
  requestCacheStatus(requestId, latestRead() ? "success" : "cancel", "", url);
  return value;
  } catch (error) {
    requestCacheStatus(requestId, controller.signal.aborted || !latestRead() ? "cancel" : "error", error instanceof Error ? error.message : "暂时无法更新", url);
    throw error;
  } finally { untrack(); init?.signal?.removeEventListener("abort", abort); }
}
