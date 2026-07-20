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
});

test("template list stays lightweight while detail owns the interactive preview", () => {
  const list = read("core/app/src/components/page-templates/page-templates-page.tsx");
  const artwork = read("core/app/src/components/page-templates/template-card-artwork.tsx");
  const detail = read("core/app/src/components/page-templates/page-template-detail-page.tsx");
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const canvas = read("core/app/src/components/page-templates/interior-template-canvas.tsx");
  assert.match(list, /TemplateCardArtwork/);
  assert.doesNotMatch(`${list}\n${artwork}`, /iframe|WebGLRenderer|InteriorTemplateCanvas/);
  assert.match(detail, /Web/);
  assert.match(detail, /移动端/);
  assert.match(preview, /整体方案 · 完整户型/);
  assert.match(preview, /SelectTrigger/);
  assert.match(preview, /SelectItem value="all"/);
  assert.match(preview, /setRoomId\(room\.id\)/);
  assert.match(canvas, /OrbitControls/);
  assert.doesNotMatch(`${detail}\n${preview}\n${canvas}`, /setInterval|requestAnimationFrame|autoRotate/);
});

test("space browsing defaults to the whole home and enters a room by moving the camera", () => {
  const preview = read("core/app/src/components/page-templates/interior-template-preview.tsx");
  const canvas = read("core/app/src/components/page-templates/interior-template-canvas.tsx");
  const scene = read("core/app/src/components/page-templates/interior-template-scene.ts");
  const skillClient = read("skills/interior-design/scripts/page-client.mjs");
  assert.match(preview, /const \[roomId, setRoomId\] = useState\(""\)/);
  assert.match(preview, /<SelectItem value="all">整体方案 · 完整户型<\/SelectItem>/);
  assert.match(preview, /onClick=\{\(\) => setRoomId\(room\.id\)\}/);
  assert.match(canvas, /const pose = cameraPose\(view, roomId\)/);
  assert.match(canvas, /controls\.target\.copy\(pose\.target\)/);
  assert.match(canvas, /\[roomId, view\]/);
  assert.match(scene, /interiorRooms\.find\(\(entry\) => entry\.id === roomId\)/);
  assert.match(scene, /room \? Math\.max\(room\.width, room\.depth\) : interiorBounds\.span/);
  assert.match(skillClient, /runtime\.update\(view, roomId\)/);
  assert.match(skillClient, /const room = model\.rooms\.find\(\(entry\) => entry\.id === roomId\)/);
});

test("authenticated route registry covers template list and details", () => {
  const routes = JSON.parse(read("registry/routes.json")).routes;
  const exact = routes.find((route) => route.pattern === "/app/pages/templates");
  const detail = routes.find((route) => route.pattern === "/app/pages/templates/*");
  assert.deepEqual(exact, { pattern: "/app/pages/templates", access: "authenticated", capability: "publications" });
  assert.deepEqual(detail, { pattern: "/app/pages/templates/*", access: "authenticated", capability: "publications" });
});
