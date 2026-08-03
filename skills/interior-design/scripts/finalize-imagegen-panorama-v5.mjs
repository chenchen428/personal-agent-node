import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { registerPanoramaImage } from "./panorama-artifacts-v5.mjs";
import { assertPanoramaQuality, inspectPanoramaQuality, stitchPanoramaWrapSeam } from "./panorama-quality-v5.mjs";

const DELIVERY_WIDTH = 4096;
const DELIVERY_HEIGHT = 2048;
const MIN_SOURCE_WIDTH = 1536;
const MIN_SOURCE_HEIGHT = 768;

export async function finalizeImagegenPanorama({ projectDir, nodeId, file, promptId }) {
  const root = path.resolve(projectDir);
  const source = path.resolve(root, file);
  if (!inside(root, source) || !fs.existsSync(source)) throw new Error("Imagegen source must exist inside the project workspace");
  if (!promptId) throw new Error("Imagegen finalization requires the confirmed prompt id");

  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg"].includes(metadata.format)) {
    throw new Error("Imagegen source must be a valid PNG or JPEG image");
  }
  if (metadata.width < MIN_SOURCE_WIDTH || metadata.height < MIN_SOURCE_HEIGHT) {
    throw new Error(`Imagegen source must be at least ${MIN_SOURCE_WIDTH}x${MIN_SOURCE_HEIGHT}; received ${metadata.width}x${metadata.height}`);
  }
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - 2) > 0.02) throw new Error(`Imagegen source must already be a 2:1 equirectangular panorama; received ratio ${ratio.toFixed(3)}`);
  const sourceQuality = await inspectPanoramaQuality(source);

  const attempt = nextAttempt(root, nodeId);
  const relativeOutput = `panoramas/photorealistic/${nodeId}-attempt-${String(attempt).padStart(3, "0")}.png`;
  const output = path.join(root, ...relativeOutput.split("/"));
  if (fs.existsSync(output)) throw new Error(`Imagegen delivery output already exists: ${relativeOutput}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const resized = path.join(root, "derived", `imagegen-resized-${nodeId}-attempt-${String(attempt).padStart(3, "0")}.png`);
  fs.mkdirSync(path.dirname(resized), { recursive: true });
  let seamStitch;
  let deliveryQuality;
  try {
    await sharp(source)
      .resize({ width: DELIVERY_WIDTH, height: DELIVERY_HEIGHT, fit: "fill", kernel: sharp.kernel.lanczos3 })
      .sharpen()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(resized);

    seamStitch = await stitchPanoramaWrapSeam({ source: resized, output });
    deliveryQuality = await inspectPanoramaQuality(output);
    assertPanoramaQuality(deliveryQuality);
  } finally {
    fs.rmSync(resized, { force: true });
  }

  const controlOrientationOffsetDeg = latestControlOrientation(root, nodeId);
  const orientationOffsetDeg = yaw(controlOrientationOffsetDeg);

  const sourceSha256 = sha256File(source);
  const registered = await registerPanoramaImage({
    projectDir: root,
    nodeId,
    kind: "photorealistic",
    file: relativeOutput,
    generator: "codex-imagegen",
    promptId,
    orientationOffsetDeg,
    normalization: {
      type: "same-projection-resize-and-wrap-seam-stitch",
      sourceFile: slash(path.relative(root, source)),
      sourceSha256,
      sourceDimensions: { width: metadata.width, height: metadata.height },
      outputDimensions: { width: DELIVERY_WIDTH, height: DELIVERY_HEIGHT },
      kernel: "lanczos3",
      controlOrientationOffsetDeg,
      additionalYawOffsetDeg: 0,
      orientationOffsetDeg,
      seamStitch: {
        bandWidth: seamStitch.bandWidth,
        before: seamStitch.before,
        after: seamStitch.after,
      },
      deliveryQuality,
      contentGeneratedByPostprocess: false,
    },
  });
  return {
    ...registered,
    source: {
      file: slash(path.relative(root, source)),
      sha256: sourceSha256,
      dimensions: { width: metadata.width, height: metadata.height },
      quality: sourceQuality,
    },
    delivery: { file: relativeOutput, width: DELIVERY_WIDTH, height: DELIVERY_HEIGHT },
  };
}

function latestControlOrientation(root, nodeId) {
  const ledgerFile = path.join(root, "panorama-production.json");
  if (!fs.existsSync(ledgerFile)) return 0;
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const record = [...(ledger.records ?? [])].reverse().find((entry) => entry.nodeId === nodeId && entry.kind === "control");
  return Number.isFinite(record?.orientationOffsetDeg) ? record.orientationOffsetDeg : 0;
}

function nextAttempt(root, nodeId) {
  const directory = path.join(root, "panoramas", "photorealistic");
  if (!fs.existsSync(directory)) return 1;
  const expression = new RegExp(`^${escapeRegExp(nodeId)}-attempt-(\\d{3})\\.png$`);
  const attempts = fs.readdirSync(directory).map((name) => Number(name.match(expression)?.[1] ?? 0));
  return Math.max(0, ...attempts) + 1;
}

function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function slash(value) { return value.split(path.sep).join("/"); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function yaw(value) {
  const wrapped = (((value + 180) % 360) + 360) % 360 - 180;
  return Math.round(wrapped * 10_000) / 10_000;
}
