import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectPageTemplate, listPageTemplates, readPageTemplateRegistry, validatePageTemplateArtifact } from "../core/agent/src/online-pages/template-catalog.js";
import { buildTemplateExample, verifyTemplateExample } from "../skills/interior-design/scripts/build-template-example.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const artifactRoot = path.join(root, "core/app/public/assets/templates/interior-design-delivery-v2");

test("Pages registers one Pascal v2 renovation template with a generated example artifact", () => {
  const registry = JSON.parse(read("registry/page-templates.json"));
  const pageSkill = read("skills/personal-pages/SKILL.md");
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.templates.length, 1);
  const template = registry.templates[0];
  assert.equal(template.id, "interior-design-delivery");
  assert.equal(template.skill, "interior-design");
  assert.equal(template.mobileLandscape, true);
  assert.equal(template.implementation.version, 2);
  assert.match(template.implementation.generator, /cli\.mjs page --template interior-design-delivery --project-dir/);
  assert.equal(template.implementation.artifactMarker, "personal-agent-page-template");
  assert.deepEqual(template.acceptance, { visualOwner: "user", agentBrowserReview: false });
  assert.deepEqual(template.publicationContract, { verifyArtifactBeforePublish: true, persistProvenance: true });
  assert.deepEqual(template.exampleArtifact, {
    source: "native-governed-pascal-v2-project",
    pagePath: "/assets/templates/interior-design-delivery-v2/index.html",
    manifestPath: "/assets/templates/interior-design-delivery-v2/manifest.json",
    coverPath: "/assets/templates/interior-design-delivery-v2/cover.svg",
  });
  assert.equal(fs.existsSync(path.join(root, `skills/personal-pages/references/templates/${template.id}.md`)), true);
  assert.match(pageSkill, new RegExp(`${template.id}\\.md`));
});

test("the committed example is the byte-stable output of the governed native v2 pipeline", async () => {
  const result = await buildTemplateExample({ check: true });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check");
  const { manifest } = verifyTemplateExample(artifactRoot);
  assert.equal(manifest.source.kind, "native-governed-pascal-v2-project");
  assert.deepEqual(manifest.source.pipeline, [
    "project-v2-seed",
    "pascal-scene-compile",
    "professional-quality-audit",
    "page-v2-generate",
    "artifact-hash-verify",
  ]);
  assert.equal(manifest.source.renderProfile, "professional-mesh-ink");
  assert.equal(manifest.source.layoutProfile, "su-design-classic");
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
  for (const [name, expected] of Object.entries(manifest.files)) {
    const value = fs.readFileSync(path.join(artifactRoot, name));
    assert.equal(value.length, expected.bytes, name);
    assert.equal(crypto.createHash("sha256").update(value).digest("hex"), expected.sha256, name);
  }
  const html = read("core/app/public/assets/templates/interior-design-delivery-v2/index.html");
  const scene = JSON.parse(read("core/app/public/assets/templates/interior-design-delivery-v2/scene.json"));
  const nodes = Object.values(scene.scene.nodes);
  const cover = read("core/app/public/assets/templates/interior-design-delivery-v2/cover.svg");
  assert.match(html, /data-engine="pascal-v2"/);
  assert.match(html, /id="pascal-scene"/);
  assert.match(html, /id="model-derived-plan"/);
  assert.match(html, /id="viewer-loading"/);
  assert.match(html, /用户户型图与 Agent 标注/);
  assert.match(html, /plan-source-image/);
  assert.match(html, /plan-annotation-image/);
  assert.match(html, /data-plan-mode="annotation"/);
  assert.match(html, /data-presentation-panel="review"/);
  assert.doesNotMatch(html, /data-presentation="review"/);
  assert.match(html, /<nav class="presentation-switch"[\s\S]*SU 设计稿[\s\S]*户型图[\s\S]*用户需求[\s\S]*<\/nav>/);
  assert.match(html, /pascal-room-label/);
  assert.match(html, /pascal-highlight/);
  assert.match(html, /professional-mesh-ink/);
  assert.match(html, /data-layout-profile="su-design-classic"/);
  assert.match(html, /pascal-viewer-warmup/);
  assert.match(html, /function restoreModelView\(\)\{call\('resetCamera'\);call\('warmup'\)\}/);
  assert.match(html, /setTimeout\(restoreModelView,180\)/);
  assert.match(html, /setTimeout\(restoreModelView,1100\)/);
  assert.doesNotMatch(html, /class="navigator"/);
  assert.ok(nodes.filter((node) => node.type === "zone").length >= 12);
  assert.ok(nodes.filter((node) => ["door", "window"].includes(node.type)).length >= 14);
  assert.ok(nodes.filter((node) => node.type === "wall").length >= 20);
  assert.ok(nodes.filter((node) => node.type === "slab").length >= 1);
  assert.ok(nodes.filter((node) => node.type === "ceiling").length >= 1);
  assert.ok(scene.furniture.length >= 30);
  assert.match(cover, /模型派生轴测封面/);
  assert.match(cover, /data-cover-item=/);
  assert.doesNotMatch(html, /data-engine="(?!pascal-v2)[^"]+"|localhost|127\.0\.0\.1|editor\.pascal\.app/);
});

test("template catalog and example route consume only the verified generated artifact", () => {
  const list = read("core/app/src/components/page-templates/page-templates-page.tsx");
  const artwork = read("core/app/src/components/page-templates/template-card-artwork.tsx");
  const detail = read("core/app/src/components/page-templates/page-template-detail-page.tsx");
  const devicePreview = read("core/app/src/components/page-templates/template-device-preview.tsx");
  const artifactPreview = read("core/app/src/components/page-templates/template-artifact-preview.tsx");
  const exampleRoute = read("core/app/src/app/template-pages/[templateId]/page.tsx");
  const styles = read("core/app/src/app/page-templates.css");
  const pages = read("core/app/src/components/desktop-v627/pages-page.tsx");
  const nextConfig = read("core/app/next.config.ts");
  const runtimeBuild = read("skills/interior-design/scripts/build-pascal-runtime.mjs");
  const viewerClient = read("skills/interior-design/scripts/pascal-page-client.jsx");
  const projectCamera = read("skills/interior-design/scripts/pascal-project-camera.jsx");
  const viewerLifecycle = read("skills/interior-design/scripts/pascal-viewer-lifecycle.jsx");
  const architectureClient = read("skills/interior-design/scripts/pascal-architecture.jsx");
  assert.match(list, /coverPath=\{template\.exampleArtifact\.coverPath\}/);
  assert.match(artwork, /src=\{coverPath\}/);
  assert.match(detail, /artifactPath=\{template\.exampleArtifact\.pagePath\}/);
  assert.match(devicePreview, /TemplateArtifactPreview/);
  assert.match(artifactPreview, /key=\{`\$\{artifactPath\}:\$\{device\}`\}/);
  assert.match(artifactPreview, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(artifactPreview, /referrerPolicy="no-referrer"/);
  assert.match(pages, /PageSurface className="pages-library-page"/);
  assert.match(pages, /className="button pages-template-action"/);
  assert.match(exampleRoute, /redirect\(template\.exampleArtifact\.pagePath\)/);
  assert.match(styles, /\.template-artifact-frame/);
  assert.match(nextConfig, /interior-design-delivery-v2/);
  assert.match(nextConfig, /max-age=300, must-revalidate/);
  assert.match(runtimeBuild, /\['import\.meta\.url', 'document\.baseURI'\]/);
  assert.match(projectCamera, /function ProjectCamera/);
  assert.match(projectCamera, /<CameraControls/);
  assert.match(projectCamera, /camera=\{camera\}/);
  assert.match(projectCamera, /api\.setLookAt/);
  assert.match(projectCamera, /narrowViewportScale/);
  assert.match(projectCamera, /frame\.span \* 1\.12/);
  assert.match(projectCamera, /frame\.span \* 0\.71/);
  assert.doesNotMatch(projectCamera, /api\.fitToSphere/);
  assert.match(projectCamera, /pascal-reset-camera/);
  assert.match(projectCamera, /pascal-camera-mode/);
  assert.match(projectCamera, /activeMode\.current/);
  assert.match(projectCamera, /1_900, 2_800/);
  assert.match(projectCamera, /hasUserCameraPose/);
  assert.match(projectCamera, /onStart=\{markUserCameraPose\}/);
  assert.match(projectCamera, /event\?\.detail\?\.automatic === true/);
  assert.match(projectCamera, /viewport\.current = size/);
  assert.doesNotMatch(projectCamera, /\[cameraMode, frame, invalidate, size\.height, size\.width\]/);
  assert.match(viewerClient, /<ArchitectureEnvelope payload=\{payload\}/);
  assert.match(viewerClient, /<ViewerLifecycle \/>/);
  assert.match(viewerClient, /wallMode: 'down'/);
  assert.match(viewerClient, /shading: 'rendered'/);
  assert.match(viewerClient, /professional-mesh-ink/);
  assert.match(viewerClient, /disablePostFx/);
  assert.match(viewerClient, /shadows: true/);
  assert.match(viewerClient, /setTimeout\(restoreCamera, 1_800\)/);
  assert.match(viewerClient, /detail: \{ automatic: true \}/);
  assert.match(viewerClient, /pascal-camera-mode/);
  assert.match(viewerLifecycle, /useFrame/);
  assert.match(viewerLifecycle, /pascal-viewer-warmup/);
  assert.match(viewerLifecycle, /fallback\.hidden = true/);
  assert.match(viewerLifecycle, /loading\.hidden = true/);
  assert.match(viewerLifecycle, /body\.dataset\.viewerState = 'ready'/);
  assert.match(architectureClient, /personal-agent-architecture-envelope/);
  assert.match(architectureClient, /pascal-room-surface/);
  assert.match(architectureClient, /pascal-wall-cap/);
  assert.match(architectureClient, /function WallShell/);
  assert.match(architectureClient, /function splitWall/);
  assert.match(architectureClient, /function BalconyRailing/);
  const templateComponents = fs.readdirSync(path.join(root, "core/app/src/components/page-templates"));
  assert.equal(templateComponents.some((name) => name.startsWith("interior-template-")), false);
  assert.equal(templateComponents.includes("page-template-example-page.tsx"), false);
  assert.doesNotMatch(`${list}\n${artwork}\n${detail}\n${devicePreview}\n${styles}`, /WebGLRenderer|hand-authored-scene/);
});

test("Agent template catalog lists matching metadata and inspects the execution contract", () => {
  const registry = readPageTemplateRegistry();
  const templates = listPageTemplates({ registry });
  assert.deepEqual(templates.map((template) => template.id), ["interior-design-delivery"]);
  assert.equal(templates[0].skill, "interior-design");
  assert.equal(templates[0].implementation.version, 2);
  assert.equal(templates[0].acceptance.agentBrowserReview, false);
  assert.match(templates[0].contractDigest, /^[a-f0-9]{64}$/);
  const template = inspectPageTemplate("interior-design-delivery", { registry });
  assert.ok(template.fixedFramework.length >= 8);
  assert.ok(template.agentInstructions.some((item) => item.includes("子任务")));
  assert.equal(template.contractDigest, templates[0].contractDigest);
  assert.equal(inspectPageTemplate("missing-template", { registry }), null);
});

test("registered template artifacts fail closed and return persisted publication provenance", () => {
  const html = fs.readFileSync(path.join(artifactRoot, "index.html"));
  const verified = validatePageTemplateArtifact("interior-design-delivery", html);
  assert.deepEqual(verified.provenance, {
    id: "interior-design-delivery",
    version: 2,
    contractDigest: verified.template.contractDigest,
    artifactMarker: "personal-agent-page-template",
    artifactSha256: crypto.createHash("sha256").update(html).digest("hex"),
  });
  assert.throws(
    () => validatePageTemplateArtifact("interior-design-delivery", html.toString("utf8").replace('data-template-version="2"', 'data-template-version="1"')),
    /bodyVersion mismatch/,
  );
  assert.throws(
    () => validatePageTemplateArtifact("missing-template", html),
    /Unknown Page template/,
  );
});

test("desktop header owns reusable drill-down breadcrumbs", () => {
  const shell = read("core/app/src/components/app-shell.tsx");
  const header = read("core/app/src/components/desktop-header-breadcrumb.tsx");
  assert.match(shell, /DesktopHeaderBreadcrumb/);
  assert.match(header, /aria-label="当前位置"/);
  assert.match(header, /\/app\/pages\/templates/);
  assert.match(header, /\/app\/workers\/schedules/);
  assert.match(header, /\/app\/connections\/wechat-personal/);
  assert.match(header, /页面详情/);
  assert.match(header, /应用详情/);
});

test("authenticated route registry covers template list, details, and generated example redirects", () => {
  const routes = JSON.parse(read("registry/routes.json")).routes;
  assert.deepEqual(routes.find((route) => route.pattern === "/app/pages/templates"), {
    pattern: "/app/pages/templates",
    access: "authenticated",
    capability: "publications",
  });
  assert.deepEqual(routes.find((route) => route.pattern === "/app/pages/templates/*"), {
    pattern: "/app/pages/templates/*",
    access: "authenticated",
    capability: "publications",
  });
  assert.deepEqual(routes.find((route) => route.pattern === "/template-pages/*"), {
    pattern: "/template-pages/*",
    access: "authenticated",
    capability: "publications",
  });
});
