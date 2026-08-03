import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Online Pages CLI, Skill, server, clients, and Activity share one dual-device contract", () => {
  const cli = read("core/agent/bin/pa-cli.mjs");
  const runtimeCli = read("core/runtime/bin/personal-agent.mjs");
  const publishing = read("skills/personal-runtime/references/page-publishing.md");
  const server = read("core/agent/src/server/server.ts");
  const activity = read("core/agent/src/activity/store.js");
  const desktop = read("core/app/src/components/desktop-v627/shared.tsx");
  const mobile = read("core/app/src/components/mobile-current/pages.tsx");

  assert.match(cli, /createGeneratedPageThumbnails/);
  assert.match(cli, /omit both/);
  assert.match(cli, /desktopThumbnail:/);
  assert.match(cli, /mobileThumbnail:/);
  assert.match(publishing, /without opening a browser/);
  assert.match(publishing, /pending user acceptance/);
  assert.match(publishing, /page\.thumbnails\.desktop/);
  assert.match(publishing, /page\.thumbnails\.mobile/);
  assert.match(publishing, /--target-type page/);
  assert.match(publishing, /without `--template`/);
  assert.match(publishing, /new publications do not write template provenance/);
  assert.match(publishing, /360-430 CSS px/);
  assert.match(publishing, /not the desktop composition merely scaled/);
  assert.match(publishing, /essential diagram or annotation labels at least 12 CSS px/);
  assert.match(publishing, /Do not use `user-scalable=no` or a restrictive `maximum-scale`/);
  assert.match(publishing, /intrinsic width must be at least twice/);
  assert.match(publishing, /bounded pan\/zoom or horizontal-scroll surface/);
  assert.match(publishing, /mobile gallery preview is not visual or interaction acceptance/);
  const interiorSkill = read("skills/interior-design/SKILL.md");
  const interiorDelivery = read("skills/interior-design/references/delivery-v5.md");
  assert.match(interiorSkill, /最终用户收到持续更新的设计工作区/);
  assert.match(interiorDelivery, /`pages\/index\.html` 是默认入口/);
  assert.match(interiorDelivery, /`pages\/3d\/index\.html`/);
  assert.match(interiorDelivery, /`pages\/panorama-review\/index\.html`/);
  assert.match(interiorDelivery, /合法授权的 `krpano\.js`/);
  assert.match(interiorDelivery, /按依赖关系只使受影响的下游失效/);
  assert.match(runtimeCli, /Page Activity requires --target-type page and --target-id <page-id>/);
  assert.match(activity, /PAGE_TARGET_REQUIRED/);
  assert.match(server, /desktopThumbnailUrl:/);
  assert.match(server, /mobileThumbnailUrl:/);
  assert.match(desktop, /page\.desktopThumbnailUrl \|\| page\.thumbnailUrl/);
  assert.match(mobile, /page\.mobileThumbnailUrl \|\| page\.thumbnailUrl/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
