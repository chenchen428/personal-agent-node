import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Next.js owns the application shell, Setup Center, BFF and Plugin Studio", () => {
  const shell = read("core/app/src/components/app-shell.tsx");
  const setup = read("core/app/src/components/setup-dashboard.tsx");
  const setupPage = read("core/app/src/app/app/setup/page.tsx");
  const proxy = read("core/app/src/app/api/[...path]/route.ts");
  const plugins = read("core/plugins/runtime/store.ts");
  const distribution = JSON.parse(read("registry/site-distribution.json"));
  assert.match(shell, /\/app\/chat/);
  assert.match(shell, /\/app\/plugins/);
  assert.match(shell, /\/app\/pages/);
  assert.match(shell, /\/app\/channels/);
  assert.doesNotMatch(shell, /\/app\/files/);
  assert.match(setup, /buildSetupTaskModel/);
  assert.match(setup, /现在处理/);
  assert.match(setup, /以后配置/);
  assert.match(setup, /检测详情/);
  assert.match(setup, /Agent 邮箱/);
  assert.match(setupPage, /把这台电脑准备好/);
  assert.match(proxy, /PERSONAL_AGENT_CONTROL_URL/);
  assert.match(proxy, /x-personal-agent-authenticated/);
  assert.match(plugins, /personal-agent\.plugin\.json/);
  assert.deepEqual(
    distribution.routing.paths.find((route) => route.key === "next-static"),
    { key: "next-static", prefix: "/_next/static", access: "public", kind: "proxy", targetKey: "console", upstreamPath: "/_next/static" },
  );
  assert.equal(distribution.routing.paths.find((route) => route.key === "app-pages").targetKey, "console");
  assert.equal(distribution.routing.paths.find((route) => route.key === "app-channels").targetKey, "console");
});

test("the application reuses shadcn primitives for setup, channels, and responsive page previews", () => {
  const config = JSON.parse(read("core/app/components.json"));
  const setup = read("core/app/src/components/setup-dashboard.tsx");
  const setupPage = read("core/app/src/app/app/setup/page.tsx");
  const channels = read("core/app/src/components/channels-dashboard.tsx");
  const pages = read("core/app/src/components/pages-dashboard.tsx");
  const button = read("core/app/src/components/ui/button.tsx");
  const css = read("core/app/src/app/globals.css");
  assert.equal(config.rsc, true);
  assert.match(setup, /components\/ui\/button/);
  assert.match(setup, /components\/ui\/card/);
  assert.match(setup, /components\/ui\/progress/);
  assert.match(setup, /components\/ui\/separator/);
  assert.match(setup, /components\/ui\/tabs/);
  assert.match(setup, /installation\.local-auth/);
  assert.match(setup, /mail-identity/);
  assert.match(setup, /local-mail/);
  assert.match(setup, /agent\.open-chat/);
  assert.match(setup, /post\("plan"/);
  assert.match(setup, /post\("approve"/);
  assert.match(setup, /post\("execute"/);
  assert.match(setup, /check\.guidance/);
  assert.match(setup, /check\.why/);
  assert.match(setup, /developers\.openai\.com\/codex\/cli/);
  assert.match(setup, /打开安装包/);
  assert.match(setup, /打开邮件页/);
  assert.match(setup, /chenjianhui\.site/);
  assert.match(setup, /managedCloud/);
  assert.match(setup, /window\.setTimeout/);
  assert.match(setup, /01 · NOW/);
  assert.match(setup, /Cloud 授权接口暂时未完成请求/);
  assert.match(setup, /noValidate/);
  assert.match(setup, /两次输入一致，可以确认设置/);
  assert.match(setup, /text-\[#faf9f5\]/);
  assert.doesNotMatch(setup, /text-\[var\(--on-dark\)\]/);
  assert.doesNotMatch(setup, /text-\[clamp/);
  assert.doesNotMatch(setupPage, /text-\[clamp/);
  assert.match(channels, /components\/ui\/(?:badge|card)/);
  assert.match(pages, /components\/ui\/tabs/);
  assert.match(pages, /value="mobile"/);
  assert.doesNotMatch(setup, /setup-todo-list|setup-summary-band|setup-secondary-grid/);
  assert.match(read("core/app/src/components/ui/progress.tsx"), /data-slot="progress"/);
  assert.match(button, /bg-\[var\(--coral\)\][^\n]*text-white/);
  assert.match(css, /@layer base \{[\s\S]*a \{ color: inherit;[\s\S]*h1, h2, h3 \{/);
  assert.match(setup, /lg:grid-cols-\[minmax\(0,1\.45fr\)_minmax\(320px,\.75fr\)\]/);
  assert.match(setup, /sm:grid-cols-2/);
  assert.match(css, /preview-mobile/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test("the internal control service exposes APIs but no handwritten HTML renderer", () => {
  const server = read("core/control/server.ts");
  assert.match(server, /\/api\/setup/);
  assert.match(server, /\/api\/wechat\/status/);
  assert.match(server, /\/api\/plugins/);
  assert.doesNotMatch(server, /renderNavigationPage|renderSetupPage|text\/html/);
  for (const file of ["page.ts", "setup-page.ts", "status.ts", "status-logic.ts"]) assert.equal(fs.existsSync(path.join(root, "core", "control", file)), false);
});

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
