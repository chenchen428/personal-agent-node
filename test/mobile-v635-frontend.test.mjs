import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Mobile V6.39 keeps every destination and task-history responsibility in a focused component", () => {
  const components = ["activity", "pages", "page-masonry", "workers", "mobile-task-detail", "task-display-presentation", "apps", "personal-app", "about", "mail", "shell", "skeletons", "wechat-status", "token-usage"];
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

test("Mobile V6.39 implements lazy navigation and tail-first task history", () => {
  const desktopEntry = read("core/app/src/app/app/page.tsx");
  const mobileProxy = read("core/app/src/proxy.ts");
  const shell = read("core/app/src/components/mobile-current/shell.tsx");
  const workers = read("core/app/src/components/mobile-current/workers.tsx");
  const detail = read("core/app/src/components/mobile-current/mobile-task-detail.tsx");
  const presentation = read("core/app/src/components/mobile-current/task-display-presentation.tsx");
  const history = read("core/app/src/components/mobile-current/use-task-display-history.ts");
  const activity = read("core/app/src/components/mobile-current/activity.tsx");
  const pages = read("core/app/src/components/mobile-current/pages.tsx");
  const apps = read("core/app/src/components/mobile-current/apps.tsx");
  const about = read("core/app/src/components/mobile-current/about.tsx");
  const tokenUsage = read("core/app/src/components/mobile-current/token-usage.tsx");
  assert.match(desktopEntry, /export const dynamic = "force-dynamic"/);
  assert.match(desktopEntry, /redirect\("\/app\/mobile"\)/);
  assert.match(mobileProxy, /matcher: "\/app"/);
  assert.match(mobileProxy, /isMobileRequest\(request\.headers\)/);
  assert.match(mobileProxy, /NextResponse\.redirect\(new URL\("\/app\/mobile", request\.url\)\)/);
  assert.match(shell, /打开侧边菜单/);
  assert.match(shell, /工作区/);
  assert.match(shell, /自定义应用/);
  assert.match(shell, /list-search-filters/);
  assert.match(shell, />完成</);
  assert.doesNotMatch(shell, /function FilterSheet|filter-sheet-layer/);
  assert.match(shell, /onCompositionStart/);
  assert.match(shell, /drawerOpen \? <MobileDrawer/);
  assert.match(workers, /\/api\/mobile\/tasks/);
  assert.match(workers, /filter !== "all"/);
  assert.match(workers, /setFilter\("all"\)/);
  assert.match(workers, /<MobileTaskDetail/);
  assert.match(history, /\/display-events\?/);
  assert.match(history, /new URLSearchParams\(\{ limit: String\(PAGE_SIZE\) \}\)/);
  assert.match(history, /params\.set\("before", before\)/);
  assert.match(history, /useLayoutEffect/);
  assert.match(history, /pendingInitialPositionRef/);
  assert.match(history, /element\.scrollTop = element\.scrollHeight/);
  assert.match(history, /previous\.top \+ Math\.max\(0, element\.scrollHeight - previous\.height\)/);
  assert.match(history, /element\.scrollTop <= TOP_LOAD_THRESHOLD/);
  assert.match(history, /task\.display\.delta/);
  assert.match(history, /\/api\/chat\/ws/);
  assert.doesNotMatch(history, /messageLimit=80/);
  assert.match(detail, /data-task-display-scroll="tail"/);
  assert.match(detail, /TaskLoading/);
  assert.match(detail, /TaskUnavailable/);
  assert.match(detail, /mobile-task-runtime/);
  assert.match(detail, /正在处理/);
  assert.match(presentation, /mobile-task-loading-message user/);
  assert.match(presentation, /mobile-task-loading-message agent/);
  assert.match(presentation, /mobile-task-loading-plan-header/);
  assert.match(presentation, /mobile-task-message/);
  assert.match(presentation, /mobile-task-plan/);
  assert.match(workers, /load\(true\)/);
  assert.match(workers, /if \(!background\) setError/);
  assert.match(workers, /if \(!background\) setLoading/);
  assert.match(activity, /mobile-story-icon/);
  assert.match(activity, /ListTodo/);
  assert.match(activity, /\/api\/mobile\/tasks\?limit=20&status=running/);
  assert.match(activity, /另有 \$\{parallelTasks\.length\} 项并行工作/);
  assert.match(activity, /parallelTasks\.length \? <>/);
  assert.match(pages, /<OrderedPageGrid/);
  assert.match(pages, /filter !== "all"/);
  assert.match(pages, /setFilter\("all"\)/);
  assert.match(apps, /你的常用工具/);
  assert.match(apps, /手机与桌面共享应用/);
  assert.match(apps, /<Link/);
  assert.doesNotMatch(apps, /<a className="mobile-app-card/);
  assert.ok(about.indexOf("<MobileTokenUsageSection />") > about.indexOf("mobile-about-email"));
  assert.ok(about.indexOf("<MobileTokenUsageSection />") < about.indexOf("mobile-about-skills"));
  assert.match(tokenUsage, /TokenUsageHeatmap/);
  assert.match(tokenUsage, /CompactTokenCount/);
});

test("Mobile Activity renders target-derived representative media", () => {
  const activity = read("core/app/src/components/mobile-current/activity.tsx");
  const types = read("core/app/src/components/mobile-current/types.ts");
  const css = read("core/app/src/app/mobile-current.css");
  assert.match(types, /preview: ActivityPreview \| null/);
  assert.match(activity, /activity-target-preview/);
  assert.match(activity, /item\.preview\.url/);
  assert.match(css, /\.activity-target-preview/);
});

test("Mobile task detail keeps long-form conversation typography readable", () => {
  const presentation = read("core/app/src/components/mobile-current/task-display-presentation.tsx");
  const types = read("core/app/src/components/mobile-current/types.ts");
  const css = read("core/app/src/app/mobile-current.css");
  assert.match(css, /\.mobile-task-message-body \{[^}]*font: 400 14px\/1\.75 var\(--pa-sans\)/);
  assert.match(css, /\.mobile-task-message-body \{[^}]*color: #4b4843/);
  assert.match(css, /\.mobile-task-plan li \{[^}]*font-weight: 400/);
  assert.match(types, /attachments\?: ChatAttachment\[\]/);
  assert.match(presentation, /item\.metadata\?\.attachments/);
  assert.match(presentation, /TaskMessageAttachments/);
  assert.match(presentation, /attachment\.previewUrl/);
  assert.match(presentation, /attachment\.deliveryState/);
  assert.match(presentation, /attachment\.downloadUrl/);
  assert.match(presentation, /mobile-task-file/);
  assert.match(presentation, /formatAttachmentBytes/);
  assert.match(css, /\.mobile-task-message-attachments img/);
  assert.match(css, /\.mobile-task-message-attachments \.mobile-task-file/);
});

test("Mobile primary loading states use layout-matched skeletons", () => {
  const skeletons = read("core/app/src/components/mobile-current/skeletons.tsx");
  const css = read("core/app/src/app/mobile-current.css");
  for (const component of ["activity", "workers", "pages", "apps", "mail", "personal-app"]) {
    const source = read(`core/app/src/components/mobile-current/${component}.tsx`);
    assert.match(source, /MobileContentSkeleton/, component);
  }
  for (const kind of ["activity", "tasks", "pages", "apps", "mail", "page", "app"]) {
    assert.match(skeletons, new RegExp(`kind === "${kind}"`), kind);
  }
  assert.match(read("core/app/src/components/mobile-current/about.tsx"), /MobileAboutMachineSkeleton/);
  assert.match(read("core/app/src/components/mobile-current/token-usage.tsx"), /MobileAboutSectionSkeleton/);
  assert.match(read("core/app/src/components/mobile-current/wechat-status.tsx"), /MobileAboutSectionSkeleton/);
  assert.match(css, /@keyframes mobile-content-shimmer/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.mobile-skeleton-block::after/);
});

test("local Next preview mirrors the registered API upstream mappings", () => {
  const bff = read("core/app/src/app/api/[...path]/route.ts");
  assert.match(bff, /PERSONAL_AGENT_CONTROL_URL/);
  assert.match(bff, /OPEN_AGENT_BRIDGE_INTERNAL_URL/);
  assert.match(bff, /data: "agent-data"/);
  assert.doesNotMatch(bff, /agent-automations/);
  assert.match(bff, /schedules: "agent-corn"/);
  assert.match(bff, /mail: "mail"/);
  assert.match(bff, /controlRoots/);
  assert.match(bff, /"apps"/);
  assert.match(bff, /path\[0\] === "chat"/);
  assert.match(bff, /path\[0\] === "publications"/);
});
