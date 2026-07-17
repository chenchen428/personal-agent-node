import fs from "node:fs/promises";
import path from "node:path";

const SAFE_SEGMENT_RE = /[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g;

export function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "").trim());
  const sanitized = baseName.replace(SAFE_SEGMENT_RE, "-").replace(/-+/g, "-");
  const trimmed = sanitized.replace(/^[.-]+/, "").slice(0, 180);
  if (!trimmed) throw new Error("fileName must include at least one safe character");
  return trimmed;
}

export function todayPathSegment(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function assertInside(parentDir, targetPath) {
  const relative = path.relative(parentDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("resolved path escapes the allowed directory");
  }
}

export async function nextAvailablePath(targetPath, overwrite) {
  if (overwrite) return targetPath;
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
}

export function toPublicUrl(publicBaseUrl, publicRelativePath) {
  if (!publicBaseUrl) return "";
  const normalized = publicRelativePath.split(path.sep).map(encodeURIComponent).join("/");
  return `${publicBaseUrl}/${normalized.replace(/^\/+/, "")}`;
}
