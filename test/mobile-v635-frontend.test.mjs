import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Mobile V6.35 keeps every destination in a focused component", () => {
  const components = ["activity", "pages", "workers", "apps", "personal-app", "about", "mail", "shell", "wechat-status"];
  for (const component of components) {
    const source = read(`core/app/src/components/mobile-current/${component}.tsx`);
    assert.ok(source.split(/\r?\n/).length <= 300, `${component} exceeds 300 lines`);
  }
  for (const route of [
    "app/mobile/page.tsx",
    "app/mobile/workers/page.tsx",
    "app/mobile/workers/[sessionId]/page.tsx",
    "app/mobile/pages/page.tsx",
    "app/mobile/pages/[pageId]/page.tsx",
    "app/mobile/apps/page.tsx",
    "app/mobile/apps/[appId]/page.tsx",
    "app/mobile/about/page.tsx",
    "app/mobile/mail/[messageId]/page.tsx",
  ]) assert.equal(fs.existsSync(path.join(root, "core/app/src/app", route)), true, route);
});

test("Mobile V6.35 implements the approved task and navigation interactions", () => {
  const shell = read("core/app/src/components/mobile-current/shell.tsx");
  const workers = read("core/app/src/components/mobile-current/workers.tsx");
  const activity = read("core/app/src/components/mobile-current/activity.tsx");
  const apps = read("core/app/src/components/mobile-current/apps.tsx");
  assert.match(shell, /打开侧边菜单/);
  assert.match(shell, /工作区/);
  assert.match(shell, /我的应用/);
  assert.match(shell, /function FilterSheet/);
  assert.match(shell, /onCompositionStart/);
  assert.match(workers, /\/api\/mobile\/tasks/);
  assert.match(workers, /\/api\/chat\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(workers, /TaskLoading/);
  assert.match(workers, /TaskUnavailable/);
  assert.match(workers, /messages\.length \|\| plan\.length/);
  assert.match(activity, /mobile-story-icon/);
  assert.match(activity, /ListTodo/);
  assert.match(apps, /你的常用工具/);
  assert.match(apps, /在手机上打开 PA 为你准备的应用/);
});

test("local Next preview mirrors the registered API upstream mappings", () => {
  const bff = read("core/app/src/app/api/[...path]/route.ts");
  assert.match(bff, /PERSONAL_AGENT_CONTROL_URL/);
  assert.match(bff, /OPEN_AGENT_BRIDGE_INTERNAL_URL/);
  assert.match(bff, /data: "agent-data"/);
  assert.match(bff, /automations: "agent-automations"/);
  assert.match(bff, /schedules: "agent-corn"/);
  assert.match(bff, /mail: "mail"/);
  assert.match(bff, /controlRoots/);
  assert.match(bff, /"apps"/);
  assert.match(bff, /path\[0\] === "chat"/);
  assert.match(bff, /path\[0\] === "publications"/);
});
