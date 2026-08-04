import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SEGMENT_COUNT = 6;

export async function compositeConstrainedPanorama({
  source,
  portalMask,
  geometryControl,
  semanticControl,
  output,
  width = 4096,
  height = 2048,
}) {
  const sourceImage = await sharp(source)
    .resize({ width, height, fit: "fill", kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskImage = await sharp(portalMask)
    .resize({ width, height, fit: "fill", kernel: sharp.kernel.nearest })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const geometryImage = geometryControl ? await readRgb(geometryControl, width, height) : null;
  const semanticImage = semanticControl ? await readRgb(semanticControl, width, height, sharp.kernel.nearest) : null;
  const portalEdges = boundaryMap(maskImage.data, width, height, 1, Math.max(3, Math.round(width / 1024)));
  const semanticEdges = semanticImage
    ? boundaryMap(semanticImage.data, width, height, semanticImage.info.channels, Math.max(2, Math.round(width / 2048)), 24)
    : new Uint8Array(width * height);
  const protectedEdges = unionMaps(portalEdges, semanticEdges);
  const overlap = Math.max(24, Math.round(width / 96));
  const segmentWidth = width / SEGMENT_COUNT;
  const phase = choosePhase(protectedEdges, width, height, segmentWidth, overlap);
  const composited = blendSegments(sourceImage.data, sourceImage.info, phase, segmentWidth, overlap);
  const hardEdgeRetention = {
    portal: edgeRetention(sourceImage, geometryImage, portalEdges),
    semantic: edgeRetention(sourceImage, geometryImage, semanticEdges),
  };
  assertHardEdgeRetention(hardEdgeRetention);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await sharp(composited, { raw: sourceImage.info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
  return {
    type: "geometry-aware-yaw-segment-composite",
    segmentCount: SEGMENT_COUNT,
    overlapPixels: overlap,
    phasePixels: phase,
    phaseDeg: round(phase / width * 360),
    boundariesDeg: Array.from({ length: SEGMENT_COUNT }, (_, index) => round((((phase + index * segmentWidth) % width) / width) * 360)),
    portalMaskCoverage: round(maskCoverage(maskImage.data)),
    portalDetailScore: portalDetailScore(sourceImage.data, sourceImage.info, maskImage.data),
    hardEdgeRetention,
    hardGeometryPolicy: "six overlapping yaw faces avoid Blender portal and semantic hard-edge zones; delivery is rejected when generated edge response no longer follows the Blender control",
  };
}

async function readRgb(file, width, height, kernel = sharp.kernel.lanczos3) {
  return sharp(file)
    .resize({ width, height, fit: "fill", kernel })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function boundaryMap(data, width, height, channels, radius, colorThreshold = 1) {
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      if (different(data, pixel, pixel + 1, channels, colorThreshold)
        || different(data, pixel, pixel + width, channels, colorThreshold)) edges[pixel] = 255;
    }
  }
  if (radius <= 0) return edges;
  const expanded = new Uint8Array(edges.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!edges[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) expanded[yy * width + wrap(x + dx, width)] = 255;
      }
    }
  }
  return expanded;
}

function different(data, firstPixel, secondPixel, channels, threshold) {
  const first = firstPixel * channels;
  const second = secondPixel * channels;
  let delta = 0;
  for (let channel = 0; channel < channels; channel += 1) delta = Math.max(delta, Math.abs(data[first + channel] - data[second + channel]));
  return delta >= threshold;
}

function unionMaps(first, second) {
  const output = new Uint8Array(first.length);
  for (let index = 0; index < output.length; index += 1) output[index] = first[index] || second[index] ? 255 : 0;
  return output;
}

function edgeRetention(source, geometry, edgeMap) {
  if (!geometry) return { samples: 0, score: null, status: "not-measured" };
  let samples = 0;
  let retained = 0;
  for (let y = 1; y < source.info.height - 1; y += 3) {
    for (let x = 1; x < source.info.width - 1; x += 3) {
      const pixel = y * source.info.width + x;
      if (!edgeMap[pixel]) continue;
      const controlGradient = gradient(geometry.data, geometry.info, pixel);
      if (controlGradient < 5) continue;
      samples += 1;
      if (gradient(source.data, source.info, pixel) >= 4) retained += 1;
    }
  }
  if (samples === 0) return { samples: 0, score: null, status: "not-applicable" };
  const score = round(retained / samples);
  return { samples, score, status: "passed" };
}

function assertHardEdgeRetention(retention) {
  const minimums = { portal: 0.12, semantic: 0.08 };
  for (const [kind, result] of Object.entries(retention)) {
    if (result.score !== null && result.score < minimums[kind]) {
      throw new Error(`Imagegen panorama lost Blender ${kind} hard edges: ${result.score} < ${minimums[kind]}`);
    }
  }
}

function gradient(data, info, pixel) {
  const left = luminance(data, (pixel - 1) * info.channels);
  const right = luminance(data, (pixel + 1) * info.channels);
  const up = luminance(data, (pixel - info.width) * info.channels);
  const down = luminance(data, (pixel + info.width) * info.channels);
  return Math.abs(right - left) + Math.abs(down - up);
}

function choosePhase(mask, width, height, segmentWidth, overlap) {
  let best = { phase: 0, score: Number.POSITIVE_INFINITY };
  const step = Math.max(8, Math.round(segmentWidth / 64));
  for (let phase = 0; phase < segmentWidth; phase += step) {
    let score = 0;
    for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
      const boundary = Math.round(phase + segment * segmentWidth) % width;
      for (let dx = -overlap; dx <= overlap; dx += 4) {
        const x = wrap(boundary + dx, width);
        for (let y = 0; y < height; y += 8) score += mask[y * width + x] / 255;
      }
    }
    if (score < best.score) best = { phase, score };
  }
  return Math.round(best.phase);
}

function blendSegments(source, info, phase, segmentWidth, overlap) {
  const accum = new Float64Array(source.length);
  const weights = new Float64Array(info.width * info.height);
  for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
    const start = phase + segment * segmentWidth - overlap;
    const span = segmentWidth + overlap * 2;
    for (let localX = 0; localX < Math.ceil(span); localX += 1) {
      const globalX = wrap(Math.round(start + localX), info.width);
      const distance = Math.min(localX, span - localX);
      const weight = distance >= overlap ? 1 : smoothstep(Math.max(0, distance / overlap));
      for (let y = 0; y < info.height; y += 1) {
        const pixel = y * info.width + globalX;
        const offset = pixel * info.channels;
        weights[pixel] += weight;
        for (let channel = 0; channel < info.channels; channel += 1) accum[offset + channel] += source[offset + channel] * weight;
      }
    }
  }
  const output = Buffer.alloc(source.length);
  for (let pixel = 0; pixel < weights.length; pixel += 1) {
    const weight = Math.max(1e-6, weights[pixel]);
    const offset = pixel * info.channels;
    for (let channel = 0; channel < info.channels; channel += 1) output[offset + channel] = Math.round(accum[offset + channel] / weight);
  }
  return output;
}

function maskCoverage(mask) {
  let active = 0;
  for (const value of mask) if (value > 127) active += 1;
  return active / Math.max(1, mask.length);
}

function portalDetailScore(image, info, mask) {
  let total = 0;
  let count = 0;
  for (let y = 1; y < info.height - 1; y += 2) {
    for (let x = 1; x < info.width - 1; x += 2) {
      const pixel = y * info.width + x;
      if (mask[pixel] <= 127) continue;
      const left = luminance(image, (pixel - 1) * info.channels);
      const right = luminance(image, (pixel + 1) * info.channels);
      const up = luminance(image, (pixel - info.width) * info.channels);
      const down = luminance(image, (pixel + info.width) * info.channels);
      total += Math.abs(right - left) + Math.abs(down - up);
      count += 2;
    }
  }
  return round(total / Math.max(1, count) / 255);
}

function luminance(data, offset) {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function wrap(value, width) { return ((value % width) + width) % width; }
function smoothstep(value) { return value * value * (3 - 2 * value); }
function round(value) { return Math.round(value * 10_000) / 10_000; }
