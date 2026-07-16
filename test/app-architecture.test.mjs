import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Next.js owns the approved V6.32 client and V6.33 desktop conversation", () => {
  const shell = read("core/app/src/components/app-shell.tsx");
  const navigation = read("core/app/src/components/navigation.ts");
  const desktopNavigationSource = `${navigation}\n${shell}`;
  const desktopComponents = fs.readdirSync(path.join(root, "core/app/src/components/desktop-v627"))
    .filter((file) => /\.(?:ts|tsx)$/.test(file))
    .map((file) => read(`core/app/src/components/desktop-v627/${file}`))
    .join("\n");
  const mobileClient = [
    "mobile-current.tsx",
    "mobile-current/activity.tsx",
    "mobile-current/pages.tsx",
    "mobile-current/workers.tsx",
    "mobile-current/apps.tsx",
    "mobile-current/personal-app.tsx",
    "mobile-current/about.tsx",
    "mobile-current/wechat-status.tsx",
    "mobile-current/mail.tsx",
    "mobile-current/shell.tsx",
    "mobile-current/data.tsx",
  ].map((relative) => read(`core/app/src/components/${relative}`)).join("\n");
  const mailClient = read("core/app/src/components/mail-dashboard.tsx");
  const setupDashboard = read("core/app/src/components/setup-dashboard.tsx");
  const conversationClient = [
    "conversation-page.tsx",
    "conversation-message-list.tsx",
    "conversation-plan.tsx",
    "conversation-composer.tsx",
  ].map((file) => read(`core/app/src/components/desktop-v627/${file}`)).join("\n");
  const overview = read("core/app/src/app/app/page.tsx");
  const mobile = read("core/app/src/app/app/mobile/page.tsx");
  const css = read("core/app/src/app/desktop-v627-v4.css");
  const conversationCss = read("core/app/src/app/desktop-v633-conversation.css");
  const mobileCss = read("core/app/src/app/mobile-current.css");

  for (const route of ["/app/conversations", "/app/workers", "/app/mail", "/app/pages", "/app/data", "/app/automations", "/app/channels", "/app/skills", "/app/setup", "/app/runtime", "/app/apps", "/app/settings"]) {
    assert.match(desktopNavigationSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const route of ["/app/mobile", "/app/mobile/pages", "/app/mobile/workers", "/app/mobile/apps", "/app/mobile/about"]) {
    assert.match(navigation, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(shell, /关闭客户端将停止本机服务与手机入口/);
  assert.match(shell, /personal-agent-close-requested/);
  assert.match(shell, /__personal-agent\/close/);
  assert.match(shell, /仍有工作正在进行/);
  assert.match(shell, /\["start", "running"\]/);
  assert.match(shell, /移动端仅提供安全的只读访问/);
  assert.match(shell, /系统设置/);
  assert.match(shell, /无需登录/);
  assert.match(shell, /\/api\/system\/apps/);
  assert.match(overview, /sec-ch-ua-mobile/);
  assert.match(overview, /redirect\("\/app\/mobile"\)/);
  assert.match(mobile, /MobileActivity/);
  assert.match(shell, /pa-app desktop-shell/);
  assert.match(shell, /pa-sidebar/);
  assert.match(css, /\.desktop-shell \.pa-sidebar/);
  assert.match(css, /\.desktop-shell :is\(\.pa-callout, \.setup-option\.dark, \.desktop-app-card\.dark\)\s*\{[\s\S]*color:\s*var\(--pa-canvas\)/);
  assert.match(css, /:is\(h1, h2, h3, strong, b\)\s*\{[\s\S]*color:\s*inherit/);
  assert.match(mobileCss, /\.mobile-current/);
  assert.match(mobileCss, /@media \(max-width: 460px\)/);
  assert.match(mobileCss, /\.filter-sheet/);
  assert.match(mobileCss, /\.mobile-current :where\(button, input, select\) \{ font: inherit; \}/);
  assert.doesNotMatch(mobileCss, /\.mobile-current button, \.mobile-current input, \.mobile-current select \{ font: inherit; \}/);
  assert.match(mobileCss, /\.task-plan/);

  for (const endpoint of ["overview", "pages", "automations", "runtime"]) {
    assert.match(desktopComponents, new RegExp(`/api/node/v1/client/${endpoint}`));
  }
  assert.match(desktopComponents, /\/api\/chat\/sessions\?limit=50/);
  assert.match(mailClient, /\/api\/app\/mail\/messages/);
  assert.match(desktopComponents, /\/api\/app\/data\/query/);
  assert.match(desktopComponents, /operator:\s*"contains"/);
  assert.match(desktopComponents, /direction:\s*"asc"/);
  assert.match(desktopComponents, /sheet-column-menu/);
  assert.match(desktopComponents, /sheet-formula/);
  assert.match(desktopComponents, /function Pager/);
  assert.match(desktopComponents, /selected=\{status\}/);
  assert.match(desktopComponents, /selected=\{filter\}/);
  assert.match(desktopComponents, /PageDetail/);
  assert.match(desktopComponents, /runtime-page-full/);
  assert.match(desktopComponents, /ConversationPage/);
  assert.match(desktopComponents, /desktop-chat-composer/);
  assert.match(conversationClient, /\/api\/chat\/desktop\/conversation/);
  assert.match(conversationClient, /\/api\/chat\/desktop\/conversation\/messages/);
  assert.match(conversationClient, /clientMessageId/);
  assert.match(conversationClient, /optimistic-/);
  assert.match(conversationClient, /setWaiting\(true\)/);
  assert.match(conversationClient, /window\.setInterval\([\s\S]*1200\)/);
  assert.match(conversationClient, /正在处理，回复会自动显示/);
  assert.match(conversationClient, /before=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(conversationClient, /desktop-chat-checkpoint/);
  assert.match(conversationClient, /desktop-chat-dock/);
  assert.match(conversationClient, /添加附件/);
  assert.match(conversationCss, /max-width:\s*760px/);
  assert.match(conversationCss, /\.desktop-chat-composer/);
  assert.match(conversationCss, /\.desktop-chat-processing/);
  assert.doesNotMatch(conversationClient, /model|reasoning|sandbox|approval/i);
  assert.doesNotMatch(conversationClient, /\/api\/chat\/sessions/);
  assert.doesNotMatch(conversationClient, /createdBy|task:\s*content/);
  assert.match(desktopComponents, /无需输入旧密码/);
  assert.match(desktopComponents, /其他设备需要重新登录/);
  assert.match(desktopComponents, /installation\.local-auth/);
  assert.match(setupDashboard, /可选 · 公网域名/);
  assert.match(setupDashboard, /验证后分配 PA 邮箱/);
  assert.match(setupDashboard, /无需单独接入/);
  assert.doesNotMatch(setupDashboard, /启用邮件检测|了解接入|可选 · 手机/);
  assert.doesNotMatch(desktopComponents, /createdBy:\s*["']web["']/);
  assert.match(css, /\.pa-app\.desktop-shell\s*\{[\s\S]*height:\s*100vh/);
  assert.match(css, /\.desktop-shell \.pa-sidebar\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.desktop-shell \.pa-page\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(shell, /from "@\/components\/navigation"/);
  assert.match(shell, /appActive\(app\)/);
  const appHost = read("core/app/src/components/personal-app-host.tsx");
  const wechatLogin = read("core/app/src/components/wechat-login.ts");
  const wechatPanel = read("core/app/src/components/wechat-connect-panel.tsx");
  const appCatalog = read("core/runtime/src/apps.ts");
  const appGuide = read("docs/personal-app-development.md");
  const referenceApp = read("workspace/apps/personal-agent.daily-brief/dist/index.html");
  const referenceController = read("workspace/apps/personal-agent.daily-brief/dist/app.js");
  assert.match(appHost, /embedded=1&surface=desktop/);
  assert.match(appHost, /assetRoute/);
  assert.match(appCatalog, /desktopRoute/);
  assert.match(appCatalog, /mobileRoute/);
  assert.match(appGuide, /Mobile is the primary Personal App entry/);
  assert.match(appGuide, /A mobile surface is not a narrow desktop page/);
  assert.match(referenceApp, /data-surface-view="desktop"/);
  assert.match(referenceApp, /data-surface-view="mobile"/);
  assert.match(referenceController, /requestedSurface === "mobile"/);
  assert.match(mobileClient, /\/api\/mobile\/activity/);
  assert.match(mobileClient, /\/api\/mobile\/tasks/);
  assert.match(mobileClient, /\/api\/mobile\/pages/);
  assert.match(mobileClient, /app\.mobileRoute \|\| app\.route/);
  assert.match(mobileClient, /embedded=1&surface=mobile/);
  assert.match(mobileClient, /MobileWechatStatus/);
  assert.match(mobileClient, /\/api\/channels/);
  assert.match(mobileClient, /downloadWechatQrPng/);
  assert.match(mobileClient, /weixin:\/\/scanqrcode/);
  assert.match(wechatLogin, /\/api\/channels\/wechat\/login\/start/);
  assert.match(wechatLogin, /\/api\/channels\/wechat\/login\/status/);
  assert.match(wechatPanel, /useWechatLogin/);
  assert.match(mobileCss, /\.about-wechat-actions/);
  assert.match(mobileCss, /min-height:\s*44px/);
  assert.match(mobileClient, /visibility=\$\{encodeURIComponent\(filter\)\}/);
  assert.match(mobileClient, /onCompositionStart/);
  assert.match(mobileClient, /event\.key === "Escape"/);
  assert.match(mobileClient, /sessionStorage/);
  assert.match(mobileClient, /有新进展/);
  assert.doesNotMatch(mobileClient.match(/const navItems:[\s\S]*?\];/)?.[0] || "", /conversations/);
  for (const responsibility of ["activity", "pages", "workers", "apps", "personal-app", "about", "wechat-status", "mail", "shell", "data", "types"]) {
    const file = path.join(root, "core/app/src/components/mobile-current", `${responsibility}.${responsibility === "types" ? "ts" : "tsx"}`);
    assert.equal(fs.existsSync(file), true, responsibility);
    assert.ok(fs.readFileSync(file, "utf8").split(/\r?\n/).length <= 300, `${responsibility} exceeds 300 lines`);
  }
  for (const file of fs.readdirSync(path.join(root, "core/app/src/components/desktop-v627")).filter((name) => name.endsWith(".tsx"))) {
    assert.ok(read(`core/app/src/components/desktop-v627/${file}`).split(/\r?\n/).length <= 300, `${file} exceeds 300 lines`);
  }
});

test("all finalized client routes have independently buildable Next pages", () => {
  const pages = [
    "app/page.tsx", "app/conversations/page.tsx", "app/workers/page.tsx", "app/mail/page.tsx",
    "app/pages/page.tsx", "app/pages/[pageId]/page.tsx", "app/data/page.tsx", "app/automations/page.tsx", "app/apps/page.tsx", "app/apps/[appId]/page.tsx",
    "app/channels/page.tsx", "app/skills/page.tsx", "app/setup/page.tsx", "app/runtime/page.tsx", "app/settings/page.tsx",
    "app/mobile/page.tsx", "app/mobile/pages/page.tsx", "app/mobile/pages/[pageId]/page.tsx",
    "app/mobile/workers/page.tsx", "app/mobile/workers/[sessionId]/page.tsx",
    "app/mobile/conversations/page.tsx", "app/mobile/conversations/[sessionId]/page.tsx",
    "app/mobile/apps/page.tsx", "app/mobile/about/page.tsx", "app/mobile/mail/[messageId]/page.tsx",
    "app/mobile/apps/[appId]/page.tsx",
  ];
  for (const page of pages) assert.equal(fs.existsSync(path.join(root, "core/app/src/app", page)), true, page);
});

test("gateway routes the approved client to Next and its read-only data to the local Agent", () => {
  const distribution = JSON.parse(read("registry/site-distribution.json"));
  const routes = distribution.routing.paths;
  assert.equal(routes.find((route) => route.key === "app").targetKey, "console");
  assert.equal(routes.find((route) => route.key === "app-pages").targetKey, "console");
  assert.equal(routes.find((route) => route.key === "app-automations").targetKey, "console");
  assert.equal(routes.find((route) => route.key === "api-node-v1").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-mobile").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-app-mail").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-app-data").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-chat").targetKey, "agent");
  assert.deepEqual(routes.find((route) => route.key === "api-channels"), { key: "api-channels", prefix: "/api/channels", access: "authenticated", kind: "proxy", targetKey: "agent", upstreamPath: "/api/channels" });
  assert.equal(routes.find((route) => route.key === "home").access, "authenticated");
  assert.equal(routes.find((route) => route.key === "app-settings").access, "local-admin");
  assert.equal(routes.find((route) => route.key === "api-system-setup-actions").access, "local-admin");
  assert.deepEqual(routes.find((route) => route.key === "public-pages"), { key: "public-pages", prefix: "/public", access: "public", kind: "proxy", targetKey: "agent", upstreamPath: "/pages" });
});

test("existing writable desktop workflows and Personal Apps remain available", () => {
  const chat = read("core/app/src/components/chat-dashboard.tsx");
  const mail = read("core/app/src/components/mail-dashboard.tsx");
  const channels = read("core/app/src/components/channels-dashboard.tsx");
  const setup = read("core/app/src/components/setup-dashboard.tsx");
  const appCatalog = read("core/app/src/components/apps-dashboard.tsx");
  const appShell = read("core/app/src/components/app-shell.tsx");
  const mobileShell = read("core/app/src/components/mobile-current/shell.tsx");
  const mobilePersonalApp = read("core/app/src/components/mobile-current/personal-app.tsx");
  const pluginStore = read("core/plugins/runtime/store.ts");
  assert.match(chat, /createdBy:\s*["']web["']/);
  assert.match(chat, /\/api\/chat\/sessions/);
  assert.match(mail, /\/api\/app\/mail\/import/);
  assert.match(channels, /WechatConnectPanel/);
  assert.match(setup, /buildSetupTaskModel/);
  assert.match(setup, /setup-layout/);
  assert.match(setup, /三个核心步骤|核心初始化步骤/);
  assert.match(setup, /WechatConnectPanel[\s\S]*compact/);
  assert.match(appCatalog, /\/api\/system\/apps/);
  assert.match(appShell, /pathname === "\/app\/apps" \? "page" : undefined/);
  assert.match(mobilePersonalApp, /activeAppId=\{appId\}/);
  assert.match(mobileShell, /section === "apps" && !activeAppId/);
  assert.match(mobileShell, /aria-current=\{activeAppId === app\.id \? "page" : undefined\}/);
  assert.match(pluginStore, /personal-agent\.plugin\.json/);
});

test("V6.27 setup keeps desktop direct access independent from the remote access password", () => {
  const registry = JSON.parse(read("registry/setup-checks.json"));
  const accessPassword = registry.checks.find((check) => check.id === "installation.console-auth");
  const runtimeSetup = read("core/runtime/src/setup.ts");
  assert.equal(accessPassword.requirement, "conditional");
  assert.equal(accessPassword.dimension, "remote");
  assert.match(accessPassword.why, /桌面客户端.*无需登录/);
  assert.match(runtimeSetup, /protectsLocalDesktop:\s*false/);
  assert.match(runtimeSetup, /protectsRemoteAccess:\s*true/);
  assert.match(runtimeSetup, /手机访问密码尚未设置/);
});

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
