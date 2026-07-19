import path from "node:path";

const GENERIC_IMAGE_NAMES = new Set(["wechat-image.jpg", "image.jpg", "image.jpeg", "image.png"]);
const GENERIC_FILE_NAMES = new Set(["wechat-file", "file"]);

export function sanitizeInboundAttachmentFileName(fileName, fallback = "wechat-file") {
  const lastSegment = String(fileName || "").trim().replace(/\\/g, "/").split("/").pop() || "";
  const withoutControlChars = Array.from(lastSegment)
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("");
  const sanitized = withoutControlChars
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, 160) || fallback;
}

export function buildInboundAttachmentDisplayName({ kind, fileName, createdAt, usedNames = new Set() }) {
  const fallback = kind === "image" ? "wechat-image.jpg" : "wechat-file";
  const safeOriginal = sanitizeInboundAttachmentFileName(fileName, fallback);
  const normalized = safeOriginal.toLowerCase();
  const generic = kind === "image" ? GENERIC_IMAGE_NAMES.has(normalized) : GENERIC_FILE_NAMES.has(normalized);
  const timestamp = compactTimestamp(createdAt);
  const extension = path.extname(safeOriginal);
  const proposed = generic
    ? `${kind === "image" ? "微信图片" : "微信文件"}-${timestamp}${extension}`
    : safeOriginal;
  return uniqueDisplayName(proposed, usedNames);
}

export function buildPrivateAttachmentPreviewUrl({ rootDir, filePath }) {
  const relativePath = relativeAttachmentPath(rootDir, filePath);
  if (!relativePath) return "";
  return `/app/files/view/${encodeRelativePath(relativePath)}`;
}

export function relativeAttachmentPath(rootDir, filePath) {
  const root = path.resolve(String(rootDir || ""));
  const target = path.resolve(String(filePath || ""));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative.split(path.sep).join("/");
}

export function decodePrivateAttachmentPath(encodedPath) {
  const segments = String(encodedPath || "").split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (!segments.length || segments.some((segment) => segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) {
    throw Object.assign(new Error("invalid private file path"), { code: "ENOENT" });
  }
  return segments;
}

export function storedAttachmentDisplayName(filePath) {
  const baseName = path.basename(String(filePath || ""));
  return baseName.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-/i, "") || "微信文件";
}

export function privateFilePreviewKind(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (/^image\/(?:avif|gif|jpeg|png|webp)$/.test(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || ["application/json", "application/x-ndjson"].includes(mime)) return "text";
  return "download";
}

function compactTimestamp(value) {
  const date = new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function uniqueDisplayName(fileName, usedNames) {
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = fileName;
  let index = 2;
  while (usedNames.has(candidate.toLocaleLowerCase("zh-CN"))) {
    candidate = `${stem}-${index}${extension}`;
    index += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase("zh-CN"));
  return candidate;
}

function encodeRelativePath(relativePath) {
  return relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
