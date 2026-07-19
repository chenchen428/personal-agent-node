import fs from "node:fs";
import path from "node:path";

import { mergeSecretEnv, writeJsonAtomic } from "./config.ts";
import { initializeInstallation } from "./space-registry.ts";

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export async function refreshManagedCloudCredential({ config, fetchImpl = fetch } = {}) {
  if (!config?.configDir || !config?.envPath) throw credentialError("CLOUD_REFRESH_CONFIG_INVALID", "Managed Cloud refresh configuration is unavailable");
  const metadataPath = path.join(config.configDir, "cloud.json");
  const metadata = readJson(metadataPath);
  const credential = validateCredentialContract(metadata?.credential, metadata?.cloudUrl);
  const refreshToken = String(config.env?.PERSONAL_AGENT_CLOUD_REFRESH_TOKEN || "").trim();
  if (refreshToken.length < 16 || refreshToken.length > 4096) throw credentialError("CLOUD_REFRESH_TOKEN_MISSING", "Managed Cloud refresh credential is missing");
  const installationId = initializeInstallation({ dataRoot: config.installationDataRoot }).installation.installationId;
  const spaceId = String(config.space?.id || "");
  if (credential.deviceBinding.installationId !== installationId || credential.deviceBinding.spaceId !== spaceId) {
    throw credentialError("CLOUD_DEVICE_BINDING_MISMATCH", "Managed Cloud credential does not match this local installation and Space");
  }

  let response;
  let payload;
  try {
    response = await fetchImpl(credential.refreshEndpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${refreshToken}` },
      body: JSON.stringify({ installationId, spaceId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    throw credentialError("CLOUD_REFRESH_UNREACHABLE", "Managed Cloud credential refresh is temporarily unreachable");
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) throw credentialError("CLOUD_REFRESH_UNAVAILABLE", "Managed Cloud credential refresh is temporarily unavailable");
    const code = /^[a-z0-9_]{1,64}$/.test(String(payload?.code || "")) ? String(payload.code).toUpperCase() : "CLOUD_REFRESH_REJECTED";
    throw credentialError(code, "Managed Cloud credential refresh was rejected");
  }
  const nodeToken = boundedSecret(payload?.nodeToken, "CLOUD_ACCESS_TOKEN_INVALID");
  const nextRefreshToken = boundedSecret(payload?.refreshToken, "CLOUD_REFRESH_TOKEN_INVALID");
  const nextCredential = validateCredentialContract(payload?.credential, metadata?.cloudUrl, { requireFuture: true });
  if (nextCredential.deviceBinding.installationId !== installationId || nextCredential.deviceBinding.spaceId !== spaceId) {
    throw credentialError("CLOUD_DEVICE_BINDING_MISMATCH", "Managed Cloud returned a credential for another device binding");
  }
  mergeSecretEnv(config.envPath, {
    PERSONAL_AGENT_CLOUD_TOKEN: nodeToken,
    PERSONAL_AGENT_CLOUD_REFRESH_TOKEN: nextRefreshToken,
  }, ["PERSONAL_AGENT_CLOUD_TOKEN", "PERSONAL_AGENT_CLOUD_REFRESH_TOKEN"]);
  writeJsonAtomic(metadataPath, {
    ...metadata,
    schemaVersion: Math.max(3, Number(metadata.schemaVersion) || 0),
    credential: nextCredential,
    tunnel: payload?.tunnelGeneration
      ? { ...metadata.tunnel, generation: Number(payload.tunnelGeneration) }
      : metadata.tunnel,
    credentialRotatedAt: new Date().toISOString(),
  }, 0o600);
  return {
    token: nodeToken,
    accessExpiresAt: nextCredential.accessExpiresAt,
    refreshExpiresAt: nextCredential.refreshExpiresAt,
    generation: Number(payload?.tunnelGeneration || metadata?.tunnel?.generation || 0),
  };
}

export function validateCredentialContract(value, cloudUrl, { requireFuture = false, now = () => new Date() } = {}) {
  if (!value || value.tokenType !== "Bearer") throw credentialError("CLOUD_CREDENTIAL_CONTRACT_INVALID", "Managed Cloud credential contract is invalid");
  const trusted = new URL(String(cloudUrl || ""));
  const endpoint = new URL(String(value.refreshEndpoint || ""));
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(trusted.hostname);
  if (trusted.protocol !== "https:" && !(loopback && trusted.protocol === "http:")) throw credentialError("CLOUD_CREDENTIAL_ORIGIN_INVALID", "Managed Cloud origin is not trusted");
  if (endpoint.origin !== trusted.origin || endpoint.pathname !== "/api/node/token/refresh" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw credentialError("CLOUD_REFRESH_ENDPOINT_INVALID", "Managed Cloud refresh endpoint is not trusted");
  }
  const accessExpiresAt = futureTimestamp(value.accessExpiresAt, "CLOUD_ACCESS_EXPIRY_INVALID");
  const refreshExpiresAt = futureTimestamp(value.refreshExpiresAt, "CLOUD_REFRESH_EXPIRY_INVALID");
  if (requireFuture) {
    const current = now().getTime();
    const accessLifetime = Date.parse(accessExpiresAt) - current;
    const refreshLifetime = Date.parse(refreshExpiresAt) - current;
    if (accessLifetime <= 0 || accessLifetime > 30 * 60_000) throw credentialError("CLOUD_ACCESS_EXPIRY_INVALID", "Managed Cloud access credential lifetime is invalid");
    if (refreshLifetime <= accessLifetime || refreshLifetime > 45 * 24 * 60 * 60_000) throw credentialError("CLOUD_REFRESH_EXPIRY_INVALID", "Managed Cloud refresh credential lifetime is invalid");
  }
  const installationId = String(value.deviceBinding?.installationId || "");
  const spaceId = String(value.deviceBinding?.spaceId || "");
  if (!/^ins_[A-Za-z0-9_-]{16,64}$/.test(installationId) || (spaceId && !/^sp_[A-Za-z0-9_-]{16,64}$/.test(spaceId))) {
    throw credentialError("CLOUD_DEVICE_BINDING_INVALID", "Managed Cloud device binding is invalid");
  }
  return { tokenType: "Bearer", accessExpiresAt, refreshExpiresAt, refreshEndpoint: endpoint.toString(), deviceBinding: { installationId, spaceId } };
}

function futureTimestamp(value, code) {
  const timestamp = new Date(String(value || ""));
  if (!Number.isFinite(timestamp.getTime())) throw credentialError(code, "Managed Cloud credential expiry is invalid");
  return timestamp.toISOString();
}

function boundedSecret(value, code) {
  const secret = String(value || "").trim();
  if (secret.length < 16 || secret.length > 4096) throw credentialError(code, "Managed Cloud returned an invalid credential");
  return secret;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { throw credentialError("CLOUD_REFRESH_CONFIG_INVALID", "Managed Cloud refresh configuration is unavailable"); }
}

function credentialError(code, message) {
  return Object.assign(new Error(message), { code });
}
