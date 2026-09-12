type HeaderValue = string | string[] | undefined;
type HeaderBag = Record<string, HeaderValue> | { get(name: string): string | null };

function header(headers: HeaderBag, name: string): string {
  const value = typeof (headers as { get?: unknown }).get === "function"
    ? (headers as { get(name: string): string | null }).get(name)
    : (headers as Record<string, HeaderValue>)[name];
  return typeof value === "string" ? value : "";
}

export function isRuntimeEnvironmentPath(pathname: string): boolean {
  return /^\/api\/(?:system\/|node\/v1\/client\/|chat\/node\/v1\/client\/)?(?:agent-runtime|codex-settings)(?:\/|$)/.test(pathname);
}

export function isLocalRuntimeEnvironmentRequest(headers: HeaderBag): boolean {
  const authority = header(headers, "x-forwarded-host") || header(headers, "host");
  if (!authority || authority.includes(",")) return false;
  let localUrl: URL;
  try { localUrl = new URL(`http://${authority}`); } catch { return false; }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(localUrl.hostname)) return false;
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(forwarded)) return false;
  if (header(headers, "x-personal-agent-surface") !== "desktop") return false;
  if (header(headers, "sec-ch-ua-mobile") === "?1" || /Android|iPhone|iPad|iPod|Mobile/i.test(header(headers, "user-agent"))) return false;
  const origin = header(headers, "origin");
  if (origin) {
    try {
      const requestedOrigin = new URL(origin);
      const protocol = header(headers, "x-forwarded-proto") || "http";
      if (!["http", "https"].includes(protocol) || requestedOrigin.protocol !== `${protocol}:` || requestedOrigin.host !== localUrl.host) return false;
    } catch { return false; }
  }
  return true;
}
