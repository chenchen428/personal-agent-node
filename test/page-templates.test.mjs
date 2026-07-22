import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Pages registers one focused built-in renovation template", () => {
  const registry = JSON.parse(read("registry/page-templates.json"));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.templates.length, 1);
  assert.equal(registry.templates[0].id, "interior-design-delivery");
  assert.equal(registry.templates[0].skill, "interior-design");
  assert.equal(registry.templates[0].mobileLandscape, true);
  assert.match(registry.templates[0].summary, /SketchUp 式建筑模型语言/);
  assert.ok(registry.templates[0].fixedFramework.some((item) => item.includes("SketchUp 式低多边形建筑表达")));
});

test("template list stays a compact static card while detail owns interaction", () => {
  const list = read("core/app/src/components/page-templates/page-templates-page.tsx");
  const routeLoading = read("core/app/src/app/app/pages/templates/[templateId]/loading.tsx");
  const artwork = read("core/app/src/components/page-templates/template-card-artwork.tsx");
  const detail = read("core/app/src/components/page-templates/page-template-detail-page.tsx");
  const devicePreview = read("core/app/src/components/page-templates/template-device-preview.tsx");
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const requirements = read("core/app/src/components/page-templates/interior-template-requirements.tsx");
  const parityStyles = read("core/app/src/app/page-template-parity.css");
  assert.match(list, /TemplateCardArtwork/);
  assert.match(list, /href=\{`\/app\/pages\/templates\/\$\{template\.id\}`\} prefetch/);
  assert.match(routeLoading, /LoadingState label="正在打开模板"/);
  assert.match(routeLoading, /PageSurface/);
  assert.doesNotMatch(list, /PAGES · TEMPLATE/);
  assert.doesNotMatch(`${list}\n${detail}`, /<Breadcrumb/);
  assert.doesNotMatch(`${list}\n${artwork}`, /iframe|WebGLRenderer|InteriorTemplateCanvas/);
  assert.match(devicePreview, /Web/);
  assert.match(devicePreview, /移动端/);
  assert.match(detail, /户型调整依据/);
  assert.match(detail, /PageHeader/);
  assert.match(detail, /template-detail-overview/);
  assert.match(devicePreview, /template-device-preview/);
  assert.match(parityStyles, /template-device-preview\.is-web \.template-device-frame/);
  assert.doesNotMatch(detail, /template-detail-heading|template-detail-facts|template-live-preview|template-detail-information/);
  assert.match(preview, /SU 设计稿/);
  assert.match(preview, /户型图/);
  assert.match(preview, /用户需求/);
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
  assert.deepEqual(exact, { pattern: "/app/pages/templates", access: "authenticated", capability: "publications" });
  assert.deepEqual(detail, { pattern: "/app/pages/templates/*", access: "authenticated", capability: "publications" });
});
