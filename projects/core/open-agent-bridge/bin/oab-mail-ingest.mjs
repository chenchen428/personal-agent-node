#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestRawEmail } from "../src/automation/mail-ingest.js";

const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), ".personal-agent.local"));
const mailDataDir = path.join(siteDataRoot, "mail-ingress");
loadServiceEnv(process.env.OPEN_AGENT_BRIDGE_MAIL_ENV_FILE || path.join(mailDataDir, "mail-ingest.env"));

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const result = await ingestRawEmail(Buffer.concat(chunks), {
    dataDir: process.env.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR || mailDataDir,
    apiBase: process.env.OPEN_AGENT_BRIDGE_API_BASE || `http://127.0.0.1:${process.env.OPEN_AGENT_BRIDGE_PORT || "8788"}`,
    apiToken: process.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "",
    envelopeRecipient: argument("--recipient"),
    envelopeSender: argument("--sender"),
  });
  process.stdout.write(`${JSON.stringify({ ok: true, eventId: result.event?.id, sha256: result.sha256 })}\n`);
} catch (error) {
  process.stderr.write(`[mail-ingest] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(75);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function loadServiceEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); } catch { return; }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
