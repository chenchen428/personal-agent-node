#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInteriorWorkspace } from "../../interior-design/scripts/workspace-v5.mjs";
import { evaluateAgentReview, renderInteriorPages } from "./renderer.mjs";

const rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const interiorSkillRoot = path.resolve(rendererRoot, "..", "interior-design");
const [command = "help", ...argv] = process.argv.slice(2);
const options = parse(argv);
try {
  if (command === "render") render();
  else if (command === "review") review();
  else help();
} catch (error) {
  emit({ ok: false, error: { code: error.code || "INTERIOR_PAGE_RENDER_FAILED", message: error.message } });
  process.exitCode = 1;
}

function render() {
  const projectDir = path.resolve(required("project-dir"));
  const verification = verifyInteriorWorkspace(projectDir);
  if (!verification.ok) throw new Error(`workspace verification failed: ${verification.errors.join("; ")}`);
  const output = path.resolve(options.output || path.join(projectDir, "pages"));
  if (!inside(projectDir, output)) throw new Error("Page output must stay inside the project workspace");
  const result = renderInteriorPages({ projectDir, output, skillRoot: interiorSkillRoot });
  emit({ ok: true, schemaVersion: 5, renderer: result.manifest.renderer, projectId: result.manifest.projectId, revision: result.manifest.revision, output: slash(path.relative(projectDir, output)), preview: { primary: "index.html", onlineDrawings: ["assets/drawings/p-01-plan-layout.svg", "assets/drawings/c-01-ceiling-lighting.svg", "assets/drawings/e-01-switch-control.svg", "assets/drawings/e-02-socket-layout.svg", "assets/drawings/w-01-plumbing.svg", "assets/drawings/m-01-cabinet.svg"], specialistPages: { threeD: "3d/index.html", panoramaReview: "panorama-review/index.html", tour: "tour/index.html" }, styleGuide: "style-guide.json" }, shareableOutputs: result.reviewPlan.shareableOutputs, agentReview: result.reviewPlan, totalBytes: result.totalBytes });
}
function review() { emit(evaluateAgentReview(path.resolve(required("bundle")), JSON.parse(fs.readFileSync(path.resolve(required("input")), "utf8")))); }
function help() { emit({ ok: true, commands: ["render --project-dir <workspace> [--output <workspace>/pages] --json", "review --bundle <page-dir> --input <observations.json> --json"] }); }
function required(name) { const value = options[name]; if (!value) throw new Error(`--${name} is required`); return value; }
function emit(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function slash(value) { return value.split(path.sep).join("/"); }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (!value.startsWith("--")) throw new Error(`unsupported argument: ${value}`); const key = value.slice(2); result[key] = key === "json" ? true : values[++index]; } return result; }
