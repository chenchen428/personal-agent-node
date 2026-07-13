import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256File } from "../managed-files/service.js";

let managedFileCatalog = null;

export function configurePrivateManagedFiles({ catalog = null } = {}) {
  managedFileCatalog = catalog;
}

export function privateStorageConfigured() {
  return true;
}

export async function uploadPrivateAttachment({ filePath, relativePath, contentType }) {
  const target = resolvePrivatePath(relativePath);
  if (path.resolve(filePath) !== target) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(filePath, target);
  }
  const sha256 = await sha256File(target);
  const sizeBytes = fs.statSync(target).size;
  const storedAt = new Date().toISOString();
  let objectId = "";
  if (managedFileCatalog) {
    let object = managedFileCatalog.upsertObject({
      visibility: "private",
      source: "wechat",
      bucket: "local-disk",
      region: "local",
      objectKey: normalizeRelative(relativePath),
      relativePath: normalizeRelative(relativePath),
      originalName: path.basename(target),
      contentType: String(contentType || "application/octet-stream"),
      sizeBytes,
      sha256,
      status: "ready",
      uploadedAt: storedAt,
      remoteVerifiedAt: storedAt,
    });
    object = managedFileCatalog.recordLocalCopy(object.id, { localPath: target, tier: "hot", sha256, sizeBytes, verifiedAt: storedAt });
    objectId = object.id;
  }
  return { uploaded: true, stored: true, storage: "local-disk", objectKey: normalizeRelative(relativePath), objectId, sha256, sizeBytes };
}

export function signPrivateAttachmentUrl(relativePath, expiresSeconds = 3600) {
  const target = resolvePrivatePath(relativePath);
  if (!fs.existsSync(target)) throw Object.assign(new Error("private file not found"), { code: "ENOENT" });
  const expires = Math.min(Math.max(Number(expiresSeconds) || 3600, 60), 86400);
  const baseUrl = String(process.env.OPEN_AGENT_BRIDGE_CONSOLE_BASE_URL || "").replace(/\/+$/, "");
  const encoded = normalizeRelative(relativePath).split("/").map(encodeURIComponent).join("/");
  return { url: `${baseUrl}/private-files/raw/${encoded}`, expires, expiresAt: new Date(Date.now() + expires * 1000).toISOString() };
}

export async function headPrivateAttachment(relativePath) {
  const target = resolvePrivatePath(relativePath);
  if (!fs.existsSync(target)) return null;
  const stat = fs.statSync(target);
  return { res: { headers: { "content-length": String(stat.size) } }, sha256: await sha256File(target) };
}

export async function readPrivateAttachment(relativePath, maxBytes = 512 * 1024) {
  const target = resolvePrivatePath(relativePath);
  if (!fs.existsSync(target) || fs.statSync(target).size > maxBytes) return null;
  return fs.readFileSync(target);
}

export async function deletePrivateAttachment(relativePath) {
  const target = resolvePrivatePath(relativePath);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target);
  return true;
}

export async function verifyPrivateStorageAccess() {
  const relativePath = `_health/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.txt`;
  const target = resolvePrivatePath(relativePath);
  const marker = Buffer.from(`private-site-local-${crypto.randomBytes(16).toString("hex")}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(target, marker, { mode: 0o600 });
    if (!fs.readFileSync(target).equals(marker)) throw new Error("local private storage read-back differs");
    return { ok: true, storage: "local-disk", write: true, read: true, cleanup: true };
  } finally {
    fs.rmSync(target, { force: true });
  }
}

function resolvePrivatePath(relativePath) {
  const root = path.resolve(process.env.WECHAT_INBOUND_ATTACHMENTS_DIR || path.join(process.cwd(), ".local", "files"));
  const target = path.resolve(root, normalizeRelative(relativePath));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("private file path escapes local storage");
  return target;
}

function normalizeRelative(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid private file path");
  return normalized;
}
