import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { auditInteriorWorkspace, buildModelPrimitives, stableHash } from "../skills/interior-design/scripts/geometry-v5.mjs";
import { ownerTitle } from "../skills/interior-design/scripts/owner-language-v5.mjs";
import { renderInteriorPages } from "../skills/render-interior-pages/scripts/renderer.mjs";
import { buildInteriorWorkspace, verifyInteriorWorkspace } from "../skills/interior-design/scripts/workspace-v5.mjs";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, "skills", "interior-design");
const exampleRoot = path.join(skillRoot, "examples", "co-design-example");

test("owner-facing project titles remove internal workspace wording without duplication", () => {
  assert.equal(ownerTitle("朝光三居装修工作区"), "朝光三居装修方案");
  assert.equal(ownerTitle("朝光三居装修设计工作区"), "朝光三居装修方案");
  assert.equal(ownerTitle("朝光三居"), "朝光三居");
  assert.equal(ownerTitle(""), "装修方案");
});

test("workspace V5 generates six discipline drawings, semantic Web 3D, and panorama review", () => withTemp((temp) => {
  const projectDir = path.join(temp, "interior-test-project");
  const result = buildInteriorWorkspace({ inputFile: path.join(exampleRoot, "workspace-input.json"), sourceDir: exampleRoot, projectDir });
  assert.equal(result.contract, "personal-agent/interior-workspace/v5");
  assert.equal(result.status, "concept-ready");
  assert.equal(result.readiness.conceptDesign, "ready");
  assert.match(result.readiness.constructionDocumentation, /site-measure/);
  assert.equal(verifyInteriorWorkspace(projectDir).ok, true);

  assert.equal(fs.existsSync(path.join(projectDir, "exports")), false);

  const page = renderInteriorPages({ projectDir, output: path.join(projectDir, "pages"), skillRoot });
  assert.equal(page.manifest.contract, "personal-agent/interior-page-bundle/v5");
  assert.equal(verifyInteriorWorkspace(projectDir).ok, true);
  assert.equal(fs.existsSync(path.join(projectDir, "pages", "downloads")), false);
  const sheets = ["p-01-plan-layout", "c-01-ceiling-lighting", "e-01-switch-control", "e-02-socket-layout", "w-01-plumbing", "m-01-cabinet"];
  const sheetHashes = new Set();
  for (const sheet of sheets) {
    const svg = fs.readFileSync(path.join(projectDir, "pages", "assets", "drawings", `${sheet}.svg`), "utf8");
    assert.match(svg, new RegExp(`data-sheet="${sheet}"`));
    assert.match(svg, new RegExp(`data-geometry-sha256="${stableHash(JSON.parse(fs.readFileSync(path.join(projectDir, "geometry.json"), "utf8")))}"`));
    sheetHashes.add(cryptoHash(svg));
  }
  assert.equal(sheetHashes.size, 6, "six drawings must have distinct semantic content");
  const booklet = fs.readFileSync(path.join(projectDir, "pages", "index.html"), "utf8");
  assert.match(booklet, /你会获得怎样的家/);
  assert.match(booklet, /六类设计图纸/);
  assert.match(booklet, /这些需求已经进入方案/);
  assert.match(booklet, /把这一版发给家人一起看/);
  assert.doesNotMatch(booklet, /DXF|DWG|SKP|SketchUp|GLB|专业文件/);
  assert.match(booklet, /data-drawing-action="zoom-in"/);
  assert.equal((booklet.match(/role="tab"/g) || []).length, 6, "all six drawings must be available as tabs");
  assert.equal((booklet.match(/role="tabpanel"/g) || []).length, 6, "each drawing tab must own one panel");
  assert.equal((booklet.match(/data-drawing-panel="[^"]+" hidden/g) || []).length, 5, "only the default drawing may be visible");
  const bookletScript = fs.readFileSync(path.join(projectDir, "pages", "assets", "booklet.js"), "utf8");
  const bookletStyles = fs.readFileSync(path.join(projectDir, "pages", "assets", "booklet.css"), "utf8");
  assert.match(bookletScript, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(bookletScript, /download\.href = files\[id\]/);
  assert.match(bookletStyles, /\.drawing-panel\[hidden\]\{display:none\}/);
  assert.doesNotMatch(booklet, /INTERIOR WORKSPACE|geometry\.json|工作区|需求闭环/);
  const viewer = fs.readFileSync(path.join(projectDir, "pages", "3d", "index.html"), "utf8");
  assert.match(viewer, /data-engine="three-interior-v5"/);
  assert.match(viewer, /data-action="walk"/);
  assert.match(viewer, /id="room-buttons"/);

  const geometry = JSON.parse(fs.readFileSync(path.join(projectDir, "geometry.json"), "utf8"));
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
  const primitives = buildModelPrimitives(project, geometry);
  const glass = primitives.find((entry) => entry.id.endsWith("-glass"));
  assert.ok(glass && glass.kind === "glass" && glass.size[2] > 500, "window glass must occupy the opening height");
  assert.ok(primitives.some((entry) => entry.kind === "window-frame"));
  assert.ok(primitives.some((entry) => entry.kind === "door-frame"));
  assert.ok(primitives.some((entry) => entry.kind === "door-handle"));
  assert.ok(primitives.some((entry) => entry.kind === "mattress"));
  const review = fs.readFileSync(path.join(projectDir, "pages", "panorama-review", "index.html"), "utf8");
  assert.match(review, /Imagegen 一次生成一张 · 逐张确认/);
  assert.match(review, /Imagegen 实景全景图/);
  assert.doesNotMatch(review, /基础全景|Codex 增强全景/);
  assert.ok(fs.existsSync(path.join(projectDir, "pages", "panorama-review", "viewer.bundle.js")));
  assert.match(fs.readFileSync(path.join(projectDir, "pages", "panorama-review", "viewer.html"), "utf8"), /viewer\.bundle\.js/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectDir, "artifact-workflow.json"), "utf8")).artifacts["spatial-sketch-3d"].status, "ready-for-review");
}));

test("quality gate distinguishes concept readiness from construction and fabrication readiness", () => withTemp((temp) => {
  const projectDir = path.join(temp, "interior-quality-project");
  buildInteriorWorkspace({ inputFile: path.join(exampleRoot, "workspace-input.json"), sourceDir: exampleRoot, projectDir });
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
  const geometry = JSON.parse(fs.readFileSync(path.join(projectDir, "geometry.json"), "utf8"));
  const report = auditInteriorWorkspace(project, geometry);
  assert.equal(report.conceptReady, true);
  assert.equal(report.constructionReady, false);
  assert.equal(report.productionReady, false);
  assert.ok(report.issues.some((entry) => entry.code === "GEO-SITE-MEASURE"));
  const invalidCameraGeometry = structuredClone(geometry);
  const cameraNode = invalidCameraGeometry.panoramaNodes[0];
  const blockingElement = invalidCameraGeometry.elements.find((entry) => entry.roomId === cameraNode.roomId && entry.collisionClass === "solid");
  cameraNode.position = [blockingElement.position[0], blockingElement.position[1], 1550];
  const invalidCamera = auditInteriorWorkspace(project, invalidCameraGeometry);
  assert.equal(invalidCamera.conceptReady, false);
  assert.ok(invalidCamera.issues.some((entry) => entry.code === "GEO-PANORAMA-COLLISION"));
  geometry.openings[0].offset = 99_999;
  const invalid = auditInteriorWorkspace(project, geometry);
  assert.equal(invalid.conceptReady, false);
  assert.ok(invalid.issues.some((entry) => entry.code === "GEO-OPENING-RANGE"));
}));

test("evidence inventory hashes originals and excludes prior design answers from automatic reuse", () => withTemp((temp) => {
  fs.writeFileSync(path.join(temp, "户型图.pdf"), "drawing", "utf8");
  fs.writeFileSync(path.join(temp, "衣柜修改方案.pdf"), "prior design", "utf8");
  const result = spawnSync(process.execPath, ["skills/interior-design/scripts/cli.mjs", "evidence", "inventory", "--source-dir", temp, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const inventory = JSON.parse(result.stdout);
  const prior = inventory.files.find((entry) => entry.file.includes("衣柜"));
  assert.equal(prior.kind, "prior-design-output");
  assert.ok(prior.allowedUses.includes("do-not-copy-design-answer"));
  assert.match(prior.expectedSha256, /^[a-f0-9]{64}$/);
}));

function withTemp(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "interior-v5-test-"));
  try { return run(temp); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function cryptoHash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
