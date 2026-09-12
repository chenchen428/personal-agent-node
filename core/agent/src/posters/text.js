import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const POSTER_FONT_PATH = fileURLToPath(new URL("./fonts/NotoSansSC.ttf", import.meta.url));
const FONT_SHA256 = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da";
const verifiedFonts = new Map();
export const COLORS = { paper: "#F5F3EA", ink: "#183D36", muted: "#607A70", glass: "#D9E7DD", rule: "#C9D5C9" };

export function posterError(code, message) { return Object.assign(new Error(message), { code }); }
export function escapeMarkup(text) {
  return String(text).replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[value]);
}

export function createTypography({ fontPath = POSTER_FONT_PATH } = {}) {
  const stat = fs.statSync(fontPath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size !== 17772300) throw posterError("POSTER_FONT_UNAVAILABLE", "海报字体尚未安装完整");
  const signature = `${stat.size}:${stat.mtimeMs}`;
  if (verifiedFonts.get(fontPath) !== signature) {
    if (crypto.createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex") !== FONT_SHA256) throw posterError("POSTER_FONT_UNAVAILABLE", "海报字体完整性校验失败");
    verifiedFonts.set(fontPath, signature);
  }
  const cache = new Map();
  async function text(value, size = 32, color = COLORS.ink, weight = "Regular") {
    const source = String(value || " ");
    const key = `${size}|${color}|${weight}|${source}`;
    if (!cache.has(key)) cache.set(key, sharp({ text: {
      text: `<span foreground="${color}">${escapeMarkup(source)}</span>`,
      font: `Noto Sans SC ${weight} ${size}`, fontfile: fontPath, dpi: 72, rgba: true,
    } }).png().toBuffer({ resolveWithObject: true }));
    return cache.get(key);
  }
  async function lines(value, width, size, color = COLORS.ink, weight = "Regular") {
    const output = [];
    for (const paragraph of String(value).split(/\r?\n/)) {
      let remaining = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(paragraph)].map((part) => part.segment);
      if (!remaining.length) { output.push({ text: "", ...(await text(" ", size, color, weight)) }); continue; }
      while (remaining.length) {
        let low = 1;
        let high = Math.min(remaining.length, Math.max(1, Math.floor(width / (size * 0.22))));
        let fit = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if ((await text(remaining.slice(0, mid).join(""), size, color, weight)).info.width <= width) { fit = mid; low = mid + 1; }
          else high = mid - 1;
        }
        if (!fit) throw posterError("POSTER_TEXT_TOO_WIDE", "海报文字包含无法在当前画布中呈现的字符");
        if (fit < remaining.length) {
          const boundary = remaining.slice(0, fit).lastIndexOf(" ");
          if (boundary > fit * 0.55) fit = boundary + 1;
        }
        const line = remaining.splice(0, fit).join("");
        output.push({ text: line, ...(await text(line, size, color, weight)) });
      }
    }
    return output;
  }
  return { text, lines, fontPath };
}

export function imageOverlay(image, left, top) { return { input: image.data, left: Math.round(left), top: Math.round(top) }; }
export function shape(svg, width = 1200, height = 1600) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg>`);
}
