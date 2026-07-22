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
  assert.match(registry.templates[0].summary, /用户户型图/);
  assert.ok(registry.templates[0].fixedFramework.some((item) => item.includes("生活可用性")));
});

test("template list stays a compact static card while detail owns interaction", () => {
  const list = read("core/app/src/components/page-templates/page-templates-page.tsx");
  const artwork = read("core/app/src/components/page-templates/template-card-artwork.tsx");
  const detail = read("core/app/src/components/page-templates/page-template-detail-page.tsx");
  const devicePreview = read("core/app/src/components/page-templates/template-device-preview.tsx");
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const parityStyles = read("core/app/src/app/page-template-parity.css");
  assert.match(list, /TemplateCardArtwork/);
  assert.doesNotMatch(list, /PAGES · TEMPLATE/);
  assert.doesNotMatch(`${list}\n${detail}`, /<Breadcrumb/);
  assert.doesNotMatch(`${list}\n${artwork}`, /iframe|WebGLRenderer|InteriorTemplateCanvas/);
  assert.match(devicePreview, /Web/);
  assert.match(devicePreview, /移动端/);
  assert.match(detail, /生活可用性/);
  assert.match(detail, /PageHeader/);
  assert.match(detail, /template-detail-overview/);
  assert.match(devicePreview, /template-device-preview/);
  assert.match(parityStyles, /template-device-preview\.is-web \.template-device-frame/);
  assert.doesNotMatch(detail, /template-detail-heading|template-detail-facts|template-live-preview|template-detail-information/);
  assert.match(preview, /SU 设计稿/);
  assert.match(preview, /户型图/);
  assert.match(preview, /用户需求/);
  assert.match(preview, /interior-requirement-groups/);
  assert.match(preview, /interior-requirement-history/);
  assert.doesNotMatch(`${detail}\n${preview}`, /滚轮或双指|全屏查看|浏览空间/);
});

test("requirement digest is a single continuous vertical reader", () => {
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
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
  const canvas = read("core/app/src/components/page-templates/interior-template-canvas.tsx");
  assert.match(preview, /interior-design-source-plan-redacted-v2\.png/);
  assert.match(preview, /原始图/);
  assert.match(preview, /调整标注/);
  assert.match(preview, /拆除餐厅右侧卧室/);
  assert.match(preview, /墙厚约 220mm/);
  assert.match(preview, /revision-wall-dimension/);
  assert.doesNotMatch(preview, /六人餐桌 2200|通道净宽约 1100|主卧大床 2200/);
  assert.match(preview, /revision-wall-left/);
  assert.match(preview, /revision-wall-bottom/);
  assert.match(preview, /onPointerDown/);
  assert.match(preview, /pointers\.current/);
  assert.match(preview, /1 层/);
  assert.match(preview, /2 层/);
  assert.match(preview, /DropdownMenuTrigger/);
  assert.match(preview, /2 层 · 局部书房/);
  assert.doesNotMatch(preview, /<select|<option/);
  assert.match(preview, /6 米挑高/);
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
