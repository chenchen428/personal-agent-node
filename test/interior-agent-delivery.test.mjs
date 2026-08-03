import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildAgentDeliveryExample, verifyAgentDeliveryExample } from "../skills/interior-design/scripts/build-agent-delivery-example.mjs";
import { evaluateAgentReview, REVIEW_TARGETS } from "../skills/render-interior-pages/scripts/renderer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifactRoot = path.join(root, "core", "app", "public", "assets", "agents", "interior-designer", "featured");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("interior-designer exposes one V5 dependency-aware delivery", () => {
  const contract = JSON.parse(read("agents/interior-designer/examples/featured-delivery.json"));
  assert.equal(contract.id, "interior-workspace-v5");
  assert.deepEqual(contract.agent, { id: "interior-designer", version: 5 });
  assert.equal(contract.delivery.workspaceContract, "personal-agent/interior-workspace/v5");
  assert.equal(contract.delivery.geometryAuthority, "geometry.json");
  assert.equal(contract.delivery.engine, "geometry-v5+three-v5+krpano");
  assert.deepEqual(contract.delivery.shareableOutputs, ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"]);
  assert.equal(contract.delivery.renderer.version, 5);
  assert.equal(contract.delivery.specialistPages.threeD.path, "3d/index.html");
});

test("representative delivery is reproducible, self-contained, and hash complete", async () => {
  const result = await buildAgentDeliveryExample({ check: true });
  assert.equal(result.ok, true);
  const { manifest } = verifyAgentDeliveryExample(artifactRoot);
  assert.equal(manifest.contract, "personal-agent/interior-page-bundle/v5");
  assert.equal(manifest.delivery.engine, "geometry-v5+three-v5+krpano");
  assert.deepEqual(manifest.delivery.distributions, ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"]);
  assert.equal(manifest.privacy.rawEvidenceIncluded, false);
  assert.equal(manifest.visualAcceptance, "user");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const value = fs.readFileSync(path.join(artifactRoot, name));
    assert.equal(value.length, expected.bytes, name);
    assert.equal(crypto.createHash("sha256").update(value).digest("hex"), expected.sha256, name);
  }
});

test("booklet remains the Page entry and Web 3D stays a separate focused surface", () => {
  const booklet = read("core/app/public/assets/agents/interior-designer/featured/index.html");
  const viewer = read("core/app/public/assets/agents/interior-designer/featured/3d/index.html");
  assert.match(booklet, /你会获得怎样的家/);
  assert.match(booklet, /href="3d\/index\.html"[^>]*target="_blank"/);
  assert.match(booklet, /六类设计图纸/);
  assert.match(booklet, /这些需求已经进入方案/);
  assert.match(booklet, /assets\/drawings\/p-01-plan-layout\.svg/);
  assert.match(booklet, /把这一版发给家人一起看/);
  assert.doesNotMatch(booklet, /DXF|DWG|SKP|SketchUp|GLB|专业文件/);
  assert.match(booklet, /这些决定需要你确认/);
  assert.doesNotMatch(booklet, /INTERIOR WORKSPACE|geometry\.json|工作区|统一几何|需求闭环/);
  assert.doesNotMatch(booklet, /<iframe\b/);
  assert.match(viewer, /data-engine="three-interior-v5"/);
  assert.match(viewer, /data-view="overview"/); assert.match(viewer, /data-view="plan"/); assert.match(viewer, /data-action="walk"/); assert.match(viewer, /data-action="reset"/);
  assert.doesNotMatch(`${booklet}\n${viewer}`, /<(?:script|img|link|iframe)\b[^>]*(?:src|href)=["']https?:/i);
  assert.doesNotMatch(`${booklet}\n${viewer}`, /localhost|127\.0\.0\.1|file:\/\//i);
});

test("renderer review is revision-bound and never grants user visual acceptance", () => {
  const plan = JSON.parse(read("core/app/public/assets/agents/interior-designer/featured/agent-review.json"));
  const observations = {
    schemaVersion: 5,
    rendererVersion: 5,
    revision: plan.revision,
    targets: REVIEW_TARGETS.map(({ id }) => ({ id, status: "pass", observations: ["结构与控件已检查"] })),
    style: { selectedStyleId: plan.styleInspection.selectedStyleId, effectRenderBindingReady: true, observations: ["材料与效果图合同一致"] },
  };
  const result = evaluateAgentReview(artifactRoot, observations);
  assert.equal(result.ok, true);
  assert.equal(result.decision, "ready-for-user-review");
  assert.deepEqual(result.shareableOutputs, ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"]);
  assert.equal(result.visualAcceptance, "user");
  observations.targets.find((target) => target.id === "three-d-desktop").status = "needs-change";
  assert.deepEqual(evaluateAgentReview(artifactRoot, observations).blockingTargets, ["three-d-desktop"]);
});

test("retired engine code and dependencies are absent from the interior production surface", () => {
  const token = ["pas", "cal"].join("");
  const interiorFiles = walk(path.join(root, "skills", "interior-design"));
  assert.equal(interiorFiles.some((file) => path.basename(file).toLowerCase().includes(token)), false);
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(Object.keys(packageJson.dependencies).some((name) => name.toLowerCase().includes(token)), false);
  const productionText = interiorFiles.filter((file) => !/\.(?:png|jpg|jpeg|webp|glb)$/i.test(file)).map((file) => fs.readFileSync(file, "utf8").toLowerCase()).join("\n");
  assert.equal(productionText.includes(token), false);
});

function walk(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const file = path.join(directory, entry.name); return entry.isDirectory() ? walk(file) : [file]; }); }
