import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildAgentDeliveryExample,
  verifyAgentDeliveryExample,
} from "../skills/interior-design/scripts/build-agent-delivery-example.mjs";
import {
  DELIVERY_MAX_RENDER_EDGE,
  DELIVERY_PIXEL_BUDGET,
  resolveDeliveryDpr,
} from "../skills/interior-design/scripts/pascal-render-budget.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifactRoot = path.join(root, "core/app/public/assets/agents/interior-designer/featured");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Pascal delivery DPR follows a bounded pixel budget as the page grows", () => {
  assert.equal(DELIVERY_PIXEL_BUDGET, 1_400_000);
  assert.equal(DELIVERY_MAX_RENDER_EDGE, 2_048);
  assert.equal(resolveDeliveryDpr({ width: 640, height: 400, deviceDpr: 2 }), 1.25);
  assert.equal(resolveDeliveryDpr({ width: 1280, height: 720, deviceDpr: 1.5 }), 1.23);
  assert.equal(resolveDeliveryDpr({ width: 1920, height: 1080, deviceDpr: 2 }), 0.82);
  assert.equal(resolveDeliveryDpr({ width: 2560, height: 1440, deviceDpr: 2 }), 0.61);
  assert.equal(resolveDeliveryDpr({ width: 3840, height: 2160, deviceDpr: 2 }), 0.41);
  assert.equal(resolveDeliveryDpr({ width: 5000, height: 200, deviceDpr: 2 }), 0.4);
  assert.equal(resolveDeliveryDpr({ width: Number.NaN, height: 720, deviceDpr: 2 }), null);
  assert.equal(resolveDeliveryDpr({ width: 0, height: 720, deviceDpr: 2 }), null);
  assert.equal(resolveDeliveryDpr({ width: -1, height: 720, deviceDpr: 2 }), null);
  assert.equal(resolveDeliveryDpr({ width: Number.POSITIVE_INFINITY, height: 720, deviceDpr: 2 }), null);
  assert.equal(resolveDeliveryDpr({ width: 1280, height: 720, deviceDpr: 0 }), 1);
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]) {
    const dpr = resolveDeliveryDpr({ width, height, deviceDpr: 2 });
    assert.ok(width * height * dpr * dpr <= DELIVERY_PIXEL_BUDGET);
    assert.ok(width * dpr <= DELIVERY_MAX_RENDER_EDGE);
    assert.ok(height * dpr <= DELIVERY_MAX_RENDER_EDGE);
  }
});

test("interior-designer owns one representative delivery contract without a template product layer", () => {
  const contract = JSON.parse(read("agents/interior-designer/examples/featured-delivery.json"));
  assert.equal(contract.id, "interior-c-layout-delivery");
  assert.deepEqual(contract.agent, { id: "interior-designer", version: 1 });
  assert.equal(contract.delivery.version, 2);
  assert.equal(contract.delivery.engine, "pascal-v2");
  assert.equal(contract.delivery.layoutProfile, "su-design-classic");
  assert.equal(contract.delivery.renderProfile, "professional-mesh-ink");
  assert.match(contract.delivery.generator, /cli\.mjs page --project-dir/);
  assert.doesNotMatch(contract.delivery.generator, /--template/);
  assert.equal(contract.asset.basePath, "/assets/agents/interior-designer/featured");
  assert.ok(contract.fixedFramework.length >= 6);
  assert.ok(contract.agentFreedom.length >= 3);

  assert.equal(fs.existsSync(path.join(root, "registry/page-templates.json")), false);
  assert.equal(fs.existsSync(path.join(root, "skills/personal-pages/SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(root, "core/app/public/assets/templates/interior-design-delivery-v2")), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, "template.json")), false);
});

test("the representative delivery is the byte-stable output of the governed native v2 pipeline", async () => {
  const result = await buildAgentDeliveryExample({ check: true });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check");
  const { manifest } = verifyAgentDeliveryExample(artifactRoot);
  assert.deepEqual(manifest.agent, {
    id: "interior-designer",
    version: 1,
    exampleId: "interior-c-layout-delivery",
  });
  assert.deepEqual(manifest.delivery, {
    version: 2,
    engine: "pascal-v2",
    layoutProfile: "su-design-classic",
    renderProfile: "professional-mesh-ink",
  });
  assert.equal(manifest.source.kind, "native-governed-pascal-v2-project");
  assert.deepEqual(manifest.source.pipeline, [
    "project-v2-seed",
    "pascal-scene-compile",
    "professional-quality-audit",
    "page-v2-generate",
    "artifact-hash-verify",
  ]);
  assert.deepEqual(manifest.source.qualityFloor, {
    rooms: 12,
    furniture: 30,
    openings: 14,
    doors: 8,
    windows: 6,
    walls: 20,
    slabs: 1,
    ceilings: 1,
  });
  for (const retired of ["templateId", "templateVersion", "artifactMarker"]) {
    assert.equal(retired in manifest, false, retired);
  }
  assert.deepEqual(Object.keys(manifest.files).sort(), ["audit.json", "cover.svg", "index.html", "scene.json"]);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const value = fs.readFileSync(path.join(artifactRoot, name));
    assert.equal(value.length, expected.bytes, name);
    assert.equal(crypto.createHash("sha256").update(value).digest("hex"), expected.sha256, name);
  }
});

test("the representative delivery preserves the governed Pascal v2 interaction and safety contract", () => {
  const html = read("core/app/public/assets/agents/interior-designer/featured/index.html");
  const scene = JSON.parse(read("core/app/public/assets/agents/interior-designer/featured/scene.json"));
  const cover = read("core/app/public/assets/agents/interior-designer/featured/cover.svg");
  const nodes = Object.values(scene.scene.nodes);

  assert.match(html, /data-agent-id="interior-designer"/);
  assert.match(html, /data-agent-example-id="interior-c-layout-delivery"/);
  assert.match(html, /data-delivery-version="2"/);
  assert.match(html, /data-engine="pascal-v2"/);
  assert.match(html, /data-layout-profile="su-design-classic"/);
  assert.match(html, /id="pascal-scene"/);
  assert.match(html, /id="model-derived-plan"/);
  assert.match(html, /id="viewer-loading"/);
  assert.match(html, /plan-source-image/);
  assert.match(html, /plan-annotation-image/);
  assert.match(html, /data-level-mode="stacked"/);
  assert.match(html, /data-level-mode="exploded"/);
  assert.match(html, /data-level-mode="solo"/);
  assert.match(html, /pascal-room-label/);
  assert.match(html, /pascal-highlight/);
  assert.match(html, /professional-mesh-ink/);
  assert.match(html, /pascal-viewer-warmup/);
  assert.match(html, /pascal-viewer-visibility/);
  assert.match(cover, /data-cover-item=/);
  assert.doesNotMatch(html, /personal-agent-page-template|data-template-|templateId|templateVersion|artifactMarker/);
  assert.doesNotMatch(html, /data-engine="(?!pascal-v2)[^"]+"|localhost|127\.0\.0\.1|editor\.pascal\.app/);
  assert.ok(nodes.filter((node) => node.type === "zone").length >= 12);
  assert.ok(nodes.filter((node) => ["door", "window"].includes(node.type)).length >= 14);
  assert.ok(nodes.filter((node) => node.type === "wall").length >= 20);
  assert.ok(scene.furniture.length >= 30);
});

test("render budget and Page generator keep the accepted Pascal v2 implementation details", () => {
  const viewerClient = read("skills/interior-design/scripts/pascal-page-client.jsx");
  const renderBudget = read("skills/interior-design/scripts/pascal-render-budget.jsx");
  const generator = read("skills/interior-design/scripts/generate-page-v2.mjs");
  assert.match(viewerClient, /shading: 'rendered'/);
  assert.match(viewerClient, /shadows: false/);
  assert.match(viewerClient, /<DeliveryRenderBudget \/>/);
  assert.match(renderBudget, /resolveDeliveryDpr/);
  assert.match(renderBudget, /state\.viewport\.dpr/);
  assert.match(renderBudget, /Math\.abs\(currentDpr - desiredDpr\)/);
  assert.match(renderBudget, /setRenderPaused/);
  assert.match(renderBudget, /IntersectionObserver/);
  assert.match(renderBudget, /pascal-viewer-visibility/);
  assert.match(generator, /new CustomEvent\('pascal-viewer-visibility'\)/);
  assert.doesNotMatch(generator, /template\.json|artifactMarker|data-template-id|data-template-version/);
});

test("the interior Page command rejects the retired template selector", () => {
  const result = spawnSync(process.execPath, [
    "skills/interior-design/scripts/cli.mjs",
    "page",
    "--template",
    "interior-design-delivery",
    "--project-dir",
    "unused",
    "--output",
    "unused",
    "--json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /--template is retired/);
  assert.match(result.stdout, /INVALID_ARGUMENT/);
});
