import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { auditInteriorWorkspace, geometryMetrics, normalizeGeometry, renderPlanSvg } from "./geometry-v5.mjs";
import { createArtifactWorkflow, DRAWING_ARTIFACTS, validateArtifactWorkflow } from "./artifact-workflow-v5.mjs";

export const WORKSPACE_CONTRACT = Object.freeze({
  id: "personal-agent/interior-workspace/v5",
  schemaVersion: 5,
  geometryAuthority: "geometry.json",
  projectAuthority: "project.json",
  units: "mm",
});

export function buildInteriorWorkspace({ inputFile, sourceDir, projectDir, overwrite = false, copyEvidence = true }) {
  const inputPath = path.resolve(inputFile);
  const sourceRoot = path.resolve(sourceDir || path.dirname(inputPath));
  const target = path.resolve(projectDir);
  assertSafeTarget(target);
  if (!fs.existsSync(inputPath)) throw coded("INPUT_NOT_FOUND", `input does not exist: ${inputPath}`);
  if (!fs.statSync(sourceRoot).isDirectory()) throw coded("SOURCE_NOT_FOUND", `source directory does not exist: ${sourceRoot}`);
  if (fs.existsSync(target) && !overwrite) throw coded("WORKSPACE_EXISTS", `workspace already exists: ${target}`);
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  validateInput(input);
  const stage = `${target}.building-${process.pid}`;
  assertSafeTarget(stage);
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    const evidence = ingestEvidence(input.evidence || [], sourceRoot, stage, { copyEvidence });
    const renders = ingestRenders(input.design?.renders || [], sourceRoot, stage);
    const project = normalizeProject(input, evidence, renders);
    const geometry = normalizeGeometry(input.geometry, { projectId: project.projectId, revision: project.revision });
    writeJson(path.join(stage, "project.json"), project);
    writeJson(path.join(stage, "geometry.json"), geometry);
    fs.mkdirSync(path.join(stage, "derived"), { recursive: true });
    fs.writeFileSync(path.join(stage, "derived", "plan.svg"), renderPlanSvg(project, geometry), "utf8");
    const quality = auditInteriorWorkspace(project, geometry);
    writeJson(path.join(stage, "quality-report.json"), quality);
    if (!quality.conceptReady) throw coded("QUALITY_BLOCKED", `workspace contains ${quality.counts.error} blocking design errors`, { quality });
    const artifactWorkflow = createArtifactWorkflow({ projectId: project.projectId, geometry });
    writeJson(path.join(stage, "artifact-workflow.json"), artifactWorkflow);
    const workspace = {
      contract: WORKSPACE_CONTRACT,
      projectId: project.projectId,
      title: project.title,
      revision: project.revision,
      status: quality.status,
      entryPage: "pages/index.html",
      entries: {
        project: "project.json", geometry: "geometry.json", quality: "quality-report.json", plan: "derived/plan.svg",
        artifactWorkflow: "artifact-workflow.json", booklet: "pages/index.html", web3d: "pages/3d/index.html",
        onlineDrawings: "pages/assets/drawings", panoramaReview: "pages/panorama-review/index.html", tour: "pages/tour/index.html",
      },
      outputs: {
        booklet: { status: "generated-after-render", format: "HTML" },
        onlineDrawings: { status: "generated-after-render", format: "SVG", sheets: DRAWING_ARTIFACTS.map(([id]) => id) },
        web3d: { status: "generated-after-render", format: "HTML", role: "editable-intermediate" },
        panoramaReview: { status: "generated-after-sketch-confirmation", format: "HTML", generation: "one-view-at-a-time" },
        tour: { status: "generated-after-all-panorama-confirmations", format: "krpano" },
      },
      readiness: {
        conceptDesign: quality.conceptReady ? "ready" : "blocked",
        constructionDocumentation: quality.constructionReady ? "ready" : "site-measure-and-professional-review-required",
        customFabrication: quality.productionReady ? "ready" : "site-measure-and-fabrication-review-required",
      },
      visualAcceptance: "user",
    };
    writeJson(path.join(stage, "workspace.json"), workspace);
    refreshWorkspaceManifest(stage);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(stage, target);
    return { ok: true, contract: WORKSPACE_CONTRACT.id, projectDir: target, projectId: project.projectId, revision: project.revision, status: quality.status, metrics: geometryMetrics(geometry), readiness: workspace.readiness };
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function refreshWorkspaceManifest(projectDir) {
  const root = path.resolve(projectDir);
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const quality = readJson(path.join(root, "quality-report.json"));
  const files = {};
  for (const file of walk(root)) {
    const relative = slash(path.relative(root, file));
    if (relative === "manifest.json") continue;
    files[relative] = fileRecord(file);
  }
  const manifest = {
    schemaVersion: 5,
    contract: WORKSPACE_CONTRACT.id,
    projectId: project.projectId,
    revision: project.revision,
    authorities: { project: { path: "project.json", sha256: files["project.json"].sha256 }, geometry: { path: "geometry.json", sha256: files["geometry.json"].sha256 } },
    source: { evidenceCount: project.evidence.length, sourceEvidenceIds: project.evidence.map((entry) => entry.id), geometryBasis: geometry.basis },
    readiness: { conceptDesign: quality.conceptReady, constructionDocumentation: quality.constructionReady, customFabrication: quality.productionReady },
    files,
    privacy: { absolutePaths: false, remoteRuntimeDependencies: false, rawEvidencePublished: false },
    visualAcceptance: "user",
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  return manifest;
}

export function verifyInteriorWorkspace(projectDir) {
  const root = path.resolve(projectDir);
  const manifest = readJson(path.join(root, "manifest.json"));
  const errors = [];
  if (manifest.contract !== WORKSPACE_CONTRACT.id) errors.push("workspace contract mismatch");
  for (const [relative, expected] of Object.entries(manifest.files || {})) {
    const file = path.resolve(root, relative);
    if (!inside(root, file) || !fs.existsSync(file)) { errors.push(`missing file: ${relative}`); continue; }
    const actual = fileRecord(file);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) errors.push(`file drift: ${relative}`);
  }
  const current = new Set(walk(root).map((file) => slash(path.relative(root, file))).filter((file) => file !== "manifest.json"));
  for (const file of current) if (!manifest.files[file]) errors.push(`untracked workspace file: ${file}`);
  const project = readJson(path.join(root, "project.json"));
  const geometry = readJson(path.join(root, "geometry.json"));
  const quality = auditInteriorWorkspace(project, geometry);
  if (!quality.conceptReady) errors.push("current project no longer passes concept quality gate");
  try { validateArtifactWorkflow(readJson(path.join(root, "artifact-workflow.json"))); }
  catch (error) { errors.push(`artifact workflow invalid: ${error.message}`); }
  return { ok: errors.length === 0, contract: manifest.contract, projectId: manifest.projectId, revision: manifest.revision, errors, fileCount: Object.keys(manifest.files).length, quality };
}

function normalizeProject(input, evidence, renders) {
  const project = structuredClone(input.project);
  project.schemaVersion = 5;
  project.contract = WORKSPACE_CONTRACT.id;
  project.units = "mm";
  project.revision = Number(project.revision || 1);
  project.scope ||= { designStage: "concept-design", includes: [], excludes: [] };
  project.brief = structuredClone(input.brief || {});
  project.evidence = evidence;
  project.requirements = structuredClone(input.requirements || []);
  project.assumptions = structuredClone(input.assumptions || []);
  project.unknowns = structuredClone(input.unknowns || []);
  project.professionalVerifications = structuredClone(input.professionalVerifications || []);
  project.design = structuredClone(input.design || {});
  project.design.renders = renders;
  project.deliverables = [
    { id: "owner-booklet", label: "装修方案设计册", status: "generated-from-workspace" },
    { id: "online-drawings", label: "在线概念图纸", status: "generated-from-workspace" },
    { id: "immersive-web3d", label: "沉浸式 3D 看房", status: "generated-from-workspace" },
    { id: "decision-record", label: "需求与待确认事项", status: "generated-from-workspace" },
  ];
  return project;
}

function ingestEvidence(entries, sourceRoot, stage, { copyEvidence }) {
  const destination = path.join(stage, "evidence", "source");
  if (copyEvidence) fs.mkdirSync(destination, { recursive: true });
  const seen = new Set();
  return entries.map((entry) => {
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(entry.id || "") || seen.has(entry.id)) throw coded("EVIDENCE_ID_INVALID", `invalid or duplicate evidence id: ${entry.id}`);
    seen.add(entry.id);
    const source = safeSource(sourceRoot, entry.file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw coded("EVIDENCE_NOT_FOUND", `evidence does not exist: ${entry.file}`);
    const record = fileRecord(source);
    if (entry.expectedSha256 && entry.expectedSha256.toLowerCase() !== record.sha256) throw coded("EVIDENCE_HASH_MISMATCH", `evidence hash mismatch: ${entry.id}`);
    const extension = path.extname(source).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
    const relative = copyEvidence ? `evidence/source/${entry.id}${extension}` : null;
    if (copyEvidence) fs.copyFileSync(source, path.join(stage, relative));
    return {
      id: entry.id, label: entry.label || entry.id, kind: entry.kind || "reference", status: entry.status || "received",
      confidence: clamp(entry.confidence ?? 0.5), allowedUses: entry.allowedUses || ["design-reference"], prohibitedUses: entry.prohibitedUses || [],
      source: relative, mediaType: mediaType(extension), bytes: record.bytes, sha256: record.sha256,
      observations: entry.observations || [], factStatus: entry.factStatus || "image-derived",
    };
  });
}

function ingestRenders(entries, sourceRoot, stage) {
  if (!entries.length) return [];
  const destination = path.join(stage, "renders");
  fs.mkdirSync(destination, { recursive: true });
  return entries.map((entry) => {
    const source = safeSource(sourceRoot, entry.file);
    if (!fs.existsSync(source)) throw coded("RENDER_NOT_FOUND", `render does not exist: ${entry.file}`);
    const extension = path.extname(source).toLowerCase();
    const relative = `renders/${entry.id}${extension}`;
    fs.copyFileSync(source, path.join(stage, relative));
    const record = fileRecord(source);
    return { id: entry.id, title: entry.title || entry.id, view: entry.view || "concept", file: relative, mediaType: mediaType(extension), bytes: record.bytes, sha256: record.sha256, generator: entry.generator || "provided", styleId: inputString(entry.styleId), geometryRevision: entry.geometryRevision || 1, disclaimer: entry.disclaimer || "概念效果图，不替代施工图与材料实样。" };
  });
}

function validateInput(input) {
  if (input?.schemaVersion !== 5) throw coded("INPUT_SCHEMA_UNSUPPORTED", "workspace input schemaVersion must be 5");
  if (!input.project || !/^[a-z][a-z0-9_-]{2,63}$/.test(input.project.projectId || "")) throw coded("PROJECT_ID_INVALID", "project.projectId is invalid");
  if (!input.project.title || typeof input.project.title !== "string") throw coded("PROJECT_TITLE_REQUIRED", "project.title is required");
  if (!input.geometry || typeof input.geometry !== "object") throw coded("GEOMETRY_REQUIRED", "geometry is required");
  if (!Array.isArray(input.requirements) || !input.requirements.length) throw coded("REQUIREMENTS_REQUIRED", "at least one requirement is required");
  const requirementIds = new Set();
  for (const entry of input.requirements) {
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(entry.id || "") || requirementIds.has(entry.id)) throw coded("REQUIREMENT_ID_INVALID", `invalid or duplicate requirement id: ${entry.id}`);
    requirementIds.add(entry.id);
  }
}

function walk(root) { return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap((entry) => { const item = path.join(root, entry.name); return entry.isDirectory() ? walk(item) : [item]; }); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function fileRecord(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function safeSource(root, relative) { if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) throw coded("SOURCE_PATH_INVALID", `source file must be relative: ${relative}`); const target = path.resolve(root, relative); if (!inside(root, target)) throw coded("SOURCE_PATH_INVALID", `source escapes root: ${relative}`); return target; }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function assertSafeTarget(target) { const parsed = path.parse(target); const basename = path.basename(target); if (target === parsed.root || basename.length < 3 || [".", "..", "skills", "core", "projects", "workspace"].includes(basename.toLowerCase())) throw coded("UNSAFE_TARGET", `unsafe workspace target: ${target}`); }
function slash(value) { return value.split(path.sep).join("/"); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value))); }
function inputString(value) { return typeof value === "string" ? value : ""; }
function mediaType(extension) { return ({ ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain" })[extension] || "application/octet-stream"; }
function coded(code, message, details) { const error = new Error(message); error.code = code; if (details) error.details = details; return error; }
