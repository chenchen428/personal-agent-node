export type RequestSurface = "mobile" | "desktop" | "unknown";

type HeaderReader = { get(name: string): string | null };

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i;
const DESKTOP_UA = /Windows NT|Macintosh|X11|CrOS/i;

export function detectRequestSurface(headers: HeaderReader): RequestSurface {
  const clientHint = headers.get("sec-ch-ua-mobile");
  if (clientHint === "?1") return "mobile";
  if (clientHint === "?0") return "desktop";

  const userAgent = headers.get("user-agent") || "";
  if (MOBILE_UA.test(userAgent)) return "mobile";
  if (DESKTOP_UA.test(userAgent)) return "desktop";
  return "unknown";
}
