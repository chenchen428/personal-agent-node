import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mergeSecretEnv } from "./config.ts";
import { wireGuardLifecycle } from "./platform-wireguard.ts";

export function initializeOriginIdentity(config, { address = "10.77.0.2" } = {}) {
  const identityDir = path.join(config.dataRoot, "secrets", "node-identity");
  fs.mkdirSync(identityDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(identityDir, "origin.key");
  const csrPath = path.join(identityDir, "origin.csr");
  const serverName = originServerName(config.site.nodeId);
  const openssl = findOpenSsl();
  if (!fs.existsSync(keyPath)) {
    run(openssl, ["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", keyPath]);
    try { fs.chmodSync(keyPath, 0o600); } catch {}
  }
  run(openssl, [
    "req", "-new", "-sha256", "-key", keyPath,
    "-subj", `/CN=${serverName}`,
    "-addext", `subjectAltName=DNS:${serverName},IP:${address}`,
    "-out", csrPath,
  ]);
  return { ok: true, nodeId: config.site.nodeId, address, serverName, csrPath };
}

export function installOriginIdentity(config, { certificatePath, caPath, edgeClientCertificatePath, address = "10.77.0.2" }) {
  const identityDir = path.join(config.dataRoot, "secrets", "node-identity");
  const keyPath = path.join(identityDir, "origin.key");
  if (!fs.existsSync(keyPath)) throw new Error("Run identity-init before installing the signed certificate");
  const certificate = new X509Certificate(fs.readFileSync(certificatePath));
  const ca = new X509Certificate(fs.readFileSync(caPath));
  const edgeClient = new X509Certificate(fs.readFileSync(edgeClientCertificatePath));
  const serverName = originServerName(config.site.nodeId);
  if (!certificate.checkHost(serverName)) throw new Error("Signed origin certificate has the wrong node identity");
  if (!certificate.checkIP(address)) throw new Error("Signed origin certificate has the wrong tunnel address");
  if (!certificate.verify(ca.publicKey) || !edgeClient.verify(ca.publicKey)) throw new Error("Origin identity is not signed by the provided platform CA");
  const key = createPrivateKey(fs.readFileSync(keyPath));
  const derived = createPublicKey(key).export({ type: "spki", format: "der" });
  const certified = certificate.publicKey.export({ type: "spki", format: "der" });
  if (!derived.equals(certified)) throw new Error("Signed origin certificate does not match the local private key");
  const installedCertificate = path.join(identityDir, "origin.crt");
  const installedCa = path.join(identityDir, "origin-ca.crt");
  fs.copyFileSync(certificatePath, installedCertificate);
  fs.copyFileSync(caPath, installedCa);
  const fingerprint = edgeClient.fingerprint256.replaceAll(":", "").toUpperCase();
  mergeSecretEnv(config.envPath, {
    PRIVATE_SITE_GATEWAY_HOST: address,
    PRIVATE_SITE_ORIGIN_TLS_CERT: installedCertificate,
    PRIVATE_SITE_ORIGIN_TLS_KEY: keyPath,
    PRIVATE_SITE_ORIGIN_TLS_CA: installedCa,
    PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT: fingerprint,
    PRIVATE_SITE_TRUST_EDGE_HEADERS: "1",
  }, [
    "PRIVATE_SITE_GATEWAY_HOST",
    "PRIVATE_SITE_ORIGIN_TLS_CERT",
    "PRIVATE_SITE_ORIGIN_TLS_KEY",
    "PRIVATE_SITE_ORIGIN_TLS_CA",
    "PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT",
    "PRIVATE_SITE_TRUST_EDGE_HEADERS",
  ]);
  return { ok: true, nodeId: config.site.nodeId, address, serverName, certificatePath: installedCertificate, caPath: installedCa };
}

export function initializeWireGuard(config, { edgePublicKey, endpoint, address = "10.77.0.2/32" }) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(String(edgePublicKey || ""))) throw new Error("Invalid Edge WireGuard public key");
  if (!/^\[[0-9a-f:]+\]:[0-9]+$/i.test(endpoint) && !/^[A-Za-z0-9.-]+:[0-9]+$/.test(endpoint)) throw new Error("Invalid WireGuard endpoint");
  if (!/^10\.77\.0\.[0-9]{1,3}\/32$/.test(address)) throw new Error("Invalid Site WireGuard address");
  const wg = findWireGuardTool();
  const identityDir = path.join(config.dataRoot, "secrets", "node-identity");
  fs.mkdirSync(identityDir, { recursive: true, mode: 0o700 });
  const privateKeyPath = path.join(identityDir, "wireguard.key");
  let privateKey = fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath, "utf8").trim() : "";
  if (!privateKey) {
    privateKey = runCapture(wg, ["genkey"]).trim();
    fs.writeFileSync(privateKeyPath, `${privateKey}\n`, { mode: 0o600 });
  }
  const publicKey = runCapture(wg, ["pubkey"], privateKey).trim();
  const tunnelPath = path.join(identityDir, "private-site.conf");
  const tunnel = writeWireGuardTunnelConfig({ tunnelPath, privateKey, address, edgePublicKey, endpoint });
  return { ok: true, nodeId: config.site.nodeId, address, endpoint, publicKey, edgePublicKey, tunnelPath, changed: tunnel.changed, configHash: tunnel.configHash, lifecycle: wireGuardLifecycle(tunnelPath) };
}

export function writeWireGuardTunnelConfig({ tunnelPath, privateKey, address, edgePublicKey, endpoint, allowedIPs = ["10.77.0.1/32"], dns = [], persistentKeepalive = 25 }) {
  if (!Array.isArray(allowedIPs) || !allowedIPs.length) throw new Error("WireGuard AllowedIPs are required");
  if (!Array.isArray(dns)) throw new Error("WireGuard DNS must be an array");
  const tunnelConfig = `[Interface]
PrivateKey = ${privateKey}
Address = ${address}
${dns.length ? `DNS = ${dns.join(", ")}\n` : ""}

[Peer]
PublicKey = ${edgePublicKey}
AllowedIPs = ${allowedIPs.join(", ")}
Endpoint = ${endpoint}
PersistentKeepalive = ${persistentKeepalive}
`;
  const changed = !fs.existsSync(tunnelPath) || fs.readFileSync(tunnelPath, "utf8") !== tunnelConfig;
  fs.mkdirSync(path.dirname(tunnelPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tunnelPath, tunnelConfig, { mode: 0o600 });
  return { changed, configHash: createHash("sha256").update(tunnelConfig).digest("hex") };
}

export function originServerName(nodeId) {
  const label = String(nodeId).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  if (!label) throw new Error("Invalid node ID");
  return `${label}.origin.private-site`;
}

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "openssl",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], { stdio: "ignore", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("OpenSSL is required to create an origin CSR");
}

function findWireGuardTool() {
  const candidates = [
    process.env.WG_BIN,
    "C:\\Program Files\\WireGuard\\wg.exe",
    "/opt/homebrew/bin/wg",
    "/usr/local/bin/wg",
    "/usr/bin/wg",
    "wg",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("WireGuard is required to create the Site tunnel identity");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${String(result.stderr || "").trim() || result.status}`);
}

function runCapture(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${String(result.stderr || "").trim() || result.status}`);
  return String(result.stdout || "");
}
