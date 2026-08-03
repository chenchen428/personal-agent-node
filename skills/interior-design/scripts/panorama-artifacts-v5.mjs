import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { markArtifactReady, modifyArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { assertPanoramaQuality, inspectPanoramaQuality } from "./panorama-quality-v5.mjs";

export async function registerPanoramaImage({ projectDir, nodeId, kind, file, generator, promptId = null, orientationOffsetDeg = null, normalization = null }) {
  const root = path.resolve(projectDir);
  if (!["control", "photorealistic"].includes(kind)) throw new Error("panorama kind must be control or photorealistic");
  const geometry = readJson(path.join(root, "geometry.json"));
  if (!(geometry.panoramaNodes ?? []).some((node) => node.id === nodeId)) throw new Error(`unknown panorama node: ${nodeId}`);
  if (kind === "control" && generator !== "blender") throw new Error("control panoramas must be registered with generator=blender");
  if (kind === "photorealistic" && generator !== "codex-imagegen") throw new Error("photorealistic panoramas must be registered with generator=codex-imagegen");
  const source = path.resolve(root, file);
  if (!inside(root, source) || !fs.existsSync(source)) throw new Error("panorama file must exist inside the project workspace");
  const value = fs.readFileSync(source);
  const dimensions = imageDimensions(value);
  if (dimensions.width < 2048 || dimensions.height < 1024) throw new Error(`panorama must be at least 2048x1024; received ${dimensions.width}x${dimensions.height}`);
  const ratio = dimensions.width / dimensions.height;
  if (Math.abs(ratio - 2) > 0.02) throw new Error(`panorama must be a 2:1 equirectangular image; received ratio ${ratio.toFixed(3)}`);
  const quality = await inspectPanoramaQuality(source);
  assertPanoramaQuality(quality);

  const workflowFile = path.join(root, "artifact-workflow.json");
  let workflow = readJson(workflowFile);
  validateArtifactWorkflow(workflow);
  const artifactId = `panorama-${kind}-${nodeId}`;
  let promptArtifact = null;
  let prompt = null;
  if (kind === "photorealistic") {
    if (!promptId) throw new Error("photorealistic panoramas require --prompt-id from the confirmed Imagegen prompt package");
    promptArtifact = workflow.artifacts[`panorama-imagegen-prompt-${nodeId}`];
    if (promptArtifact?.status !== "confirmed" || !promptArtifact.file || !promptArtifact.sha256) {
      throw new Error(`panorama-imagegen-prompt-${nodeId} must be confirmed before registering a photorealistic panorama`);
    }
    const promptFile = path.resolve(root, promptArtifact.file);
    if (!inside(root, promptFile) || !fs.existsSync(promptFile)) throw new Error("confirmed Imagegen prompt package is missing");
    prompt = readJson(promptFile);
    if (prompt.promptId !== promptId) throw new Error(`prompt id mismatch: expected ${prompt.promptId}`);
    if (crypto.createHash("sha256").update(fs.readFileSync(promptFile)).digest("hex") !== promptArtifact.sha256) {
      throw new Error("confirmed Imagegen prompt package hash does not match the workflow");
    }
  }
  const sha256 = crypto.createHash("sha256").update(value).digest("hex");
  const current = workflow.artifacts[artifactId];
  if (!current) throw new Error(`missing workflow artifact: ${artifactId}`);
  if (current.sha256 && current.sha256 !== sha256 && current.status !== "draft") {
    workflow = modifyArtifact(workflow, artifactId, { reason: `${kind} panorama image content changed` });
  }
  if (workflow.artifacts[artifactId].status !== "confirmed" || workflow.artifacts[artifactId].sha256 !== sha256) workflow = markArtifactReady(workflow, artifactId, {
    file: slash(path.relative(root, source)),
    sha256,
  });
  writeJson(workflowFile, workflow);

  const ledgerFile = path.join(root, "panorama-production.json");
  const ledger = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : {
    contract: "personal-agent/interior-panorama-production/v5",
    projectId: geometry.projectId,
    policy: "one-view-one-image-one-confirmation",
    records: [],
  };
  const controlRecord = [...ledger.records].reverse().find((entry) => entry.nodeId === nodeId && entry.kind === "control");
  const resolvedOrientation = Number.isFinite(orientationOffsetDeg)
    ? orientationOffsetDeg
    : (kind === "photorealistic" && Number.isFinite(controlRecord?.orientationOffsetDeg) ? controlRecord.orientationOffsetDeg : 0);
  ledger.records.push({
    sequence: ledger.records.length + 1,
    at: new Date().toISOString(),
    nodeId,
    kind,
    artifactId,
    artifactRevision: workflow.artifacts[artifactId].revision,
    generator,
    promptId,
    promptArtifactId: promptArtifact?.id ?? null,
    promptRevision: promptArtifact?.revision ?? null,
    promptSha256: promptArtifact?.sha256 ?? null,
    file: slash(path.relative(root, source)),
    sha256: workflow.artifacts[artifactId].sha256,
    width: dimensions.width,
    height: dimensions.height,
    orientationOffsetDeg: resolvedOrientation,
    quality,
    normalization,
  });
  writeJson(ledgerFile, ledger);
  return { ok: true, artifact: workflow.artifacts[artifactId], dimensions, record: ledger.records.at(-1) };
}

export function imageDimensions(value) {
  if (value.length >= 24 && value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { format: "png", width: value.readUInt32BE(16), height: value.readUInt32BE(20) };
  }
  if (value.length >= 4 && value[0] === 0xff && value[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < value.length) {
      if (value[offset] !== 0xff) { offset += 1; continue; }
      const marker = value[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: "jpeg", height: value.readUInt16BE(offset + 5), width: value.readUInt16BE(offset + 7) };
      }
      const length = value.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  throw new Error("panorama file must be a valid PNG or JPEG image");
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function slash(value) { return value.split(path.sep).join("/"); }
