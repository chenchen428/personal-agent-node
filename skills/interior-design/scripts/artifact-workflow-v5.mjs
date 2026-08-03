const CONTRACT = "personal-agent/interior-artifact-workflow/v5";

export const DRAWING_ARTIFACTS = Object.freeze([
  ["drawing-plan-layout", "平面布置图", "pages/assets/drawings/p-01-plan-layout.svg"],
  ["drawing-ceiling-lighting", "天花与灯具图", "pages/assets/drawings/c-01-ceiling-lighting.svg"],
  ["drawing-switch-control", "开关控制图", "pages/assets/drawings/e-01-switch-control.svg"],
  ["drawing-socket-layout", "插座点位图", "pages/assets/drawings/e-02-socket-layout.svg"],
  ["drawing-plumbing", "给排水图", "pages/assets/drawings/w-01-plumbing.svg"],
  ["drawing-cabinet", "柜体深化图", "pages/assets/drawings/m-01-cabinet.svg"],
]);

function artifact(id, title, kind, dependsOn = [], file = null) {
  return {
    id,
    title,
    kind,
    status: "draft",
    revision: 1,
    dependsOn,
    file,
    sha256: null,
    confirmation: null,
    invalidatedBy: [],
    updatedAt: null,
  };
}

function panoramaDefinitions(geometry = {}) {
  const explicit = Array.isArray(geometry.panoramaNodes) ? geometry.panoramaNodes : [];
  if (explicit.length > 0) return explicit;
  return (geometry.cameras ?? []).map((camera, index) => ({
    id: camera.id ?? `view-${index + 1}`,
    title: camera.label ?? camera.name ?? `视角 ${index + 1}`,
  }));
}

function panoramaArtifacts(node, previousPhotorealisticId = null) {
  const id = String(node.id);
  const title = node.title ?? node.label ?? id;
  const cameraId = `panorama-camera-${id}`;
  const controlId = `panorama-control-${id}`;
  const promptId = `panorama-imagegen-prompt-${id}`;
  const photorealisticId = `panorama-photorealistic-${id}`;
  const hotspotId = `panorama-hotspots-${id}`;
  const promptDependencies = previousPhotorealisticId
    ? [controlId, previousPhotorealisticId]
    : [controlId];
  return [
    artifact(cameraId, `${title} · 相机视角`, "panorama-camera", ["spatial-sketch-3d"]),
    artifact(controlId, `${title} · Blender 结构控制底稿`, "panorama-control", [cameraId]),
    artifact(promptId, `${title} · Imagegen 提示词包`, "panorama-imagegen-prompt", promptDependencies, `panoramas/prompts/${id}.json`),
    artifact(photorealisticId, `${title} · Imagegen 实景全景图`, "panorama-photorealistic", [promptId]),
    artifact(hotspotId, `${title} · 热点关系`, "panorama-hotspots", [cameraId, photorealisticId]),
  ];
}

function clone(value) {
  return structuredClone(value);
}

function now() {
  return new Date().toISOString();
}

function addEvent(state, type, artifactId, detail = {}) {
  state.events.push({
    sequence: state.events.length + 1,
    at: now(),
    type,
    artifactId,
    ...detail,
  });
  state.updatedAt = state.events.at(-1).at;
}

function requireArtifact(state, artifactId) {
  const item = state.artifacts[artifactId];
  if (!item) throw new Error(`Unknown interior artifact: ${artifactId}`);
  return item;
}

function descendants(state, rootId) {
  const found = new Set();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const item of Object.values(state.artifacts)) {
      if (!found.has(item.id) && item.dependsOn.includes(current)) {
        found.add(item.id);
        queue.push(item.id);
      }
    }
  }
  return [...found];
}

export function createArtifactWorkflow({ projectId, geometry = {} }) {
  const artifacts = {};
  for (const [id, title, file] of DRAWING_ARTIFACTS) {
    artifacts[id] = artifact(id, title, "drawing", [], file);
  }
  artifacts["spatial-sketch-3d"] = artifact(
    "spatial-sketch-3d",
    "可进入查看的语义 3D 草图",
    "spatial-sketch",
    DRAWING_ARTIFACTS.map(([id]) => id),
    "pages/model.html",
  );

  const photorealisticIds = [];
  const hotspotIds = [];
  let previousPhotorealisticId = null;
  for (const node of panoramaDefinitions(geometry)) {
    for (const item of panoramaArtifacts(node, previousPhotorealisticId)) artifacts[item.id] = item;
    const photorealisticId = `panorama-photorealistic-${node.id}`;
    photorealisticIds.push(photorealisticId);
    hotspotIds.push(`panorama-hotspots-${node.id}`);
    previousPhotorealisticId = photorealisticId;
  }
  artifacts["krpano-tour"] = artifact(
    "krpano-tour",
    "krpano 全景漫游",
    "tour",
    [...photorealisticIds, ...hotspotIds],
    "pages/tour/index.html",
  );
  artifacts["tour-walkthrough"] = artifact(
    "tour-walkthrough",
    "全景漫游走查记录",
    "walkthrough",
    ["krpano-tour"],
    "review/tour-walkthrough.json",
  );
  artifacts["owner-page-final"] = artifact(
    "owner-page-final",
    "用户设计工作区",
    "delivery",
    [...DRAWING_ARTIFACTS.map(([id]) => id), "spatial-sketch-3d", "tour-walkthrough"],
    "pages/index.html",
  );

  return {
    $schema: CONTRACT,
    version: 5,
    projectId,
    createdAt: now(),
    updatedAt: null,
    artifacts,
    events: [],
  };
}

export function markArtifactReady(workflow, artifactId, { file, sha256 } = {}) {
  const state = clone(workflow);
  const item = requireArtifact(state, artifactId);
  item.status = "ready-for-review";
  item.file = file ?? item.file;
  item.sha256 = sha256 ?? item.sha256;
  item.confirmation = null;
  item.invalidatedBy = [];
  item.updatedAt = now();
  addEvent(state, "artifact-ready", artifactId, { revision: item.revision });
  return state;
}

export function confirmArtifact(workflow, artifactId, { summary, confirmedBy = "user" } = {}) {
  const state = clone(workflow);
  const item = requireArtifact(state, artifactId);
  if (item.status !== "ready-for-review") {
    throw new Error(`${artifactId} is ${item.status}; it must be ready-for-review before confirmation.`);
  }
  const unconfirmed = item.dependsOn.filter((id) => state.artifacts[id]?.status !== "confirmed");
  if (unconfirmed.length > 0) {
    throw new Error(`${artifactId} has unconfirmed dependencies: ${unconfirmed.join(", ")}`);
  }
  item.status = "confirmed";
  item.confirmation = { confirmedAt: now(), confirmedBy, summary: summary ?? "已确认" };
  item.updatedAt = item.confirmation.confirmedAt;
  addEvent(state, "artifact-confirmed", artifactId, { revision: item.revision, summary });
  return state;
}

export function modifyArtifact(workflow, artifactId, { reason = "内容已修改" } = {}) {
  const state = clone(workflow);
  const item = requireArtifact(state, artifactId);
  item.status = "draft";
  item.revision += 1;
  item.confirmation = null;
  item.invalidatedBy = [];
  item.updatedAt = now();
  addEvent(state, "artifact-modified", artifactId, { revision: item.revision, reason });

  for (const dependentId of descendants(state, artifactId)) {
    const dependent = state.artifacts[dependentId];
    dependent.status = "invalidated";
    dependent.confirmation = null;
    dependent.invalidatedBy = [...new Set([...dependent.invalidatedBy, artifactId])];
    dependent.updatedAt = now();
    addEvent(state, "artifact-invalidated", dependentId, { causedBy: artifactId });
  }
  return state;
}

export function workflowSummary(workflow) {
  const counts = { draft: 0, "ready-for-review": 0, confirmed: 0, invalidated: 0 };
  for (const item of Object.values(workflow.artifacts)) counts[item.status] += 1;
  const next = Object.values(workflow.artifacts).filter((item) => item.status !== "confirmed").map((item) => item.id);
  return { projectId: workflow.projectId, counts, complete: next.length === 0, next };
}

export function validateArtifactWorkflow(workflow) {
  if (workflow?.$schema !== CONTRACT) throw new Error(`Expected ${CONTRACT}.`);
  const statuses = new Set(["draft", "ready-for-review", "confirmed", "invalidated"]);
  for (const item of Object.values(workflow.artifacts ?? {})) {
    if (!statuses.has(item.status)) throw new Error(`Invalid status for ${item.id}: ${item.status}`);
    for (const dependency of item.dependsOn) requireArtifact(workflow, dependency);
  }
  return true;
}
