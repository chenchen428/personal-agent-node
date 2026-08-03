import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { markArtifactReady, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";
import { buildModelPrimitives, geometryMetrics } from "./geometry-v5.mjs";
import { ownerTitle } from "./owner-language-v5.mjs";
import { renderBookletV5 } from "./render-booklet-v5.mjs";
import { DRAWING_SHEETS, renderOnlineDrawingSvg } from "./render-online-drawing.mjs";
import { renderPanoramaReview } from "./render-panorama-review.mjs";
import { renderViewerV5 } from "./render-viewer-v5.mjs";

export const PAGE_BUNDLE_CONTRACT = "personal-agent/interior-page-bundle/v5";

export function generateWorkspacePages({ projectDir, output, skillRoot }) {
  const root = path.resolve(projectDir);
  const target = path.resolve(output);
  const productRoot = path.resolve(skillRoot, "../..");
  if (!inside(root, target)) throw new Error("interior Pages output must stay inside the project workspace");
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const quality = readJson(path.join(root, "quality-report.json"));
  if (!quality.conceptReady || quality.counts.error) throw new Error("interior Pages require a concept-ready workspace");
  const stage = `${target}.rendering-${process.pid}`;
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  for (const folder of ["assets/drawings", "3d", "media", "panorama-review", "tour"]) fs.mkdirSync(path.join(stage, folder), { recursive: true });
  try {
    copy(path.join(skillRoot, "assets", "interior-booklet.css"), path.join(stage, "assets", "booklet.css"));
    copy(path.join(skillRoot, "assets", "interior-booklet.js"), path.join(stage, "assets", "booklet.js"));
    copy(path.join(skillRoot, "assets", "interior-viewer.css"), path.join(stage, "3d", "viewer.css"));
    copy(path.join(productRoot, "core", "agent", "public", "assets", "interior-workspace", "workspace-viewer.bundle.js"), path.join(stage, "3d", "viewer.bundle.js"));
    copy(path.join(root, "derived", "plan.svg"), path.join(stage, "media", "plan.svg"));
    copy(path.join(root, "derived", "plan.svg"), path.join(stage, "cover.svg"));
    for (const sheet of DRAWING_SHEETS) fs.writeFileSync(path.join(stage, "assets", "drawings", `${sheet.id}.svg`), renderOnlineDrawingSvg(project, geometry, sheet.id), "utf8");
    const renders = copyRenders(project, root, stage);
    const metrics = geometryMetrics(geometry);
    const model = {
      schemaVersion: 5,
      projectId: project.projectId,
      revision: project.revision,
      title: ownerTitle(project.title),
      units: "mm",
      rooms: geometry.rooms,
      points: geometry.points,
      cameras: geometry.cameras,
      ceilingZones: geometry.ceilingZones,
      panoramaNodes: geometry.panoramaNodes,
      primitives: buildModelPrimitives(project, geometry),
    };
    fs.writeFileSync(path.join(stage, "3d", "model-data.js"), `window.__INTERIOR_MODEL__=${safeJson(model)};\n`, "utf8");
    fs.writeFileSync(path.join(stage, "index.html"), renderBookletV5({ contract: PAGE_BUNDLE_CONTRACT, project, quality, metrics, renders }), "utf8");
    fs.writeFileSync(path.join(stage, "3d", "index.html"), renderViewerV5(project), "utf8");
    renderPanoramaReview({ projectDir: root, output: path.join(stage, "panorama-review") });
    fs.writeFileSync(path.join(stage, "tour", "index.html"), pendingTourHtml(project), "utf8");
    const styleGuide = renderStyleGuide(project, geometry);
    writeJson(path.join(stage, "style-guide.json"), styleGuide);
    writeJson(path.join(stage, "audit.json"), quality);
    const manifest = createPageManifest(stage, project, geometry, quality, styleGuide);
    writeJson(path.join(stage, "manifest.json"), manifest);
    verifyPageHtml(stage);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(stage, target);
    updateGeneratedArtifactWorkflow(root, target);
    return { ok: true, contract: PAGE_BUNDLE_CONTRACT, output: target, projectId: project.projectId, revision: project.revision, manifest, entry: "index.html", threeD: "3d/index.html" };
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function verifyPageHtml(root) {
  const booklet = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const viewer = fs.readFileSync(path.join(root, "3d", "index.html"), "utf8");
  const combined = `${booklet}\n${viewer}`;
  const checks = {
    csp: (combined.match(/Content-Security-Policy/g) || []).length === 2,
    noRemoteAssets: !/<(?:script|img|link|iframe)\b[^>]*(?:src|href)=["']https?:/i.test(combined),
    noAbsolutePaths: !/(?:file:\/\/|[A-Za-z]:\\|localhost|127\.0\.0\.1)/i.test(combined),
    userLanguage: !/INTERIOR WORKSPACE|geometry\.json|工作区|统一几何|需求闭环|生成引擎/i.test(combined),
    noProfessionalDownloads: !/downloads\/|DXF|DWG|SKP|SketchUp|GLB/i.test(booklet) && !fs.existsSync(path.join(root, "downloads")),
    onlineDrawings: DRAWING_SHEETS.every((sheet) => fs.existsSync(path.join(root, "assets", "drawings", `${sheet.id}.svg`))) && /data-drawing-tab="p-01-plan-layout"/.test(booklet),
    separate3d: /href="3d\/index\.html"[^>]*target="_blank"/.test(booklet) && !/<iframe\b/i.test(booklet),
    immersive3d: /data-engine="three-interior-v5"/.test(viewer) && /data-action="walk"/.test(viewer) && /id="room-buttons"/.test(viewer),
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`generated Page contract failed: ${JSON.stringify(checks)}`);
  return checks;
}

function copyRenders(project, root, stage) {
  return (project.design?.renders || []).map((entry) => {
    const extension = path.extname(entry.file);
    const relative = `media/${entry.id}${extension}`;
    copy(path.join(root, entry.file), path.join(stage, relative));
    return { ...entry, file: relative };
  });
}

function renderStyleGuide(project, geometry) {
  const style = project.design?.style || {};
  return { schemaVersion: 5, projectId: project.projectId, revision: project.revision, selected: { id: style.id || "project-defined", name: style.name || "项目定义风格", keywords: style.keywords || [], palette: style.palette || (project.design?.materials || []).map((entry) => entry.color).filter(Boolean), lighting: style.lighting || project.design?.lighting?.summary || "" }, bindings: { geometryHash: hashJson(geometry), materials: (project.design?.materials || []).map((entry) => entry.id), renderIds: (project.design?.renders || []).map((entry) => entry.id) }, pagePresentation: "owner-decision-booklet-v5", feedbackAction: "modify-artifact-and-invalidate-dependants" };
}

function createPageManifest(stage, project, geometry, quality, styleGuide) {
  const files = {};
  for (const file of walk(stage)) { const relative = slash(path.relative(stage, file)); if (relative !== "manifest.json") files[relative] = fileRecord(file); }
  return { schemaVersion: 5, contract: PAGE_BUNDLE_CONTRACT, projectId: project.projectId, revision: project.revision, delivery: { primary: "index.html", specialistPages: { threeD: "3d/index.html", panoramaReview: "panorama-review/index.html", tour: "tour/index.html" }, onlineDrawings: DRAWING_SHEETS.map((sheet) => `assets/drawings/${sheet.id}.svg`), engine: "geometry-v5+three-v5+krpano", distributions: ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"] }, source: { projectSha256: hashJson(project), geometrySha256: hashJson(geometry), qualityStatus: quality.status, styleId: styleGuide.selected.id }, files, privacy: { rawEvidenceIncluded: false, absolutePaths: false, remoteAssets: false }, visualAcceptance: "user" };
}

function pendingTourHtml(project) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'"><title>${ownerTitle(project.title)} · 全景漫游</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17201c;color:#fff;font-family:system-ui,"Microsoft YaHei",sans-serif}.card{width:min(620px,86vw);padding:48px;background:#25302b}.step{color:#d8b07f}h1{font:500 46px/1.1 Georgia,serif}p{line-height:1.7;color:#d5d9d5}a{color:#fff}</style></head><body><main class="card"><span class="step">最终交付尚未解锁</span><h1>Imagegen 实景全景正在逐张确认</h1><p>只有全部照片级实景全景图确认完成后，系统才会组装 krpano 漫游并进行热点走查。</p><a href="../panorama-review/index.html">查看实景全景确认进度 →</a></main></body></html>`;
}

function updateGeneratedArtifactWorkflow(projectRoot, pagesRoot) {
  const workflowFile = path.join(projectRoot, "artifact-workflow.json");
  if (!fs.existsSync(workflowFile)) return;
  let workflow = readJson(workflowFile);
  validateArtifactWorkflow(workflow);
  for (const sheet of DRAWING_SHEETS) {
    const artifactId = `drawing-${sheet.id.replace(/^[a-z]-\d+-/, "").replace("ceiling-lighting", "ceiling-lighting")}`;
    const mapping = {
      "p-01-plan-layout": "drawing-plan-layout", "c-01-ceiling-lighting": "drawing-ceiling-lighting",
      "e-01-switch-control": "drawing-switch-control", "e-02-socket-layout": "drawing-socket-layout",
      "w-01-plumbing": "drawing-plumbing", "m-01-cabinet": "drawing-cabinet",
    };
    const file = `pages/assets/drawings/${sheet.id}.svg`;
    const sha256 = fileRecord(path.join(pagesRoot, "assets", "drawings", `${sheet.id}.svg`)).sha256;
    const current = workflow.artifacts[mapping[sheet.id] ?? artifactId];
    if (current.status !== "confirmed" || current.sha256 !== sha256) workflow = markArtifactReady(workflow, current.id, { file, sha256 });
  }
  const sketchFile = "pages/3d/index.html";
  const sketchHash = fileRecord(path.join(pagesRoot, "3d", "index.html")).sha256;
  const sketch = workflow.artifacts["spatial-sketch-3d"];
  if (sketch.status !== "confirmed" || sketch.sha256 !== sketchHash) workflow = markArtifactReady(workflow, sketch.id, { file: sketchFile, sha256: sketchHash });
  writeJson(workflowFile, workflow);
}

function copy(source, target) { if (!fs.existsSync(source)) throw new Error(`required renderer asset is missing: ${source}`); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
function walk(root) { return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap((entry) => { const item = path.join(root, entry.name); return entry.isDirectory() ? walk(item) : [item]; }); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function fileRecord(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function hashJson(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safeJson(value) { return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function slash(value) { return value.split(path.sep).join("/"); }
