import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { config } from "../config.js";
import { sha256Buffer } from "../managed-files/service.js";
import { assertInside, nextAvailablePath, sanitizeFileName, todayPathSegment, toPublicUrl } from "./path-utils.js";
import { decodePageThumbnail, pageProperties } from "./page-thumbnail.js";

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

  const url = internalPublicUrl(normalizedPublicPath);
  const shareUrl = toPublicUrl(externalPagesBaseUrl(), publicRelativePath);
  return {
    fileName: path.basename(targetPath),
    bytes: buffer.byteLength,
    mimeType: contentType,
    publicPath: `/${normalizedPublicPath}`,
    url,
    shareUrl,
    linkNotice: shareUrl ? "" : publicLinkNotice(),
    objectId: managedObject?.id || "",
    tier: "hot",
    localPath: targetPath,
    durable: Boolean(remoteResult),
    storageUrl: remoteResult?.publicUrl || "",
  };
}

export async function publishHtmlPage(input) {
  const fileName = sanitizeFileName(input.fileName || "index.html");
  if (!/\.html?$/i.test(fileName)) throw new Error("pages publish requires an HTML entry file");
  if (!input.folder) throw new Error("pages publish requires a stable folder");
  const folder = sanitizeFolder(input.folder);
  const desktopThumbnail = decodePageThumbnail(input.desktopThumbnail, { maxBytes: config.maxUploadBytes, variant: "desktop" });
  const mobileThumbnail = decodePageThumbnail(input.mobileThumbnail, { maxBytes: config.maxUploadBytes, variant: "mobile" });
  if (desktopThumbnail.buffer.equals(mobileThumbnail.buffer)) throw new Error("desktop and mobile Page thumbnails must be different screenshots");
  const properties = pageProperties(input, desktopThumbnail, mobileThumbnail);
  const desktopThumbnailAsset = await uploadStaticAsset({
    fileName: desktopThumbnail.fileName,
    content: desktopThumbnail.buffer.toString("base64"),
    encoding: "base64",
    folder,
    mimeType: desktopThumbnail.mimeType,
    overwrite: true,
  });
  const mobileThumbnailAsset = await uploadStaticAsset({
    fileName: mobileThumbnail.fileName,
    content: mobileThumbnail.buffer.toString("base64"),
    encoding: "base64",
    folder,
    mimeType: mobileThumbnail.mimeType,
    overwrite: true,
  });
  const asset = await uploadStaticAsset({ ...input, fileName, folder, desktopThumbnail: undefined, mobileThumbnail: undefined });
  const updatedAt = new Date().toISOString();
  const desktopMetadata = pageThumbnailMetadata(desktopThumbnailAsset, desktopThumbnail, properties.desktopThumbnailAlt);
  const mobileMetadata = pageThumbnailMetadata(mobileThumbnailAsset, mobileThumbnail, properties.mobileThumbnailAlt);
  const manifest = {
    schemaVersion: 1,
    pageId: publicPageId(folder),
    title: properties.title,
    summary: properties.summary,
    entryFile: asset.fileName,
    visibility: "public",
    thumbnail: desktopMetadata,
    thumbnails: { desktop: desktopMetadata, mobile: mobileMetadata },
    updatedAt,
  };
  await writePageManifest(folder, manifest);
  return {
    ...asset,
    pageId: manifest.pageId,
    page: manifest,
    thumbnailUrl: pageThumbnailUrl(manifest, "desktop"),
    desktopThumbnailUrl: pageThumbnailUrl(manifest, "desktop"),
    mobileThumbnailUrl: pageThumbnailUrl(manifest, "mobile"),
  };
}

export async function listUploadedAssets(limit = 50) {
  if (managedStorage.catalog) {
    const objects = managedStorage.catalog.search({ source: "pages", limit });
    if (objects.length) return Promise.all(objects.map(async (object) => {
      const url = internalPublicUrl(object.relativePath);
      const shareUrl = toPublicUrl(externalPagesBaseUrl(), object.relativePath);
      return enrichPageAsset({
      objectId: object.id,
      fileName: object.originalName,
      bytes: object.sizeBytes,
      updatedAt: object.uploadedAt,
      publicPath: `/${object.relativePath}`,
      url,
      shareUrl,
      linkNotice: shareUrl ? "" : publicLinkNotice(),
      tier: object.localCopies.find((copy) => copy.tier !== "shadow")?.tier || "cold",
      localPath: object.localCopies.find((copy) => copy.tier !== "shadow")?.localPath || "",
      });
    }));
  }
  const files = [];
  await walkUploads(config.uploadsDir, files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return Promise.all(files.slice(0, limit).map(async (file) => {
    const uploadRelativePath = path.relative(config.uploadsDir, file.path);
    const publicRelativePath = path.join("uploads", uploadRelativePath);
    const normalizedPublicPath = publicRelativePath.split(path.sep).join("/");
    const url = internalPublicUrl(normalizedPublicPath);
    const shareUrl = toPublicUrl(externalPagesBaseUrl(), publicRelativePath);
    return enrichPageAsset({
      fileName: path.basename(file.path),
      bytes: file.size,
      updatedAt: new Date(file.mtimeMs).toISOString(),
      publicPath: `/${normalizedPublicPath}`,
      url,
      shareUrl,
      linkNotice: shareUrl ? "" : publicLinkNotice(),
    });
  }));
}

async function enrichPageAsset(asset) {
  if (!/\.html?$/i.test(String(asset.fileName || ""))) return asset;
  const manifest = await readPageManifest(asset.publicPath);
  if (!manifest || manifest.entryFile !== asset.fileName) return asset;
  return {
    ...asset,
    pageId: manifest.pageId,
    page: manifest,
    thumbnailUrl: pageThumbnailUrl(manifest, "desktop"),
    desktopThumbnailUrl: pageThumbnailUrl(manifest, "desktop"),
    mobileThumbnailUrl: pageThumbnailUrl(manifest, "mobile"),
  };
}

async function writePageManifest(folder, manifest) {
  const directory = path.join(config.uploadsDir, folder);
  const target = path.join(directory, ".page.json");
  assertInside(config.uploadsDir, target);
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, target);
}

async function readPageManifest(publicPath) {
  const relative = String(publicPath || "").replace(/^\/+/, "").replace(/^uploads\//, "");
  const target = path.join(config.uploadsDir, path.dirname(relative), ".page.json");
  assertInside(config.uploadsDir, target);
  try {
    const manifest = JSON.parse(await fs.readFile(target, "utf8"));
    return manifest?.schemaVersion === 1 ? manifest : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function pageThumbnailUrl(manifest, variant = "desktop") {
  const metadata = manifest?.thumbnails?.[variant] || (variant === "desktop" ? manifest?.thumbnail : null);
  const publicPath = String(metadata?.publicPath || "");
  if (!publicPath.startsWith("/uploads/")) return "";
  return `/public${publicPath}`;
}

function pageThumbnailMetadata(asset, thumbnail, alt) {
  return {
    fileName: asset.fileName,
    publicPath: asset.publicPath,
    mimeType: thumbnail.mimeType,
    width: thumbnail.width,
    height: thumbnail.height,
    alt,
    sha256: sha256Buffer(thumbnail.buffer),
  };
}

function publicPageId(folder) {
  return `public-${String(folder).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function externalPagesBaseUrl() {
  const access = config.externalAccess?.();
  return access?.ready && access.origin ? `${access.origin}/public` : "";
}

function internalPublicUrl(publicPath) {
  const normalized = String(publicPath || "").replace(/^\/+/, "");
  return normalized ? `/public/${normalized}` : "";
}

function publicLinkNotice() {
  const reason = config.externalAccess?.()?.reason;
  return reason === "tunnel-offline"
    ? "远程连接暂时离线，页面链接暂不支持查看。"
    : "当前未配置远程访问，页面链接暂不支持查看。";
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
    else if (entry.isFile() && !entry.name.startsWith(".")) {
      const stat = await fs.stat(fullPath);
      files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
}
