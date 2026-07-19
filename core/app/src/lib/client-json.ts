const pendingGets = new Map<string, Promise<unknown>>();

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || "GET").toUpperCase();
  if (method !== "GET" || init?.signal) return requestJson<T>(url, init);
  const pending = pendingGets.get(url) as Promise<T> | undefined;
  if (pending) return pending;
  const request = requestJson<T>(url, init).finally(() => pendingGets.delete(url));
  pendingGets.set(url, request);
  return request;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { throw new Error("本机服务返回了无法读取的内容"); }
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `请求失败（${response.status}）`);
  }
  return (payload.data ?? payload.result ?? payload) as T;
}
