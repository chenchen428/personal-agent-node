import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectPageTemplate, listPageTemplates, readPageTemplateRegistry } from "../core/agent/src/online-pages/template-catalog.js";
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
  assert.deepEqual(manifest.source.qualityFloor, {
    rooms: 12,
    furniture: 30,
    openings: 14,
    doors: 8,
    windows: 6,
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
  assert.match(html, /data-presentation="review"/);
  assert.match(html, /pascal-room-label/);
  assert.match(html, /pascal-highlight/);
  assert.ok(nodes.filter((node) => node.type === "zone").length >= 12);
  assert.ok(nodes.filter((node) => ["door", "window"].includes(node.type)).length >= 14);
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
  const nextConfig = read("core/app/next.config.ts");
  const runtimeBuild = read("skills/interior-design/scripts/build-pascal-runtime.mjs");
  const viewerClient = read("skills/interior-design/scripts/pascal-page-client.jsx");
  assert.match(list, /coverPath=\{template\.exampleArtifact\.coverPath\}/);
  assert.match(artwork, /src=\{coverPath\}/);
  assert.match(detail, /artifactPath=\{template\.exampleArtifact\.pagePath\}/);
  assert.match(devicePreview, /TemplateArtifactPreview/);
  assert.match(artifactPreview, /sandbox="allow-scripts"/);
  assert.match(artifactPreview, /referrerPolicy="no-referrer"/);
  assert.match(exampleRoute, /redirect\(template\.exampleArtifact\.pagePath\)/);
  assert.match(styles, /\.template-artifact-frame/);
  assert.match(nextConfig, /interior-design-delivery-v2/);
  assert.match(nextConfig, /max-age=300, must-revalidate/);
  assert.match(runtimeBuild, /\['import\.meta\.url', 'document\.baseURI'\]/);
  assert.match(viewerClient, /function ProjectCamera/);
  assert.match(viewerClient, /<CameraControls/);
  assert.match(viewerClient, /api\.setLookAt/);
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
  const template = inspectPageTemplate("interior-design-delivery", { registry });
  assert.ok(template.fixedFramework.length >= 8);
  assert.ok(template.agentInstructions.some((item) => item.includes("子任务")));
  assert.equal(inspectPageTemplate("missing-template", { registry }), null);
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
