import fs from "node:fs";
import path from "node:path";

export const FINAL_REPLY_MAX_FILE_BYTES = 50 * 1024 * 1024;

const FILE_TYPES = {
  pdf: { mimeTypes: ["application/pdf"], extensions: [".pdf"] },
  docx: { mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], extensions: [".docx"] },
  xlsx: { mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], extensions: [".xlsx"] },
  pptx: { mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], extensions: [".pptx"] },
  zip: { mimeTypes: ["application/zip", "application/x-zip-compressed"], extensions: [".zip"] },
  text: { mimeTypes: ["text/plain"], extensions: [".txt"] },
  markdown: { mimeTypes: ["text/markdown", "text/x-markdown"], extensions: [".md", ".markdown"] },
  mp3: { mimeTypes: ["audio/mpeg"], extensions: [".mp3"] },
  wav: { mimeTypes: ["audio/wav", "audio/x-wav"], extensions: [".wav"] },
  ogg: { mimeTypes: ["audio/ogg", "video/ogg"], extensions: [".ogg", ".oga", ".ogv"] },
  isoMedia: { mimeTypes: ["audio/mp4", "video/mp4", "video/quicktime"], extensions: [".m4a", ".mp4", ".mov"] },
  webm: { mimeTypes: ["audio/webm", "video/webm"], extensions: [".webm"] },
};

const DANGEROUS_EXTENSIONS = new Set([
  ".app", ".apk", ".bat", ".bin", ".cmd", ".com", ".cpl", ".dll", ".dmg", ".exe", ".hta", ".iso", ".jar", ".js", ".jse", ".lnk", ".mjs", ".msi", ".pif", ".ps1", ".reg", ".scr", ".sh", ".url", ".vb", ".vbe", ".vbs", ".wsf",
  ".env", ".key", ".kdbx", ".log", ".mdb", ".pem", ".pfx", ".p12", ".sqlite", ".sqlite3", ".db",
]);
const SENSITIVE_NAME_PATTERN = /(?:^|[._\-\s])(credential|credentials|password|passwd|private[-_ ]?key|secret|secrets|token|tokens|cookie|cookies|session|auth)(?:[._\-\s]|$)/i;
const ZIP_DANGEROUS_PATH_PATTERN = /(?:^|\/)(?:\.env|id_rsa|id_ed25519|credentials?|secrets?)(?:$|[.\/])/i;

export async function inspectSendableFile({ filePath, declaredMime, originalName }) {
  const mimeType = normalizeMime(declaredMime);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > FINAL_REPLY_MAX_FILE_BYTES) {
    throw filePolicyError("FINAL_REPLY_FILE_SIZE", "managed attachment exceeds the file size policy");
  }
  assertSafeSourceName(originalName);
  const head = await readRange(filePath, 0, Math.min(stat.size, 65_536));
  let detected = detectSimpleMagic(head);
  let zipEntries = [];
  if (detected === "zip") {
    zipEntries = await readZipEntryNames(filePath, stat.size);
    detected = detectZipKind(zipEntries);
    assertSafeZipEntries(zipEntries, detected);
  }
  if (detected === "text" && FILE_TYPES.markdown.mimeTypes.includes(mimeType)) detected = "markdown";
  const spec = FILE_TYPES[detected];
  if (!spec || !spec.mimeTypes.includes(mimeType)) {
    throw filePolicyError("FINAL_REPLY_FILE_MIME_MISMATCH", "managed attachment content does not match its MIME type");
  }
  const originalExtension = path.extname(String(originalName || "")).toLowerCase();
  if (!spec.extensions.includes(originalExtension)) {
    throw filePolicyError("FINAL_REPLY_FILE_EXTENSION_MISMATCH", "managed attachment name does not match its verified type");
  }
  if ((detected === "text" || detected === "markdown") && looksLikeExecutableScript(head)) {
    throw filePolicyError("FINAL_REPLY_FILE_SCRIPT", "script content is not sendable as a reply attachment");
  }
  return { mimeType, detectedType: detected, extensions: spec.extensions };
}

export function safeAttachmentName({ originalName, displayName = "", extensions, fallback = "attachment" }) {
  assertSafeSourceName(originalName);
  const originalExtension = path.extname(String(originalName || "")).toLowerCase();
  const requested = String(displayName || "").trim();
  if (requested) assertSafeSourceName(requested);
  let cleaned = sanitizeFileName(requested || originalName || `${fallback}${extensions[0] || ""}`);
  let extension = path.extname(cleaned).toLowerCase();
  if (!extension && originalExtension) {
    cleaned = `${cleaned}${originalExtension}`;
    extension = originalExtension;
  }
  if (!extensions.includes(extension)) {
    throw filePolicyError("FINAL_REPLY_DISPLAY_NAME_EXTENSION", "attachment displayName must preserve the verified file type");
  }
  const stemLimit = Math.max(1, 180 - extension.length);
  const stem = cleaned.slice(0, -extension.length).slice(0, stemLimit).replace(/[. ]+$/g, "") || fallback;
  return `${stem}${extension}`;
}

function detectSimpleMagic(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 4 && [0x04034b50, 0x06054b50, 0x08074b50].includes(buffer.readUInt32LE(0))) return "zip";
  if ((buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "mp3";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "isoMedia";
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  if (isUtf8Text(buffer)) return "text";
  return "unknown";
}

function detectZipKind(entries) {
  const normalized = new Set(entries.map((entry) => entry.toLowerCase()));
  if (normalized.has("[content_types].xml")) {
    if ([...normalized].some((entry) => entry.startsWith("word/"))) return "docx";
    if ([...normalized].some((entry) => entry.startsWith("xl/"))) return "xlsx";
    if ([...normalized].some((entry) => entry.startsWith("ppt/"))) return "pptx";
  }
  return "zip";
}

async function readZipEntryNames(filePath, fileSize) {
  const tailLength = Math.min(fileSize, 65_557);
  const tail = await readRange(filePath, fileSize - tailLength, tailLength);
  let eocd = -1;
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw filePolicyError("FINAL_REPLY_FILE_ZIP_INVALID", "ZIP central directory is missing");
  const entryCount = tail.readUInt16LE(eocd + 10);
  const centralSize = tail.readUInt32LE(eocd + 12);
  const centralOffset = tail.readUInt32LE(eocd + 16);
  if (entryCount > 10_000 || centralSize > 8 * 1024 * 1024 || centralOffset + centralSize > fileSize) {
    throw filePolicyError("FINAL_REPLY_FILE_ZIP_LIMIT", "ZIP directory exceeds the attachment policy");
  }
  const directory = await readRange(filePath, centralOffset, centralSize);
  const names = [];
  let offset = 0;
  while (offset < directory.length && names.length < entryCount) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
      throw filePolicyError("FINAL_REPLY_FILE_ZIP_INVALID", "ZIP central directory is invalid");
    }
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > directory.length) throw filePolicyError("FINAL_REPLY_FILE_ZIP_INVALID", "ZIP entry is truncated");
    names.push(directory.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/\\/g, "/"));
    offset = end;
  }
  if (names.length !== entryCount || offset !== directory.length) throw filePolicyError("FINAL_REPLY_FILE_ZIP_INVALID", "ZIP entry count is inconsistent");
  return names;
}

function assertSafeZipEntries(entries, detectedType) {
  for (const entry of entries) {
    if (!entry || entry.startsWith("/") || /^[A-Za-z]:\//.test(entry) || entry.split("/").some((segment) => segment === "..")) {
      throw filePolicyError("FINAL_REPLY_FILE_ZIP_PATH", "ZIP contains an unsafe path");
    }
    const lower = entry.toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(path.posix.extname(lower)) || ZIP_DANGEROUS_PATH_PATTERN.test(lower)) {
      throw filePolicyError("FINAL_REPLY_FILE_ZIP_UNSAFE", "ZIP contains a prohibited file type");
    }
    if (detectedType !== "zip" && (lower.includes("vbaproject.bin") || lower.includes("/embeddings/"))) {
      throw filePolicyError("FINAL_REPLY_FILE_OFFICE_ACTIVE_CONTENT", "Office attachment contains active or embedded content");
    }
  }
}

function assertSafeSourceName(value) {
  const name = String(value || "").normalize("NFC");
  if (!name || name.length > 500 || /[\u0000-\u001f\u007f]/.test(name)) throw filePolicyError("FINAL_REPLY_FILE_NAME", "attachment name is invalid");
  const base = name.replace(/\\/g, "/").split("/").pop() || "";
  const extension = path.extname(base).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(extension) || SENSITIVE_NAME_PATTERN.test(base)) {
    throw filePolicyError("FINAL_REPLY_FILE_NAME_UNSAFE", "attachment name indicates a prohibited file type");
  }
}

function sanitizeFileName(value) {
  const base = String(value || "attachment").normalize("NFC").replace(/\\/g, "/").split("/").pop() || "attachment";
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "attachment";
}

function looksLikeExecutableScript(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").slice(0, 8_192);
  return /^\s*#!\s*\//.test(text) || /^\s*@echo\s+off\b/i.test(text) || /^\s*(?:set-strictmode\b|param\s*\()/i.test(text);
}

function isUtf8Text(buffer) {
  if (!buffer.length || buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    let controls = 0;
    for (const byte of buffer) if (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) controls += 1;
    return controls <= Math.max(1, Math.floor(buffer.length / 1_000));
  } catch { return false; }
}

async function readRange(filePath, start, length) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

function normalizeMime(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function filePolicyError(code, message) {
  return Object.assign(new Error(message), { code });
}
