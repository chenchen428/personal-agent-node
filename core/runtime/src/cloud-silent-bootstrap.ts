import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { mergeSecretEnv, writeJsonAtomic } from "./config.ts";
import { ensureCloudDeviceIdentity, signCloudDeviceProof } from "./cloud-device-identity.ts";
import { openExternalUrl } from "./cloud-enrollment.ts";
import { validateCredentialContract } from "./cloud-token-refresh.ts";
import { validateReverseTunnelContract } from "./reverse-tunnel.ts";
import { initializeInstallation } from "./space-registry.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const AUTHORIZATION_TIMEOUT_MS = 2 * 60_000;
const activeBootstraps = new Map();

export function silentBootstrapManagedCloudCredential(options = {}) {
  const key = path.join(String(options.config?.configDir || ""), "cloud.json");
  if (activeBootstraps.has(key)) return activeBootstraps.get(key);
  const operation = performSilentBootstrap(options).finally(() => activeBootstraps.delete(key));
  activeBootstraps.set(key, operation);
  return operation;
}

async function performSilentBootstrap({
  config,
  fetchImpl = fetch,
  openBrowser = openExternalUrl,
  callbackFactory = createLoopbackCallback,
  now = () => new Date(),
  timeoutMs = AUTHORIZATION_TIMEOUT_MS,
} = {}) {
  if (!config?.configDir || !config?.envPath || !config?.dataRoot) throw silentError("CLOUD_SILENT_CONFIG_INVALID", "Managed Cloud silent authorization is unavailable");
  const metadataPath = path.join(config.configDir, "cloud.json");
  const metadata = readJson(metadataPath);
  const cloudOrigin = normalizeCloudOrigin(metadata.cloudUrl);
  const siteId = boundedId(metadata.siteId, "site");
  const installationId = initializeInstallation({ dataRoot: config.installationDataRoot }).installation.installationId;
  const spaceId = String(config.space?.id || "");
  const identity = ensureCloudDeviceIdentity({ dataRoot: config.dataRoot, create: false });
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const callback = await callbackFactory({ state, timeoutMs });
  try {
    const issuedAt = now().toISOString();
    const jti = randomBase64Url(24);
    const start = { siteId, installationId, spaceId, state, nonce, codeChallenge, redirectUri: callback.redirectUri, issuedAt, jti };
    const startPayload = await requestJson(fetchImpl, new URL("/api/node/silent/start", cloudOrigin), {
      ...start,
      signature: signCloudDeviceProof(identity, silentStartProof(start)),
    });
    const authorizationUrl = validateAuthorizationUrl(startPayload.authorizationUrl, cloudOrigin);
    let opened = false;
    try { opened = await openBrowser(authorizationUrl); } catch {}
    if (!opened) throw silentError("CLOUD_BROWSER_UNAVAILABLE", "The default browser could not be opened");
    const callbackResult = await callback.wait;
    if (callbackResult.error) throw interactionError(callbackResult.error);
    const code = boundedSecret(callbackResult.code, "CLOUD_SILENT_CODE_INVALID");
    const tokenIssuedAt = now().toISOString();
    const tokenJti = randomBase64Url(24);
    const exchange = { code, codeVerifier, nonce, redirectUri: callback.redirectUri, installationId, spaceId, issuedAt: tokenIssuedAt, jti: tokenJti };
    const payload = await requestJson(fetchImpl, new URL("/api/node/silent/token", cloudOrigin), {
      ...exchange,
      signature: signCloudDeviceProof(identity, silentTokenProof(exchange)),
    });
    if (payload.nonce !== nonce) throw silentError("CLOUD_SILENT_NONCE_MISMATCH", "Silent authorization nonce validation failed");
    const nodeToken = boundedSecret(payload.nodeToken, "CLOUD_ACCESS_TOKEN_INVALID");
    const refreshToken = boundedSecret(payload.refreshToken, "CLOUD_REFRESH_TOKEN_INVALID");
    const credential = validateCredentialContract(payload.credential, cloudOrigin.toString().replace(/\/$/, ""), { requireFuture: true, now });
    if (credential.deviceBinding.installationId !== installationId || credential.deviceBinding.spaceId !== spaceId) {
      throw silentError("CLOUD_DEVICE_BINDING_MISMATCH", "Silent authorization returned a credential for another device");
    }
    const tunnel = validateReverseTunnelContract(payload.tunnel);
    mergeSecretEnv(config.envPath, {
      PERSONAL_AGENT_CLOUD_TOKEN: nodeToken,
      PERSONAL_AGENT_CLOUD_REFRESH_TOKEN: refreshToken,
    }, ["PERSONAL_AGENT_CLOUD_TOKEN", "PERSONAL_AGENT_CLOUD_REFRESH_TOKEN"]);
    writeJsonAtomic(metadataPath, {
      ...metadata,
      schemaVersion: Math.max(4, Number(metadata.schemaVersion) || 0),
      credential,
      tunnel,
      credentialRecoveredAt: now().toISOString(),
      credentialRecoveryMethod: "silent-browser-session",
    }, 0o600);
    return { token: nodeToken, accessExpiresAt: credential.accessExpiresAt, refreshExpiresAt: credential.refreshExpiresAt, generation: tunnel.generation };
  } finally {
    callback.close();
  }
}

export async function createLoopbackCallback({ state, timeoutMs = AUTHORIZATION_TIMEOUT_MS } = {}) {
  const callbackPath = `/callback/${randomBase64Url(32)}`;
  let settle;
  const wait = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = http.createServer((request, response) => {
    const host = String(request.headers.host || "");
    const url = new URL(request.url || "/", `http://${host || "127.0.0.1"}`);
    if (request.method !== "GET" || url.pathname !== callbackPath || host !== `127.0.0.1:${server.address()?.port}`) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return response.end("Not found");
    }
    if (url.searchParams.get("state") !== state) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Authorization could not be completed.");
      settle.reject(silentError("CLOUD_SILENT_STATE_MISMATCH", "Silent authorization state validation failed"));
      return server.close();
    }
    const error = normalizeBrowserError(url.searchParams.get("error"));
    const code = error ? "" : String(url.searchParams.get("code") || "");
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(error ? "Personal Agent needs your confirmation to reconnect." : "Personal Agent reconnected. You can close this window.");
    settle.resolve({ code, error });
    server.close();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const timer = setTimeout(() => {
    settle.reject(silentError("CLOUD_SILENT_TIMEOUT", "Silent authorization timed out"));
    server.close();
  }, Math.min(Math.max(Number(timeoutMs) || AUTHORIZATION_TIMEOUT_MS, 1000), AUTHORIZATION_TIMEOUT_MS));
  timer.unref?.();
  const port = server.address().port;
  return {
    redirectUri: `http://127.0.0.1:${port}${callbackPath}`,
    wait: wait.finally(() => clearTimeout(timer)),
    close: () => { clearTimeout(timer); try { server.close(); } catch {} },
  };
}

function validateAuthorizationUrl(value, cloudOrigin) {
  const url = new URL(String(value || ""));
  if (url.origin !== cloudOrigin.origin || url.pathname !== "/api/node/silent/authorize" || url.hash || url.username || url.password
    || url.searchParams.get("prompt") !== "none" || !/^silentauth_[A-Za-z0-9_-]{12,128}$/.test(String(url.searchParams.get("transaction") || ""))
    || [...url.searchParams.keys()].some((key) => !["transaction", "prompt"].includes(key))) {
    throw silentError("CLOUD_SILENT_AUTHORIZATION_URL_INVALID", "Cloud returned an untrusted silent authorization URL");
  }
  return url.toString();
}

async function requestJson(fetchImpl, url, body) {
  let response;
  let payload;
  try {
    response = await fetchImpl(url, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    throw silentError("CLOUD_SILENT_UNREACHABLE", "Silent authorization is temporarily unreachable");
  }
  if (!response.ok) {
    const code = /^[a-z0-9_]{1,64}$/.test(String(payload?.code || "")) ? String(payload.code).toUpperCase() : "CLOUD_SILENT_REJECTED";
    throw silentError(code, "Silent authorization was rejected");
  }
  return payload;
}

function normalizeCloudOrigin(value) {
  const url = new URL(String(value || ""));
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw silentError("CLOUD_SILENT_ORIGIN_INVALID", "Managed Cloud origin is invalid");
  }
  return url;
}

function normalizeBrowserError(value) {
  const error = String(value || "");
  return ["login_required", "consent_required", "interaction_required", "mfa_required", "risk_blocked"].includes(error) ? error : error ? "interaction_required" : "";
}

function interactionError(value) {
  return silentError(`CLOUD_SILENT_${String(value).toUpperCase()}`, "Silent authorization requires user interaction");
}

function randomBase64Url(bytes) { return crypto.randomBytes(bytes).toString("base64url"); }
function boundedId(value, prefix) { const text = String(value || ""); if (!new RegExp(`^${prefix}_[A-Za-z0-9_-]{12,128}$`).test(text)) throw silentError("CLOUD_SILENT_CONFIG_INVALID", "Managed Cloud binding is invalid"); return text; }
function boundedSecret(value, code) { const text = String(value || "").trim(); if (text.length < 16 || text.length > 4096) throw silentError(code, "Cloud returned an invalid authorization value"); return text; }
function readJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { throw silentError("CLOUD_SILENT_CONFIG_INVALID", "Managed Cloud metadata is unavailable"); } }
function silentError(code, message) { return Object.assign(new Error(message), { code }); }
function silentStartProof(value) { return ["pa-silent-start-v1", value.siteId, value.installationId, value.spaceId, value.state, value.nonce, value.codeChallenge, value.redirectUri, value.issuedAt, value.jti].join("\n"); }
function silentTokenProof(value) { return ["pa-silent-token-v1", value.code, value.codeVerifier, value.nonce, value.redirectUri, value.installationId, value.spaceId, value.issuedAt, value.jti].join("\n"); }
