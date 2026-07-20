import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { domainToASCII } from "node:url";

import { mergeSecretEnv, resolveNodeConfig, setConnectionMode, writeJsonAtomic } from "./config.ts";
import { getSpace, installationPaths, listSpaces } from "./space-registry.ts";

const KINDS = new Set(["mail", "sites"]);
const RELAY_TOKEN_ENV = "PERSONAL_AGENT_CUSTOM_DOMAIN_TOKEN";

export type CustomDomainKind = "mail" | "sites";
export type CustomDomainInput = { kind: CustomDomainKind; domain: string; relayToken: string };

export function normalizeCustomDomainInput(input: Record<string, unknown> = {}): CustomDomainInput {
  const kind = String(input.kind || "") as CustomDomainKind;
  if (!KINDS.has(kind)) throw customDomainError("CUSTOM_DOMAIN_KIND_INVALID", "仅支持本地邮箱和 Sites 自定义域名");
  const relayToken = String(input.relayToken || "").trim();
  if (relayToken && !validRelayToken(relayToken)) throw customDomainError("CUSTOM_DOMAIN_RELAY_TOKEN_INVALID", "请粘贴服务器安装后显示的有效连接密钥");
  return { kind, domain: normalizeDomain(input.domain), relayToken };
}

export function customDomainInputFingerprint(input: Record<string, unknown> = {}) {
  const normalized = normalizeCustomDomainInput(input);
  const credentialFingerprint = normalized.relayToken
    ? crypto.createHash("sha256").update(normalized.relayToken).digest("hex")
    : "reuse";
  return `${normalized.kind}:${normalized.domain}:${credentialFingerprint}`;
}

export function readCustomDomainBindings({ dataRoot, env = process.env }: { dataRoot?: string; env?: NodeJS.ProcessEnv } = {}) {
  const config = resolveRequestedConfig(env, dataRoot);
  const local = readBindingDocument(bindingPath(config.dataRoot));
  const installation = readBindingDocument(installationBindingPath(config.installationDataRoot));
  const document = installation.mail || installation.sites ? installation : local;
  return projectBindingsForSpace(document, config.space);
}

export async function startCustomDomainForwarder({
  dataRoot,
  input,
  env = process.env,
}: {
  dataRoot?: string;
  input?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const normalized = normalizeCustomDomainInput(input);
  const requestedConfig = resolveRequestedConfig(env, dataRoot);
  const spaces = listSpaces(requestedConfig.installationDataRoot);
  const owner = spaces.find((space) => space.kind === "personal") || getSpace(requestedConfig.installationDataRoot);
  if (!owner) throw customDomainError("CUSTOM_DOMAIN_SPACE_MISSING", "找不到个人 Space，无法建立自定义域名连接");
  const ownerConfig = configForSpace(env, requestedConfig.installationDataRoot, owner);
  const current = readBindingDocument(installationBindingPath(requestedConfig.installationDataRoot));
  const existingToken = String(ownerConfig.env?.[RELAY_TOKEN_ENV] || "").trim();
  const relayToken = normalized.relayToken || (validRelayToken(existingToken) ? existingToken : "");
  if (!relayToken) throw customDomainError("CUSTOM_DOMAIN_RELAY_TOKEN_REQUIRED", "请先在公网服务器安装 Relay，再把服务器显示的连接密钥粘贴到客户端");
  const credentialPath = path.join(ownerConfig.dataRoot, "secrets", "custom-domain", "relay-token");
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(credentialPath, `${relayToken}\n`, { mode: 0o600 });
  mergeSecretEnv(ownerConfig.envPath, {
    [RELAY_TOKEN_ENV]: relayToken,
    PRIVATE_SITE_GATEWAY_HOST: "127.0.0.1",
    PRIVATE_SITE_ORIGIN_TLS_CERT: "",
    PRIVATE_SITE_ORIGIN_TLS_KEY: "",
    PRIVATE_SITE_ORIGIN_TLS_CA: "",
    PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT: "",
    PRIVATE_SITE_TRUST_EDGE_HEADERS: "0",
  }, [
    RELAY_TOKEN_ENV,
    "PRIVATE_SITE_GATEWAY_HOST",
    "PRIVATE_SITE_ORIGIN_TLS_CERT",
    "PRIVATE_SITE_ORIGIN_TLS_KEY",
    "PRIVATE_SITE_ORIGIN_TLS_CA",
    "PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT",
    "PRIVATE_SITE_TRUST_EDGE_HEADERS",
  ]);

  const now = new Date().toISOString();
  const spaceRoutes = spaces.map((space) => ({
    spaceId: space.id,
    slug: space.slug,
    domain: space.kind === "personal" ? normalized.domain : `${space.slug}.${normalized.domain}`,
  }));
  const previousSiteDomains = normalized.kind === "sites"
    ? Object.fromEntries(spaces.map((space) => [space.id, readJson(path.join(space.root, "config", "site.json"))?.asciiDomain || "personal-agent.local"]))
    : undefined;
  const binding = {
    schemaVersion: 1,
    scope: "installation",
    kind: normalized.kind,
    baseDomain: normalized.domain,
    domain: normalized.domain,
    ownerSpaceId: owner.id,
    phase: "server",
    serviceReady: false,
    dnsRecord: {
      type: normalized.kind === "mail" ? "MX" : "A",
      name: normalized.domain,
      value: normalized.kind === "mail" ? "你的邮件服务器主机名" : "你的转发服务器公网 IPv4",
    },
    dnsRecords: normalized.kind === "mail"
      ? [{ type: "MX", name: normalized.domain, value: "你的邮件服务器主机名" }]
      : [
          { type: "A", name: normalized.domain, value: "你的转发服务器公网 IPv4" },
          { type: "A", name: `*.${normalized.domain}`, value: "你的转发服务器公网 IPv4" },
        ],
    relay: {
      protocol: "pa-reverse-ws-v1",
      credentialFile: "Workspace/secrets/custom-domain/relay-token",
      serverPreparationRequired: true,
    },
    tunnel: {
      protocol: "pa-reverse-ws-v1",
      endpoint: `wss://connect.${normalized.domain}/v1/connect`,
      heartbeatSeconds: 20,
      maxFrameBytes: 128 * 1024,
      generation: 1,
      routePolicy: "gateway",
      credentialEnv: RELAY_TOKEN_ENV,
    },
    spaceRoutes,
    ...(previousSiteDomains ? { previousSiteDomains } : {}),
    updatedAt: now,
  };
  const next = { ...current, schemaVersion: 1, [normalized.kind]: binding };
  writeJsonAtomic(installationBindingPath(requestedConfig.installationDataRoot), next, 0o600);
  writeJsonAtomic(bindingPath(ownerConfig.dataRoot), next, 0o600);
  setConnectionMode(ownerConfig, "self-hosted-edge");
  if (normalized.kind === "sites") {
    for (const route of spaceRoutes) {
      const space = spaces.find((candidate) => candidate.id === route.spaceId);
      if (!space) continue;
      const sitePath = path.join(space.root, "config", "site.json");
      const site = readJson(sitePath);
      if (site) writeJsonAtomic(sitePath, { ...site, displayDomain: route.domain, asciiDomain: route.domain, updatedAt: now }, 0o600);
      mergeSecretEnv(path.join(space.root, "secrets", "applications", "site.env"), { SITE_DOMAIN: route.domain }, ["SITE_DOMAIN"]);
    }
  }
  suppressAutomaticManagedBinding(ownerConfig.dataRoot, "CUSTOM_DOMAIN_SELECTED");
  return publicBinding(projectBindingForSpace(binding, requestedConfig.space));
}

export function removeCustomDomainBinding({ dataRoot, kind, env = process.env }: { dataRoot?: string; kind?: string; env?: NodeJS.ProcessEnv } = {}) {
  if (!KINDS.has(String(kind || ""))) throw customDomainError("CUSTOM_DOMAIN_KIND_INVALID", "仅支持本地邮箱和 Sites 自定义域名");
  const requestedConfig = resolveRequestedConfig(env, dataRoot);
  const spaces = listSpaces(requestedConfig.installationDataRoot);
  const owner = spaces.find((space) => space.kind === "personal") || getSpace(requestedConfig.installationDataRoot);
  const current = readBindingDocument(installationBindingPath(requestedConfig.installationDataRoot));
  const removed = current[kind as CustomDomainKind];
  const next = { ...current, schemaVersion: 1, [kind as CustomDomainKind]: null };
  writeJsonAtomic(installationBindingPath(requestedConfig.installationDataRoot), next, 0o600);
  if (owner) {
    const ownerConfig = configForSpace(env, requestedConfig.installationDataRoot, owner);
    writeJsonAtomic(bindingPath(owner.root), next, 0o600);
    if (!next.mail && !next.sites) setConnectionMode(ownerConfig, "local-only");
  }
  if (kind === "sites" && removed?.previousSiteDomains) {
    for (const space of spaces) {
      const previous = removed.previousSiteDomains[space.id];
      const sitePath = path.join(space.root, "config", "site.json");
      const site = readJson(sitePath);
      if (previous && site) {
        writeJsonAtomic(sitePath, { ...site, displayDomain: previous, asciiDomain: previous, updatedAt: new Date().toISOString() }, 0o600);
        mergeSecretEnv(path.join(space.root, "secrets", "applications", "site.env"), { SITE_DOMAIN: previous }, ["SITE_DOMAIN"]);
      }
    }
  }
  return { removed: Boolean(removed), kind, domain: removed?.baseDomain || removed?.domain || "", localDataPreserved: true };
}

export function customDomainResource(binding: any, kind: CustomDomainKind) {
  const domain = normalizeDomain(binding?.domain);
  return kind === "mail" ? `agent@${domain}` : domain;
}

function configForSpace(env: NodeJS.ProcessEnv, installationDataRoot: string, space: any) {
  return resolveNodeConfig({
    ...env,
    PERSONAL_AGENT_DATA_ROOT: installationDataRoot,
    PERSONAL_AGENT_SPACE_ID: space.id,
    PERSONAL_AGENT_SPACE_ROOT: space.root,
    PRIVATE_SITE_DATA_ROOT: space.root,
    PRIVATE_SITE_ENV_FILE: path.join(space.root, "secrets", "applications", "site.env"),
    SITE_DOMAIN: "",
  });
}

function resolveRequestedConfig(env: NodeJS.ProcessEnv, dataRoot?: string) {
  if (!dataRoot) return resolveNodeConfig(env);
  const requestedRoot = path.resolve(dataRoot);
  const directSpace = readJson(path.join(requestedRoot, "space.json"));
  const installationDataRoot = directSpace?.spaceId ? path.dirname(path.dirname(requestedRoot)) : requestedRoot;
  return resolveNodeConfig({
    ...env,
    PERSONAL_AGENT_DATA_ROOT: installationDataRoot,
    PERSONAL_AGENT_SPACE_ID: directSpace?.spaceId ? String(directSpace.spaceId) : "",
    PERSONAL_AGENT_SPACE_ROOT: directSpace?.spaceId ? requestedRoot : "",
    PRIVATE_SITE_DATA_ROOT: requestedRoot,
    PRIVATE_SITE_ENV_FILE: "",
    SITE_DOMAIN: "",
  });
}

function projectBindingsForSpace(document: any, space: any) {
  return {
    schemaVersion: 1,
    mail: document.mail ? projectBindingForSpace(document.mail, space) : null,
    sites: document.sites ? projectBindingForSpace(document.sites, space) : null,
  };
}

function projectBindingForSpace(binding: any, space: any) {
  const baseDomain = normalizeDomain(binding?.baseDomain || binding?.domain);
  if (!baseDomain) return binding;
  const route = Array.isArray(binding.spaceRoutes) ? binding.spaceRoutes.find((candidate: any) => candidate.spaceId === space?.id) : null;
  const domain = route?.domain || (space?.kind === "user" ? `${space.slug}.${baseDomain}` : baseDomain);
  return { ...binding, baseDomain, domain, publicAddress: binding.kind === "mail" ? `agent@${domain}` : `https://${domain}`, inherited: space?.id !== binding.ownerSpaceId };
}

function suppressAutomaticManagedBinding(dataRoot: string, code: string) {
  const filePath = path.join(dataRoot, "runtime", "setup", "managed-cloud-action.json");
  writeJsonAtomic(filePath, { schemaVersion: 1, state: "cancelled", phase: "idle", code, updatedAt: new Date().toISOString() }, 0o600);
}

function publicBinding(binding: any) { return { ...binding, relayCredentialPrepared: true }; }
function bindingPath(dataRoot: string) { return path.join(dataRoot, "config", "custom-domain-bindings.json"); }
function installationBindingPath(dataRoot: string) { return path.join(installationPaths(dataRoot).installationRoot, "custom-domain-bindings.json"); }
function readBindingDocument(filePath: string) {
  const document = readJson(filePath);
  return document?.schemaVersion === 1 ? document : { schemaVersion: 1, mail: null, sites: null };
}
function readJson(filePath: string) { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; } }

function normalizeDomain(value: unknown) {
  const input = String(value || "").trim().replace(/\.$/, "");
  if (!input || net.isIP(input)) throw customDomainError("CUSTOM_DOMAIN_INVALID", "请输入有效的自定义域名");
  const domain = domainToASCII(input).toLowerCase();
  if (!domain || !domain.includes(".") || domain.endsWith(".local") || domain === "localhost" || domain.length > 253) throw customDomainError("CUSTOM_DOMAIN_INVALID", "请输入有效的自定义域名");
  if (domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw customDomainError("CUSTOM_DOMAIN_INVALID", "请输入有效的自定义域名");
  return domain;
}

function validRelayToken(value: string) { return /^[A-Za-z0-9_-]{43,128}$/.test(value); }

function customDomainError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
