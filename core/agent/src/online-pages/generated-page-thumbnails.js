import sharp from "sharp";

const VARIANTS = {
  desktop: { width: 1200, height: 750, titleSize: 54, summarySize: 24, padding: 72 },
  mobile: { width: 750, height: 1200, titleSize: 48, summarySize: 25, padding: 58 },
};

export async function createGeneratedPageThumbnails({
  title = "Untitled page",
  summary = "",
  templateId = "",
} = {}) {
  const [desktop, mobile] = await Promise.all([
    createGeneratedPageThumbnail({ title, summary, templateId, variant: "desktop" }),
    createGeneratedPageThumbnail({ title, summary, templateId, variant: "mobile" }),
  ]);
  return { desktop, mobile };
}

export async function createGeneratedPageThumbnail({
  title = "Untitled page",
  summary = "",
  templateId = "",
  variant = "desktop",
} = {}) {
  const layout = VARIANTS[variant];
  if (!layout) throw new Error(`unsupported Page thumbnail variant: ${variant}`);
  const safeTitle = normalized(title, 120) || "Untitled page";
  const safeSummary = normalized(summary, 280) || "由 Personal Agent 生成，视觉与交互效果等待用户打开页面验收。";
  const titleLines = wrap(safeTitle, variant === "mobile" ? 12 : 20, variant === "mobile" ? 3 : 2);
  const summaryLines = wrap(safeSummary, variant === "mobile" ? 22 : 38, variant === "mobile" ? 5 : 3);
  const templateLabel = normalized(templateId, 64) || "personal-agent-page";
  const accentWidth = variant === "mobile" ? 210 : 290;
  const titleY = variant === "mobile" ? 315 : 255;
  const summaryY = titleY + titleLines.length * (layout.titleSize + 10) + 42;
  const footerY = layout.height - layout.padding;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
  <rect width="100%" height="100%" fill="#f3f1eb"/>
  <rect x="${layout.padding}" y="${layout.padding}" width="${accentWidth}" height="10" rx="5" fill="#26302b"/>
  <rect x="${layout.width - layout.padding - 76}" y="${layout.padding}" width="76" height="76" rx="18" fill="#26302b"/>
  <text x="${layout.width - layout.padding - 38}" y="${layout.padding + 49}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">PA</text>
  <text x="${layout.padding}" y="${layout.padding + 72}" fill="#737a74" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3">PERSONAL AGENT · PAGES</text>
  ${textLines(titleLines, layout.padding, titleY, layout.titleSize, layout.titleSize + 10, "#202521", 700)}
  ${textLines(summaryLines, layout.padding, summaryY, layout.summarySize, layout.summarySize + 13, "#697069", 400)}
  <line x1="${layout.padding}" y1="${footerY - 50}" x2="${layout.width - layout.padding}" y2="${footerY - 50}" stroke="#d4d5cf" stroke-width="2"/>
  <text x="${layout.padding}" y="${footerY}" fill="#374039" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(templateLabel)}</text>
  <text x="${layout.width - layout.padding}" y="${footerY}" text-anchor="end" fill="#7b827c" font-family="Arial, sans-serif" font-size="18">打开页面后由用户验收</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function textLines(lines, x, y, size, lineHeight, color, weight) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}">${escapeXml(line)}</text>`).join("");
}

function wrap(value, maximumCharacters, maximumLines) {
  const characters = [...normalized(value, 500)];
  const lines = [];
  while (characters.length && lines.length < maximumLines) {
    const remainingSlots = maximumLines - lines.length;
    if (remainingSlots === 1) {
      const last = characters.splice(0, maximumCharacters).join("");
      lines.push(characters.length ? `${last.slice(0, Math.max(1, maximumCharacters - 1))}…` : last);
      break;
    }
    lines.push(characters.splice(0, maximumCharacters).join(""));
  }
  return lines.length ? lines : [""];
}

function normalized(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function escapeXml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character]);
}
