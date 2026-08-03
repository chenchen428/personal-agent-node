#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderInteriorPages } from "../../render-interior-pages/scripts/renderer.mjs";
import { verifyPageHtml } from "./generate-pages-v5.mjs";
import { buildInteriorWorkspace, refreshWorkspaceManifest, verifyInteriorWorkspace } from "./workspace-v5.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(skillRoot, "..", "..");
const exampleRoot = path.join(skillRoot, "examples", "co-design-example");
const inputFile = path.join(exampleRoot, "workspace-input.json");
const artifactRoot = path.join(repoRoot, "core", "app", "public", "assets", "agents", "interior-designer", "featured");

export async function buildAgentDeliveryExample({ check = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-interior-v5-"));
  const workspace = path.join(tempRoot, "interior-example");
  try {
    buildInteriorWorkspace({ inputFile, sourceDir: exampleRoot, projectDir: workspace });
    renderInteriorPages({ projectDir: workspace, output: path.join(workspace, "pages"), skillRoot });
    const pageManifestFile = path.join(workspace, "pages", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(pageManifestFile, "utf8"));
    manifest.agent = { id: "interior-designer", version: 5, exampleId: "interior-workspace-v5" };
    manifest.delivery.layoutProfile = "owner-decision-booklet-v5";
    fs.writeFileSync(pageManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refreshWorkspaceManifest(workspace);
    const workspaceVerification = verifyInteriorWorkspace(workspace);
    if (!workspaceVerification.ok) throw new Error(`generated example workspace failed verification: ${workspaceVerification.errors.join("; ")}`);
    const generated = path.join(workspace, "pages");
    verifyAgentDeliveryExample(generated);
    if (check) {
      compareTrees(generated, artifactRoot);
      return { ok: true, mode: "check", artifactRoot, contract: manifest.contract, files: Object.keys(manifest.files).length };
    }
    replaceGeneratedDirectory(generated, artifactRoot);
    verifyAgentDeliveryExample(artifactRoot);
    return { ok: true, mode: "write", artifactRoot, contract: manifest.contract, files: Object.keys(manifest.files).length };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function verifyAgentDeliveryExample(root = artifactRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.contract !== "personal-agent/interior-page-bundle/v5") throw new Error("representative Page contract is not v5");
  if (manifest.delivery.engine !== "geometry-v5+three-v5+krpano") throw new Error("representative Page is not generated from the current V5 geometry, 3D, and tour workflow");
  if (manifest.agent?.id !== "interior-designer") throw new Error("representative Page lacks interior-designer provenance");
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) throw new Error(`representative Page file is missing: ${relative}`);
    const actual = fileRecord(file);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`representative Page file drift: ${relative}`);
  }
  verifyPageHtml(root);
  for (const sheet of ["p-01-plan-layout", "c-01-ceiling-lighting", "e-01-switch-control", "e-02-socket-layout", "w-01-plumbing", "m-01-cabinet"]) {
    const svg = fs.readFileSync(path.join(root, "assets", "drawings", `${sheet}.svg`), "utf8");
    if (!svg.includes(`data-sheet="${sheet}"`) || !svg.includes("data-geometry-sha256")) throw new Error(`representative online drawing is invalid: ${sheet}`);
  }
  if (fs.existsSync(path.join(root, "downloads"))) throw new Error("representative owner Page must not expose professional-file downloads");
  const booklet = fs.readFileSync(path.join(root, "index.html"), "utf8");
  if (!booklet.includes("把这一版发给家人一起看") || /DXF|DWG|SKP|SketchUp|GLB/.test(booklet)) throw new Error("representative owner Page is not focused on collaborative confirmation");
  return { ok: true, manifest };
}

function replaceGeneratedDirectory(source, target) {
  const expectedSuffix = path.join("core", "app", "public", "assets", "agents", "interior-designer", "featured");
  if (!path.resolve(target).endsWith(expectedSuffix)) throw new Error(`unsafe representative artifact target: ${target}`);
  const stage = `${target}.next-${process.pid}`;
  if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(source, stage, { recursive: true });
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(stage, target);
}

function compareTrees(expectedRoot, actualRoot) {
  if (!fs.existsSync(actualRoot)) throw new Error("committed representative Page is missing");
  const expected = new Map(walk(expectedRoot).map((file) => [slash(path.relative(expectedRoot, file)), fileRecord(file)]));
  const actual = new Map(walk(actualRoot).map((file) => [slash(path.relative(actualRoot, file)), fileRecord(file)]));
  const errors = [];
  for (const [name, record] of expected) {
    const current = actual.get(name);
    if (!current) errors.push(`missing ${name}`);
    else if (current.bytes !== record.bytes || current.sha256 !== record.sha256) errors.push(`drift ${name}`);
  }
  for (const name of actual.keys()) if (!expected.has(name)) errors.push(`obsolete ${name}`);
  if (errors.length) throw new Error(`representative Page drift: ${errors.join("; ")}`);
}

function walk(root) { return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap((entry) => { const item = path.join(root, entry.name); return entry.isDirectory() ? walk(item) : [item]; }); }
function fileRecord(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function slash(value) { return value.split(path.sep).join("/"); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAgentDeliveryExample({ check: process.argv.includes("--check") }).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
