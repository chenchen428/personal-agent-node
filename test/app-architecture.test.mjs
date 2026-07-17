import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Next.js owns the approved V6.35 mobile client and V7.3 desktop workspace", () => {
  const shell = read("core/app/src/components/app-shell.tsx");
  const navigation = read("core/app/src/components/navigation.ts");
  const desktopNavigationSource = `${navigation}\n${shell}`;
  const desktopComponents = fs.readdirSync(path.join(root, "core/app/src/components/desktop-v627"))
    .filter((file) => /\.(?:ts|tsx)$/.test(file))
    .map((file) => read(`core/app/src/components/desktop-v627/${file}`))
    .join("\n");
  const workersClient = read("core/app/src/components/desktop-v627/workers-page.tsx");
  const overviewClient = read("core/app/src/components/desktop-v627/overview-page.tsx");
  const channelsClient = read("core/app/src/components/desktop-v627/channels-page.tsx");
  const automationsClient = read("core/app/src/components/desktop-v627/automations-page.tsx");
  const skillsClient = read("core/app/src/components/desktop-v627/skills-page.tsx");
  const updateClient = read("core/app/src/components/desktop-v627/update-page.tsx");
  const dataClient = read("core/app/src/components/desktop-v627/data-page.tsx");
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
  const legacyCss = read("core/app/src/app/desktop-v627-v4.css");
  const css = read("core/app/src/app/desktop-v72.css");
  const conversationCss = read("core/app/src/app/desktop-v633-conversation.css");
  const mobileCss = read("core/app/src/app/mobile-current.css");

  for (const route of ["/app/conversations", "/app/workers", "/app/mail", "/app/pages", "/app/data", "/app/automations", "/app/channels", "/app/runtime", "/app/apps", "/app/settings", "/app/update"]) {
    assert.match(desktopNavigationSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const route of ["/app/mobile", "/app/mobile/pages", "/app/mobile/workers", "/app/mobile/apps", "/app/mobile/about"]) {
    assert.match(navigation, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(shell, /关闭客户端会停止当前工作、邮件接收和手机入口/);
  assert.match(shell, /personal-agent-close-requested/);
  assert.match(shell, /__personal-agent\/close/);
  assert.match(shell, /仍有工作正在进行/);
  assert.match(shell, /\["start", "running"\]/);
  assert.match(shell, /系统设置/);
  assert.match(shell, /本机工作区/);
  assert.match(shell, /\/api\/system\/apps/);
  assert.match(dataClient, /\/api\/app\/data\/schema\?counts=0&preview=1/);
  assert.match(dataClient, /visibleRows/);
  assert.doesNotMatch(dataClient, /search:\s*query/);
  assert.match(read("core/app/src/components/desktop-v72/loading-state.tsx"), /role="status"/);
  assert.match(overview, /sec-ch-ua-mobile/);
  assert.match(overview, /redirect\("\/app\/mobile"\)/);
  assert.match(mobile, /MobileActivity/);
  assert.match(shell, /desktop-v72/);
  assert.match(shell, /v72-sidebar/);
  assert.match(shell, /desktopNavigationGroups/);
  assert.ok(navigation.indexOf('label: "Agent 组件"') < navigation.indexOf('href: "\/app\/workers"'));
  assert.match(navigation, /label: "核心功能"/);
  assert.doesNotMatch(navigation, /用户参与|Agent 工作/);
  assert.match(shell, /PanelLeftClose/);
  assert.doesNotMatch(shell, /window-dots|phone-status|9:41/);
  assert.match(css, /\.v72-sidebar\s*\{[\s\S]*width:\s*236px/);
  assert.match(css, /\.v72-page-scroll\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(legacyCss, /\.desktop-shell :is\(\.pa-callout, \.setup-option\.dark, \.desktop-app-card\.dark\)\s*\{[\s\S]*color:\s*var\(--pa-canvas\)/);
  assert.match(mobileCss, /\.mobile-current/);
  assert.match(mobileCss, /@media \(max-width: 460px\)/);
  assert.match(mobileCss, /\.filter-sheet/);
  assert.match(mobileCss, /\.mobile-current :where\(button, input, select\) \{ font: inherit; \}/);
  assert.doesNotMatch(mobileCss, /\.mobile-current button, \.mobile-current input, \.mobile-current select \{ font: inherit; \}/);
  assert.doesNotMatch(mobileClient, /PhoneStatus|phone-status|9:41/);
  assert.doesNotMatch(mobileCss, /\.phone-status/);
  assert.match(mobileCss, /\.task-plan/);
  assert.match(mobileClient, /工作区/);
  assert.match(mobileClient, /我的应用/);
  assert.match(mobileClient, /系统/);
  assert.match(mobileClient, /mobile-task-list/);
  assert.match(mobileClient, /mobile-task-conversation/);
  assert.match(mobileClient, /mobile-about-machine/);
  assert.match(mobileCss, /\.mobile-drawer \{[^}]*top: 0;/);
  assert.match(mobileCss, /\.mobile-about-machine h1 \{[^}]*overflow-wrap: anywhere;/);

  for (const endpoint of ["overview", "pages", "automations", "runtime"]) {
    assert.match(desktopComponents, new RegExp(`/api/node/v1/client/${endpoint}`));
  }
  assert.match(desktopComponents, /\/api\/chat\/sessions\?limit=50/);
  assert.match(mailClient, /\/api\/app\/mail\/messages/);
  assert.match(desktopComponents, /\/api\/app\/data\/query/);
  assert.match(desktopComponents, /operator:\s*"contains"/);
  assert.match(desktopComponents, /direction:\s*"asc"/);
  assert.match(desktopComponents, /data-control-panel/);
  assert.match(desktopComponents, /DataVisibilityPanel/);
  assert.match(desktopComponents, /data-pager/);
  assert.match(desktopComponents, /hasRunningWorker/);
  assert.match(desktopComponents, /window\.setInterval\([\s\S]*2500\)/);
  assert.match(desktopComponents, /status === "idle" \? "已完成"/);
  assert.match(desktopComponents, /v72-split-view/);
  assert.doesNotMatch(workersClient, /v72-task-composer|继续这个任务|\/input/);
  assert.match(overviewClient, /Personal Agent 已就绪/);
  assert.match(overviewClient, /Personal Agent 正在准备/);
  assert.match(overviewClient, /RequiredSetupGuide/);
  assert.match(desktopComponents, /开始使用前/);
  assert.match(overviewClient, /counts\.runningWork/);
  assert.match(overviewClient, /最近动态/);
  assert.match(overviewClient, /externalAddress/);
  assert.match(overviewClient, /target="_blank"/);
  assert.doesNotMatch(overviewClient, /下午好|最近工作/);
  assert.match(channelsClient, /channelTone/);
  assert.match(channelsClient, /tone: channelTone/);
  assert.match(channelsClient, /公网域名访问/);
  assert.match(channelsClient, /XiaohongshuConnectPanel/);
  assert.match(read("core/app/src/components/xiaohongshu-connect-panel.tsx"), /\/api\/channels\/xiaohongshu\/login\/start/);
  assert.doesNotMatch(channelsClient, /Web 控制台|手机访问/);
  assert.match(conversationClient, /MarkdownContent/);
  assert.match(workersClient, /MarkdownContent/);
  assert.match(css, /\.desktop-v72 \.v72-markdown/);
  assert.match(automationsClient, /CollectionDetail/);
  assert.match(automationsClient, /search=\{\{ value: query/);
  assert.match(skillsClient, /skill-filter-bar/);
  assert.match(skillsClient, /skill-library-layout/);
  assert.doesNotMatch(updateClient, /rollback-plan|RotateCcw|恢复 \{/);
  assert.match(desktopComponents, /PageDetail/);
  assert.match(desktopComponents, /runtime-page-full/);
  assert.match(desktopComponents, /ConversationPage/);
  assert.match(desktopComponents, /composer-wrap/);
  assert.match(conversationClient, /\/api\/chat\/desktop\/conversation/);
  assert.match(conversationClient, /\/api\/chat\/desktop\/conversation\/messages/);
  assert.match(conversationClient, /clientMessageId/);
  assert.match(conversationClient, /optimistic-/);
  assert.match(conversationClient, /setWaiting\(true\)/);
  assert.match(conversationClient, /window\.setInterval\([\s\S]*1200\)/);
  assert.match(conversationClient, /正在处理，回复会自动显示/);
  assert.match(conversationClient, /before=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(conversationClient, /plan-block/);
  assert.match(conversationClient, /composer-wrap/);
  assert.match(conversationClient, /添加附件/);
  assert.match(css, /\.desktop-v72 \.message-thread/);
  assert.match(css, /\.desktop-v72 \.composer/);
  assert.match(css, /\.desktop-v72 \.message-processing/);
  assert.doesNotMatch(conversationClient, /model|reasoning|sandbox|approval/i);
  assert.doesNotMatch(conversationClient, /\/api\/chat\/sessions/);
  assert.doesNotMatch(conversationClient, /createdBy|task:\s*content/);
  assert.match(desktopComponents, /本机可信/);
  assert.match(desktopComponents, /其他设备会话已失效/);
  assert.match(desktopComponents, /installation\.local-auth/);
  assert.match(desktopComponents, /\/api\/system\/update/);
  assert.match(desktopComponents, /安装后自动重启/);
  assert.match(desktopComponents, /Agent.*不能替你批准/);
  assert.match(setupDashboard, /可选 · 公网域名/);
  assert.match(setupDashboard, /验证后分配 PA 邮箱/);
  assert.match(setupDashboard, /无需单独接入/);
  assert.ok(setupDashboard.indexOf("可选 · 公网域名") < setupDashboard.indexOf("可选 · 邮件"));
  assert.match(setupDashboard, /重新验证公网域名/);
  assert.match(setupDashboard, /cloudPending/);
  assert.match(setupDashboard, /role="status"/);
  assert.doesNotMatch(setupDashboard, /启用邮件检测|了解接入|可选 · 手机/);
  assert.doesNotMatch(desktopComponents, /createdBy:\s*["']web["']/);
  assert.match(css, /\.desktop-v72\s*\{[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.v72-sidebar-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.v72-page-scroll\s*\{[\s\S]*min-height:\s*0;[\s\S]*flex:\s*1;[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.desktop-v72 \.data-shell\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0/);
  assert.match(css, /\.desktop-v72 \.table-scroll\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto/);
  assert.match(desktopComponents, /className="page flush data-shell"/);
  assert.match(desktopComponents, /可横向和纵向滚动的数据表/);
  assert.match(shell, /from "@\/components\/navigation"/);
  assert.match(shell, /appActive\(app\)/);
  const appHost = read("core/app/src/components/personal-app-host.tsx");
  const wechatLogin = read("core/app/src/components/wechat-login.ts");
  const wechatPanel = read("core/app/src/components/wechat-connect-panel.tsx");
  const appCatalog = read("core/runtime/src/apps.ts");
  const appGuide = read("docs/personal-app-development.md");
  const referenceApp = read("examples/personal-apps/personal-agent.daily-brief/dist/index.html");
  const referenceController = read("examples/personal-apps/personal-agent.daily-brief/dist/app.js");
  assert.match(appHost, /embedded=1&surface=desktop/);
  assert.match(appHost, /assetRoute/);
  assert.match(css, /v72-page-scroll:has\(> \.personal-app-host\)/);
  assert.match(css, /\.personal-app-host iframe \{ width: 100%; height: 100%/);
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
  assert.match(mobileClient, /hasRunningTask/);
  assert.match(mobileClient, /重启后已继续处理/);
  assert.match(mobileClient, /session && \(messages\.length \|\| plan\.length\)/);
  assert.match(mobileClient, /\/api\/chat\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
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
    "app/channels/page.tsx", "app/skills/page.tsx", "app/setup/page.tsx", "app/runtime/page.tsx", "app/settings/page.tsx", "app/update/page.tsx",
    "app/mobile/page.tsx", "app/mobile/pages/page.tsx", "app/mobile/pages/[pageId]/page.tsx",
    "app/mobile/workers/page.tsx", "app/mobile/workers/[sessionId]/page.tsx",
    "app/mobile/conversations/page.tsx", "app/mobile/conversations/[sessionId]/page.tsx",
    "app/mobile/apps/page.tsx", "app/mobile/about/page.tsx", "app/mobile/mail/[messageId]/page.tsx",
    "app/mobile/apps/[appId]/page.tsx",
  ];
  for (const page of pages) assert.equal(fs.existsSync(path.join(root, "core/app/src/app", page)), true, page);
});

test("desktop Pages previews render the published page instead of a fabricated cover", () => {
  const pagesPage = read("core/app/src/components/desktop-v627/pages-page.tsx");
  const pagePreview = read("core/app/src/components/desktop-v627/page-preview.tsx");
  assert.match(pagesPage, /<PagePreview page=\{page\}/);
  assert.match(pagePreview, /<iframe/);
  assert.match(pagePreview, /src=\{page\.url \|\| page\.shareUrl\}/);
  assert.match(pagePreview, /loading="lazy"/);
  assert.match(pagePreview, /sandbox="allow-scripts"/);
  assert.doesNotMatch(`${pagesPage}\n${pagePreview}`, /preview-bars|\[34,46,28,51,42,60,48\]/);
});

test("gateway routes the approved client to Next and its read-only data to the local Agent", () => {
  const distribution = JSON.parse(read("registry/site-distribution.json"));
  const nextBff = read("core/app/src/app/api/[...path]/route.ts");
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
  assert.deepEqual(routes.find((route) => route.key === "api-system-update"), { key: "api-system-update", prefix: "/api/system/update", access: "local-admin", kind: "proxy", targetKey: "console", upstreamPath: "/api/update" });
  assert.deepEqual(routes.find((route) => route.key === "public-pages"), { key: "public-pages", prefix: "/public", access: "public", kind: "proxy", targetKey: "agent", upstreamPath: "/pages" });
  assert.match(nextBff, /path\[0\] === "system"/);
  assert.match(nextBff, /PERSONAL_AGENT_CONTROL_URL/);
  assert.match(nextBff, /OPEN_AGENT_BRIDGE_INTERNAL_URL/);
  assert.match(nextBff, /data: "agent-data"/);
  assert.match(nextBff, /mail: "mail"/);
  assert.match(nextBff, /path\[0\] === "chat"/);
  assert.match(nextBff, /path\[0\] === "publications"/);
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
