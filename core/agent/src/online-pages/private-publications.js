import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decodePageThumbnail, pageProperties } from "./page-thumbnail.js";

export class PrivatePublicationStore {
  constructor({ rootDir, maxUploadBytes = 20 * 1024 * 1024 } = {}) {
    this.rootDir = path.resolve(rootDir || process.cwd());
    this.maxUploadBytes = Math.max(Number(maxUploadBytes) || 0, 1);
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.rootDir, 0o700);
  }

  upload({ publicationId, fileName, content, encoding = "utf8", mimeType = "", overwrite = false } = {}) {
    const id = publicationId ? safeSegment(publicationId) : `report-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(5).toString("hex")}`;
    const name = safeFileName(fileName || "index.html");
    const directory = path.join(this.rootDir, id);
    const target = path.join(directory, name);
    if (fs.existsSync(target) && !overwrite) throw new Error("private publication file already exists");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const bytes = encoding === "base64" ? Buffer.from(String(content || ""), "base64") : Buffer.from(String(content || ""), "utf8");
    if (!bytes.length) throw new Error("publication content is required");
    if (bytes.length > this.maxUploadBytes) throw new Error(`publication file exceeds ${this.maxUploadBytes} bytes`);
    const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.renameSync(temp, target);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const manifestPath = path.join(directory, "publication.json");
    const current = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { id, createdAt: new Date().toISOString(), files: [] };
    const entry = { name, mimeType: mimeType || mimeFromName(name), sizeBytes: bytes.length, sha256, updatedAt: new Date().toISOString() };
    current.files = [...current.files.filter((item) => item.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
    current.updatedAt = entry.updatedAt;
    fs.writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    return { ...entry, publicationId: id, url: publicationUrl(id, name) };
  }

  publish(input = {}) {
    const fileName = safeFileName(input.fileName || "index.html");
    if (!/\.html?$/i.test(fileName)) throw new Error("pages publish requires an HTML entry file");
    if (Array.isArray(input.assets) && input.assets.length) throw new Error("Page assets must be uploaded individually and referenced with assetPaths");
    const desktopThumbnail = decodePageThumbnail(resolvePrivateThumbnailInput(this, input.publicationId, input.desktopThumbnail), { variant: "desktop" });
    const mobileThumbnail = decodePageThumbnail(resolvePrivateThumbnailInput(this, input.publicationId, input.mobileThumbnail), { variant: "mobile" });
    if (desktopThumbnail.buffer.equals(mobileThumbnail.buffer)) throw new Error("desktop and mobile Page thumbnails must be distinct images");
    const properties = pageProperties(input, desktopThumbnail, mobileThumbnail);
    const assetPaths = normalizePrivatePageAssetPaths(input.assetPaths);
    const desktopThumbnailAsset = this.upload({
      publicationId: input.publicationId,
      fileName: desktopThumbnail.fileName,
      content: desktopThumbnail.buffer.toString("base64"),
      encoding: "base64",
      mimeType: desktopThumbnail.mimeType,
      overwrite: true,
    });
    const mobileThumbnailAsset = this.upload({
      publicationId: desktopThumbnailAsset.publicationId,
      fileName: mobileThumbnail.fileName,
      content: mobileThumbnail.buffer.toString("base64"),
      encoding: "base64",
      mimeType: mobileThumbnail.mimeType,
      overwrite: true,
    });
    const asset = this.upload({ ...input, publicationId: desktopThumbnailAsset.publicationId, fileName });
    const directory = path.join(this.rootDir, asset.publicationId);
    const manifestPath = path.join(directory, "publication.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const referencedAssets = resolvePrivatePageAssetReferences(manifest, assetPaths);
    const desktopMetadata = privateThumbnailMetadata(desktopThumbnailAsset, desktopThumbnail, properties.desktopThumbnailAlt);
    const mobileMetadata = privateThumbnailMetadata(mobileThumbnailAsset, mobileThumbnail, properties.mobileThumbnailAlt);
    manifest.page = {
      pageId: `private-${asset.publicationId}`,
      title: properties.title,
      summary: properties.summary,
      entryFile: asset.fileName,
      visibility: "private",
      thumbnail: desktopMetadata,
      thumbnails: { desktop: desktopMetadata, mobile: mobileMetadata },
      assets: referencedAssets,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return {
      ...asset,
      pageId: manifest.page.pageId,
      page: manifest.page,
      thumbnailUrl: desktopThumbnailAsset.url,
      desktopThumbnailUrl: desktopThumbnailAsset.url,
      mobileThumbnailUrl: mobileThumbnailAsset.url,
    };
  }

  list() {
    return fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const manifestPath = path.join(this.rootDir, entry.name, "publication.json");
        if (!fs.existsSync(manifestPath)) return null;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return { ...manifest, url: publicationUrl(entry.name, "index.html") };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  resolve(publicationId, fileName = "index.html") {
    const id = safeSegment(publicationId);
    const name = safeFileName(fileName);
    const filePath = path.resolve(this.rootDir, id, name);
    const expected = `${path.resolve(this.rootDir, id)}${path.sep}`;
    if (!filePath.startsWith(expected)) throw new Error("invalid publication path");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return { filePath, mimeType: mimeFromName(name), fileName: name };
  }
}

function normalizePrivatePageAssetPaths(input) {
  const assets = Array.isArray(input) ? input : [];
  if (assets.length > 256) throw new Error("Page bundle exceeds 256 assets");
  const seen = new Set();
  return assets.map((entry) => {
    const relativePath = String(entry || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relativePath || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("Page bundle contains an unsafe asset path");
    if (seen.has(relativePath)) throw new Error(`Page bundle asset is duplicated: ${relativePath}`);
    seen.add(relativePath);
    return safeFileName(relativePath);
  });
}

function resolvePrivatePageAssetReferences(manifest, assetPaths) {
  const files = new Map((manifest.files || []).map((entry) => [entry.name, entry]));
  return assetPaths.map((relativePath) => {
    const entry = files.get(relativePath);
    if (!entry) throw new Error(`Page asset reference was not uploaded: ${relativePath}`);
    return {
      fileName: entry.name,
      url: publicationUrl(manifest.id, entry.name),
      mimeType: entry.mimeType,
      bytes: entry.sizeBytes,
      sha256: entry.sha256,
    };
  });
}

function publicationUrl(publicationId, fileName) {
  return `/publications/${encodeURIComponent(publicationId)}/${encodeURIComponent(fileName)}`;
}

function resolvePrivateThumbnailInput(store, publicationId, input) {
  if (!input) return input;
  if (String(input?.content || "")) return input;
  if (!publicationId) throw new Error("Page thumbnail reference requires a stable publication id");
  const fileName = path.basename(String(input?.fileName || "").trim());
  const file = fileName ? store.resolve(publicationId, fileName) : null;
  if (!file) throw new Error(`Page thumbnail reference was not uploaded: ${fileName || "missing file"}`);
  return {
    ...input,
    content: fs.readFileSync(file.filePath).toString("base64"),
    encoding: "base64",
  };
}

function privateThumbnailMetadata(asset, thumbnail, alt) {
  return {
    fileName: asset.fileName,
    mimeType: thumbnail.mimeType,
    width: thumbnail.width,
    height: thumbnail.height,
    alt,
    sha256: asset.sha256,
  };
}

function safeSegment(value) {
  const segment = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(segment)) throw new Error("invalid publication id");
  return segment;
}

function safeFileName(value) {
  const name = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = name.split("/");
  if (!name || segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("invalid publication file name");
  const file = segments.pop();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(file)) throw new Error("invalid publication file name");
  return [...segments.map((segment) => safeSegment(segment)), file].join("/");
}

function mimeFromName(name) {
  const extension = path.extname(name).toLowerCase();
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" })[extension] || "application/octet-stream";
}
