export type RequestHeaders = { get(name: string): string | null };

export function isMobileRequest(requestHeaders: RequestHeaders) {
  const userAgent = requestHeaders.get("user-agent") || "";
  const clientHintMobile = requestHeaders.get("sec-ch-ua-mobile") === "?1";
  return clientHintMobile || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function isLocalDesktopSpaceManagementRequest(requestHeaders: RequestHeaders) {
  const host = normalizeHost(requestHeaders.get("host"));
  return ["127.0.0.1", "localhost", "::1"].includes(host)
    && !isMobileRequest(requestHeaders)
    && requestHeaders.get("x-personal-agent-surface") === "desktop";
}

function normalizeHost(value: string | null) {
  const host = String(value || "").split(",", 1)[0].trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  if (host === "::1") return host;
  return host.split(":", 1)[0];
}
