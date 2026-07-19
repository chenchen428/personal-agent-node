import path from "node:path";
import { resolveNodeConfig, writeJsonAtomic } from "./config.ts";
import { refreshManagedCloudCredential } from "./cloud-token-refresh.ts";
import { silentBootstrapManagedCloudCredential } from "./cloud-silent-bootstrap.ts";
import { loadReverseTunnelConfig, ReverseTunnelConnector } from "./reverse-tunnel.ts";

let connector = null;
let fingerprint = "";
let stopping = false;
let bootstrapRecovery = null;
let bootstrapRetryAt = 0;
let bootstrapAttempt = 0;
let bootstrapBlocked = false;

function reconcile() {
  if (stopping) return;
  let config;
  try { config = resolveNodeConfig(); }
  catch { return stopConnector(); }
  if (config.site?.connectionMode !== "managed-cloud") return stopConnector();
  try {
    const tunnel = loadReverseTunnelConfig(config);
    const nextFingerprint = JSON.stringify([tunnel.protocol, tunnel.endpoint, tunnel.generation, tunnel.token]);
    if (connector && fingerprint === nextFingerprint) return;
    stopConnector();
    fingerprint = nextFingerprint;
    connector = new ReverseTunnelConnector({
      config,
      tunnel,
      refreshCredential: () => refreshManagedCloudCredential({ config: resolveNodeConfig() }),
      silentCredential: () => silentBootstrapManagedCloudCredential({ config: resolveNodeConfig() }),
    });
    connector.start();
  } catch (error) {
    stopConnector();
    if (error?.code === "TUNNEL_TOKEN_MISSING" && !bootstrapRecovery && !bootstrapBlocked && Date.now() >= bootstrapRetryAt) {
      writeJsonAtomic(path.join(config.runtimeDir, "reverse-tunnel.json"), { schemaVersion: 1, protocol: "pa-reverse-ws-v1", state: "authorizing", cause: "access_token_missing", authorizationRequired: false, updatedAt: new Date().toISOString() }, 0o600);
      bootstrapRecovery = silentBootstrapManagedCloudCredential({ config })
        .then(() => { bootstrapRetryAt = 0; bootstrapAttempt = 0; })
        .catch((recoveryError) => {
          const code = String(recoveryError?.code || "CLOUD_SILENT_FAILED").toUpperCase();
          bootstrapBlocked = requiresVisibleAuthorization(code);
          const delay = Math.min(5 * 60_000, 5000 * 2 ** Math.min(bootstrapAttempt, 6));
          bootstrapAttempt += 1;
          bootstrapRetryAt = bootstrapBlocked ? Number.POSITIVE_INFINITY : Date.now() + delay;
          writeJsonAtomic(path.join(config.runtimeDir, "reverse-tunnel.json"), { schemaVersion: 1, protocol: "pa-reverse-ws-v1", state: bootstrapBlocked ? "reauth_required" : "degraded", cause: code.toLowerCase(), authorizationRequired: bootstrapBlocked, ...(bootstrapBlocked ? { setupAction: "connectivity.managed-authorize" } : { nextRetryAt: new Date(bootstrapRetryAt).toISOString() }), updatedAt: new Date().toISOString() }, 0o600);
        })
        .finally(() => { bootstrapRecovery = null; });
    }
    console.error(`[reverse-tunnel] waiting for valid enrollment: ${/^[A-Z0-9_]{1,64}$/.test(String(error?.code || "")) ? error.code : "CONFIG_INVALID"}`);
  }
}

function stopConnector() {
  connector?.stop();
  connector = null;
  fingerprint = "";
}

const timer = setInterval(reconcile, 2000);
reconcile();

const stop = () => {
  stopping = true;
  clearInterval(timer);
  stopConnector();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise(() => {});

function requiresVisibleAuthorization(code) {
  return new Set([
    "CLOUD_SILENT_LOGIN_REQUIRED", "CLOUD_SILENT_CONSENT_REQUIRED", "CLOUD_SILENT_INTERACTION_REQUIRED",
    "CLOUD_SILENT_MFA_REQUIRED", "CLOUD_SILENT_RISK_BLOCKED", "CLOUD_BROWSER_UNAVAILABLE",
    "CLOUD_SILENT_TIMEOUT", "CLOUD_SILENT_DEVICE_KEY_MISSING", "CLOUD_SILENT_DEVICE_KEY_INVALID",
    "CLOUD_SILENT_STATE_MISMATCH", "CLOUD_SILENT_NONCE_MISMATCH", "INVALID_DEVICE_PROOF", "DEVICE_BINDING_MISMATCH",
  ]).has(code);
}
