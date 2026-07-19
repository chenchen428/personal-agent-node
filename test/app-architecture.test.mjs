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
  const scheduledTasksClient = read("core/app/src/components/desktop-v627/scheduled-tasks-page.tsx");
  const scheduledTaskDetail = read("core/app/src/components/desktop-v627/scheduled-task-detail.tsx");
  const taskViewNavigation = read("core/app/src/components/desktop-v627/task-module-view-navigation.tsx");
  const overviewClient = read("core/app/src/components/desktop-v627/overview-page.tsx");
  const mobileAccessControl = read("core/app/src/components/desktop-v627/mobile-access-control.tsx");
  const connectionsClient = read("core/app/src/components/desktop-v627/connections-page.tsx");
  const connectionViewSwitch = read("core/app/src/components/desktop-v627/connection-view-switch.tsx");
  const connectionActionsClient = read("core/app/src/components/desktop-v627/connection-action-row.tsx");
  const skillsClient = read("core/app/src/components/desktop-v627/skills-page.tsx");
  const updateClient = read("core/app/src/components/desktop-v627/update-page.tsx");
  const dataClient = read("core/app/src/components/desktop-v627/data-page.tsx");
  const dataEmptyState = read("core/app/src/components/desktop-v627/data-empty-state.tsx");
  const runtimeClient = read("core/app/src/components/desktop-v627/runtime-page.tsx");
  const appsClient = read("core/app/src/components/desktop-v627/apps-page.tsx");
  const legacyChatPage = read("core/app/src/app/app/chat/[[...slug]]/page.tsx");
  const settingsClient = read("core/app/src/components/desktop-v627/settings-page.tsx");
  const spaceSwitcher = read("core/app/src/components/space-switcher.tsx");
  const tokenUsageHook = read("core/app/src/components/token-usage/use-token-usage.ts");
  const dataExportControl = read("core/app/src/components/desktop-v627/data-export-control.tsx");
  const agentServer = read("core/agent/src/server/server.ts");
  const controlServer = read("core/control/server.ts");
  const mobileClient = [
    "mobile-current.tsx",
    "mobile-current/activity.tsx",
    "mobile-current/pages.tsx",
    "mobile-current/workers.tsx",
    "mobile-current/apps.tsx",
    "mobile-current/personal-app.tsx",
    "mobile-current/about.tsx",
    "mobile-current/token-usage.tsx",
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

  for (const route of ["/app/conversations", "/app/workers", "/app/mail", "/app/pages", "/app/data", "/app/connections", "/app/runtime", "/app/apps", "/app/settings", "/app/statistics/token-usage", "/app/update"]) {
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
  assert.match(spaceSwitcher, /隔离空间不存在/);
  assert.match(spaceSwitcher, /options = snapshot\.spaces/);
  assert.match(spaceSwitcher, /aria-selected=\{selected\}/);
  assert.doesNotMatch(spaceSwitcher, /\.filter\(\(space\) => space\.id !== current\?\.id\)/);
  assert.match(dataClient, /visibleRows/);
  assert.doesNotMatch(dataClient, /search:\s*query/);
  assert.match(dataClient, /illustrated:\s*true/);
  assert.match(dataEmptyState, /IllustratedEmptyState/);
  assert.match(read("core/app/src/components/desktop-v72/loading-state.tsx"), /role="status"/);
  assert.doesNotMatch(read("core/app/src/components/desktop-v72/settings-layout.tsx"), /Token统计/);
  assert.match(navigation, /统计目录/);
  assert.match(tokenUsageHook, /\/api\/token-usage\?range=/);
  assert.match(mobileClient, /MobileTokenUsageSection/);
  assert.match(mobileClient, /TokenUsageHeatmap/);
  assert.match(overview, /sec-ch-ua-mobile/);
  assert.match(overview, /redirect\("\/app\/mobile"\)/);
  assert.match(overviewClient, /MobileAccessControl/);
  assert.match(mobileAccessControl, /\/app\/mobile/);
  assert.match(mobileAccessControl, /远程访问暂不可用，请在连接处配置公网域名后即可访问/);
  assert.match(mobileAccessControl, /target="_blank"/);
  assert.match(mobileAccessControl, /role="tooltip"/);
  assert.match(conversationClient, /id="desktop-chat-input"[\s\S]*autoFocus/);
  assert.match(conversationClient, /className="conversation-empty"/);
  assert.doesNotMatch(conversationClient, /<Empty\s/);
  assert.match(settingsClient, /runtime\.value\?\.workspaceRoot/);
  assert.doesNotMatch(settingsClient, /关闭窗口后继续运行|shellStopsService/);
  assert.match(runtimeClient, /runtime-stat-grid/);
  assert.match(runtimeClient, /客户端持续守护/);
  assert.doesNotMatch(runtimeClient, /关闭策略|停止 PA 服务|CircleStop|__personal-agent\/close/);
  assert.match(appsClient, /\/app\/conversations\?draft=/);
  assert.doesNotMatch(appsClient, /\/app\/chat\?draft=/);
  assert.match(legacyChatPage, /redirect\("\/app\/conversations"\)/);
  assert.equal(fs.existsSync(path.join(root, "core/app/src/components/chat-dashboard.tsx")), false);
  assert.match(dataExportControl, /SQLite/);
  assert.match(agentServer, /workspaceRoot:\s*config\.workspaceRoot/);
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
  assert.match(mobileCss, /\.list-search-filters/);
  assert.doesNotMatch(mobileCss, /\.filter-sheet/);
  assert.match(mobileCss, /\.mobile-current :where\(button, input, select\) \{ font: inherit; \}/);
  assert.doesNotMatch(mobileCss, /\.mobile-current button, \.mobile-current input, \.mobile-current select \{ font: inherit; \}/);
  assert.doesNotMatch(mobileClient, /PhoneStatus|phone-status|9:41/);
  assert.doesNotMatch(mobileCss, /\.phone-status/);
  assert.match(mobileCss, /\.task-plan/);
  assert.match(mobileClient, /工作区/);
  assert.match(mobileClient, /自定义应用/);
  assert.match(mobileClient, /系统/);
  assert.match(mobileClient, /mobile-task-list/);
  assert.match(mobileClient, /mobile-task-conversation/);
  assert.match(mobileClient, /mobile-about-machine/);
  assert.match(mobileCss, /\.mobile-drawer \{[^}]*top: 0;/);
  assert.match(mobileCss, /\.mobile-about-machine h1 \{[^}]*overflow-wrap: anywhere;/);

  for (const endpoint of ["overview", "pages", "runtime"]) {
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
  assert.match(taskViewNavigation, /\/app\/workers\/schedules/);
  assert.match(workersClient, /TaskModuleViewNavigation active="tasks"/);
  assert.match(workersClient, /v72-split-toolbar-title[\s\S]*<h1>任务<\/h1>[\s\S]*TaskModuleViewNavigation/);
  assert.match(scheduledTasksClient, /TaskModuleViewNavigation active="schedules"/);
  assert.match(scheduledTasksClient, /v72-split-toolbar-title[\s\S]*<h1>任务<\/h1>[\s\S]*TaskModuleViewNavigation/);
  assert.match(css, /\.v72-split-toolbar-title\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between/);
  assert.match(desktopComponents, /\/api\/app\/schedules\/tasks/);
  assert.match(scheduledTaskDetail, /lastSessionId/);
  assert.match(scheduledTaskDetail, /\/app\/workers\?task=/);
  assert.doesNotMatch(`${scheduledTasksClient}\n${scheduledTaskDetail}`, /"POST"|"PATCH"|"DELETE"|\/run\b/);
  assert.doesNotMatch(navigation, /\/app\/workers\/schedules|\/app\/schedules/);
  assert.match(overviewClient, /Personal Agent 已就绪/);
  assert.match(overviewClient, /Personal Agent 正在准备/);
  assert.match(overviewClient, /RequiredSetupGuide/);
  assert.match(desktopComponents, /开始使用前/);
  assert.match(overviewClient, /counts\.runningWork/);
  assert.match(overviewClient, /最近动态/);
  assert.match(overviewClient, /externalAddress/);
  assert.match(overviewClient, /target="_blank"/);
  assert.doesNotMatch(overviewClient, /下午好|最近工作/);
  assert.match(connectionsClient, /\/api\/connections/);
  assert.match(connectionActionsClient, /connection-summary-action/);
  assert.match(connectionsClient, /connection\.cli\.operations/);
  assert.match(connectionsClient, /accessModeLabel/);
  assert.match(connectionsClient, /浏览器连接/);
  assert.match(connectionsClient, /ConnectionViewSwitch/);
  assert.match(connectionsClient, /isEffectiveConnection/);
  assert.match(connectionViewSwitch, /全部/);
  assert.match(connectionViewSwitch, /已生效/);
  assert.match(connectionViewSwitch, /aria-pressed/);
  assert.match(connectionsClient, /initialLoading/);
  assert.match(connectionsClient, /正在加载连接/);
  assert.match(css, /\.kv-grid > \.kv:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.connection-toolbar \.split-toolbar-title\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between/);
  assert.match(connectionActionsClient, /OpenCliAction/);
  assert.match(connectionActionsClient, /\/api\/connections\/\$\{connection\.id\}\/open/);
  assert.match(connectionActionsClient, /检测浏览器操作/);
  assert.match(connectionActionsClient, /校验平台只读能力/);
  assert.match(connectionActionsClient, /不是.*账号授权/);
  assert.doesNotMatch(connectionActionsClient, /npm install|查看官方安装说明/);
  assert.doesNotMatch(connectionActionsClient, /XiaohongshuConnectPanel|xiaohongshu\/login/);
  assert.match(connectionActionsClient, /useConnectionStatusSync/);
  assert.match(connectionActionsClient, /syncing \?/);
  assert.doesNotMatch(connectionActionsClient, /fetchJson\("\/api\/connections\/notion\/login\/poll"/);
  assert.doesNotMatch(connectionsClient, /Web 控制台|手机访问/);
  assert.match(conversationClient, /MarkdownContent/);
  assert.match(workersClient, /MarkdownContent/);
  assert.match(css, /\.desktop-v72 \.v72-markdown/);
  assert.doesNotMatch(desktopNavigationSource, /\/app\/automations/);
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
  assert.match(conversationClient, /session\?\.linkedTask\?\.status/);
  assert.match(conversationClient, /const processing = mainProcessing \|\|/);
  assert.match(conversationClient, /waiting=\{mainProcessing\}/);
  assert.match(conversationClient, /正在处理，回复会自动显示/);
  assert.match(conversationClient, /before=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(conversationClient, /plan-block/);
  assert.match(conversationClient, /const planIndex = linkedTask \? linkedIndex : findLastAssistant\(messages\)/);
  assert.match(conversationClient, /linkedTask\.parentSessionId/);
  assert.match(conversationClient, /message\.metadata\?\.sourceLabel/);
  assert.match(conversationClient, /来自桌面/);
  assert.doesNotMatch(conversationClient, /planIndex = messages\.findIndex/);
  assert.match(conversationClient, /composer-wrap/);
  assert.match(conversationClient, /添加附件/);
  assert.match(css, /\.desktop-v72 \.message-thread/);
  assert.match(css, /\.desktop-v72 \.composer/);
  assert.match(css, /\.desktop-v72 \.message-processing/);
  assert.match(css, /\.desktop-v72 \.message-source/);
  const messageTaskRule = css.match(/\.desktop-v72 \.message-task\s*\{[^}]*\}/)?.[0] || "";
  assert.match(messageTaskRule, /min-height:\s*24px/);
  assert.doesNotMatch(messageTaskRule, /border(?:-radius)?:|background:/);
  assert.doesNotMatch(conversationClient, /model|reasoning|sandbox|approval/i);
  assert.doesNotMatch(conversationClient, /\/api\/chat\/sessions/);
  assert.doesNotMatch(conversationClient, /createdBy|task:\s*content/);
  assert.match(desktopComponents, /本机可信/);
  assert.match(desktopComponents, /其他设备会话已失效/);
  assert.match(desktopComponents, /installation\.local-auth/);
  assert.match(desktopComponents, /\/api\/system\/update/);
  assert.match(desktopComponents, /安装后自动重启/);
  assert.match(desktopComponents, /\/api\/system\/authorization/);
  assert.match(desktopComponents, /\/api\/system\/codex-settings/);
  assert.match(desktopComponents, /模型与推理强度/);
  assert.match(agentServer, /\/api\/node\/v1\/client\/codex-settings/);
  assert.match(controlServer, /\/api\/codex-settings/);
  assert.match(desktopComponents, /bypass/);
  assert.match(desktopComponents, /confirm/);
  assert.match(desktopComponents, /if \(bypass\) await applyPlan/);
  assert.match(setupDashboard, /可选 · 公网域名/);
  assert.match(setupDashboard, /验证后分配 PA 邮箱/);
  assert.match(setupDashboard, /无需单独接入/);
  assert.ok(setupDashboard.indexOf("可选 · 公网域名") < setupDashboard.indexOf("可选 · 邮件"));
  assert.match(setupDashboard, /验证公网与邮箱/);
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
  assert.match(mobileClient, /list-search-filters/);
  assert.match(mobileClient, />完成</);
  assert.match(mobileClient, /sessionStorage/);
  assert.match(mobileClient, /有新进展/);
  assert.match(mobileClient, /hasRunningTask/);
  assert.match(mobileClient, /重启后已继续处理/);
  assert.match(mobileClient, /session && \(messages\.length \|\| plan\.length\)/);
  assert.match(mobileClient, /\/api\/chat\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.doesNotMatch(mobileClient.match(/const navItems:[\s\S]*?\];/)?.[0] || "", /conversations/);
  for (const responsibility of ["activity", "pages", "workers", "apps", "personal-app", "about", "wechat-status", "mail", "shell", "token-usage", "data", "types"]) {
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
    "app/page.tsx", "app/conversations/page.tsx", "app/workers/page.tsx", "app/workers/schedules/page.tsx", "app/schedules/page.tsx", "app/mail/page.tsx",
    "app/pages/page.tsx", "app/pages/[pageId]/page.tsx", "app/data/page.tsx", "app/apps/page.tsx", "app/apps/[appId]/page.tsx",
    "app/connections/page.tsx", "app/connections/wechat-personal/page.tsx", "app/channels/page.tsx", "app/skills/page.tsx", "app/statistics/token-usage/page.tsx", "app/setup/page.tsx", "app/runtime/page.tsx", "app/settings/page.tsx", "app/update/page.tsx",
    "app/mobile/page.tsx", "app/mobile/pages/page.tsx", "app/mobile/pages/[pageId]/page.tsx",
    "app/mobile/workers/page.tsx", "app/mobile/workers/[sessionId]/page.tsx",
    "app/mobile/conversations/page.tsx", "app/mobile/conversations/[sessionId]/page.tsx",
    "app/mobile/apps/page.tsx", "app/mobile/about/page.tsx", "app/mobile/mail/[messageId]/page.tsx",
    "app/mobile/apps/[appId]/page.tsx",
  ];
  for (const page of pages) assert.equal(fs.existsSync(path.join(root, "core/app/src/app", page)), true, page);
});

test("desktop Pages previews read the persisted thumbnail without embedding the published page", () => {
  const pagesPage = read("core/app/src/components/desktop-v627/pages-page.tsx");
  const pagePreview = read("core/app/src/components/desktop-v627/page-preview.tsx");
  assert.match(pagesPage, /<PagePreview page=\{page\}/);
  assert.match(pagePreview, /<PageThumbnail page=\{page\}/);
  assert.doesNotMatch(pagePreview, /<iframe/);
  assert.doesNotMatch(`${pagesPage}\n${pagePreview}`, /preview-bars|\[34,46,28,51,42,60,48\]/);
});

test("gateway routes the approved client to Next and its read-only data to the local Agent", () => {
  const distribution = JSON.parse(read("registry/site-distribution.json"));
  const routeRegistry = JSON.parse(read("registry/routes.json"));
  const nextBff = read("core/app/src/app/api/[...path]/route.ts");
  const routes = distribution.routing.paths;
  assert.equal(routes.find((route) => route.key === "app").targetKey, "console");
  assert.equal(routes.find((route) => route.key === "app-pages").targetKey, "console");
  assert.equal(routes.find((route) => route.key === "app-connections").targetKey, "console");
  assert.deepEqual(routes.find((route) => route.key === "app-schedules"), { key: "app-schedules", prefix: "/app/schedules", access: "authenticated", kind: "proxy", targetKey: "console", upstreamPath: "/app/schedules" });
  assert.equal(routes.find((route) => route.key === "api-node-v1").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-mobile").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-app-mail").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-app-data").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-app-schedules").targetKey, "agent");
  assert.equal(routes.find((route) => route.key === "api-chat").targetKey, "agent");
  assert.deepEqual(routes.find((route) => route.key === "api-token-usage"), { key: "api-token-usage", prefix: "/api/token-usage", access: "authenticated", kind: "proxy", targetKey: "agent", upstreamPath: "/api/token-usage" });
  assert.deepEqual(routeRegistry.routes.find((route) => route.pattern === "/api/token-usage"), { pattern: "/api/token-usage", access: "authenticated", capability: "agent" });
  assert.deepEqual(routes.find((route) => route.key === "api-connections"), { key: "api-connections", prefix: "/api/connections", access: "authenticated", kind: "proxy", targetKey: "agent", upstreamPath: "/api/connections" });
  assert.equal(routes.find((route) => route.key === "home").access, "authenticated");
  assert.equal(routes.find((route) => route.key === "app-settings").access, "local-admin");
  assert.equal(routes.find((route) => route.key === "api-system-setup-actions").access, "local-admin");
  assert.deepEqual(routes.find((route) => route.key === "api-system-update"), { key: "api-system-update", prefix: "/api/system/update", access: "local-admin", kind: "proxy", targetKey: "console", upstreamPath: "/api/update" });
  assert.deepEqual(routes.find((route) => route.key === "public-pages"), { key: "public-pages", prefix: "/public", access: "public", kind: "proxy", targetKey: "agent", upstreamPath: "/pages" });
  assert.match(nextBff, /path\[0\] === "system"/);
  assert.match(nextBff, /"authorization"/);
  assert.match(nextBff, /"data-export"/);
  assert.match(nextBff, /"spaces"/);
  assert.match(nextBff, /"expect"/);
  assert.match(nextBff, /PERSONAL_AGENT_CONTROL_URL/);
  assert.match(nextBff, /OPEN_AGENT_BRIDGE_INTERNAL_URL/);
  assert.match(nextBff, /data: "agent-data"/);
  assert.match(nextBff, /schedules: "agent-corn"/);
  assert.match(nextBff, /mail: "mail"/);
  assert.match(nextBff, /path\[0\] === "chat"/);
  assert.match(nextBff, /path\[0\] === "publications"/);
});

test("existing writable desktop workflows and Personal Apps remain available", () => {
  const chat = read("core/app/src/components/desktop-v627/conversation-page.tsx");
  const mail = read("core/app/src/components/mail-dashboard.tsx");
  const channels = read("core/app/src/components/channels-dashboard.tsx");
  const setup = read("core/app/src/components/setup-dashboard.tsx");
  const appCatalog = read("core/app/src/components/apps-dashboard.tsx");
  const appShell = read("core/app/src/components/app-shell.tsx");
  const mobileShell = read("core/app/src/components/mobile-current/shell.tsx");
  const mobilePersonalApp = read("core/app/src/components/mobile-current/personal-app.tsx");
  const pluginStore = read("core/plugins/runtime/store.ts");
  assert.match(chat, /\/api\/chat\/desktop\/conversation\/messages/);
  assert.match(chat, /clientMessageId/);
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
