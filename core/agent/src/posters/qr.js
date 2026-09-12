import net from "node:net";
import QRCode from "qrcode";
import { posterError } from "./text.js";

// Callers must first resolve and authorize the target in the current Space.
// These checks are defense in depth, never an object-authorization substitute.
export function validatePosterTarget(targetUrl) {
  let url;
  try { url = new URL(String(targetUrl || "")); } catch { throw posterError("POSTER_LINK_UNAVAILABLE", "尚无可用的手机访问地址，无法生成海报二维码"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || net.isIP(host.replace(/^\[|\]$/g, "")) || url.username || url.password || url.hash) {
    throw posterError("POSTER_LINK_UNAVAILABLE", "海报需要当前对象的有效 HTTPS 手机访问地址");
  }
  if ([...url.searchParams.keys()].some((key) => /token|secret|password|credential|authorization|session|signature|api.?key/i.test(key))) {
    throw posterError("POSTER_LINK_UNAVAILABLE", "海报链接不能携带登录凭据");
  }
  if (Buffer.byteLength(url.href) > 512) throw posterError("POSTER_LINK_TOO_LONG", "手机访问地址过长，无法生成小尺寸二维码");
  return url.href;
}

export async function createPosterQr(targetUrl, { maxWidth = 260, modulePixels = 4 } = {}) {
  const url = validatePosterTarget(targetUrl);
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size;
  const scale = Math.max(4, Math.floor(modulePixels));
  const width = (modules + 8) * scale;
  if (width > maxWidth) throw posterError("POSTER_LINK_TOO_LONG", "链接过长，二维码无法同时保持小尺寸与清晰度");
  const buffer = await QRCode.toBuffer(url, { type: "png", margin: 4, scale, errorCorrectionLevel: "M", color: { dark: "#183D36", light: "#FFFFFF" } });
  return { buffer, width, height: width, modules, modulePixels: scale, quietZoneModules: 4, targetUrl: url };
}
