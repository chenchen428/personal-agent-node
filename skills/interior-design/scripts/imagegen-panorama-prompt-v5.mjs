import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { confirmArtifact, markArtifactReady, modifyArtifact, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { resolveTourNodes } from "./portal-topology-v5.mjs";

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

  const node = resolveTourNodes(geometry).find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`unknown panorama node: ${nodeId}`);
  const controlId = `panorama-control-${nodeId}`;
  const promptArtifactId = `panorama-imagegen-prompt-${nodeId}`;
  const control = workflow.artifacts[controlId];
  const promptArtifact = workflow.artifacts[promptArtifactId];
  if (control?.status !== "confirmed" || !control.file || !control.sha256) throw new Error(`${controlId} must be confirmed before preparing the Imagegen prompt`);
  if (!promptArtifact) throw new Error(`missing workflow artifact: ${promptArtifactId}`);

  const bundleFile = path.join(root, "panoramas", "controls", nodeId, "control-bundle.json");
  if (!fs.existsSync(bundleFile)) throw new Error(`control bundle is missing for ${nodeId}`);
  const controlBundle = readJson(bundleFile);
  if (controlBundle.contract !== "personal-agent/interior-panorama-control-bundle/v5") throw new Error(`invalid control bundle for ${nodeId}`);
  verifyControlBundle(root, controlBundle);

  const previousPhotoId = promptArtifact.dependsOn.find((id) => id.startsWith("panorama-photorealistic-"));
  const previousPhoto = previousPhotoId ? workflow.artifacts[previousPhotoId] : null;
  if (previousPhoto && (previousPhoto.status !== "confirmed" || !previousPhoto.file || !previousPhoto.sha256)) {
    throw new Error(`${previousPhotoId} must be confirmed before preparing ${promptArtifactId}`);
  }
  if (promptArtifact.status === "invalidated") workflow = modifyArtifact(workflow, promptArtifactId, { reason: "upstream design, camera, control, portal, or style reference changed" });

  const output = path.join(root, "panoramas", "prompts", `${nodeId}.json`);
  let compiled = compilePrompt(workflow.artifacts[promptArtifactId].revision);
  let current = workflow.artifacts[promptArtifactId];
  if (current.status === "confirmed" && current.sha256 === compiled.promptSha256 && current.file === slash(path.relative(root, output))) {
    return { ok: true, artifact: current, prompt: compiled.prompt, automaticConfirmation: true, unchanged: true };
  }
  if (!["draft", "invalidated"].includes(current.status)) {
    workflow = modifyArtifact(workflow, promptArtifactId, { reason: "Imagegen prompt package changed" });
    current = workflow.artifacts[promptArtifactId];
    compiled = compilePrompt(current.revision);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, compiled.value, "utf8");
  workflow = markArtifactReady(workflow, promptArtifactId, { file: slash(path.relative(root, output)), sha256: compiled.promptSha256 });
  workflow = confirmArtifact(workflow, promptArtifactId, {
    confirmedBy: "agent-prompt-compiler",
    summary: "已绑定设计、相机、门洞拓扑、五类 Blender 控制通道和前序实景风格。",
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
      controlBundle,
      controlBundleSha256: sha256File(bundleFile),
      previousPhoto,
    });
    const value = `${JSON.stringify(prompt, null, 2)}\n`;
    return { prompt, value, promptSha256: sha256(value) };
  }
}

function buildPrompt({ project, geometry, node, promptId, projectSha256, geometrySha256, control, controlBundle, controlBundleSha256, previousPhoto }) {
  const style = project.design?.style ?? {};
  const concept = project.design?.concept ?? {};
  const room = (geometry.rooms ?? []).find((entry) => entry.id === node.roomId);
  const materials = (project.design?.materials ?? []).map((item) => ({ id: item.id, name: item.name, color: item.color ?? null, specification: item.specification ?? null }));
  const controlInputs = [
    { index: 1, role: "hard-geometry-control", ...controlBundle.geometryControl },
    { index: 2, role: "depth-normal-semantic-control-atlas", ...controlBundle.controlAtlas },
    { index: 3, role: "portal-mask-control", ...controlBundle.passes["portal-mask"] },
  ];
  const inputImages = [...controlInputs, ...(previousPhoto ? [{ index: 4, role: "confirmed-style-reference", file: previousPhoto.file, sha256: previousPhoto.sha256 }] : [])];
  const materialText = materials.map((item) => `${item.name}${item.color ? ` ${item.color}` : ""}${item.specification ? `；${item.specification}` : ""}`).join("；");
  const portalText = (node.hotspots ?? []).filter((item) => item.kind === "portal").map((item) => `${item.label}：门洞 ${item.portalId} 必须保持开启并可通行`).join("；") || "本机位没有可通行门洞";
  const finalPrompt = [
    "Use case: sketch-to-render",
    "Asset type: krpano 360-degree photorealistic interior panorama source",
    `Primary request: 按已确认装修设计，将“${node.title ?? room?.name ?? node.id}”完善为一张完整、照片级的 2:1 等距柱状 360°×180°实景全景图。`,
    `Input images: Image 1 锁定硬结构与相机；Image 2 是 2×2 控制图集，左上深度、右上法线、左下语义、右下留空；Image 3 锁定可通行门洞${previousPhoto ? "；Image 4 仅约束已确认材质、灯光和摄影质感" : ""}。`,
    `Scene/backdrop: ${room?.name ?? node.roomId ?? "室内空间"}；设计概念“${concept.name ?? project.title}”，${concept.summary ?? "遵循已确认空间设计"}。`,
    `Style/medium: photorealistic architectural interior photography；${style.name ?? "自然、克制、耐久"}；关键词 ${(style.keywords ?? []).join("、")}。`,
    `Composition/framing: 2:1 equirectangular projection，固定相机位置 ${formatPoint(node.position)} mm，朝向 ${formatPoint(node.lookAt)} mm，相机高度、地平线和 0°/360° 方位不得改变。`,
    `Lighting/mood: ${style.lighting ?? "自然光与分层室内照明，真实曝光，低眩光"}。`,
    `Color palette: ${(style.palette ?? []).join("、") || "遵循设计稿"}。`,
    `Materials/textures: ${materialText || "严格遵循设计稿中的材料和真实尺度纹理"}。`,
    `Portal constraints: ${portalText}。`,
    "Constraints: 只增强材质、灯光、软装表面和生活细节；墙体、门洞、门扇开启状态、门窗数量与位置、固定柜体、吊顶边界、主要家具位置、尺度关系、遮挡关系和相机必须与控制图一致；输出必须是单张完整且首尾连续的 2:1 等距柱状全景图。",
    "Avoid: 不新增、删除或移动墙体、门窗、固定柜体、吊顶和主要家具；不封闭可通行门洞；不把门画在柜体或墙面上；不生成普通透视图，不拉伸，不拼接互不一致的视角；不要鱼眼画框、黑边、文字、标注、logo、水印、人物或施工状态。",
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
      deliveryPostprocess: "geometry-aware-yaw-segment-composite-and-wrap-seam-stitch",
    },
    inputs: {
      project: { file: "project.json", sha256: projectSha256 },
      geometry: { file: "geometry.json", sha256: geometrySha256 },
      controlBundle: { file: `panoramas/controls/${node.id}/control-bundle.json`, sha256: controlBundleSha256 },
      images: inputImages,
      camera: { position: node.position, lookAt: node.lookAt, initialView: node.initialView ?? null },
      portals: (node.hotspots ?? []).filter((item) => item.kind === "portal").map((item) => item.portal),
    },
    design: { concept, style, materials },
    invariants: ["hard-geometry", "portal-topology", "camera", "equirectangular-projection", "wrap-seam"],
    finalPrompt,
  };
}

function verifyControlBundle(root, bundle) {
  const entries = [bundle.geometryControl, bundle.controlAtlas, bundle.portalMap, ...Object.values(bundle.passes ?? {})];
  for (const entry of entries) {
    const file = path.resolve(root, entry?.file ?? "");
    if (!entry?.file || !inside(root, file) || !fs.existsSync(file)) throw new Error("control bundle references a missing file");
    if (sha256File(file) !== entry.sha256) throw new Error(`control bundle hash mismatch: ${entry.file}`);
  }
}

function formatPoint(point = []) { return point.map((value) => Math.round(value)).join(", "); }
function sha256File(file) { return sha256(fs.readFileSync(file)); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function slash(value) { return value.split(path.sep).join("/"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
