// 所有请求都带超时:macOS 休眠 / 网络抖动后 undici fetch 可能永久挂起,而心跳循环用
// inflight 守卫,一次挂起就会把整条循环静默冻死、只能手动 abg restart。带超时后挂起会
// 变成一次拒绝,循环得以继续重试并在网络恢复后自愈。
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function postJson(baseUrl, path, body, { fetchImpl = fetch, headers = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const json = text ? safeJson(text) : null;
  if (!response.ok || json?.ok === false) {
    throw new Error(`POST ${url} failed: ${response.status} ${text}`);
  }
  return json;
}

export async function getJson(baseUrl, path, { fetchImpl = fetch, headers = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const json = text ? safeJson(text) : null;
  if (!response.ok || json?.ok === false) {
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
  }
  return json;
}

/** Single-machine open-agent-bridge does not use identity-scoped auth headers. */
export function bucAuthHeaders(config) {
  return {};
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
