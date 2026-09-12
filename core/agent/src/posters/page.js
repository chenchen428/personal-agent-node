import crypto from "node:crypto";
import sharp from "sharp";
import { createPosterQr } from "./qr.js";
import { posterError } from "./text.js";

function rasterFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024) throw posterError("POSTER_IMAGE_INVALID", "海报底图须为不超过25MB的 PNG、JPEG 或 WebP");
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw posterError("POSTER_IMAGE_INVALID", "海报底图仅支持 PNG、JPEG 或 WebP，不接受 SVG");
}

export async function renderPagePoster({ image, targetUrl, pageId, pageVersion, corner = "bottom-right" } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(pageId || "")) || !/^[a-f0-9]{64}$/.test(String(pageVersion || ""))) throw posterError("POSTER_PAGE_VERSION_REQUIRED", "请先绑定当前发布页及其内容版本");
  if (!["bottom-right", "bottom-left", "top-right", "top-left"].includes(corner)) throw posterError("POSTER_PLACEMENT_INVALID", "二维码位置无效");
  const format = rasterFormat(image);
  let base;
  try {
    const source = sharp(image, { limitInputPixels: 32 * 1024 * 1024, failOn: "warning" });
    const metadata = await source.metadata();
    if (metadata.format !== format || (metadata.pages || 1) !== 1) throw new Error("unsupported raster");
    // Honor orientation; preserve the complete composition without cropping/resizing.
    base = await source.autoOrient().toColourspace("srgb").png().toBuffer({ resolveWithObject: true });
  } catch { throw posterError("POSTER_IMAGE_INVALID", "底图无法安全解码，请重新导出静态 PNG、JPEG 或 WebP"); }
  const { width, height } = base.info;
  if (Math.min(width, height) < 800 || Math.max(width, height) > 8192) throw posterError("POSTER_IMAGE_SIZE", "底图短边至少800像素，长边不超过8192像素");
  const qr = await createPosterQr(targetUrl, { maxWidth: Math.min(260, Math.floor(Math.min(width, height) * 0.23)) });
  const inset = Math.max(32, Math.round(Math.min(width, height) * 0.045));
  const left = corner.endsWith("right") ? width - inset - qr.width : inset;
  const top = corner.startsWith("bottom") ? height - inset - qr.height : inset;
  const buffer = await sharp(base.data).composite([{ input: qr.buffer, left, top }]).png().toBuffer();
  if (buffer.length > 20 * 1024 * 1024) throw posterError("POSTER_IMAGE_TOO_LARGE", "生成图片超过原生附件20MB限制，请减小底图尺寸后重试");
  return { buffer, mimeType: "image/png", fileName: `cove-page-${pageId}-${pageVersion.slice(0, 12)}.png`, width, height,
    sizeBytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    alt: "发布页海报，扫码查看完整内容", pageId, pageVersion, targetUrl: qr.targetUrl,
    qr: { left, top, width: qr.width, modules: qr.modules, modulePixels: qr.modulePixels, quietZoneModules: 4 },
  };
}
