export type RequestHeaders = { get(name: string): string | null };

export function isMobileRequest(requestHeaders: RequestHeaders) {
  const userAgent = requestHeaders.get("user-agent") || "";
  const clientHintMobile = requestHeaders.get("sec-ch-ua-mobile") === "?1";
  return clientHintMobile || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
