import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { config } from "../config.js";
import { sha256Buffer } from "../managed-files/service.js";
import { assertInside, nextAvailablePath, sanitizeFileName, todayPathSegment, toPublicUrl } from "./path-utils.js";

const TEXT_ENCODINGS = new Set(["utf8", "utf-8", "text", "plain"]);
const BINARY_ENCODINGS = new Set(["base64"]);
let managedStorage = { catalog: null, remote: null };

export function configureOnlinePagesStorage({ catalog = null, remote = null } = {}) {
  managedStorage = { catalog, remote };
}

export async function uploadStaticAsset(input) {
  const fileName = sanitizeFileName(input.fileName);
  const encoding = String(input.encoding || "utf8").toLowerCase();
  const content = String(input.content ?? "");
  const folder = sanitizeFolder(input.folder || todayPathSegment());
  const overwrite = Boolean(input.overwrite);

  let buffer;
  if (TEXT_ENCODINGS.has(encoding)) buffer = Buffer.from(content, "utf8");
  else if (BINARY_ENCODINGS.has(encoding)) buffer = Buffer.from(content, "base64");
  else throw new Error("encoding must be utf8 or base64");

  if (buffer.byteLength > config.maxUploadBytes) {
    throw new Error(`upload exceeds ${config.maxUploadBytes} bytes`);
  }

  const targetDir = path.join(config.uploadsDir, folder);
  const initialTargetPath = path.join(targetDir, fileName);
  assertInside(config.uploadsDir, initialTargetPath);

  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = await nextAvailablePath(initialTargetPath, overwrite);
  const uploadRelativePath = path.relative(config.uploadsDir, targetPath);
  const publicRelativePath = path.join("uploads", uploadRelativePath);
  const normalizedPublicPath = publicRelativePath.split(path.sep).join("/");
  const contentType = input.mimeType || mime.lookup(targetPath) || "application/octet-stream";
  const sha256 = sha256Buffer(buffer);
  const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, buffer, { flag: "wx" });

  let remoteResult = null;
  try {
    if (managedStorage.remote?.configured?.("public")) {
      remoteResult = await managedStorage.remote.put({
        visibility: "public",
        relativePath: normalizedPublicPath,
        body: buffer,
        contentType,
        sha256,
        cacheControl: normalizedPublicPath === "uploads/releases/index.html"
          ? "no-cache, no-store, must-revalidate"
          : "public, max-age=31536000, immutable",
      });
      if (remoteResult.sizeBytes !== buffer.byteLength || remoteResult.sha256 !== sha256) {
        throw new Error("local managed storage read-back metadata differs from the uploaded file");
      }
    } else if (process.env.NODE_ENV === "production" && process.env.OPEN_AGENT_BRIDGE_ALLOW_LOCAL_ONLY_MANAGED_FILES !== "1") {
      throw new Error("local managed storage is not configured");
    }

    if (overwrite) await fs.rm(targetPath, { force: true });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  let managedObject = null;
  if (managedStorage.catalog) {
    const settings = managedStorage.remote?.settings?.("public") || {};
    const uploadedAt = new Date().toISOString();
    managedObject = managedStorage.catalog.upsertObject({
      visibility: "public",
      source: "pages",
      bucket: remoteResult?.bucket || settings.bucket || "local-only",
      region: remoteResult?.region || settings.region || "",
      objectKey: remoteResult?.objectKey || normalizedPublicPath,
      relativePath: normalizedPublicPath,
      originalName: path.basename(targetPath),
      contentType,
      sizeBytes: buffer.byteLength,
      sha256,
      crc64: remoteResult?.crc64 || "",
      versionId: remoteResult?.versionId || "",
      status: remoteResult ? "ready" : "pending-upload",
      uploadedAt,
      remoteVerifiedAt: remoteResult?.verifiedAt || null,
      metadata: { publicPath: `/${normalizedPublicPath}` },
    });
    managedObject = managedStorage.catalog.recordLocalCopy(managedObject.id, {
      localPath: targetPath,
      tier: "hot",
      sha256,
      sizeBytes: buffer.byteLength,
      verifiedAt: uploadedAt,
    });
  }

  return {
    fileName: path.basename(targetPath),
    bytes: buffer.byteLength,
    mimeType: contentType,
    publicPath: `/${normalizedPublicPath}`,
    url: toPublicUrl(config.pagesBaseUrl, publicRelativePath),
    objectId: managedObject?.id || "",
    tier: "hot",
    localPath: targetPath,
    durable: Boolean(remoteResult),
    storageUrl: remoteResult?.publicUrl || "",
  };
}

export async function listUploadedAssets(limit = 50) {
  if (managedStorage.catalog) {
    const objects = managedStorage.catalog.search({ source: "pages", limit });
    if (objects.length) return objects.map((object) => ({
      objectId: object.id,
      fileName: object.originalName,
      bytes: object.sizeBytes,
      updatedAt: object.uploadedAt,
      publicPath: `/${object.relativePath}`,
      url: toPublicUrl(config.pagesBaseUrl, object.relativePath),
      tier: object.localCopies.find((copy) => copy.tier !== "shadow")?.tier || "cold",
      localPath: object.localCopies.find((copy) => copy.tier !== "shadow")?.localPath || "",
    }));
  }
  const files = [];
  await walkUploads(config.uploadsDir, files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, limit).map((file) => {
    const uploadRelativePath = path.relative(config.uploadsDir, file.path);
    const publicRelativePath = path.join("uploads", uploadRelativePath);
    return {
      fileName: path.basename(file.path),
      bytes: file.size,
      updatedAt: new Date(file.mtimeMs).toISOString(),
      publicPath: `/${publicRelativePath.split(path.sep).join("/")}`,
      url: toPublicUrl(config.pagesBaseUrl, publicRelativePath),
    };
  });
}

function sanitizeFolder(folder) {
  const segments = String(folder)
    .split("/")
    .map((segment) => sanitizeFileName(segment))
    .filter(Boolean);
  if (segments.length === 0 || segments.length > 4) {
    throw new Error("folder must contain 1 to 4 path segments");
  }
  return path.join(...segments);
}

async function walkUploads(dir, files) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkUploads(fullPath, files);
    else if (entry.isFile() && entry.name !== ".gitkeep") {
      const stat = await fs.stat(fullPath);
      files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
}
