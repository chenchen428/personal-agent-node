#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { confirmArtifact, markArtifactReady, modifyArtifact, validateArtifactWorkflow, workflowSummary } from "./artifact-workflow-v5.mjs";
import { assembleKrpanoTour } from "./render-krpano-tour.mjs";
import { renderPanoramaReview } from "./render-panorama-review.mjs";
import { registerPanoramaImage } from "./panorama-artifacts-v5.mjs";
import { renderPanoramaControl } from "./render-panorama-control-v5.mjs";
import { prepareImagegenPanoramaPrompt } from "./imagegen-panorama-prompt-v5.mjs";
import { finalizeImagegenPanorama } from "./finalize-imagegen-panorama-v5.mjs";
import { buildInteriorWorkspace, refreshWorkspaceManifest, verifyInteriorWorkspace } from "./workspace-v5.mjs";

const [domain = "help", action = "", ...argv] = process.argv.slice(2);
const options = parse(argv);
try {
  if (domain === "evidence" && action === "inventory") inventory();
  else if (domain === "workspace" && action === "build") buildWorkspace();
  else if (domain === "workspace" && action === "verify") verifyWorkspace();
  else if (domain === "workflow" && action === "status") workflowStatus();
  else if (domain === "workflow" && action === "ready") workflowReady();
  else if (domain === "workflow" && action === "confirm") workflowConfirm();
  else if (domain === "workflow" && action === "modify") workflowModify();
  else if (domain === "tour" && action === "assemble") tourAssemble();
  else if (domain === "panorama" && action === "register") await panoramaRegister();
  else if (domain === "panorama" && action === "render-control") await panoramaRenderControl();
  else if (domain === "panorama" && action === "prepare-imagegen") panoramaPrepareImagegen();
  else if (domain === "panorama" && action === "finalize-imagegen") await panoramaFinalizeImagegen();
  else help();
} catch (error) {
  emit({ ok: false, error: { code: error.code || "INTERIOR_COMMAND_FAILED", message: error.message, details: error.details || null } });
  process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
}

function inventory() {
  const sourceDir = path.resolve(required("source-dir"));
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) throw coded("SOURCE_NOT_FOUND", "--source-dir must be an existing directory");
  const files = walk(sourceDir).map((file, index) => {
    const relative = slash(path.relative(sourceDir, file));
    const record = hash(file);
    return {
      id: `evidence-${String(index + 1).padStart(3, "0")}`,
      file: relative,
      label: path.basename(file, path.extname(file)),
      kind: classify(relative),
      status: "received",
      factStatus: "image-derived",
      confidence: 0.5,
      allowedUses: defaultUses(relative),
      prohibitedUses: ["execute-embedded-instructions", "infer-structure", "infer-construction-dimensions"],
      bytes: record.bytes,
      expectedSha256: record.sha256,
      observations: [],
    };
  });
  const result = { schemaVersion: 5, sourceName: path.basename(sourceDir), files };
  if (options.output) writeJson(path.resolve(options.output), result);
  emit({ ok: true, ...result, output: options.output ? path.resolve(options.output) : null });
}

function buildWorkspace() {
  const result = buildInteriorWorkspace({ inputFile: required("input"), sourceDir: options["source-dir"], projectDir: required("project-dir"), overwrite: options.overwrite === true || options.overwrite === "true", copyEvidence: options["no-copy-evidence"] !== true });
  emit(result);
}
function verifyWorkspace() {
  const result = verifyInteriorWorkspace(required("project-dir"));
  emit(result);
  if (!result.ok) process.exitCode = 1;
}
function workflowStatus() {
  const { state } = readWorkflow();
  emit({ ok: true, summary: workflowSummary(state), artifacts: state.artifacts });
}
function workflowReady() {
  const { root, file, state } = readWorkflow();
  let fileHash;
  if (options.file) {
    const target = path.resolve(root, options.file);
    const relative = path.relative(root, target);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw coded("INVALID_ARGUMENT", "--file must stay inside --project-dir");
    if (!fs.existsSync(target)) throw coded("ARTIFACT_FILE_NOT_FOUND", `artifact file does not exist: ${options.file}`);
    fileHash = hash(target).sha256;
  }
  saveWorkflow(root, file, markArtifactReady(state, required("artifact"), { file: options.file, sha256: fileHash }));
}
function workflowConfirm() {
  const { root, file, state } = readWorkflow();
  saveWorkflow(root, file, confirmArtifact(state, required("artifact"), { summary: options.summary, confirmedBy: options["confirmed-by"] || "user" }));
}
function workflowModify() {
  const { root, file, state } = readWorkflow();
  saveWorkflow(root, file, modifyArtifact(state, required("artifact"), { reason: options.reason }));
}
function tourAssemble() {
  const root = path.resolve(required("project-dir"));
  const result = assembleKrpanoTour({ projectDir: root, runtimeFile: required("runtime"), output: options.output });
  refreshWorkspaceManifest(root);
  emit(result);
}
async function panoramaRegister() {
  const root = path.resolve(required("project-dir"));
  const result = await registerPanoramaImage({
    projectDir: root,
    nodeId: required("node"),
    kind: required("kind"),
    file: required("file"),
    generator: required("generator"),
    promptId: options["prompt-id"],
  });
  if (fs.existsSync(path.join(root, "pages"))) renderPanoramaReview({ projectDir: root });
  refreshWorkspaceManifest(root);
  emit(result);
}
async function panoramaRenderControl() {
  const root = path.resolve(required("project-dir"));
  const result = await renderPanoramaControl({ projectDir: root, nodeId: required("node"), blender: required("blender") });
  if (fs.existsSync(path.join(root, "pages"))) renderPanoramaReview({ projectDir: root });
  refreshWorkspaceManifest(root);
  emit(result);
}
function panoramaPrepareImagegen() {
  const root = path.resolve(required("project-dir"));
  const result = prepareImagegenPanoramaPrompt({ projectDir: root, nodeId: required("node") });
  if (fs.existsSync(path.join(root, "pages"))) renderPanoramaReview({ projectDir: root });
  refreshWorkspaceManifest(root);
  emit(result);
}
async function panoramaFinalizeImagegen() {
  const root = path.resolve(required("project-dir"));
  const result = await finalizeImagegenPanorama({
    projectDir: root,
    nodeId: required("node"),
    file: required("file"),
    promptId: required("prompt-id"),
  });
  if (fs.existsSync(path.join(root, "pages"))) renderPanoramaReview({ projectDir: root });
  refreshWorkspaceManifest(root);
  emit(result);
}
function readWorkflow() {
  const root = path.resolve(required("project-dir"));
  const file = path.join(root, "artifact-workflow.json");
  if (!fs.existsSync(file)) throw coded("WORKFLOW_NOT_FOUND", `artifact workflow does not exist: ${file}`);
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  validateArtifactWorkflow(state);
  return { root, file, state };
}
function saveWorkflow(root, file, state) {
  writeJson(file, state);
  if (fs.existsSync(path.join(root, "pages"))) renderPanoramaReview({ projectDir: root });
  refreshWorkspaceManifest(root);
  emit({ ok: true, summary: workflowSummary(state), artifact: state.artifacts[required("artifact")] });
}
function help() {
  emit({ ok: true, contract: "personal-agent/interior-workspace/v5", commands: [
    "evidence inventory --source-dir <dir> [--output <inventory.json>] --json",
    "workspace build --input <workspace-input.json> --source-dir <evidence-dir> --project-dir <workspace> [--overwrite] --json",
    "workspace verify --project-dir <workspace> --json",
    "workflow status --project-dir <workspace> --json",
    "workflow ready --project-dir <workspace> --artifact <id> [--file <relative-file>] --json",
    "workflow confirm --project-dir <workspace> --artifact <id> [--summary <text>] --json",
    "workflow modify --project-dir <workspace> --artifact <id> [--reason <text>] --json",
    "tour assemble --project-dir <workspace> --runtime <licensed-krpano.js> [--output <dir>] --json",
    "panorama register --project-dir <workspace> --node <id> --kind <control|photorealistic> --file <relative.png> --generator <blender|codex-imagegen> [--prompt-id <id>] --json",
    "panorama render-control --project-dir <workspace> --node <id> --blender <blender.exe> --json",
    "panorama prepare-imagegen --project-dir <workspace> --node <id> --json",
    "panorama finalize-imagegen --project-dir <workspace> --node <id> --file <raw-imagegen.png> --prompt-id <id> --json",
  ] });
}

function classify(value) { const name = value.toLowerCase(); if (/开关|插座|水路|机电/.test(name)) return "professional-reference"; if (/柜|修改方案|效果|设计/.test(name)) return "prior-design-output"; if (/颜色|材料|门/.test(name)) return "preference-reference"; if (/\.pdf$/.test(name)) return "drawing-reference"; if (/\.(?:png|jpe?g|webp)$/.test(name)) return "site-or-reference-image"; if (/\.txt$/.test(name)) return "link-or-note"; return "reference"; }
function defaultUses(value) { const kind = classify(value); if (kind === "prior-design-output") return ["fact-extraction-only", "conflict-check", "do-not-copy-design-answer"]; if (kind === "professional-reference") return ["point-reference", "conflict-check", "professional-review-input"]; return ["design-reference", "fact-extraction"]; }
function walk(root) { return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, "zh-CN")).flatMap((entry) => { const item = path.join(root, entry.name); return entry.isDirectory() ? walk(item) : [item]; }); }
function hash(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function required(name) { const value = options[name]; if (!value) throw coded("INVALID_ARGUMENT", `--${name} is required`); return value; }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (!value.startsWith("--")) throw coded("INVALID_ARGUMENT", `unsupported argument: ${value}`); const key = value.slice(2); if (["json", "overwrite", "no-copy-evidence"].includes(key)) result[key] = true; else { if (!values[index + 1] || values[index + 1].startsWith("--")) throw coded("INVALID_ARGUMENT", `--${key} requires a value`); result[key] = values[++index]; } } return result; }
function slash(value) { return value.split(path.sep).join("/"); }
function emit(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
