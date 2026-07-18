import path from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePageThumbnail(input, { maxBytes = 8 * 1024 * 1024, variant = "desktop" } = {}) {
  const label = variant === "mobile" ? "mobile Page thumbnail" : "desktop Page thumbnail";
  if (!input || String(input.encoding || "base64").toLowerCase() !== "base64") {
    throw new Error(`${label} must use base64 encoding`);
  }
  const fileName = path.basename(String(input.fileName || `page-thumbnail-${variant}.png`).trim());
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.png$/i.test(fileName)) {
    throw new Error(`${label} must be a PNG file`);
  }
  const buffer = Buffer.from(String(input.content || ""), "base64");
  if (buffer.byteLength < 45 || buffer.byteLength > maxBytes || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a valid PNG image`);
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${label} is missing a PNG header`);
  }
  const chunkNames = pngChunkNames(buffer);
  if (!chunkNames.includes("IDAT") || chunkNames.at(-1) !== "IEND") {
    throw new Error(`${label} is incomplete`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const ratio = width / height;
  if (variant === "mobile") {
    if (width < 360 || height < 640 || width > 2160 || height > 4096) {
      throw new Error("mobile Page thumbnail dimensions must be between 360x640 and 2160x4096");
    }
    if (ratio < 0.5 || ratio > 0.8) {
      throw new Error("mobile Page thumbnail aspect ratio must be suitable for the mobile Pages gallery");
    }
  } else {
    if (width < 640 || height < 360 || width > 4096 || height > 4096) {
      throw new Error("desktop Page thumbnail dimensions must be between 640x360 and 4096x4096");
    }
    if (ratio < 1.35 || ratio > 1.8) {
      throw new Error("desktop Page thumbnail aspect ratio must be suitable for the desktop Pages gallery");
    }
  }
  return {
    buffer,
    fileName,
    mimeType: "image/png",
    width,
    height,
    alt: normalizedText(input.alt, 160),
  };
}

export function pageProperties(input, desktopThumbnail, mobileThumbnail) {
  const title = normalizedText(input.title, 120) || "Untitled page";
  return {
    title,
    summary: normalizedText(input.summary, 280),
    thumbnailAlt: desktopThumbnail.alt || `${title} desktop preview`,
    desktopThumbnailAlt: desktopThumbnail.alt || `${title} desktop preview`,
    mobileThumbnailAlt: mobileThumbnail.alt || `${title} mobile preview`,
  };
}

function normalizedText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function pngChunkNames(buffer) {
  const names = [];
  let offset = 8;
  while (offset + 12 <= buffer.byteLength) {
    const length = buffer.readUInt32BE(offset);
    const next = offset + 12 + length;
    if (length > buffer.byteLength || next > buffer.byteLength) return [];
    const name = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    names.push(name);
    offset = next;
    if (name === "IEND") return offset === buffer.byteLength ? names : [];
  }
  return [];
}
