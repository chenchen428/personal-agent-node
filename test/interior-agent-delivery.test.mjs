import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  buildAgentDeliveryExample,
  verifyAgentDeliveryExample,
} from "../skills/interior-design/scripts/build-agent-delivery-example.mjs";
import {
  DELIVERY_MAX_RENDER_EDGE,
  DELIVERY_PIXEL_BUDGET,
  resolveDeliveryDpr,
} from "../skills/interior-design/scripts/pascal-render-budget.mjs";
import { mobileLandscapeController } from "../skills/interior-design/scripts/generate-page-v2.mjs";
import { evaluateAgentReview, REVIEW_TARGETS } from "../skills/render-interior-pages/scripts/renderer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifactRoot = path.join(root, "core/app/public/assets/agents/interior-designer/featured");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function referencedImageByAlt(html, alt) {
  const tag = [...html.matchAll(/<img\b[^>]*>/g)]
    .map(([value]) => value)
    .find((value) => value.includes(`alt="${alt}"`));
  assert.ok(tag, `missing image: ${alt}`);
  const source = tag.match(/src="([^"]+)"/)?.[1] || "";
  assert.ok(source && !source.startsWith("data:"), `image must use a relative Page asset: ${alt}`);
  return fs.readFileSync(path.join(artifactRoot, source));
}

function evaluateMobileLayout({ width, height, userAgent, mobile = false, maxTouchPoints = 0, screenWidth = width, screenHeight = height, search = "" }) {
  const properties = new Map();
  const listeners = new Map();
  const window = {
    innerWidth: width,
    innerHeight: height,
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: () => true,
    visualViewport: { addEventListener: (name, listener) => listeners.set(`visual-${name}`, listener) },
  };
  const context = {
    CustomEvent: class CustomEvent {},
    document: {
      body: { dataset: {} },
      documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
    },
    innerWidth: width,
    innerHeight: height,
    location: { search },
    navigator: { maxTouchPoints, userAgent, userAgentData: { mobile } },
    screen: { width: screenWidth, height: screenHeight },
    window,
  };
  vm.runInNewContext(mobileLandscapeController(), context);
  return {
    labels: context.document.body.dataset.labels,
    layout: context.document.body.dataset.mobileLayout,
    properties,
  };
}

test("mobile portrait is forced into the landscape canvas without rotating narrow desktop windows", () => {
  const portrait = evaluateMobileLayout({ width: 390, height: 844, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", mobile: true, maxTouchPoints: 5 });
  assert.equal(portrait.layout, "forced-landscape");
  assert.equal(portrait.labels, "hidden");
  assert.equal(portrait.properties.get("--portrait-viewport-width"), "390px");
  assert.equal(portrait.properties.get("--landscape-viewport-width"), "844px");
  assert.equal(portrait.properties.get("--landscape-viewport-height"), "390px");

  const landscape = evaluateMobileLayout({ width: 844, height: 390, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", mobile: true, maxTouchPoints: 5 });
  assert.equal(landscape.layout, "landscape");
  assert.equal(landscape.labels, "hidden");

  const desktop = evaluateMobileLayout({ width: 430, height: 900, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", screenWidth: 1920, screenHeight: 1080 });
  assert.equal(desktop.layout, "desktop");
  assert.equal(desktop.labels, "visible");

  const portraitPreview = evaluateMobileLayout({
    width: 390,
    height: 844,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    screenWidth: 1920,
    screenHeight: 1080,
    search: "?agent-output=1&device=mobile",
  });
  assert.equal(portraitPreview.layout, "forced-landscape");
  assert.equal(portraitPreview.labels, "hidden");
});

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
  assert.equal(contract.delivery.version, 3);
  assert.equal(contract.delivery.engine, "pascal-v2");
  assert.equal(contract.delivery.layoutProfile, "renovation-booklet");
  assert.deepEqual(contract.delivery.specialistPages.threeD, {
    path: "3d/index.html",
    layoutProfile: "su-design-classic",
    engine: "pascal-v2",
  });
  assert.equal(contract.delivery.renderProfile, "professional-archviz-v2");
  assert.match(contract.delivery.generator, /render-interior-pages\/scripts\/cli\.mjs render --project-dir/);
  assert.doesNotMatch(contract.delivery.generator, /--template/);
  assert.deepEqual(contract.delivery.renderer, {
    id: "render-interior-pages",
    version: 1,
    requestSchema: "personal-agent/interior-page-request/v1",
    outputSchema: "personal-agent/interior-page-bundle/v1",
  });
  assert.equal(contract.asset.basePath, "/assets/agents/interior-designer/featured");
  assert.equal(contract.asset.threeDPagePath, "/assets/agents/interior-designer/featured/3d/index.html");
  assert.ok(contract.fixedFramework.length >= 7);
  assert.ok(contract.agentFreedom.length >= 3);

  assert.equal(fs.existsSync(path.join(root, "registry/page-templates.json")), false);
  assert.equal(fs.existsSync(path.join(root, "skills/personal-pages/SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(root, "core/app/public/assets/templates/interior-design-delivery-v2")), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, "template.json")), false);
});

test("the renderer closes the Agent review loop without granting visual acceptance", () => {
  const plan = JSON.parse(read("core/app/public/assets/agents/interior-designer/featured/agent-review.json"));
  const observations = {
    schemaVersion: 1,
    rendererVersion: 1,
    revision: plan.revision,
    targets: REVIEW_TARGETS.map(({ id }) => ({ id, status: "pass", observations: ["Rendered Page inspected"] })),
  };
  assert.deepEqual(evaluateAgentReview(artifactRoot, observations), {
    ok: true,
    schemaVersion: 1,
    renderer: plan.renderer,
    revision: plan.revision,
    decision: "ready-for-user-review",
    blockingTargets: [],
    visualAcceptance: "user",
  });
  observations.targets[3] = { ...observations.targets[3], status: "needs-change" };
  assert.deepEqual(evaluateAgentReview(artifactRoot, observations).blockingTargets, ["three-d-mobile-portrait"]);
  observations.targets[4] = { ...observations.targets[3] };
  assert.throws(() => evaluateAgentReview(artifactRoot, observations), /duplicate targets/);
});

test("the representative delivery is reproducible, self-contained, and all declared hashes match", async () => {
  const result = await buildAgentDeliveryExample({ check: true });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check");
  const { manifest } = verifyAgentDeliveryExample(artifactRoot);
  const html = read("core/app/public/assets/agents/interior-designer/featured/index.html");
  const profile = JSON.parse(read("agents/interior-designer/profile.yaml"));

  assert.deepEqual(manifest.agent, {
    id: "interior-designer",
    version: 1,
    exampleId: "interior-c-layout-delivery",
  });
  assert.deepEqual(manifest.delivery, {
    version: 3,
    engine: "pascal-v2",
    layoutProfile: "renovation-booklet",
    renderProfile: "professional-archviz-v2",
    specialistPages: {
      threeD: { path: "3d/index.html", layoutProfile: "su-design-classic", engine: "pascal-v2" },
    },
  });
  assert.equal(manifest.visualAcceptance, "user");
  assert.equal(manifest.source.kind, "native-governed-pascal-v2-project");
  assert.equal(manifest.source.renderProfile, "professional-archviz-v2");
  assert.equal(manifest.source.demandWorkflow.stage, "delivered");
  assert.equal(manifest.source.demandWorkflow.transitionCount, 7);
  assert.equal(manifest.source.renderSet.length, 4);
  assert.ok(manifest.source.renderSet.every((entry) => entry.generator === "imagegen"));
  for (const retired of ["templateId", "templateVersion", "artifactMarker"]) {
    assert.equal(retired in manifest, false, retired);
  }
  assert.ok(Object.keys(manifest.files).includes("media/render-living-overview.webp"));
  assert.ok(Object.keys(manifest.files).includes("media/render-primary-bedroom.webp"));
  assert.ok(Object.keys(manifest.files).includes("3d/index.html"));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const value = fs.readFileSync(path.join(artifactRoot, name));
    assert.equal(value.length, expected.bytes, name);
    assert.equal(sha256(value), expected.sha256, name);
  }

  assert.equal(sha256(referencedImageByAlt(html, "公共区全景概念效果图")), manifest.source.renderSet[0].deliveryImageSha256);
  assert.equal(sha256(referencedImageByAlt(html, "用户上传并脱敏的原始户型图")), manifest.files["media/source-plan.png"].sha256);
  assert.equal(sha256(referencedImageByAlt(html, "Agent 上传的户型分析标注图")), manifest.files["media/agent-annotation.png"].sha256);
  assert.match(profile.examples[0].summary, /历史代表案例.*装修项目设计册.*浏览器新页面.*独立 3D Page.*一张样张.*十五张以上/);
});

test("the representative delivery preserves the governed Pascal v2 interaction and safety contract", () => {
  const html = read("core/app/public/assets/agents/interior-designer/featured/index.html");
  const threeDHtml = read("core/app/public/assets/agents/interior-designer/featured/3d/index.html");
  const scene = JSON.parse(read("core/app/public/assets/agents/interior-designer/featured/scene.json"));
  const cover = read("core/app/public/assets/agents/interior-designer/featured/cover.svg");
  const nodes = Object.values(scene.scene.nodes);

  assert.match(html, /data-engine="pascal-v2"/);
  assert.match(html, /data-agent-id="interior-designer"/);
  assert.match(html, /data-agent-example-id="interior-c-layout-delivery"/);
  assert.match(html, /data-layout-profile="renovation-booklet"/);
  assert.match(html, /data-primary-delivery="true"/);
  assert.match(html, /href="3d\/index.html"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /<iframe\b|id="pascal-scene"|pascal-viewer-warmup/);
  assert.match(html, /项目摘要与需求/);
  assert.match(html, /完整设计说明/);
  assert.match(html, /材料清单与预算范围/);
  assert.match(html, /设计一致性检查/);
  assert.match(html, /设计过程与确认点/);
  assert.match(html, /排除项、落地顺序与复尺清单/);
  assert.match(threeDHtml, /data-layout-profile="su-design-classic"/);
  assert.match(threeDHtml, /data-specialist-page="three-d"/);
  assert.doesNotMatch(threeDHtml, /项目摘要与需求|完整设计说明|材料清单与预算范围|设计过程与确认点/);
  assert.doesNotMatch(threeDHtml, /<(?:section|article|aside)[^>]+(?:id|class)=["'][^"']*(?:requirements?|brief|narrative)[^"']*["']/i);
  assert.match(threeDHtml, /data-mobile-layout/);
  assert.match(threeDHtml, /forced-landscape/);
  assert.match(threeDHtml, /--landscape-viewport-width/);
  assert.match(threeDHtml, /transform: rotate\(90deg\)/);
  assert.doesNotMatch(threeDHtml, /orientation-hint|横屏查看空间更完整/);
  assert.doesNotMatch(threeDHtml, /data-presentation=|data-presentation-panel=/);
  assert.match(html, /概念效果不替代施工图或材料实样/);
  assert.match(threeDHtml, /id="pascal-scene"/);
  assert.match(threeDHtml, /id="model-derived-plan"/);
  assert.match(threeDHtml, /id="viewer-loading"/);
  assert.match(html, /plan-source-image/);
  assert.match(html, /plan-annotation-image/);
  assert.match(threeDHtml, /data-level-mode="stacked"/);
  assert.match(threeDHtml, /data-level-mode="exploded"/);
  assert.match(threeDHtml, /data-level-mode="solo"/);
  assert.doesNotMatch(threeDHtml, /data-camera-shot/);
  assert.match(threeDHtml, /pascal-room-label/);
  assert.match(threeDHtml, /pascal-highlight/);
  assert.match(threeDHtml, /professional-archviz-v2/);
  assert.match(threeDHtml, /pascal-viewer-warmup/);
  assert.match(cover, /data-cover-item=/);
  assert.doesNotMatch(`${html}\n${threeDHtml}`, /<(?:script|img|link|iframe)\b[^>]*(?:src|href)=["']https?:/i);
  assert.doesNotMatch(`${html}\n${threeDHtml}`, /localhost|127\.0\.0\.1|editor\.pascal\.app/);
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
  assert.match(viewerClient, /shadows: true/);
  assert.match(viewerClient, /sceneTheme: 'paper'/);
  assert.doesNotMatch(viewerClient, /disablePostFx/);
  assert.match(viewerClient, /<DeliveryRenderBudget \/>/);
  assert.match(renderBudget, /resolveDeliveryDpr/);
  assert.match(renderBudget, /state\.viewport\.dpr/);
  assert.match(renderBudget, /Math\.abs\(currentDpr - desiredDpr\)/);
  assert.match(renderBudget, /setRenderPaused/);
  assert.match(renderBudget, /IntersectionObserver/);
  assert.match(renderBudget, /pascal-viewer-visibility/);
  assert.match(generator, /new CustomEvent\('pascal-viewer-visibility'\)/);
  assert.match(generator, /function mobileLandscapeController\(\)/);
  assert.match(generator, /navigator\.userAgentData\?\.mobile/);
  assert.match(generator, /previewMobile/);
  assert.match(generator, /body\.dataset\.labels=mobile\?'hidden':'visible'/);
  assert.match(generator, /pascal-layout-change/);
  assert.doesNotMatch(generator, /data-camera-shot/);
  assert.match(read("skills/interior-design/scripts/pascal-project-camera.jsx"), /maxPolarAngle=\{Math\.PI \/ 2 - 0\.05\}/);
  const viewportBridge = read("skills/interior-design/scripts/pascal-landscape-viewport.jsx");
  assert.match(viewportBridge, /target\.offsetWidth/);
  assert.match(viewportBridge, /setSize\(width, height/);
  assert.match(viewportBridge, /virtual-landscape/);
  const sceneLabels = read("skills/interior-design/scripts/pascal-scene-labels.jsx");
  assert.match(sceneLabels, /MOBILE_LABEL_LIMIT = 7/);
  assert.match(sceneLabels, /element\.dataset\.collided/);
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
