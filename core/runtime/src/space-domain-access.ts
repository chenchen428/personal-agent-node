import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { getSpace, installationPaths, listSpaces } from "./space-registry.ts";

// Installation-scoped routing facts only. Never read or copy another Space's
// secrets, sessions, authentication state, files, or business records.
export function resolveInheritedSpaceDomain({ dataRoot = "", now = new Date() }: { dataRoot?: string; now?: Date } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) return null;
  const identity = readJson(path.join(dataRoot, "space.json"));
  if (!identity?.spaceId || identity.kind !== "user") return null;
  const installationRoot = path.dirname(path.dirname(path.resolve(dataRoot)));
  const space = getSpace(installationRoot, identity.spaceId);
  if (!space || space.kind !== "user" || path.resolve(space.root) !== path.resolve(dataRoot)) return null;
  const localSite = readJson(path.join(space.root, "config", "site.json"));
  const localCloud = readJson(path.join(space.root, "config", "cloud.json"));
  const localBinding = readJson(path.join(space.root, "config", "custom-domain-bindings.json"))?.sites;
  // Explicit independent connections retain their own authorization and routing.
  if (localSite?.connectionMode === "managed-cloud" && localCloud?.managedHost) return null;
  if (localBinding?.domain && localBinding.scope !== "installation" && (!localBinding.ownerSpaceId || localBinding.ownerSpaceId === space.id)) return null;
  const owner = listSpaces(installationRoot).find((candidate) => candidate.kind === "personal");
  if (!owner) return null;
  const installationDocument = readJson(path.join(installationPaths(installationRoot).installationRoot, "custom-domain-bindings.json"));
  const document = installationDocument || readJson(path.join(owner.root, "config", "custom-domain-bindings.json"));
  const binding = document?.sites;
  const baseDomain = publicDomain(binding?.baseDomain || binding?.domain);
  if (!baseDomain || binding.scope !== "installation" || binding.ownerSpaceId !== owner.id) return null;
  const domain = publicDomain(`${space.slug}.${baseDomain}`);
  if (!domain || binding.tunnel?.protocol !== "pa-reverse-ws-v1") return null;
  // Only the self-hosted Relay contract guarantees wildcard Space routing. A
  // managed-cloud hostname alone does not authorize nested domains or reuse.
  let endpoint;
  try { endpoint = new URL(String(binding.tunnel.endpoint || "")); } catch { return null; }
  if (endpoint.protocol !== "wss:" || ![baseDomain, `connect.${baseDomain}`].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  const ownerSite = readJson(path.join(owner.root, "config", "site.json"));
  const verification = readJson(path.join(owner.root, "runtime", "domain-binding-verification.json"))?.sites;
  const bindingRevision = crypto.createHash("sha256").update(JSON.stringify([baseDomain, owner.id, binding.updatedAt || "", binding.tunnel])).digest("hex");
  const state = readJson(path.join(owner.root, "runtime", "reverse-tunnel.json"));
  const lastPong = Date.parse(String(state?.lastPongAt || ""));
  const age = now.getTime() - lastPong;
  const heartbeatMs = Number(binding.tunnel.heartbeatSeconds || 20) * 3000;
  const endpointOrigin = endpoint.hostname === `connect.${baseDomain}` ? `wss://${baseDomain}` : endpoint.origin;
  const tunnelReady = ownerSite?.connectionMode === "self-hosted-edge" && state?.protocol === "pa-reverse-ws-v1"
    && state.state === "ready" && (!state.endpointOrigin || state.endpointOrigin === endpointOrigin)
    && (!state.generation || Number(state.generation) >= Number(binding.tunnel.generation || 1))
    && Number.isFinite(age) && age >= -30_000 && age <= Math.min(360_000, heartbeatMs);
  const checked = readJson(path.join(space.root, "runtime", "domain-inheritance-verification.json"));
  const routeVerified = checked?.ready === true && checked.spaceId === space.id && checked.domain === domain
    && checked.baseDomain === baseDomain && checked.ownerSpaceId === owner.id && checked.parentVerifiedAt === String(verification?.updatedAt || "") && checked.bindingRevision === bindingRevision;
  const parentVerified = (verification?.phase === "verified" && verification.binding === "custom" && verification.resource === baseDomain)
    || (routeVerified && checked.parentVerifiedViaHealth === true);
  const targetReady = space.state === "running" && space.desiredState === "running";
  const ready = Boolean(parentVerified && tunnelReady && routeVerified && targetReady);
  return { configured: true, mode: "self-hosted-edge", inherited: true, inheritedFromSpaceId: owner.id,
    inheritedBaseDomain: baseDomain, domain, origin: ready ? `https://${domain}` : "", ready,
    reason: !targetReady ? "space-offline" : !parentVerified ? "parent-domain-unverified" : !tunnelReady ? "tunnel-offline" : !routeVerified ? "space-domain-verifying" : "ready",
    parentVerified: Boolean(parentVerified), tunnelReady: Boolean(tunnelReady), routeVerified: Boolean(routeVerified),
    parentVerifiedAt: String(verification?.updatedAt || ""), bindingRevision, spaceId: space.id, targetReady,
  };
}

const pending = new Map<string, Promise<unknown>>();
export function verifyInheritedSpaceDomain({ dataRoot = "", fetchImpl = fetch, now = () => new Date() }: { dataRoot?: string; fetchImpl?: typeof fetch; now?: () => Date } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) return Promise.resolve(null);
  const key = path.resolve(dataRoot);
  if (pending.has(key)) return pending.get(key);
  const task = verify().catch(() => null).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
  async function verify() {
    const access = resolveInheritedSpaceDomain({ dataRoot, now: now() });
    if (!access || access.ready || !access.tunnelReady || !access.targetReady) return access;
    try {
      if (!access.parentVerified && !await verifyHealth(access.inheritedBaseDomain, access.inheritedFromSpaceId, fetchImpl)) return access;
      if (!await verifyHealth(access.domain, access.spaceId, fetchImpl)) return access;
      const latest = resolveInheritedSpaceDomain({ dataRoot, now: now() });
      if (!latest || !latest.tunnelReady || !latest.targetReady || latest.bindingRevision !== access.bindingRevision || latest.domain !== access.domain || latest.parentVerifiedAt !== access.parentVerifiedAt) return latest;
      const target = path.join(dataRoot, "runtime", "domain-inheritance-verification.json");
      const temporary = `${target}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, ready: true, spaceId: access.spaceId, domain: access.domain,
        baseDomain: access.inheritedBaseDomain, ownerSpaceId: access.inheritedFromSpaceId, parentVerifiedAt: access.parentVerifiedAt, bindingRevision: access.bindingRevision,
        parentVerifiedViaHealth: !access.parentVerified, checkedAt: now().toISOString() }), { mode: 0o600 });
      fs.renameSync(temporary, target);
      return resolveInheritedSpaceDomain({ dataRoot, now: now() });
    } catch { return access; }
  }
}

async function verifyHealth(domain: string, spaceId: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`https://${domain}/__private-site/health`, { redirect: "error", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 8192) { await response.body?.cancel(); return false; }
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); return false; }
    chunks.push(value);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return result?.ok === true && result.service === "private-site-gateway" && result.site === domain && result.spaceId === spaceId;
}

function readJson(file: string) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function publicDomain(value: unknown) {
  const domain = String(value || "").trim().toLowerCase();
  return domain.length <= 253 && domain.includes(".") && !net.isIP(domain) && !domain.endsWith(".local")
    && domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? domain : "";
}
