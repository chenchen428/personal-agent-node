import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { getSpace, installationPaths } from "./space-registry.ts";
import { resolveInheritedSpaceDomain } from "./space-domain-access.ts";

// One current-Space projection for Sites, conversation links and Page delivery.
// A live, verified binding is authoritative; legacy mode flags and display URLs
// are not evidence that a domain exists or that it is unavailable.
export function resolveSpaceDomainAccess({ dataRoot = "", now = new Date() }: { dataRoot?: string; now?: Date } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) return unavailable("not-configured");
  const identity = readJson(path.join(dataRoot, "space.json"));
  const installationRoot = path.dirname(path.dirname(dataRoot));
  const space = identity?.spaceId ? getSpace(installationRoot, identity.spaceId) : null;
  if (identity && (!space || path.resolve(space.root) !== path.resolve(dataRoot))) return unavailable("invalid-space");
  const site = readJson(path.join(dataRoot, "config", "site.json"));
  const cloud = readJson(path.join(dataRoot, "config", "cloud.json"));
  const local = readJson(path.join(dataRoot, "config", "custom-domain-bindings.json"))?.sites;
  const independentManaged = site?.connectionMode === "managed-cloud" && domainName(cloud?.managedHost);
  if (!independentManaged && local?.domain && local.scope !== "installation") {
    if (local.ownerSpaceId && local.ownerSpaceId !== space?.id) return unavailable("invalid-domain-owner");
    return customAccess(local);
  }
  if (!independentManaged && (!space || space.kind === "personal")) {
    const installed = space ? readJson(path.join(installationPaths(installationRoot).installationRoot, "custom-domain-bindings.json")) : null;
    const selected = installed ? installed.sites : local;
    if (selected?.domain) {
      if (selected.scope === "installation" && selected.ownerSpaceId !== space?.id) return unavailable("invalid-domain-owner");
      return customAccess(selected);
    }
  }
  const inherited = resolveInheritedSpaceDomain({ dataRoot, now });
  if (inherited) return { ...inherited, bindingMode: "custom", verificationReady: inherited.parentVerified && inherited.routeVerified,
    authenticationRequired: true, accessPolicy: "space-authenticated" };
  if (independentManaged) return configuredAccess(independentManaged, "platform", cloud.tunnel);
  return unavailable(site?.connectionMode === "local-only" || !site ? "local-only" : "not-configured");

  function customAccess(binding: any) {
    const domain = domainName(binding.domain);
    if (!domain) return unavailable("not-configured");
    return configuredAccess(domain, "custom", binding.tunnel);
  }
  function configuredAccess(domain: string, bindingMode: "custom" | "platform", tunnel: any) {
    const verification = readJson(path.join(dataRoot, "runtime", "domain-binding-verification.json"))?.sites;
    const verificationReady = verification?.phase === "verified" && (verification.binding || "platform") === bindingMode && verification.resource === domain;
    const live = readJson(path.join(dataRoot, "runtime", "reverse-tunnel.json"));
    const tunnelReady = tunnelIsLive(tunnel, live, now);
    const targetReady = !space || (space.state === "running" && space.desiredState === "running");
    const ready = Boolean(verificationReady && tunnelReady && targetReady);
    const reason = !targetReady ? "space-offline" : !verificationReady ? "domain-unverified" : !tunnelReady
      ? ["degraded", "refreshing", "authorizing", "reauth_required"].includes(live?.state) ? live.state : "tunnel-offline" : "ready";
    return { configured: true, mode: bindingMode === "custom" ? "self-hosted-edge" : "managed-cloud", bindingMode,
      domain, ready, reason, origin: ready ? `https://${domain}` : "", inherited: false,
      verificationReady: Boolean(verificationReady), tunnelReady, targetReady,
      authenticationRequired: true, accessPolicy: "space-authenticated", spaceId: space?.id || "" };
  }
}

function tunnelIsLive(tunnel: any, state: any, now: Date) {
  if (tunnel?.protocol !== "pa-reverse-ws-v1" || state?.protocol !== "pa-reverse-ws-v1" || state.state !== "ready") return false;
  let endpoint;
  try { endpoint = new URL(String(tunnel.endpoint || "")); } catch { return false; }
  if (endpoint.protocol !== "wss:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
  const expectedOrigins = [endpoint.origin];
  if (endpoint.hostname.startsWith("connect.")) expectedOrigins.push(`wss://${endpoint.hostname.slice("connect.".length)}`);
  if (state.endpointOrigin && !expectedOrigins.includes(state.endpointOrigin)) return false;
  if (state.generation && Number(state.generation) < Number(tunnel.generation || 1)) return false;
  const age = now.getTime() - Date.parse(String(state.lastPongAt || ""));
  return Number.isFinite(age) && age >= -30_000 && age <= Math.min(360_000, Number(tunnel.heartbeatSeconds || 20) * 3000);
}
function unavailable(reason: string) { return { ready: false, configured: false, reason, origin: "", domain: "", inherited: false, bindingMode: "", verificationReady: false, tunnelReady: false, authenticationRequired: true, accessPolicy: "space-authenticated" }; }
function readJson(file: string) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function domainName(value: unknown) {
  const domain = String(value || "").trim().toLowerCase();
  return domain.length <= 253 && domain.includes(".") && !net.isIP(domain) && !domain.endsWith(".local")
    && domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? domain : "";
}
