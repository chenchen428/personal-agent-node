import fs from "node:fs";
import path from "node:path";

export const providerCatalog = Object.freeze({
  tunnel: Object.freeze({
    local: { managed: false, description: "Localhost and LAN only" },
    wireguard: { managed: false, description: "User-managed WireGuard Edge" },
    ngrok: { managed: false, description: "User-managed ngrok tunnel" },
    cloudflare: { managed: false, description: "User-managed Cloudflare Tunnel" },
    frp: { managed: false, description: "User-managed FRP server" },
    "personal-agent-cloud": { managed: true, description: "Optional Personal Agent Cloud Edge" },
  }),
  token: Object.freeze({
    byok: { managed: false, description: "Direct provider key owned by the user" },
    "openai-compatible": { managed: false, description: "User-selected OpenAI-compatible gateway" },
    "personal-agent-cloud": { managed: true, description: "Optional prepaid Personal Agent Token" },
  }),
});

export function defaultProviders() {
  return {
    schemaVersion: 1,
    tunnel: { provider: "local", endpoint: "", credentialEnv: "" },
    token: { provider: "byok", endpoint: "", credentialEnv: "OPENAI_API_KEY" },
  };
}

export function readProviders(config) {
  const filePath = providerPath(config);
  if (!fs.existsSync(filePath)) return defaultProviders();
  return validateProviderDocument(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function setProvider(config, { kind, provider, endpoint = "", credentialEnv = "" } = {}) {
  const category = String(kind || "").trim();
  const selected = String(provider || "").trim();
  if (!providerCatalog[category]?.[selected]) throw new Error(`Unsupported ${category || "provider"} provider: ${selected || "empty"}`);
  const current = readProviders(config);
  const next = validateProviderDocument({
    ...current,
    [category]: {
      provider: selected,
      endpoint: normalizeEndpoint(endpoint, { required: selected === "openai-compatible" }),
      credentialEnv: normalizeCredentialEnv(credentialEnv || defaultCredentialEnv(category, selected)),
    },
  });
  fs.mkdirSync(path.dirname(providerPath(config)), { recursive: true, mode: 0o700 });
  writeJsonAtomic(providerPath(config), next);
  return next;
}

export function providerStatus(config) {
  const providers = readProviders(config);
  return {
    schemaVersion: 1,
    tunnel: statusEntry("tunnel", providers.tunnel, config.env),
    token: statusEntry("token", providers.token, config.env),
  };
}

function validateProviderDocument(document) {
  if (document?.schemaVersion !== 1) throw new Error("Provider configuration must use schemaVersion 1");
  const normalized = { schemaVersion: 1 };
  for (const kind of ["tunnel", "token"]) {
    const entry = document[kind] || {};
    const provider = String(entry.provider || "").trim();
    if (!providerCatalog[kind][provider]) throw new Error(`Unsupported ${kind} provider: ${provider || "empty"}`);
    normalized[kind] = {
      provider,
      endpoint: normalizeEndpoint(entry.endpoint || "", { required: kind === "token" && provider === "openai-compatible" }),
      credentialEnv: normalizeCredentialEnv(entry.credentialEnv || ""),
    };
  }
  return normalized;
}

function statusEntry(kind, entry, env) {
  return {
    ...entry,
    managed: providerCatalog[kind][entry.provider].managed,
    credentialConfigured: !entry.credentialEnv || Boolean(String(env[entry.credentialEnv] || "").trim()),
  };
}

function normalizeEndpoint(value, { required = false } = {}) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) {
    if (required) throw new Error("Provider endpoint is required");
    return "";
  }
  const url = new URL(text);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Provider endpoint must be an HTTP(S) URL without credentials or fragments");
  return url.toString().replace(/\/$/, "");
}

function normalizeCredentialEnv(value) {
  const name = String(value || "").trim();
  if (name && !/^[A-Z][A-Z0-9_]{2,127}$/.test(name)) throw new Error("credentialEnv must name an environment variable, not contain a credential value");
  return name;
}

function defaultCredentialEnv(kind, provider) {
  if (kind === "token" && ["byok", "openai-compatible"].includes(provider)) return "OPENAI_API_KEY";
  if (provider === "personal-agent-cloud") return "PERSONAL_AGENT_CLOUD_TOKEN";
  if (provider === "ngrok") return "NGROK_AUTHTOKEN";
  if (provider === "cloudflare") return "TUNNEL_TOKEN";
  return "";
}

function providerPath(config) {
  return path.join(config.configDir, "providers.json");
}

function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}
