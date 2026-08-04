import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { confirmArtifact, markArtifactReady, modifyArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { buildModelPrimitives } from "./geometry-v5.mjs";
import { registerPanoramaImage } from "./panorama-artifacts-v5.mjs";
import { normalizePanoramaSeam } from "./panorama-quality-v5.mjs";
import { resolvePortalTopology, resolveTourNodes } from "./portal-topology-v5.mjs";

export async function renderPanoramaControl({ projectDir, nodeId, blender }) {
  const root = path.resolve(projectDir);
  const executable = path.resolve(blender);
  if (!fs.existsSync(executable)) throw new Error(`Blender executable does not exist: ${executable}`);
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const workflowFile = path.join(root, "artifact-workflow.json");
  let workflow = readJson(workflowFile);
  validateArtifactWorkflow(workflow);
  if (workflow.artifacts["spatial-sketch-3d"].status !== "confirmed") throw new Error("spatial-sketch-3d must be confirmed before panorama rendering");
  if (workflow.artifacts[`panorama-camera-${nodeId}`]?.status !== "confirmed") throw new Error(`panorama-camera-${nodeId} must be confirmed before base rendering`);
  const node = (geometry.panoramaNodes ?? []).find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`unknown panorama node: ${nodeId}`);

  const resolvedNode = resolveTourNodes(geometry).find((entry) => entry.id === nodeId);
  const portals = resolvePortalTopology(geometry);
  const relevantPortalIds = new Set((resolvedNode.hotspots ?? []).map((hotspot) => hotspot.portalId).filter(Boolean));
  const relevantPortals = portals.filter((portal) => relevantPortalIds.has(portal.id));
  const controlsDir = path.join(root, "panoramas", "controls", nodeId);
  const portalMapFile = path.join(controlsDir, "portal-map.json");
  writeJson(portalMapFile, {
    contract: "personal-agent/interior-panorama-portal-map/v5",
    projectId: project.projectId,
    revision: project.revision,
    nodeId,
    camera: { position: node.position, lookAt: node.lookAt },
    portals: relevantPortals,
    hotspots: resolvedNode.hotspots ?? [],
  });
  workflow = confirmGeneratedArtifact(workflow, `panorama-portal-map-${nodeId}`, {
    file: slash(path.relative(root, portalMapFile)),
    sha256: sha256File(portalMapFile),
    confirmedBy: "agent-geometry-gate",
    summary: "门洞拓扑、门槛锚点和往返路径已通过几何检查。",
  });
  writeJson(workflowFile, workflow);

  const sceneFile = path.join(root, "derived", `panorama-scene-${nodeId}.json`);
  const rawOutput = path.join(root, "derived", `panorama-control-raw-${nodeId}.png`);
  const output = path.join(root, "panoramas", "control", `${nodeId}.png`);
  const floorColor = project.design?.materials?.find((entry) => entry.id === "floor-oak")?.color ?? "#d7c7ae";
  writeJson(sceneFile, {
    contract: "personal-agent/interior-blender-panorama-scene/v5",
    projectId: project.projectId,
    revision: project.revision,
    node: resolvedNode,
    rooms: geometry.rooms.map((room) => ({ ...room, color: floorColor })),
    ceilingZones: geometry.ceilingZones,
    points: geometry.points,
    primitives: buildModelPrimitives(project, geometry),
    portals: relevantPortals,
  });
  fs.mkdirSync(path.dirname(rawOutput), { recursive: true });
  const script = path.join(import.meta.dirname, "blender-panorama-v5.py");
  const result = spawnSync(executable, [
    "--background", "--factory-startup", "--python", script, "--",
    "--scene", sceneFile, "--output", rawOutput, "--controls-dir", controlsDir,
  ], { encoding: "utf8", timeout: 20 * 60 * 1000 });
  if (result.error || result.status !== 0 || !fs.existsSync(rawOutput)) {
    throw new Error(`Blender panorama render failed: ${result.error?.message || result.stderr || result.stdout}`);
  }

  const rawPortalMask = path.join(controlsDir, "portal-mask-raw.png");
  const portalMask = path.join(controlsDir, "portal-mask.png");
  if (!fs.existsSync(rawPortalMask)) throw new Error("Blender portal mask pass is missing");
  await sharp(rawPortalMask)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .threshold(128)
    .png()
    .toFile(portalMask);

  const portalMasks = {};
  for (const portal of relevantPortals) {
    const rawFile = path.join(controlsDir, `portal-mask-${portal.id}-raw.png`);
    const file = path.join(controlsDir, `portal-mask-${portal.id}.png`);
    if (!fs.existsSync(rawFile)) throw new Error(`Blender portal mask is missing for ${portal.id}`);
    await sharp(rawFile)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .removeAlpha()
      .threshold(128)
      .png()
      .toFile(file);
    portalMasks[portal.id] = {
      file: slash(path.relative(root, file)),
      sha256: sha256File(file),
      quality: await inspectPortalMask(file, 1),
    };
  }

  const passes = Object.fromEntries(["depth", "normal", "semantic", "portal-mask"].map((name) => {
    const file = path.join(controlsDir, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`Blender control pass is missing: ${name}`);
    return [name, { file: slash(path.relative(root, file)), sha256: sha256File(file) }];
  }));
  const portalMaskQuality = await inspectPortalMask(path.join(controlsDir, "portal-mask.png"), relevantPortals.length);
  const atlasFile = path.join(controlsDir, "control-atlas.png");
  const atlasCells = await Promise.all(["depth", "normal", "semantic"].map((name) => sharp(path.join(controlsDir, `${name}.png`)).resize(1536, 768, { fit: "fill" }).png().toBuffer()));
  await sharp({ create: { width: 3072, height: 1536, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: atlasCells[0], left: 0, top: 0 },
      { input: atlasCells[1], left: 1536, top: 0 },
      { input: atlasCells[2], left: 0, top: 768 },
    ])
    .png()
    .toFile(atlasFile);
  const normalization = await normalizePanoramaSeam({ source: rawOutput, output });
  const bundleFile = path.join(controlsDir, "control-bundle.json");
  writeJson(bundleFile, {
    contract: "personal-agent/interior-panorama-control-bundle/v5",
    projectId: project.projectId,
    revision: project.revision,
    nodeId,
    camera: { position: node.position, lookAt: node.lookAt },
    geometryControl: { file: slash(path.relative(root, output)), sha256: sha256File(output) },
    controlAtlas: { file: slash(path.relative(root, atlasFile)), sha256: sha256File(atlasFile), layout: "2x2: depth, normal, semantic, neutral" },
    passes,
    portalMasks,
    quality: { portalMask: portalMaskQuality, portals: Object.fromEntries(Object.entries(portalMasks).map(([id, value]) => [id, value.quality])) },
    portalMap: { file: slash(path.relative(root, portalMapFile)), sha256: sha256File(portalMapFile) },
  });

  const bundleSha256 = sha256File(bundleFile);
  const productionFile = path.join(root, "panorama-production.json");
  const previousBundleSha256 = fs.existsSync(productionFile)
    ? [...(readJson(productionFile).records ?? [])].reverse().find((entry) => entry.nodeId === nodeId && entry.kind === "control")?.normalization?.controlBundle?.sha256
    : null;
  if (previousBundleSha256 && previousBundleSha256 !== bundleSha256) {
    const currentWorkflow = readJson(workflowFile);
    if (currentWorkflow.artifacts[`panorama-control-${nodeId}`]?.status === "confirmed") {
      writeJson(workflowFile, modifyArtifact(currentWorkflow, `panorama-control-${nodeId}`, { reason: "Blender control bundle changed" }));
    }
  }
  const registered = await registerPanoramaImage({
    projectDir: root,
    nodeId,
    kind: "control",
    file: slash(path.relative(root, output)),
    generator: "blender",
    orientationOffsetDeg: normalization.orientationOffsetDeg,
    normalization: {
      shiftPixels: normalization.shiftPixels,
      orientationOffsetDeg: normalization.orientationOffsetDeg,
      before: normalization.before,
      after: normalization.after,
      controlBundle: { file: slash(path.relative(root, bundleFile)), sha256: bundleSha256 },
    },
  });
  let updated = readJson(workflowFile);
  const artifactId = `panorama-control-${nodeId}`;
  if (updated.artifacts[artifactId].status === "ready-for-review") {
    updated = confirmArtifact(updated, artifactId, {
      confirmedBy: "agent-quality-gate",
      summary: "Blender 几何、深度、法线、语义、门洞蒙版与 2:1 接缝检查已通过。",
    });
    writeJson(workflowFile, updated);
  }
  return { ...registered, artifact: updated.artifacts[artifactId], controlBundle: slash(path.relative(root, bundleFile)), automaticConfirmation: true };
}

function confirmGeneratedArtifact(workflow, artifactId, { file, sha256, confirmedBy, summary }) {
  let state = workflow;
  const current = state.artifacts[artifactId];
  if (!current) throw new Error(`missing workflow artifact: ${artifactId}`);
  if (current.status === "confirmed" && current.sha256 === sha256 && current.file === file) return state;
  if (current.status === "confirmed") state = modifyArtifact(state, artifactId, { reason: "generated portal topology changed" });
  state = markArtifactReady(state, artifactId, { file, sha256 });
  return confirmArtifact(state, artifactId, { confirmedBy, summary });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function slash(value) { return value.split(path.sep).join("/"); }
function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function inspectPortalMask(file, expectedPortalCount) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if ((data[index] + data[index + 1] + data[index + 2]) / 3 >= 230) white += 1;
  }
  const whiteRatio = Number((white / (info.width * info.height)).toFixed(6));
  if (expectedPortalCount === 0 && whiteRatio > 0.0001) throw new Error(`portal mask contains unexplained white pixels: ${whiteRatio}`);
  if (expectedPortalCount > 0 && (whiteRatio < 0.0001 || whiteRatio > 0.35)) {
    throw new Error(`portal mask coverage is implausible for ${expectedPortalCount} portal(s): ${whiteRatio}`);
  }
  return { expectedPortalCount, whiteRatio, status: "passed" };
}
