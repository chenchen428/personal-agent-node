import { resolveNodeConfig } from "./config.ts";
import { loadReverseTunnelConfig, ReverseTunnelConnector } from "./reverse-tunnel.ts";

let connector = null;
let fingerprint = "";
let stopping = false;

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
    connector = new ReverseTunnelConnector({ config, tunnel });
    connector.start();
  } catch (error) {
    stopConnector();
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
