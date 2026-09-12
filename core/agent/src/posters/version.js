import crypto from "node:crypto";

export function pagePosterVersion(manifest) {
  const unavailable = () => Object.assign(new Error("发布页内容尚未就绪"), { code: "POSTER_PAGE_NOT_FOUND" });
  if (!manifest?.page?.pageId) throw unavailable();
  const { poster: _poster, ...page } = manifest.page;
  const referenced = new Set([page.entryFile, ...(page.assets || []).map((asset) => asset.fileName), ...Object.values(page.thumbnails || {}).map((thumbnail) => thumbnail.fileName)]);
  const files = (manifest.files || []).filter((file) => referenced.has(file.name)).map(({ name, sha256, sizeBytes }) => ({ name, sha256, sizeBytes })).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((file) => file.name === page.entryFile)) throw unavailable();
  return crypto.createHash("sha256").update(JSON.stringify({ page, files })).digest("hex");
}
