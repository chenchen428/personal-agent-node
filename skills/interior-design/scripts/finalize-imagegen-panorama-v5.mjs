import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { confirmArtifact, markArtifactReady, modifyArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { compositeConstrainedPanorama } from "./constrained-panorama-composite-v5.mjs";
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
  if (!metadata.width || !metadata.height || !["png", "jpeg"].includes(metadata.format)) throw new Error("Imagegen source must be a valid PNG or JPEG image");
  if (metadata.width < MIN_SOURCE_WIDTH || metadata.height < MIN_SOURCE_HEIGHT) throw new Error(`Imagegen source must be at least ${MIN_SOURCE_WIDTH}x${MIN_SOURCE_HEIGHT}; received ${metadata.width}x${metadata.height}`);
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - 2) > 0.02) throw new Error(`Imagegen source must already be a 2:1 equirectangular panorama; received ratio ${ratio.toFixed(3)}`);
  const sourceQuality = await inspectPanoramaQuality(source);

  const workflowFile = path.join(root, "artifact-workflow.json");
  let workflow = readJson(workflowFile);
  validateArtifactWorkflow(workflow);
  const promptArtifact = workflow.artifacts[`panorama-imagegen-prompt-${nodeId}`];
  if (promptArtifact?.status !== "confirmed" || !promptArtifact.file) throw new Error(`panorama-imagegen-prompt-${nodeId} must be confirmed`);
  const prompt = readJson(path.join(root, promptArtifact.file));
  if (prompt.promptId !== promptId) throw new Error(`prompt id mismatch: expected ${prompt.promptId}`);

  const sourceSha256 = sha256File(source);
  const rawArtifactId = `panorama-imagegen-raw-${nodeId}`;
  const rawArtifact = workflow.artifacts[rawArtifactId];
  if (!rawArtifact) throw new Error(`missing workflow artifact: ${rawArtifactId}`);
  if (rawArtifact.status === "confirmed" && (rawArtifact.sha256 !== sourceSha256 || rawArtifact.file !== slash(path.relative(root, source)))) {
    workflow = modifyArtifact(workflow, rawArtifactId, { reason: "Imagegen source image changed" });
  }
  if (workflow.artifacts[rawArtifactId].status !== "confirmed") {
    workflow = markArtifactReady(workflow, rawArtifactId, { file: slash(path.relative(root, source)), sha256: sourceSha256 });
    workflow = confirmArtifact(workflow, rawArtifactId, {
      confirmedBy: "codex-imagegen",
      summary: "内置 Imagegen 原始 2:1 实景图已登记，等待受约束合成。",
    });
    writeJson(workflowFile, workflow);
  }

  const controlBundleFile = path.join(root, prompt.inputs.controlBundle.file);
  const controlBundle = readJson(controlBundleFile);
  const portalMask = path.join(root, controlBundle.passes["portal-mask"].file);
  const geometryControl = path.join(root, controlBundle.geometryControl.file);
  const semanticControl = path.join(root, controlBundle.passes.semantic.file);
  const attempt = nextAttempt(root, nodeId);
  const attemptLabel = String(attempt).padStart(3, "0");
  const relativeOutput = `panoramas/photorealistic/${nodeId}-attempt-${attemptLabel}.png`;
  const output = path.join(root, ...relativeOutput.split("/"));
  if (fs.existsSync(output)) throw new Error(`Imagegen delivery output already exists: ${relativeOutput}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const compositedFile = path.join(root, "derived", `panorama-composite-${nodeId}-attempt-${attemptLabel}.png`);
  fs.mkdirSync(path.dirname(compositedFile), { recursive: true });
  let composite;
  let seamStitch;
  let deliveryQuality;
  try {
    composite = await compositeConstrainedPanorama({
      source,
      portalMask,
      geometryControl,
      semanticControl,
      output: compositedFile,
      width: DELIVERY_WIDTH,
      height: DELIVERY_HEIGHT,
    });
    seamStitch = await stitchPanoramaWrapSeam({ source: compositedFile, output });
    deliveryQuality = await inspectPanoramaQuality(output);
    assertPanoramaQuality(deliveryQuality);
  } finally {
    fs.rmSync(compositedFile, { force: true });
  }

  const controlOrientationOffsetDeg = latestControlOrientation(root, nodeId);
  const orientationOffsetDeg = yaw(controlOrientationOffsetDeg);
  const registered = await registerPanoramaImage({
    projectDir: root,
    nodeId,
    kind: "photorealistic",
    file: relativeOutput,
    generator: "codex-imagegen",
    promptId,
    orientationOffsetDeg,
    normalization: {
      type: "geometry-aware-yaw-segment-composite-and-wrap-seam-stitch",
      sourceFile: slash(path.relative(root, source)),
      sourceSha256,
      sourceDimensions: { width: metadata.width, height: metadata.height },
      outputDimensions: { width: DELIVERY_WIDTH, height: DELIVERY_HEIGHT },
      controlBundle: { file: slash(path.relative(root, controlBundleFile)), sha256: sha256File(controlBundleFile) },
      composite,
      controlOrientationOffsetDeg,
      additionalYawOffsetDeg: 0,
      orientationOffsetDeg,
      seamStitch: { bandWidth: seamStitch.bandWidth, before: seamStitch.before, after: seamStitch.after },
      deliveryQuality,
      contentGeneratedByPostprocess: false,
    },
  });
  return {
    ...registered,
    source: { file: slash(path.relative(root, source)), sha256: sourceSha256, dimensions: { width: metadata.width, height: metadata.height }, quality: sourceQuality },
    delivery: { file: relativeOutput, width: DELIVERY_WIDTH, height: DELIVERY_HEIGHT },
    composite,
  };
}

function latestControlOrientation(root, nodeId) {
  const ledgerFile = path.join(root, "panorama-production.json");
  if (!fs.existsSync(ledgerFile)) return 0;
  const ledger = readJson(ledgerFile);
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

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function slash(value) { return value.split(path.sep).join("/"); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function yaw(value) { return Math.round(((((value + 180) % 360) + 360) % 360 - 180) * 10_000) / 10_000; }
