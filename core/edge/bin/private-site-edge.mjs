#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { certificateRows, loadEdgeConfig, metricLogPath, planSiteRegistration, planSiteReplacement, readMetricSummary, readSites, renderEdge, replaceSite, updateSiteStatus, upsertSite, validateCertificate, verifyEdge } from "../src/edge.ts";

const [command = "status", ...args] = process.argv.slice(2);
const config = loadEdgeConfig();

if (command === "render") {
  print(renderEdge({ config }));
} else if (command === "verify") {
  const result = verifyEdge({ config, checkFiles: !args.includes("--no-files") });
  print(result);
  if (!result.ok) process.exitCode = 1;
} else if (command === "status") {
  const siteRecords = readSites(config).sites;
  const sites = siteRecords.map((site) => ({
    siteId: site.siteId,
    nodeId: site.nodeId,
    domain: site.asciiDomain,
    status: site.status,
    originUrl: site.originUrl,
    certificateMode: site.certificateMode,
    certificate: certificateStatus(path.join(config.certificateRoot, site.asciiDomain, "fullchain.cer")),
  }));
  const metrics = Object.fromEntries(siteRecords.map((site) => [site.siteId, readMetricSummary(metricLogPath(config, site))]));
  print({ ok: true, generatedAt: new Date().toISOString(), sites, metrics });
} else if (command === "certificates") {
  for (const row of certificateRows(config)) process.stdout.write(`${row.domain}\t${row.mode}\t${row.hosts.join(",")}\n`);
} else if (command === "certificate") {
  const domain = args[0];
  const row = certificateRows(config).find((candidate) => candidate.domain === domain);
  if (!row) throw new Error(`Unknown active Site domain: ${domain || "missing"}`);
  print(row);
} else if (command === "site-status") {
  const [domain, status] = args;
  if (!domain || !status) throw new Error("site-status requires DOMAIN STATUS");
  print(updateSiteStatus({ config, domain, status }));
} else if (command === "site-plan") {
  const [siteId, nodeId, domain] = args;
  if (!siteId || !nodeId || !domain) throw new Error("site-plan requires SITE_ID NODE_ID DOMAIN");
  print(planSiteRegistration({ config, siteId, nodeId, domain }));
} else if (command === "site-upsert") {
  const [inputPath] = args;
  if (!inputPath) throw new Error("site-upsert requires a JSON file");
  print(upsertSite({ config, site: JSON.parse(fs.readFileSync(inputPath, "utf8")) }));
} else if (command === "site-replacement-plan") {
  const [siteId, nodeId, domain, previousNodeId] = args;
  if (!siteId || !nodeId || !domain || !previousNodeId) throw new Error("site-replacement-plan requires SITE_ID NODE_ID DOMAIN PREVIOUS_NODE_ID");
  print(planSiteReplacement({ config, siteId, nodeId, domain, previousNodeId }));
} else if (command === "site-replace") {
  const [previousNodeId, inputPath] = args;
  if (!previousNodeId || !inputPath) throw new Error("site-replace requires PREVIOUS_NODE_ID JSON_FILE");
  print(replaceSite({ config, previousNodeId, site: JSON.parse(fs.readFileSync(inputPath, "utf8")) }));
} else if (command === "validate-certificate") {
  const [domain, certificatePath, keyPath, currentCertificatePath] = args;
  const row = certificateRows(config).find((candidate) => candidate.domain === domain);
  if (!row) throw new Error(`Unknown active Site domain: ${domain || "missing"}`);
  if (!certificatePath || !keyPath) throw new Error("validate-certificate requires DOMAIN CERTIFICATE KEY");
  print(validateCertificate({ certificatePath, keyPath, hosts: row.hosts, currentCertificatePath }));
} else if (["help", "--help", "-h"].includes(command)) {
  process.stdout.write("Usage: private-site-edge <render|verify|status|site-plan SITE_ID NODE_ID DOMAIN|site-upsert JSON_FILE|site-replacement-plan SITE_ID NODE_ID DOMAIN PREVIOUS_NODE_ID|site-replace PREVIOUS_NODE_ID JSON_FILE|site-status DOMAIN STATUS|certificates|certificate DOMAIN|validate-certificate DOMAIN CERT KEY [CURRENT_CERT]>\n");
} else {
  throw new Error(`Unknown private-site-edge command: ${command}`);
}

function certificateStatus(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { installed: true, path: filePath, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return { installed: false, path: filePath };
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
