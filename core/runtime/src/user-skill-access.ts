import { isLocalRuntimeEnvironmentRequest } from "./runtime-environment-access.ts";

type HeaderBag = Record<string, string | string[] | undefined> | { get(name: string): string | null };
function header(headers: HeaderBag, name: string) {
  const value = "get" in headers && typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

export function isUserSkillManagementPath(pathname: string) {
  return /^\/api\/(?:chat\/)?skills\/user(?:\/|$)/.test(pathname);
}

/** Used only behind the gateway's authenticated direct-loopback desktop boundary. */
export function isLocalUserSkillRequest(headers: HeaderBag) {
  if (!isLocalRuntimeEnvironmentRequest(headers) || !header(headers, "origin") || header(headers, "sec-fetch-site") !== "same-origin") return false;
  // An Agent/Worker API credential is not a browser management authorization.
  return !["authorization", "x-cove-calendar-capability", "x-personal-agent-activity-capability", "x-personal-agent-memory-capability"].some(name => header(headers, name));
}
