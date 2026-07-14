import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_MAIL_BYTES = 30 * 1024 * 1024;
const DEFAULT_DAILY_ARCHIVE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

export async function ingestRawEmail(raw, {
  dataDir,
  apiBase = "http://127.0.0.1:8788",
  apiToken = "",
  envelopeRecipient = "",
  envelopeSender = "",
  fetchImpl = fetch,
} = {}) {
  const content = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || "");
  if (!content.length) throw new Error("empty email");
  if (content.length > MAX_MAIL_BYTES) throw new Error(`email exceeds ${MAX_MAIL_BYTES} bytes`);
  const root = path.resolve(dataDir || process.cwd());
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const headers = parseHeaders(content);
  const receivedAt = new Date().toISOString();
  const day = receivedAt.slice(0, 10);
  const archiveRoot = path.join(root, "archive");
  const archiveDir = path.join(archiveRoot, day);
  const tempDir = path.join(root, "spool", "tmp");
  pruneMailArchive(archiveRoot, receivedAt, boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_RETENTION_DAYS, 7, 365, DEFAULT_RETENTION_DAYS));
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveDir, 0o700);
  fs.chmodSync(tempDir, 0o700);
  const archivePath = path.join(archiveDir, `${sha256}.eml`);
  if (!fs.existsSync(archivePath)) {
    ensureArchiveCapacity(archiveDir, root, content.length, {
      dailyLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_DAILY_ARCHIVE_BYTES, 64 * 1024 * 1024, 10 * 1024 * 1024 * 1024, DEFAULT_DAILY_ARCHIVE_BYTES),
      minimumFree: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_MIN_FREE_BYTES, 128 * 1024 * 1024, 20 * 1024 * 1024 * 1024, DEFAULT_MIN_FREE_BYTES),
    });
    atomicWrite(content, archivePath, tempDir);
  }
  const recipients = unique([
    envelopeRecipient,
    ...addressList(headers.to || ""),
    ...addressList(headers["delivered-to"] || ""),
    ...addressList(headers["x-original-to"] || ""),
  ].filter(Boolean));
  const senderAddress = envelopeSender || addressList(headers.from || "")[0] || "";
  const payload = {
    sourceId: "src_mail_agent",
    eventType: "message.received",
    title: decodeMimeWords(headers.subject || ""),
    sender: { address: senderAddress, displayName: displayName(headers.from || "") },
    status: "received",
    dedupeKey: `sha256:${sha256}`,
    receivedAt,
    risk: {
      status: "unscanned",
      authenticationResults: headers["authentication-results"] || "",
      spamStatus: headers["x-spam-status"] || headers["x-rspamd-action"] || "",
      spamScore: parseSpamScore(headers["x-spam-score"] || headers["x-rspamd-score"] || ""),
    },
    payload: {
      messageId: headers["message-id"] || "",
      recipients,
      rawPath: archivePath,
      rawSha256: sha256,
      sizeBytes: content.length,
      contentType: headers["content-type"] || "text/plain",
      textPreview: emailPreview(content),
      attachments: attachmentMetadata(content),
    },
  };
  const response = await fetchImpl(`${String(apiBase).replace(/\/+$/, "")}/api/agent-automations/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let result = {};
  try { result = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || result.ok === false) throw new Error(result.error || text || `automation API returned ${response.status}`);
  return { sha256, archivePath, event: result.event, runs: result.runs || [] };
}

export function parseHeaders(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw || "");
  const headerText = text.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[\t ]+/g, " ");
  const headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

function atomicWrite(content, target, tempDir) {
  const temp = path.join(tempDir, `${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const descriptor = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try { fs.renameSync(temp, target); }
  catch (error) {
    fs.rmSync(temp, { force: true });
    if (error?.code !== "EEXIST") throw error;
  }
}

function ensureArchiveCapacity(archiveDir, filesystemRoot, incomingBytes, { dailyLimit, minimumFree }) {
  const usedToday = fs.readdirSync(archiveDir, { withFileTypes: true }).reduce((total, entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".eml")) return total;
    try { return total + fs.statSync(path.join(archiveDir, entry.name)).size; } catch { return total; }
  }, 0);
  if (usedToday + incomingBytes > dailyLimit) throw new Error(`daily mail archive limit ${dailyLimit} bytes exceeded`);
  if (typeof fs.statfsSync === "function") {
    const stats = fs.statfsSync(filesystemRoot);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(available) && available - incomingBytes < minimumFree) throw new Error(`mail archive requires ${minimumFree} bytes free`);
  }
}

function pruneMailArchive(archiveRoot, receivedAt, retentionDays) {
  if (!fs.existsSync(archiveRoot)) return;
  const cutoff = new Date(receivedAt).getTime() - retentionDays * 86_400_000;
  for (const entry of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const timestamp = new Date(`${entry.name}T00:00:00.000Z`).getTime();
    if (Number.isFinite(timestamp) && timestamp < cutoff) fs.rmSync(path.join(archiveRoot, entry.name), { recursive: true, force: true });
  }
}

function emailPreview(content) {
  const text = content.toString("utf8");
  const body = text.split(/\r?\n\r?\n/).slice(1).join("\n\n");
  return body
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:Content-Type|Content-Disposition|Content-Transfer-Encoding):[^\n]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function attachmentMetadata(content) {
  const text = content.toString("latin1");
  const results = [];
  const pattern = /Content-Disposition:\s*attachment[^\r\n]*(?:\r?\n[\t ][^\r\n]*)*/gi;
  for (const match of text.matchAll(pattern)) {
    const filename = /filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i.exec(match[0])?.[1]?.trim() || "attachment";
    results.push({ name: decodeURIComponentSafe(filename), disposition: "attachment" });
    if (results.length >= 100) break;
  }
  return results;
}

function addressList(value) {
  return [...String(value || "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase());
}

function displayName(value) {
  return decodeMimeWords(String(value || "").replace(/<[^>]+>/g, "").replace(/["']/g, "").trim()).slice(0, 200);
}

function decodeMimeWords(value) {
  return String(value || "").replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) => {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return _; }
  }).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, encoded) => {
    try { return Buffer.from(encoded.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))), "binary").toString("utf8"); } catch { return _; }
  });
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function unique(values) {
  return [...new Set(values)];
}

function parseSpamScore(value) {
  const match = /-?\d+(?:\.\d+)?/.exec(String(value || ""));
  return match ? Number(match[0]) : null;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}
