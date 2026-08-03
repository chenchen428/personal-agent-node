import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SEAM_MEAN_LIMIT = 0.08;
const SEAM_P95_LIMIT = 0.24;

export async function inspectPanoramaQuality(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const seam = seamMetrics(data, info, 0);
  const exposure = exposureMetrics(data, info);
  return {
    seam: { ...seam, status: seam.meanDelta <= SEAM_MEAN_LIMIT && seam.p95Delta <= SEAM_P95_LIMIT ? "passed" : "failed" },
    exposure,
  };
}

export async function normalizePanoramaSeam({ source, output }) {
  const input = path.resolve(source);
  const target = path.resolve(output);
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const before = seamMetrics(data, info, 0);
  const shiftPixels = findBestSeam(data, info);
  const rolled = rollRows(data, info, shiftPixels);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(rolled, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(target);
  const after = seamMetrics(rolled, info, 0);
  const unsignedOffset = shiftPixels / info.width * 360;
  const orientationOffsetDeg = round(((unsignedOffset + 180) % 360) - 180, 4);
  return {
    source: input,
    output: target,
    width: info.width,
    height: info.height,
    shiftPixels,
    orientationOffsetDeg,
    before,
    after,
  };
}

export async function stitchPanoramaWrapSeam({ source, output, bandWidth }) {
  const input = path.resolve(source);
  const target = path.resolve(output);
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const before = seamMetrics(data, info, 0);
  const width = Math.max(8, Math.min(Math.floor(info.width / 8), bandWidth ?? Math.round(info.width / 32)));
  const stitched = Buffer.from(data);

  // Both edge bands describe the same meridian. Converge them at x=0 while
  // preserving the untouched image outside the narrow wrap boundary.
  for (let y = 0; y < info.height; y += 1) {
    for (let distance = 0; distance < width; distance += 1) {
      const progress = width === 1 ? 1 : distance / (width - 1);
      const originalWeight = smoothstep(progress);
      const leftOffset = (y * info.width + distance) * info.channels;
      const rightOffset = (y * info.width + info.width - 1 - distance) * info.channels;
      for (let channel = 0; channel < Math.min(3, info.channels); channel += 1) {
        const left = data[leftOffset + channel];
        const right = data[rightOffset + channel];
        const midpoint = (left + right) / 2;
        stitched[leftOffset + channel] = Math.round(midpoint * (1 - originalWeight) + left * originalWeight);
        stitched[rightOffset + channel] = Math.round(midpoint * (1 - originalWeight) + right * originalWeight);
      }
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(stitched, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(target);
  return {
    source: input,
    output: target,
    width: info.width,
    height: info.height,
    bandWidth: width,
    before,
    after: seamMetrics(stitched, info, 0),
  };
}

export function assertPanoramaQuality(quality) {
  if (quality.seam.status !== "passed") {
    throw new Error(`panorama seam check failed: mean=${quality.seam.meanDelta.toFixed(4)}, p95=${quality.seam.p95Delta.toFixed(4)}`);
  }
}

function findBestSeam(data, info) {
  let best = { x: 0, mean: Number.POSITIVE_INFINITY };
  const startY = Math.floor(info.height * 0.08);
  const endY = Math.ceil(info.height * 0.92);
  const rowStep = Math.max(1, Math.floor(info.height / 512));
  for (let x = 0; x < info.width; x += 1) {
    const previous = (x - 1 + info.width) % info.width;
    let total = 0;
    let count = 0;
    for (let y = startY; y < endY; y += rowStep) {
      const currentOffset = (y * info.width + x) * info.channels;
      const previousOffset = (y * info.width + previous) * info.channels;
      for (let channel = 0; channel < Math.min(3, info.channels); channel += 1) {
        total += Math.abs(data[currentOffset + channel] - data[previousOffset + channel]);
        count += 1;
      }
    }
    const mean = total / Math.max(1, count) / 255;
    if (mean < best.mean) best = { x, mean };
  }
  return best.x;
}

function rollRows(data, info, shiftPixels) {
  if (shiftPixels === 0) return Buffer.from(data);
  const result = Buffer.allocUnsafe(data.length);
  const rowBytes = info.width * info.channels;
  const firstBytes = (info.width - shiftPixels) * info.channels;
  const shiftBytes = shiftPixels * info.channels;
  for (let y = 0; y < info.height; y += 1) {
    const rowStart = y * rowBytes;
    data.copy(result, rowStart, rowStart + shiftBytes, rowStart + rowBytes);
    data.copy(result, rowStart + firstBytes, rowStart, rowStart + shiftBytes);
  }
  return result;
}

function seamMetrics(data, info, seamX) {
  const current = ((seamX % info.width) + info.width) % info.width;
  const previous = (current - 1 + info.width) % info.width;
  const deltas = [];
  for (let y = 0; y < info.height; y += Math.max(1, Math.floor(info.height / 1024))) {
    const currentOffset = (y * info.width + current) * info.channels;
    const previousOffset = (y * info.width + previous) * info.channels;
    for (let channel = 0; channel < Math.min(3, info.channels); channel += 1) {
      deltas.push(Math.abs(data[currentOffset + channel] - data[previousOffset + channel]) / 255);
    }
  }
  deltas.sort((left, right) => left - right);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
  return {
    meanDelta: round(mean, 6),
    p95Delta: round(deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))] ?? 0, 6),
    maxDelta: round(deltas.at(-1) ?? 0, 6),
  };
}

function exposureMetrics(data, info) {
  let dark = 0;
  let bright = 0;
  let count = 0;
  const pixelStep = Math.max(1, Math.floor((info.width * info.height) / 250_000));
  for (let pixel = 0; pixel < info.width * info.height; pixel += pixelStep) {
    const offset = pixel * info.channels;
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    if (red <= 4 && green <= 4 && blue <= 4) dark += 1;
    if (red >= 251 && green >= 251 && blue >= 251) bright += 1;
    count += 1;
  }
  return { clippedBlackRatio: round(dark / count, 6), clippedWhiteRatio: round(bright / count, 6) };
}

function round(value, digits) { const power = 10 ** digits; return Math.round(value * power) / power; }
function smoothstep(value) { return value * value * (3 - 2 * value); }
