import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { confirmArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { buildModelPrimitives } from "./geometry-v5.mjs";
import { registerPanoramaImage } from "./panorama-artifacts-v5.mjs";
import { normalizePanoramaSeam } from "./panorama-quality-v5.mjs";

export async function renderPanoramaControl({ projectDir, nodeId, blender }) {
  const root = path.resolve(projectDir);
  const executable = path.resolve(blender);
  if (!fs.existsSync(executable)) throw new Error(`Blender executable does not exist: ${executable}`);
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const workflow = readJson(path.join(root, "artifact-workflow.json"));
  validateArtifactWorkflow(workflow);
  if (workflow.artifacts["spatial-sketch-3d"].status !== "confirmed") throw new Error("spatial-sketch-3d must be confirmed before panorama rendering");
  if (workflow.artifacts[`panorama-camera-${nodeId}`]?.status !== "confirmed") throw new Error(`panorama-camera-${nodeId} must be confirmed before base rendering`);
  const node = geometry.panoramaNodes.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`unknown panorama node: ${nodeId}`);

  const sceneFile = path.join(root, "derived", `panorama-scene-${nodeId}.json`);
  const rawOutput = path.join(root, "derived", `panorama-control-raw-${nodeId}.png`);
  const output = path.join(root, "panoramas", "control", `${nodeId}.png`);
  const floorColor = project.design?.materials?.find((entry) => entry.id === "floor-oak")?.color ?? "#d7c7ae";
  const scene = {
    contract: "personal-agent/interior-blender-panorama-scene/v5",
    projectId: project.projectId,
    revision: project.revision,
    node,
    rooms: geometry.rooms.map((room) => ({ ...room, color: floorColor })),
    ceilingZones: geometry.ceilingZones,
    points: geometry.points,
    primitives: buildModelPrimitives(project, geometry),
  };
  writeJson(sceneFile, scene);
  fs.mkdirSync(path.dirname(rawOutput), { recursive: true });
  const script = path.join(import.meta.dirname, "blender-panorama-v5.py");
  const result = spawnSync(executable, ["--background", "--factory-startup", "--python", script, "--", "--scene", sceneFile, "--output", rawOutput], { encoding: "utf8", timeout: 20 * 60 * 1000 });
  if (result.error || result.status !== 0 || !fs.existsSync(rawOutput)) throw new Error(`Blender panorama render failed: ${result.error?.message || result.stderr || result.stdout}`);
  const normalization = await normalizePanoramaSeam({ source: rawOutput, output });
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
    },
  });
  const workflowFile = path.join(root, "artifact-workflow.json");
  let updated = readJson(workflowFile);
  const artifactId = `panorama-control-${nodeId}`;
  if (updated.artifacts[artifactId].status === "ready-for-review") {
    updated = confirmArtifact(updated, artifactId, {
      confirmedBy: "agent-quality-gate",
      summary: "Blender 结构控制底稿已通过 2:1、相机、接缝与文件完整性检查",
    });
    writeJson(workflowFile, updated);
  }
  return { ...registered, artifact: updated.artifacts[artifactId], automaticConfirmation: true };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function slash(value) { return value.split(path.sep).join("/"); }
