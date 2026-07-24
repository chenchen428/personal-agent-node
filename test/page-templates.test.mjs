import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectPageTemplate, listPageTemplates, readPageTemplateRegistry } from "../core/agent/src/online-pages/template-catalog.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Pages registers one focused built-in renovation template", () => {
  const registry = JSON.parse(read("registry/page-templates.json"));
  const pageSkill = read("skills/personal-pages/SKILL.md");
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.templates.length, 1);
  for (const template of registry.templates) {
    const reference = `skills/personal-pages/references/templates/${template.id}.md`;
    assert.equal(fs.existsSync(path.join(root, reference)), true, reference);
    assert.match(pageSkill, new RegExp(`${template.id}\\.md`));
  }
  assert.equal(registry.templates[0].id, "interior-design-delivery");
  assert.equal(registry.templates[0].skill, "interior-design");
  assert.equal(registry.templates[0].mobileLandscape, true);
  assert.match(registry.templates[0].summary, /SketchUp 式建筑模型语言/);
  assert.match(registry.templates[0].useWhen, /户型改造/);
  assert.ok(registry.templates[0].matchTerms.includes("装修设计"));
  assert.equal(registry.templates[0].implementation.version, 1);
  assert.match(registry.templates[0].implementation.generator, /cli\.mjs page --template interior-design-delivery --source-plan/);
  assert.equal(registry.templates[0].implementation.artifactMarker, "personal-agent-page-template");
  assert.deepEqual(registry.templates[0].acceptance, { visualOwner: "user", agentBrowserReview: false });
  assert.ok(registry.templates[0].agentInstructions.some((item) => item.includes("interior-design")));
  assert.ok(registry.templates[0].fixedFramework.some((item) => item.includes("SketchUp 式低多边形建筑表达")));
});

test("Agent template catalog lists match metadata and inspects the full execution contract", () => {
  const registry = readPageTemplateRegistry();
  const templates = listPageTemplates({ registry });
  assert.deepEqual(templates.map((template) => template.id), ["interior-design-delivery"]);
  assert.equal(templates[0].skill, "interior-design");
  assert.match(templates[0].useWhen, /装修设计/);
  assert.ok(templates[0].matchTerms.includes("SketchUp"));
  assert.equal(templates[0].implementation.version, 1);
  assert.equal(templates[0].acceptance.agentBrowserReview, false);
  const template = inspectPageTemplate("interior-design-delivery", { registry });
  assert.ok(template.fixedFramework.length >= 8);
  assert.ok(template.agentInstructions.some((item) => item.includes("子任务")));
  assert.equal(inspectPageTemplate("missing-template", { registry }), null);
});

test("template list stays a compact static card while detail owns interaction", () => {
  const list = read("core/app/src/components/page-templates/page-templates-page.tsx");
  const routeLoading = read("core/app/src/app/app/pages/templates/[templateId]/loading.tsx");
  const artwork = read("core/app/src/components/page-templates/template-card-artwork.tsx");
  const detail = read("core/app/src/components/page-templates/page-template-detail-page.tsx");
  const devicePreview = read("core/app/src/components/page-templates/template-device-preview.tsx");
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const requirements = read("core/app/src/components/page-templates/interior-template-requirements.tsx");
  const example = read("core/app/src/components/page-templates/page-template-example-page.tsx");
  const exampleRoute = read("core/app/src/app/template-pages/[templateId]/page.tsx");
  const parityStyles = read("core/app/src/app/page-template-parity.css");
  const nextConfig = read("core/app/next.config.ts");
  assert.match(list, /TemplateCardArtwork/);
  assert.match(list, /href=\{`\/app\/pages\/templates\/\$\{template\.id\}`\} prefetch/);
  assert.match(list, /template-mini-card/);
  assert.match(routeLoading, /LoadingState label="正在打开模板"/);
  assert.match(routeLoading, /PageSurface/);
  assert.doesNotMatch(list, /PAGES · TEMPLATE/);
  assert.doesNotMatch(`${list}\n${detail}`, /<Breadcrumb/);
  assert.doesNotMatch(`${list}\n${artwork}`, /iframe|WebGLRenderer|InteriorTemplateCanvas/);
  assert.match(devicePreview, /Web/);
  assert.match(devicePreview, /移动端/);
  assert.match(devicePreview, /dynamic\(/);
  assert.match(devicePreview, /TemplatePreviewLoading/);
  assert.doesNotMatch(devicePreview, /import \{ InteriorTemplatePreview \}/);
  assert.match(artwork, /interior-design-su-cover-v8\.webp/);
  assert.match(detail, /户型调整依据/);
  assert.match(detail, /PageHeader/);
  assert.match(detail, /template-detail-overview/);
  assert.match(detail, /target="_blank"/);
  assert.match(detail, /href=\{`\/template-pages\/\$\{template\.id\}`\}/);
  assert.match(devicePreview, /template-device-preview/);
  assert.match(parityStyles, /template-device-preview\.is-web \.template-device-stage\{padding:0\}/);
  assert.match(parityStyles, /template-device-preview\.is-web \.template-device-frame\{width:100%;height:auto/);
  assert.match(parityStyles, /template-mini-preview\{height:188px/);
  assert.match(example, /template-page-example/);
  assert.match(example, /InteriorTemplatePreview/);
  assert.match(exampleRoute, /findPageTemplate/);
  assert.match(nextConfig, /\/app\/:path\*/);
  assert.match(nextConfig, /private, no-store/);
  assert.match(nextConfig, /interior-design-su-cover-v8\.webp/);
  assert.match(nextConfig, /public, max-age=31536000, immutable/);
  assert.doesNotMatch(detail, /template-detail-heading|template-detail-facts|template-live-preview|template-detail-information/);
  assert.match(preview, /SU 设计稿/);
  assert.match(preview, /户型图/);
  assert.match(preview, /用户需求/);
  assert.match(preview, /data-template-id/);
  assert.match(preview, /data-template-version/);
  assert.match(requirements, /interior-requirement-groups/);
  assert.match(requirements, /interior-requirement-history/);
  assert.doesNotMatch(`${detail}\n${preview}`, /滚轮或双指|全屏查看|浏览空间/);
});

test("requirement digest is a single continuous vertical reader", () => {
  const preview = read("core/app/src/components/page-templates/interior-template-requirements.tsx");
  const styles = read("core/app/src/app/page-templates.css");
  assert.match(preview, /空间结构[\s\S]*生活习惯[\s\S]*设计偏好/);
  assert.match(styles, /interior-requirement-groups[^}]*grid-template-columns:1fr/);
  assert.match(styles, /interior-requirement-history[^}]*display:grid/);
  assert.doesNotMatch(styles, /interior-requirement-(?:groups|history)[^}]*overflow\s*:\s*(?:auto|scroll)/);
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

test("delivery preview keeps source evidence, revision marks, touch gestures, and focused SU controls", () => {
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const plan = read("core/app/src/components/page-templates/interior-template-plan.tsx");
  const requirements = read("core/app/src/components/page-templates/interior-template-requirements.tsx");
  const canvas = read("core/app/src/components/page-templates/interior-template-canvas.tsx");
  const model = read("core/app/src/components/page-templates/interior-template-model.ts");
  assert.match(plan, /interior-design-source-plan-redacted-v2\.png/);
  assert.match(plan, /原始图/);
  assert.match(plan, /调整标注/);
  assert.match(plan, /拆除餐厅右侧卧室/);
  assert.match(plan, /墙厚约 220mm/);
  assert.match(plan, /revision-wall-dimension/);
  assert.doesNotMatch(plan, /六人餐桌 2200|通道净宽约 1100|主卧大床 2200/);
  assert.match(plan, /revision-wall-left/);
  assert.match(plan, /revision-wall-bottom/);
  assert.match(plan, /onPointerDown/);
  assert.match(plan, /pointers\.current/);
  assert.match(preview, /1 层/);
  assert.doesNotMatch(preview, /2 层|DropdownMenuTrigger/);
  assert.match(preview, /SU DESIGN/);
  assert.match(preview, /连续大客厅/);
  assert.match(model, /原卧室并入公共区/);
  assert.match(model, /主卧套房/);
  assert.match(model, /生活阳台一/);
  assert.doesNotMatch(preview, /<select|<option/);
  assert.doesNotMatch(`${preview}\n${requirements}`, /6 米挑高|局部二层/);
  assert.match(requirements, /R7/);
  assert.match(preview, />3D</);
  assert.match(preview, />平面</);
  assert.match(preview, /隐藏细节标注/);
  assert.match(preview, /useState\(true\)/);
  assert.doesNotMatch(preview, /移除|风格切换|进入空间/);
  assert.match(canvas, /OrbitControls/);
  assert.doesNotMatch(`${preview}\n${canvas}`, /setInterval|requestAnimationFrame|autoRotate/);
});

test("authenticated route registry covers template list and details", () => {
  const routes = JSON.parse(read("registry/routes.json")).routes;
  const exact = routes.find((route) => route.pattern === "/app/pages/templates");
  const detail = routes.find((route) => route.pattern === "/app/pages/templates/*");
  const example = routes.find((route) => route.pattern === "/template-pages/*");
  assert.deepEqual(exact, { pattern: "/app/pages/templates", access: "authenticated", capability: "publications" });
  assert.deepEqual(detail, { pattern: "/app/pages/templates/*", access: "authenticated", capability: "publications" });
  assert.deepEqual(example, { pattern: "/template-pages/*", access: "authenticated", capability: "publications" });
});
