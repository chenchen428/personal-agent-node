import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  confirmArtifact,
  markArtifactReady,
  modifyArtifact,
  validateArtifactWorkflow,
} from "./artifact-workflow-v5.mjs";

const CONTRACT = "personal-agent/interior-imagegen-panorama-prompt/v5";

export function prepareImagegenPanoramaPrompt({ projectDir, nodeId }) {
  const root = path.resolve(projectDir);
  const projectFile = path.join(root, "project.json");
  const geometryFile = path.join(root, "geometry.json");
  const workflowFile = path.join(root, "artifact-workflow.json");
  const project = readJson(projectFile);
  const geometry = readJson(geometryFile);
  let workflow = readJson(workflowFile);
  validateArtifactWorkflow(workflow);

  const node = (geometry.panoramaNodes ?? []).find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`unknown panorama node: ${nodeId}`);
  const controlId = `panorama-control-${nodeId}`;
  const promptArtifactId = `panorama-imagegen-prompt-${nodeId}`;
  const control = workflow.artifacts[controlId];
  const promptArtifact = workflow.artifacts[promptArtifactId];
  if (control?.status !== "confirmed" || !control.file || !control.sha256) {
    throw new Error(`${controlId} must be confirmed before preparing the Imagegen prompt`);
  }
  if (!promptArtifact) throw new Error(`missing workflow artifact: ${promptArtifactId}`);

  const previousPhotoId = promptArtifact.dependsOn.find((id) => id.startsWith("panorama-photorealistic-"));
  const previousPhoto = previousPhotoId ? workflow.artifacts[previousPhotoId] : null;
  if (previousPhoto && (previousPhoto.status !== "confirmed" || !previousPhoto.file || !previousPhoto.sha256)) {
    throw new Error(`${previousPhotoId} must be confirmed before preparing ${promptArtifactId}`);
  }

  if (promptArtifact.status === "invalidated") {
    workflow = modifyArtifact(workflow, promptArtifactId, { reason: "upstream design, camera, control, or style reference changed" });
  }
  const output = path.join(root, "panoramas", "prompts", `${nodeId}.json`);
  let compiled = compilePrompt(workflow.artifacts[promptArtifactId].revision);
  let current = workflow.artifacts[promptArtifactId];

  if (current.status === "confirmed" && current.sha256 === compiled.promptSha256 && current.file === slash(path.relative(root, output))) {
    return { ok: true, artifact: current, prompt: compiled.prompt, automaticConfirmation: true, unchanged: true };
  }
  if (current.status !== "draft" && current.status !== "invalidated") {
    workflow = modifyArtifact(workflow, promptArtifactId, { reason: "Imagegen prompt package changed" });
    current = workflow.artifacts[promptArtifactId];
    compiled = compilePrompt(current.revision);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, compiled.value, "utf8");
  workflow = markArtifactReady(workflow, promptArtifactId, {
    file: slash(path.relative(root, output)),
    sha256: compiled.promptSha256,
  });
  workflow = confirmArtifact(workflow, promptArtifactId, {
    confirmedBy: "agent-prompt-compiler",
    summary: "已绑定确认设计、相机、Blender 控制图和前序实景风格参考",
  });
  writeJson(workflowFile, workflow);
  return { ok: true, artifact: workflow.artifacts[promptArtifactId], prompt: compiled.prompt, automaticConfirmation: true, unchanged: false };

  function compilePrompt(revision) {
    const promptId = `${project.projectId}:${nodeId}:imagegen-r${revision}`;
    const prompt = buildPrompt({
      project,
      geometry,
      node,
      promptId,
      projectSha256: sha256File(projectFile),
      geometrySha256: sha256File(geometryFile),
      control,
      previousPhoto,
    });
    const value = `${JSON.stringify(prompt, null, 2)}\n`;
    return { prompt, value, promptSha256: sha256(value) };
  }
}

function buildPrompt({ project, geometry, node, promptId, projectSha256, geometrySha256, control, previousPhoto }) {
  const style = project.design?.style ?? {};
  const concept = project.design?.concept ?? {};
  const room = (geometry.rooms ?? []).find((entry) => entry.id === node.roomId);
  const materials = (project.design?.materials ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    color: item.color ?? null,
    specification: item.specification ?? null,
  }));
  const inputImages = [
    { index: 1, role: "geometry-control", file: control.file, sha256: control.sha256 },
    ...(previousPhoto ? [{ index: 2, role: "confirmed-style-reference", file: previousPhoto.file, sha256: previousPhoto.sha256 }] : []),
  ];
  const materialText = materials.map((item) => `${item.name}${item.color ? ` ${item.color}` : ""}${item.specification ? `，${item.specification}` : ""}`).join("；");
  const finalPrompt = [
    "Use case: sketch-to-render",
    "Asset type: krpano 360-degree photorealistic interior panorama source",
    `Primary request: 按已确认装修设计，将“${node.title ?? room?.name ?? node.id}”生成一张完整、照片级的 2:1 等距柱状 360°×180°实景全景图。`,
    `Input images: Image 1 是必须严格遵循的 Blender 空间结构控制底稿${previousPhoto ? "；Image 2 是已确认的前序实景全景，只约束材质、灯光、色调和摄影质感" : ""}。`,
    `Scene/backdrop: ${room?.name ?? node.roomId ?? "室内空间"}；设计概念“${concept.name ?? project.title}”，${concept.summary ?? "遵循已确认空间设计"}。`,
    `Style/medium: photorealistic architectural interior photography；${style.name ?? "自然、克制、耐久"}；关键词 ${(style.keywords ?? []).join("、")}。`,
    `Composition/framing: 2:1 equirectangular projection，固定相机位置 ${formatPoint(node.position)} mm，朝向 ${formatPoint(node.lookAt)} mm，相机高度和地平线不得改变。`,
    `Lighting/mood: ${style.lighting ?? "自然光与分层室内照明，真实曝光，低眩光"}。`,
    `Color palette: ${(style.palette ?? []).join("、") || "遵循设计稿"}。`,
    `Materials/textures: ${materialText || "严格遵循设计稿中的材料和真实尺度纹理"}。`,
    "Constraints: 保持 Image 1 的房间拓扑、墙体、门窗数量与位置、固定柜体、主要家具位置、尺度关系和相机视角；完整覆盖相机四周及上下方向；左右边界必须无缝连续；真实材质、真实反射、真实阴影；输出只能是一张完整的 2:1 等距柱状全景图。",
    "Avoid: 不新增或删除门窗、墙体、固定柜体和主要家具；不改变房间比例；不生成普通 16:9 透视图；不拉伸图片；不把多张独立视角拼接；不出现鱼眼画框、黑边、文字、标注、logo、水印、人物或施工状态。",
  ].join("\n");
  return {
    contract: CONTRACT,
    promptId,
    projectId: project.projectId,
    projectRevision: project.revision,
    nodeId: node.id,
    roomId: node.roomId ?? null,
    useCase: "sketch-to-render",
    execution: {
      skill: "imagegen",
      mode: "built-in",
      policy: "one-node-one-call-one-image",
      outputProjection: "2:1-equirectangular-360x180",
      minimumGeneratedCanvas: { width: 1536, height: 768 },
      deliveryCanvas: { width: 4096, height: 2048 },
      deliveryPostprocess: "same-projection-deterministic-resize-and-wrap-seam-stitch",
    },
    inputs: {
      project: { file: "project.json", sha256: projectSha256 },
      geometry: { file: "geometry.json", sha256: geometrySha256 },
      images: inputImages,
      camera: { position: node.position, lookAt: node.lookAt, initialView: node.initialView ?? null },
    },
    design: { concept, style, materials },
    finalPrompt,
  };
}

function formatPoint(point = []) { return point.map((value) => Math.round(value)).join(", "); }
function sha256File(file) { return sha256(fs.readFileSync(file)); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function slash(value) { return value.split(path.sep).join("/"); }
