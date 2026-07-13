import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { domainToASCII, fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceRoot = path.resolve(projectRoot, "..", "..", "..");
export const defaultDistributionPath = path.join(workspaceRoot, "registry", "site-distribution.json");

export function loadEdgeConfig(env = process.env) {
  const configDir = path.resolve(env.PRIVATE_SITE_EDGE_CONFIG_DIR || "/etc/private-site-edge");
  const stateDir = path.resolve(env.PRIVATE_SITE_EDGE_STATE_DIR || "/var/lib/private-site-edge");
  const sitesFile = path.resolve(env.PRIVATE_SITE_EDGE_SITES_FILE || path.join(configDir, "sites.json"));
  const distributionFile = path.resolve(env.PRIVATE_SITE_DISTRIBUTION_FILE || defaultDistributionPath);
  return {
    configDir,
    stateDir,
    sitesFile,
    distributionFile,
    nginxOutputDir: path.resolve(env.PRIVATE_SITE_EDGE_NGINX_DIR || path.join(configDir, "nginx")),
    certificateRoot: path.resolve(env.PRIVATE_SITE_EDGE_CERT_DIR || path.join(configDir, "certs")),
    acmeWebRoot: path.resolve(env.PRIVATE_SITE_EDGE_ACME_WEBROOT || "/var/www/acme"),
    clientCertificate: path.resolve(env.PRIVATE_SITE_EDGE_CLIENT_CERT || path.join(configDir, "pki", "edge-client.crt")),
    clientKey: path.resolve(env.PRIVATE_SITE_EDGE_CLIENT_KEY || path.join(configDir, "pki", "edge-client.key")),
    originCa: path.resolve(env.PRIVATE_SITE_EDGE_ORIGIN_CA || path.join(configDir, "pki", "origin-ca.crt")),
    wireGuardPrivateKey: path.resolve(env.PRIVATE_SITE_EDGE_WG_PRIVATE_KEY || path.join(configDir, "wireguard", "private.key")),
    wireGuardConfig: path.resolve(env.PRIVATE_SITE_EDGE_WG_CONFIG || "/etc/wireguard/wg0.conf"),
    wireGuardAddress: env.PRIVATE_SITE_EDGE_WG_ADDRESS || "10.77.0.1/24",
    wireGuardPort: Number(env.PRIVATE_SITE_EDGE_WG_PORT || 51820),
    maxSiteConnections: positiveInteger(env.PRIVATE_SITE_EDGE_MAX_SITE_CONNECTIONS, 200, "Site connection limit"),
    maxSourceConnections: positiveInteger(env.PRIVATE_SITE_EDGE_MAX_SOURCE_CONNECTIONS, 30, "source connection limit"),
    metricsRoot: path.resolve(env.PRIVATE_SITE_EDGE_METRICS_ROOT || "/var/log/private-site-edge"),
  };
}

export function readSites(config = loadEdgeConfig()) {
  const document = readJson(config.sitesFile);
  if (document.schemaVersion !== 1 || !Array.isArray(document.sites)) throw new Error("sites.json must contain schemaVersion 1 and a sites array");
  const seenDomains = new Set();
  const seenNodes = new Set();
  const seenSiteIds = new Set();
  const seenOrigins = new Set();
  const sites = document.sites.map((site, index) => validateSite(site, index));
  for (const site of sites) {
    if (seenDomains.has(site.asciiDomain)) throw new Error(`Duplicate Edge domain: ${site.asciiDomain}`);
    if (seenNodes.has(site.nodeId)) throw new Error(`Duplicate Edge nodeId: ${site.nodeId}`);
    if (seenSiteIds.has(site.siteId)) throw new Error(`Duplicate Edge siteId: ${site.siteId}`);
    const originAddress = new URL(site.originUrl).hostname;
    if (seenOrigins.has(originAddress)) throw new Error(`Duplicate Edge origin address: ${originAddress}`);
    seenDomains.add(site.asciiDomain);
    seenNodes.add(site.nodeId);
    seenSiteIds.add(site.siteId);
    seenOrigins.add(originAddress);
  }
  return { schemaVersion: 1, sites };
}

export function planSiteRegistration({ config = loadEdgeConfig(), ...input }) {
  const identity = registrationIdentity(input);
  const document = readSites(config);
  const existing = matchingSite(document.sites, identity);
  if (existing) {
    return {
      ok: true,
      existing: true,
      siteId: existing.siteId,
      nodeId: existing.nodeId,
      domain: existing.asciiDomain,
      address: new URL(existing.originUrl).hostname,
      certificateMode: existing.certificateMode,
    };
  }
  const used = new Set(document.sites.map((site) => new URL(site.originUrl).hostname));
  for (let host = 2; host <= 254; host += 1) {
    const address = `10.77.0.${host}`;
    if (!used.has(address)) return { ok: true, existing: false, ...identity, address, certificateMode: "http-san" };
  }
  throw new Error("The Edge WireGuard address pool is exhausted");
}

export function upsertSite({ config = loadEdgeConfig(), site }) {
  return withRegistryLock(config.sitesFile, () => {
    const identity = registrationIdentity(site);
    const plan = planSiteRegistration({ config, ...identity });
    const candidate = validateSite({
      ...site,
      ...identity,
      originUrl: site.originUrl || `https://${plan.address}:8843/`,
      certificateMode: site.certificateMode || plan.certificateMode,
      status: site.status || "pending",
    }, 0);
    if (new URL(candidate.originUrl).hostname !== plan.address) {
      throw new Error(`Edge Site must use its allocated origin address ${plan.address}`);
    }

    const document = readSites(config);
    const index = document.sites.findIndex((entry) => entry.siteId === identity.siteId);
    const now = new Date().toISOString();
    const value = {
      ...(index >= 0 ? document.sites[index] : {}),
      ...candidate,
      createdAt: index >= 0 ? document.sites[index].createdAt || now : now,
      updatedAt: now,
    };
    if (index >= 0) document.sites[index] = value;
    else document.sites.push(value);
    writeJsonAtomic(config.sitesFile, document, 0o640);
    return { ok: true, created: index < 0, site: validateSite(value, index < 0 ? document.sites.length - 1 : index), applyRequired: true };
  });
}

export function planSiteReplacement({ config = loadEdgeConfig(), previousNodeId, ...input }) {
  const identity = registrationIdentity(input);
  const previous = String(previousNodeId || "").trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(previous) || previous === identity.nodeId) throw new Error("Invalid previous Node identity");
  const raw = readJson(config.sitesFile);
  const document = readSites(config);
  const existing = document.sites.find((site) => site.siteId === identity.siteId || site.asciiDomain === identity.asciiDomain);
  if (!existing || existing.siteId !== identity.siteId || existing.asciiDomain !== identity.asciiDomain) {
    throw new Error("Edge replacement does not match the currently registered Site and previous Node");
  }
  const alreadyReplaced = existing.nodeId === identity.nodeId
    && Array.isArray(raw.revocations)
    && raw.revocations.some((entry) => entry.siteId === identity.siteId
      && entry.nodeId === previous
      && entry.replacedByNodeId === identity.nodeId);
  if (existing.nodeId !== previous && !alreadyReplaced) throw new Error("Edge replacement does not match the currently registered Site and previous Node");
  if (!alreadyReplaced && document.sites.some((site) => site.nodeId === identity.nodeId)) throw new Error("Replacement Node identity is already registered");
  return {
    ok: true,
    replacement: true,
    siteId: identity.siteId,
    nodeId: identity.nodeId,
    previousNodeId: previous,
    domain: identity.asciiDomain,
    address: new URL(existing.originUrl).hostname,
    certificateMode: existing.certificateMode,
    alreadyReplaced,
  };
}

export function replaceSite({ config = loadEdgeConfig(), previousNodeId, site }) {
  return withRegistryLock(config.sitesFile, () => {
    const plan = planSiteReplacement({ config, previousNodeId, ...site });
    if (plan.alreadyReplaced) {
      const current = readSites(config).sites.find((entry) => entry.siteId === plan.siteId);
      return { ok: true, replaced: true, alreadyReplaced: true, previousNodeId: plan.previousNodeId, site: current, applyRequired: false };
    }
    const candidate = validateSite({
      ...site,
      siteId: plan.siteId,
      nodeId: plan.nodeId,
      asciiDomain: plan.domain,
      originUrl: site.originUrl || `https://${plan.address}:8843/`,
      certificateMode: site.certificateMode || plan.certificateMode,
      status: site.status || "active",
    }, 0);
    if (new URL(candidate.originUrl).hostname !== plan.address) throw new Error(`Replacement Site must retain origin address ${plan.address}`);
    const document = readJson(config.sitesFile);
    const index = document.sites.findIndex((entry) => entry.siteId === plan.siteId && normalizeApexDomain(entry.asciiDomain) === plan.domain);
    if (index < 0 || document.sites[index].nodeId !== plan.previousNodeId) throw new Error("Edge Site changed during replacement");
    const previous = validateSite(document.sites[index], index);
    const now = new Date().toISOString();
    document.revocations = Array.isArray(document.revocations) ? document.revocations : [];
    if (!document.revocations.some((entry) => entry.siteId === previous.siteId && entry.nodeId === previous.nodeId)) {
      document.revocations.push({
        schemaVersion: 1,
        siteId: previous.siteId,
        nodeId: previous.nodeId,
        domain: previous.asciiDomain,
        originAddress: new URL(previous.originUrl).hostname,
        wireGuardPublicKey: previous.wireGuardPublicKey,
        revokedAt: now,
        replacedByNodeId: candidate.nodeId,
      });
    }
    const value = {
      ...previous,
      ...candidate,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      replacedNodeId: previous.nodeId,
    };
    document.sites[index] = value;
    writeJsonAtomic(config.sitesFile, document, 0o640);
    return { ok: true, replaced: true, previousNodeId: previous.nodeId, site: validateSite(value, index), applyRequired: true };
  });
}

export function updateSiteStatus({ config = loadEdgeConfig(), domain, status }) {
  const normalized = normalizeApexDomain(domain);
  const allowed = new Set(["pending", "active", "offline", "disabled", "revoked"]);
  if (!allowed.has(status)) throw new Error(`Invalid Site status: ${status || "missing"}`);
  const document = readJson(config.sitesFile);
  const matches = document.sites.filter((site) => normalizeApexDomain(site.asciiDomain) === normalized);
  if (matches.length !== 1) throw new Error(`Expected one Edge Site for ${normalized}, found ${matches.length}`);
  matches[0].status = status;
  matches[0].updatedAt = new Date().toISOString();
  writeJsonAtomic(config.sitesFile, document, 0o640);
  return { ok: true, domain: normalized, status, applyRequired: true };
}

export function siteHostnames(site, distribution) {
  const prefixes = [
    ...distribution.domain.standardHosts.map((entry) => entry.prefix),
    ...distribution.domain.legacyHosts.map((entry) => entry.prefix),
  ];
  return [...new Set(prefixes.map((prefix) => prefix ? `${prefix}.${site.asciiDomain}` : site.asciiDomain))];
}

export function renderSiteNginx(site, distribution, config, options = {}) {
  const hosts = siteHostnames(site, distribution);
  const certDir = path.join(config.certificateRoot, site.asciiDomain);
  const origin = new URL(site.originUrl);
  const originAuthority = origin.port ? `${origin.hostname}:${origin.port}` : origin.hostname;
  const serverName = site.originServerName || defaultOriginServerName(site.nodeId);
  const includeTls = options.includeTls !== false;
  const proxyEnabled = options.proxyEnabled !== false;
  return `# Generated by private-site-edge. Do not edit.
server {
    listen 80;
    server_name ${hosts.join(" ")};

    location ^~ /.well-known/acme-challenge/ {
        root ${nginxQuote(config.acmeWebRoot)};
        default_type text/plain;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
${includeTls ? `
server {
    listen 443 ssl;
    http2 on;
    server_name ${hosts.join(" ")};

    access_log ${nginxQuote(metricLogPath(config, site))} private_site_metrics;

    ssl_certificate ${nginxQuote(path.join(certDir, "fullchain.cer"))};
    ssl_certificate_key ${nginxQuote(path.join(certDir, "privkey.key"))};

    client_max_body_size 64m;
    limit_conn private_site_host ${config.maxSiteConnections};
    limit_conn private_site_source ${config.maxSourceConnections};
    limit_req zone=private_site_requests burst=100 nodelay;

    location / {
${proxyEnabled ? `
        proxy_pass https://${originAuthority};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        proxy_ssl_certificate ${nginxQuote(config.clientCertificate)};
        proxy_ssl_certificate_key ${nginxQuote(config.clientKey)};
        proxy_ssl_trusted_certificate ${nginxQuote(config.originCa)};
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 2;
        proxy_ssl_server_name on;
        proxy_ssl_name ${serverName};
` : `
        add_header Cache-Control "no-store" always;
        return 503;
`}
    }
}
` : ""}`;
}

export function renderEdge({ config = loadEdgeConfig(), sitesDocument = readSites(config), distribution = readJson(config.distributionFile) } = {}) {
  fs.mkdirSync(config.nginxOutputDir, { recursive: true, mode: 0o750 });
  const expected = new Set();
  const manifestSites = [];
  for (const site of sitesDocument.sites.filter((candidate) => !["disabled", "revoked"].includes(candidate.status))) {
    const fileName = `site-${site.asciiDomain}.conf`;
    const outputPath = path.join(config.nginxOutputDir, fileName);
    const certificateReady = fs.existsSync(path.join(config.certificateRoot, site.asciiDomain, "fullchain.cer"))
      && fs.existsSync(path.join(config.certificateRoot, site.asciiDomain, "privkey.key"));
    writeAtomic(outputPath, renderSiteNginx(site, distribution, config, {
      includeTls: certificateReady,
      proxyEnabled: site.status === "active",
    }), 0o640);
    expected.add(fileName);
    manifestSites.push({
      siteId: site.siteId,
      nodeId: site.nodeId,
      asciiDomain: site.asciiDomain,
      originUrl: site.originUrl,
      certificateMode: site.certificateMode,
      hosts: siteHostnames(site, distribution),
    });
  }
  for (const entry of fs.readdirSync(config.nginxOutputDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith("site-") && entry.name.endsWith(".conf") && !expected.has(entry.name)) {
      fs.rmSync(path.join(config.nginxOutputDir, entry.name));
    }
  }
  const manifestPath = path.join(config.stateDir, "render-manifest.json");
  let wireGuardConfig = null;
  if (fs.existsSync(config.wireGuardPrivateKey)) {
    wireGuardConfig = renderWireGuard({ config, sitesDocument });
  }
  writeJsonAtomic(manifestPath, { schemaVersion: 1, generatedAt: new Date().toISOString(), sites: manifestSites }, 0o640);
  return { ok: true, count: manifestSites.length, nginxOutputDir: config.nginxOutputDir, wireGuardConfig, manifestPath, sites: manifestSites };
}

export function renderWireGuard({ config = loadEdgeConfig(), sitesDocument = readSites(config) } = {}) {
  const privateKey = fs.readFileSync(config.wireGuardPrivateKey, "utf8").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(privateKey)) throw new Error("Invalid Edge WireGuard private key");
  const peers = sitesDocument.sites.filter((site) => !["disabled", "revoked"].includes(site.status) && site.wireGuardPublicKey);
  const lines = [
    "# Generated by private-site-edge. Do not edit.",
    "[Interface]",
    `Address = ${config.wireGuardAddress}`,
    `ListenPort = ${config.wireGuardPort}`,
    `PrivateKey = ${privateKey}`,
    "PostUp = iptables -C FORWARD -i %i -o %i -j DROP 2>/dev/null || iptables -I FORWARD -i %i -o %i -j DROP",
    "PostUp = iptables -N PRIVATE_SITE_WG_INPUT 2>/dev/null || true; iptables -F PRIVATE_SITE_WG_INPUT; iptables -A PRIVATE_SITE_WG_INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A PRIVATE_SITE_WG_INPUT -j DROP",
    "PostUp = iptables -C INPUT -i %i -j PRIVATE_SITE_WG_INPUT 2>/dev/null || iptables -I INPUT -i %i -j PRIVATE_SITE_WG_INPUT",
    "PostDown = iptables -D FORWARD -i %i -o %i -j DROP 2>/dev/null || true",
    "PostDown = iptables -D INPUT -i %i -j PRIVATE_SITE_WG_INPUT 2>/dev/null || true; iptables -F PRIVATE_SITE_WG_INPUT 2>/dev/null || true; iptables -X PRIVATE_SITE_WG_INPUT 2>/dev/null || true",
    "",
  ];
  for (const site of peers) {
    const origin = new URL(site.originUrl);
    lines.push(
      `# ${site.siteId} / ${site.nodeId} / ${site.asciiDomain}`,
      "[Peer]",
      `PublicKey = ${site.wireGuardPublicKey}`,
      `AllowedIPs = ${origin.hostname}/32`,
      "",
    );
  }
  writeAtomic(config.wireGuardConfig, `${lines.join("\n")}\n`, 0o600);
  return config.wireGuardConfig;
}

export function verifyEdge({ config = loadEdgeConfig(), checkFiles = true } = {}) {
  const checks = [];
  let sitesDocument;
  try {
    sitesDocument = readSites(config);
    checks.push({ name: "site registry", ok: true, count: sitesDocument.sites.length });
  } catch (error) {
    return { ok: false, checks: [{ name: "site registry", ok: false, error: error.message }] };
  }
  const distribution = readJson(config.distributionFile);
  for (const site of sitesDocument.sites) {
    const routePath = path.join(config.nginxOutputDir, `site-${site.asciiDomain}.conf`);
    if (["disabled", "revoked"].includes(site.status)) {
      checks.push({ name: `${site.asciiDomain} route excluded`, ok: !checkFiles || !fs.existsSync(routePath) });
      continue;
    }
    const rendered = renderSiteNginx(site, distribution, config);
    const routeReady = rendered.includes(`proxy_ssl_name ${site.originServerName};`)
      && (!checkFiles || fs.existsSync(routePath) && fs.readFileSync(routePath, "utf8") === rendered);
    checks.push({ name: `${site.asciiDomain} route`, ok: routeReady, path: routePath });
    checks.push({
      name: `${site.asciiDomain} certificate`,
      ...certificateCheck(
        path.join(config.certificateRoot, site.asciiDomain, "fullchain.cer"),
        path.join(config.certificateRoot, site.asciiDomain, "privkey.key"),
        siteHostnames(site, distribution),
        checkFiles,
      ),
    });
  }
  if (checkFiles) {
    for (const [name, filePath] of [["Edge client certificate", config.clientCertificate], ["Edge client key", config.clientKey], ["origin CA", config.originCa]]) {
      checks.push({ name, ok: fs.existsSync(filePath), path: filePath });
    }
    checks.push({ name: "metrics directory", ok: fs.existsSync(config.metricsRoot) && fs.statSync(config.metricsRoot).isDirectory(), path: config.metricsRoot });
  }
  return { ok: checks.every((check) => check.ok), generatedAt: new Date().toISOString(), checks };
}

export function certificateRows(config = loadEdgeConfig()) {
  const distribution = readJson(config.distributionFile);
  return readSites(config).sites
    .filter((site) => site.status !== "disabled" && site.status !== "revoked")
    .map((site) => ({
      domain: site.asciiDomain,
      mode: site.certificateMode,
      hosts: siteHostnames(site, distribution),
    }));
}

export function readMetricSummary(filePath, { maxBytes = 16 * 1024 * 1024 } = {}) {
  const summary = {
    requests: 0,
    bytesIn: 0,
    bytesOut: 0,
    durationSeconds: 0,
    statusClasses: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    lastRequestAt: null,
    truncated: false,
  };
  if (!fs.existsSync(filePath)) return summary;
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(length);
  try { fs.readSync(handle, buffer, 0, length, start); }
  finally { fs.closeSync(handle); }
  const lines = buffer.toString("utf8").split(/\r?\n/);
  if (start > 0) {
    lines.shift();
    summary.truncated = true;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const status = Number(row.status);
      summary.requests += 1;
      summary.bytesIn += nonNegativeNumber(row.bytesIn);
      summary.bytesOut += nonNegativeNumber(row.bytesOut);
      summary.durationSeconds += nonNegativeNumber(row.duration);
      const statusClass = `${Math.floor(status / 100)}xx`;
      if (Object.hasOwn(summary.statusClasses, statusClass)) summary.statusClasses[statusClass] += 1;
      if (typeof row.timestamp === "string" && (!summary.lastRequestAt || row.timestamp > summary.lastRequestAt)) summary.lastRequestAt = row.timestamp;
    } catch {}
  }
  summary.durationSeconds = Number(summary.durationSeconds.toFixed(3));
  return summary;
}

export function metricLogPath(config, site) {
  return path.join(config.metricsRoot, `traffic-${nginxValue(site.siteId)}-${nginxValue(site.nodeId)}.log`);
}

export function validateCertificate({ certificatePath, keyPath, hosts, currentCertificatePath }) {
  const certificate = new X509Certificate(fs.readFileSync(certificatePath));
  const privateKey = createPrivateKey(fs.readFileSync(keyPath));
  const now = Date.now();
  const notBefore = Date.parse(certificate.validFrom);
  const notAfter = Date.parse(certificate.validTo);
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || now < notBefore || now >= notAfter) {
    throw new Error("Certificate is not currently valid");
  }
  if (notAfter - now < 7 * 24 * 60 * 60 * 1000) throw new Error("Certificate expires in less than seven days");
  if (currentCertificatePath && fs.existsSync(currentCertificatePath)) {
    const current = new X509Certificate(fs.readFileSync(currentCertificatePath));
    const currentNotAfter = Date.parse(current.validTo);
    if (Number.isFinite(currentNotAfter) && notAfter <= currentNotAfter && certificate.fingerprint256 !== current.fingerprint256) {
      throw new Error("Candidate certificate does not expire later than the installed certificate");
    }
  }
  for (const host of hosts) {
    if (!certificate.checkHost(host)) throw new Error(`Certificate does not cover ${host}`);
  }
  const certificatePublicKey = certificate.publicKey.export({ type: "spki", format: "der" });
  const derivedPublicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  if (!certificatePublicKey.equals(derivedPublicKey)) throw new Error("Certificate and private key do not match");
  return {
    ok: true,
    subject: certificate.subject,
    issuer: certificate.issuer,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    fingerprint256: certificate.fingerprint256,
    hosts,
  };
}

function validateSite(site, index) {
  if (!site || typeof site !== "object" || Array.isArray(site)) throw new Error(`Invalid site at index ${index}`);
  for (const field of ["siteId", "nodeId", "asciiDomain", "originUrl", "status"]) {
    if (!String(site[field] || "").trim()) throw new Error(`Site ${index} is missing ${field}`);
  }
  const asciiDomain = normalizeApexDomain(site.asciiDomain);
  const origin = new URL(site.originUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(`Site ${asciiDomain} originUrl must be an HTTPS origin root`);
  }
  if (!net.isIP(origin.hostname) || !isPrivateOriginAddress(origin.hostname)) {
    throw new Error(`Site ${asciiDomain} origin must use a private WireGuard address`);
  }
  const statusValues = new Set(["pending", "active", "offline", "disabled", "revoked"]);
  if (!statusValues.has(site.status)) throw new Error(`Invalid status for ${asciiDomain}`);
  const certificateMode = site.certificateMode || "http-san";
  if (!["http-san", "dns-wildcard"].includes(certificateMode)) throw new Error(`Invalid certificate mode for ${asciiDomain}`);
  const originServerName = String(site.originServerName || defaultOriginServerName(site.nodeId)).trim();
  if (!/^[a-z0-9.-]+$/i.test(originServerName)) throw new Error(`Invalid originServerName for ${asciiDomain}`);
  const wireGuardPublicKey = String(site.wireGuardPublicKey || "").trim();
  if (wireGuardPublicKey && !/^[A-Za-z0-9+/]{43}=$/.test(wireGuardPublicKey)) throw new Error(`Invalid WireGuard public key for ${asciiDomain}`);
  if (site.status === "active" && !wireGuardPublicKey) throw new Error(`Active Site ${asciiDomain} is missing its WireGuard public key`);
  return { ...site, asciiDomain, certificateMode, originServerName, wireGuardPublicKey };
}

function registrationIdentity({ siteId, nodeId, domain, asciiDomain }) {
  const value = {
    siteId: String(siteId || "").trim(),
    nodeId: String(nodeId || "").trim(),
    asciiDomain: normalizeApexDomain(domain || asciiDomain),
  };
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(value.siteId)) throw new Error("Invalid Site identity");
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(value.nodeId)) throw new Error("Invalid Node identity");
  return value;
}

function matchingSite(sites, identity) {
  const bySite = sites.find((site) => site.siteId === identity.siteId);
  const byNode = sites.find((site) => site.nodeId === identity.nodeId);
  const byDomain = sites.find((site) => site.asciiDomain === identity.asciiDomain);
  const matches = [bySite, byNode, byDomain].filter(Boolean);
  if (!matches.length) return null;
  const first = matches[0];
  if (matches.some((site) => site !== first)
    || first.siteId !== identity.siteId
    || first.nodeId !== identity.nodeId
    || first.asciiDomain !== identity.asciiDomain) {
    throw new Error("Edge Site identity conflicts with an existing domain, Site, or Node");
  }
  return first;
}

function withRegistryLock(sitesFile, callback) {
  const lockPath = `${sitesFile}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o750 });
  let handle;
  try {
    handle = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age <= 10 * 60 * 1000) throw new Error("Another Edge Site registry update is in progress");
    fs.rmSync(lockPath, { force: true });
    handle = fs.openSync(lockPath, "wx", 0o600);
  }
  try {
    return callback();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}

function defaultOriginServerName(nodeId) {
  const label = String(nodeId).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  if (!label) throw new Error("nodeId cannot produce an origin TLS name");
  return `${label}.origin.private-site`;
}

export function normalizeApexDomain(value) {
  const input = String(value || "").trim().replace(/\.$/, "");
  const ascii = domainToASCII(input).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.includes(".") || ascii.includes("*")) throw new Error(`Invalid apex domain: ${input || "empty"}`);
  for (const label of ascii.split(".")) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error(`Invalid apex domain label: ${label}`);
  }
  return ascii;
}

function isPrivateOriginAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd");
}

function certificateCheck(filePath, keyPath, hosts, enabled) {
  if (!enabled) return { ok: true, skipped: true, path: filePath };
  if (!fs.existsSync(filePath) || !fs.existsSync(keyPath)) return { ok: false, path: filePath, error: "missing" };
  try {
    const result = validateCertificate({ certificatePath: filePath, keyPath, hosts });
    return { ok: true, path: filePath, validTo: result.validTo, fingerprint256: result.fingerprint256 };
  } catch (error) {
    return { ok: false, path: filePath, error: error.message };
  }
}

function nginxQuote(value) {
  if (/\s|[;{}]/.test(value)) throw new Error(`Unsafe Nginx path: ${value}`);
  return value.replaceAll("\\", "/");
}

function nginxValue(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw new Error(`Unsafe Nginx value: ${text || "empty"}`);
  return text;
}

function writeAtomic(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, mode); } catch {}
}

function writeJsonAtomic(filePath, value, mode) {
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function positiveInteger(value, fallback, label) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1 || number > 1_000_000) throw new Error(`Invalid ${label}`);
  return number;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
