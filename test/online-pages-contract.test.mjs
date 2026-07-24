import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Online Pages CLI, Skill, server, clients, and Activity share one dual-device contract", () => {
  const cli = read("core/agent/bin/pa-cli.mjs");
  const runtimeCli = read("core/runtime/bin/personal-agent.mjs");
  const skill = read("skills/personal-pages/references/publishing.md");
  const server = read("core/agent/src/server/server.ts");
  const activity = read("core/agent/src/activity/store.js");
  const desktop = read("core/app/src/components/desktop-v627/shared.tsx");
  const mobile = read("core/app/src/components/mobile-current/pages.tsx");

  assert.match(cli, /createGeneratedPageThumbnails/);
  assert.match(cli, /omit both/);
  assert.match(cli, /desktopThumbnail:/);
  assert.match(cli, /mobileThumbnail:/);
  assert.match(skill, /without opening a browser/);
  assert.match(skill, /pending user acceptance/);
  assert.match(skill, /page\.thumbnails\.desktop/);
  assert.match(skill, /page\.thumbnails\.mobile/);
  assert.match(skill, /--target-type page/);
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
