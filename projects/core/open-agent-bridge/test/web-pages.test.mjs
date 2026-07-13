import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { renderAutomationPage, renderCronPage, renderDashboard, renderDataPage, renderMemoryPage, renderMessagesFragment, renderNewSession, renderPrivateFileBatch, renderReleaseNotesPage, renderSessionDetail, renderSkillCatalogPage } from "../src/web/pages.js";

test("token usage dialog carries an opaque themed surface", () => {
  const html = renderDashboard({
    sessions: [],
    status: { wechat: { connected: false } },
    assets: [],
    tokenUsage: {
      totalTokens: 3_200_000,
      inputTokens: 1_500_000_000,
      cachedInputTokens: 1_200,
      outputTokens: 999,
      reasoningOutputTokens: 0,
      sessionCount: 0,
      threadCount: 0,
      requestCount: 12,
      cacheRate: 88,
      range: "today",
      dailyUsage: [{ day: "2026-07-11", totalTokens: 1200 }],
      recentSessions: [],
    },
  });

  assert.match(html, /class="agent-bridge-theme task-dialog token-dialog"/);
  assert.match(html, /\.token-dialog \.task-dialog-content\{[^}]*background:hsl\(var\(--background\)\)/);
  assert.match(html, /\.token-dialog::backdrop\{[^}]*\.56/);
  assert.match(html, /data-token-range="today" aria-pressed="true"/);
  assert.match(html, /class="token-heatmap" data-token-heatmap/);
  assert.match(html, /data-token-day="2026-07-11" data-level="4"/);
  assert.match(html, />3\.2M</);
  assert.match(html, />1\.5B</);
  assert.match(html, />1\.2K</);
  assert.match(html, />999</);
  assert.match(html, /loadTokenUsage\(button\.dataset\.tokenRange/);
  assert.match(html, /token-dialog-fallback/);
  assert.match(html, /data-console-menu/);
  assert.match(html, /href="\/agent\/release-notes"[^>]*>[\s\S]*?<span>Release Notes<\/span>/);
  assert.match(html, /\.console-header\{position:relative;z-index:40;[^}]*overflow:visible/);
  assert.match(html, /\.console-menu-popover\{position:absolute;z-index:60;[^}]*background:#fffdf8/);
  assert.match(html, /href="\/agent\/memory"/);
  assert.match(html, /href="\/agent\/data"/);
  assert.match(html, /href="\/agent\/automations"/);
  assert.match(html, /href="\/agent\/skills"/);
  assert.match(html, /href="\/agent\/schedules"/);
  assert.match(html, /href="\/agent\/channels"[^>]*>[\s\S]*?<span>渠道管理<\/span>/);
  assert.match(html, /class="compose-fab wechat-only-hidden"/);
  assert.match(html, /href="\/admin"[^>]*aria-label="返回站点导航"/);
});

test("release notes page renders history and detailed acceptance evidence", () => {
  const release = {
    releaseId: "20260713T120000Z-bbbbbbbbbbbb",
    previousReleaseId: "20260712T120000Z-aaaaaaaaaaaa",
    commit: "b".repeat(40),
    builtAt: "2026-07-13T11:55:00.000Z",
    releasedAt: "2026-07-13T12:00:00.000Z",
    summary: "Release Notes and WeChat notification",
    changes: [{ commit: "b".repeat(40), subject: "Add governed release history" }],
    checks: ["Installed runtime acceptance passed"],
    services: ["Open Agent Bridge", "Private Site Node"],
  };
  const html = renderReleaseNotesPage({ releases: [{ ...release, status: "success" }], selectedRelease: release });
  assert.match(html, /data-release-id="20260713T120000Z-bbbbbbbbbbbb"/);
  assert.match(html, /Release Notes and WeChat notification/);
  assert.match(html, /GMT\+8/);
  assert.match(html, /Add governed release history/);
  assert.match(html, /Installed runtime acceptance passed/);
  assert.match(html, /href="\/agent\/release-notes\/20260713T120000Z-bbbbbbbbbbbb" aria-current="page"/);
  assert.match(html, /@media\(max-width:767px\)\{\.release-notes-workspace/);
});

test("native data page renders dynamic schema, filters, aggregation, and mobile records without a grid dependency", () => {
  const html = renderDataPage({
    status: { sizeBytes: 4096, schemaVersion: 3, snapshotCount: 1, objects: [{ name: "expenses", type: "table", rowCount: 2, columnCount: 3 }] },
    selectedObject: "expenses",
    result: {
      object: { name: "expenses", type: "table", columns: [{ name: "id" }, { name: "category" }, { name: "amount" }] },
      columns: ["id", "category", "amount"],
      rows: [{ id: 1, category: "餐饮", amount: 1200 }],
      page: { number: 1, size: 50, totalRows: 1, totalPages: 1 },
    },
    operations: [],
    query: {},
  });
  assert.match(html, /data-page/);
  assert.match(html, /name="field"/);
  assert.match(html, /name="metricFunction"/);
  assert.match(html, /class="data-grid"/);
  assert.match(html, /data-label="category"/);
  assert.match(html, /data-data-record-dialog/);
  assert.match(html, /data-data-pagination/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /fragment','rows'/);
  assert.match(html, /\.data-grid-scroll\{max-width:100%;overscroll-behavior-inline:contain/);
  assert.doesNotMatch(html, /Tabulator|DataTable|AG Grid/);
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test("automation page exposes sources, readable rules, permissions, runs, and templates without edit controls", () => {
  const html = renderAutomationPage({
    sources: [{ id: "mail", name: "Agent 邮箱", kind: "email", accountRef: "agent@example.com", capabilities: ["message"], sensitivity: "restricted", enabled: true, health: "healthy", configVersion: 1 }],
    rules: [{ id: "rule", name: "账单", description: "识别账单", sourceId: "mail", eventType: "message.received", conditions: { matchAll: true, semanticIntent: "识别账单和消费信息", keywords: ["账单", "statement"], sender: { operator: "endsWith", value: "@bank.example" } }, action: { type: "agent-task", steps: [{ type: "agent-analysis", output: "消费报告" }] }, permissions: { readCurrentEvent: true, readAttachments: true, data: "admin", automationWrite: false }, enabled: true, version: 1, updatedAt: new Date().toISOString() }],
    events: [{ id: "event", title: "本月账单" }],
    runs: [{ id: "run", ruleId: "rule", eventId: "event", matched: true, status: "queued", reason: "规则命中", createdAt: new Date().toISOString() }],
    templates: [{ id: "template", name: "账单解析", runtime: "javascript-esm", version: 1, status: "active", purpose: "解析", sourceFingerprint: "mail", successCount: 2, failureCount: 0 }],
  });
  assert.match(html, /Agent 关注规则/);
  assert.match(html, /关注条件/);
  assert.match(html, /同时满足以下条件/);
  assert.match(html, /识别账单和消费信息/);
  assert.match(html, /结尾是/);
  assert.match(html, /创建 Agent 任务/);
  assert.match(html, /权限范围/);
  assert.match(html, /读取附件/);
  assert.match(html, /不允许/);
  assert.match(html, /data-automation-tab="runs"/);
  assert.match(html, /data-automation-tab="protection"/);
  assert.match(html, /邮件与并发防护/);
  assert.match(html, /data-automation-more/);
  assert.match(html, /format=html&limit=20/);
  assert.match(html, /\.automation-item\{min-width:0;max-width:100%;overflow:hidden/);
  assert.doesNotMatch(html, /automation-json|<pre>\s*\{/);
  assert.doesNotMatch(html, /保存规则|删除规则|新建规则/);
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test("skill catalog lists workspace skills and opens description details", () => {
  const html = renderSkillCatalogPage({
    categories: [{ id: "research-knowledge", label: "Research & Knowledge" }],
    skills: [{
      name: "deep-research",
      description: "Plan and execute structured evidence-backed research.",
      category: "research-knowledge",
      maturity: "beta",
      cli: ["research"],
      related: ["knowledge-capture"],
    }],
  });

  assert.match(html, /技能清单/);
  assert.match(html, /当前工作区 · 1 个技能/);
  assert.match(html, /data-skill-name="deep-research"/);
  assert.match(html, /Plan and execute structured evidence-backed research\./);
  assert.match(html, /data-skill-detail[^>]*hidden/);
  assert.match(html, /data-skill-detail-description/);
  assert.match(html, /data-skill-search/);
  assert.doesNotMatch(html, /\.skill-row:hover/);
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test("conversation list separates the main session before other sessions", () => {
  const html = renderDashboard({
    sessions: [
      { id: "worker-1", role: "worker", title: "后台任务", status: "running", updatedAt: "2026-07-10T12:00:00.000Z" },
      { id: "main-1", role: "main", title: "我的助理", status: "idle", updatedAt: "2026-07-10T11:00:00.000Z" },
    ],
    status: { wechat: { connected: true } },
    assets: [],
  });

  assert.ok(html.indexOf('data-console-session-group="main"') < html.indexOf('data-console-session-group="other"'));
  assert.match(html, /main-session-group/);
  assert.match(html, /<strong>主会话<\/strong>/);
  assert.match(html, /<strong>其他会话<\/strong>/);
  assert.match(html, /mergeSessionGroups/);
});

test("dashboard renders immediately and hydrates sessions and token usage asynchronously", () => {
  const html = renderDashboard({ initialLoading: true, pageSize: 20 });
  assert.match(html, /class="console-initial-loading" role="status"/);
  assert.equal((html.match(/class="console-loading-row"/g) || []).length, 5);
  assert.match(html, /loadPage\(\{ reset: true \}\);/);
  assert.match(html, /loadTokenUsage\(\);/);
  assert.match(html, /fetch\('\/api\/agent\/sessions\?'/);
  assert.match(html, /fetch\('\/api\/agent\/token-usage\?range='/);
  assert.match(html, /data\.totalSessions/);
  assert.match(html, /暂时无法加载会话/);
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)?.[1] || ""));
});

test("dashboard HTML route performs no runtime data reads before responding", () => {
  const source = fs.readFileSync(new URL("../src/server/server.ts", import.meta.url), "utf8");
  const start = source.indexOf('if (url.pathname === "/agent-bridge"');
  const end = source.indexOf('if (url.pathname === "/agent-bridge/new"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /renderDashboard\(\{[\s\S]*initialLoading: true/);
  assert.doesNotMatch(route, /await|wechat\.status|listUploadedAssets|store\.(?:listSessionsPage|countSessions|listWorkspaces|getTokenUsageSummary)/);
});

test("memory management defaults to a main session and exposes hit statistics", () => {
  const html = renderMemoryPage({
    selectedSessionId: "main-1",
    sessions: [
      { id: "main-1", role: "main", channel: "wechat", title: "赖馒头", url: "/agent-bridge/session/main-1/live", memoryCount: 1 },
      { id: "worker-1", role: "worker", title: "部署任务", url: "/agent-bridge/session/worker-1/live", memoryCount: 0 },
    ],
    memories: [{
      id: "mem-1",
      sessionId: "main-1",
      type: "preference",
      content: "发布完成后检查所有域名",
      hitCount: 7,
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-10T11:00:00.000Z",
      lastHitAt: "2026-07-10T12:00:00.000Z",
    }],
    stats: { memoryCount: 1, totalHits: 7, lastActivityAt: "2026-07-10T12:00:00.000Z" },
  });

  assert.match(html, /记忆管理/);
  assert.match(html, /data-memory-session-option data-value="main-1" aria-pressed="true"/);
  assert.match(html, /主会话 · 赖馒头 · 1 条/);
  assert.match(html, /class="memory-overlay memory-sheet" data-memory-session-sheet[^>]*hidden/);
  assert.match(html, /class="memory-overlay memory-sheet" data-memory-type-sheet[^>]*hidden/);
  assert.match(html, /class="memory-overlay task-dialog memory-dialog" data-memory-dialog[^>]*hidden/);
  assert.match(html, /data-memory-detail-type/);
  assert.doesNotMatch(html, /<select[^>]*data-memory-(?:session|type)/);
  assert.doesNotMatch(html, /<dialog[^>]*data-memory/);
  assert.match(html, /发布完成后检查所有域名/);
  assert.match(html, /命中 7 次/);
  assert.match(html, /data-memory-delete-dialog/);
  assert.match(html, /location\.assign\('\/agent\/memory' \+ \(value \? '\?session=' \+ encodeURIComponent\(value\)/);
  assert.match(html, /dialog\.hidden = false/);
  assert.match(html, /new CustomEvent\('memoryclose'/);
  const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test("web agent actions stay hidden while their implementation remains available", () => {
  const session = renderSessionDetail({
    session: {
      id: "main-1",
      title: "主会话",
      role: "main",
      status: "idle",
      workspaceRoot: "/tmp/workspace",
      childSessions: [],
      messages: [],
    },
  });
  const compose = renderNewSession({ workspaces: [] });
  const cron = renderCronPage({ tasks: [], workspaces: [] });

  assert.match(session, /class="mobile-chat-composer wechat-only-hidden"/);
  assert.match(session, /data-composer/);
  assert.match(compose, /class="compose-main wechat-only-hidden"/);
  assert.match(compose, /data-new-session/);
  assert.match(cron, /class="cron-agent-guide wechat-only-hidden"/);
  assert.match(cron, /class="task-dialog wechat-only-hidden"/);
  assert.match(cron, /\.wechat-only-hidden\{display:none!important\}/);
});

test("private file batches render one authenticated reference list", () => {
  const html = renderPrivateFileBatch({
    title: "7/11文件包 01",
    createdAt: "2026-07-11T03:00:00.000Z",
    items: [{ referenceName: "图1", fileName: "晚餐.jpg", sizeBytes: 1024, previewUrl: "/private-files/view/a.jpg" }],
  });
  assert.match(html, /7\/11文件包 01/);
  assert.match(html, /图1/);
  assert.match(html, /晚餐\.jpg/);
  assert.match(html, /href="\/private-files\/view\/a\.jpg"/);
});

test("conversation fragments omit internal system modules", () => {
  const html = renderMessagesFragment({
    session: {
      messages: [
        { role: "user", content: "开始处理", sequence: 1, createdAt: "2026-07-10T05:00:00.000Z" },
        { role: "system", content: "Turn started", sequence: 2, createdAt: "2026-07-10T05:00:01.000Z" },
        { role: "agent", content: "internal reasoning", sequence: 3, createdAt: "2026-07-10T05:00:02.000Z" },
        { role: "tool", content: "command output", sequence: 4, createdAt: "2026-07-10T05:00:03.000Z" },
        { role: "error", content: "internal error", sequence: 5, createdAt: "2026-07-10T05:00:04.000Z" },
        { role: "user", content: "[worker-hook:completed]\n内部汇总输入", sequence: 6, createdAt: "2026-07-10T05:00:04.500Z" },
        { role: "assistant", content: "已经处理完成。", sequence: 7, createdAt: "2026-07-10T05:00:05.000Z" },
      ],
    },
  });

  assert.match(html, /开始处理/);
  assert.match(html, /已经处理完成/);
  assert.doesNotMatch(html, /Turn started|internal reasoning|command output|internal error|内部汇总输入/);
  assert.doesNotMatch(html, /mobile-chat-system-message/);
});

test("conversation details render safe Markdown for user and assistant messages", () => {
  const html = renderMessagesFragment({
    session: {
      messages: [
        { role: "user", content: "**重点**\n\n- 第一项", sequence: 1, createdAt: "2026-07-10T05:00:00.000Z" },
        { role: "assistant", content: "## 结果\n\n[查看页面](https://pages.example.test/a)\n\n```js\nconst ok = true;\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))", sequence: 2, createdAt: "2026-07-10T05:01:00.000Z" },
      ],
    },
  });

  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<ul>[^]*<li>第一项<\/li>/);
  assert.match(html, /<h2>结果<\/h2>/);
  assert.match(html, /href="https:\/\/pages\.example\.test\/a" target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(html, /<pre><code class="language-js">const ok = true;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("session detail uses browser history for an immediate dashboard return", () => {
  const html = renderSessionDetail({
    session: {
      id: "session-1",
      title: "会话详情",
      status: "idle",
      role: "worker",
      metadata: { workspaceName: "personal-agent.local" },
      childSessions: [],
      messages: [],
    },
  });
  assert.match(html, /data-session-back/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /scroll-padding-bottom:calc\(2rem \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(html, /history\.back\(\)/);
  assert.match(html, /pagehide[^]*ws\.close\(\)/);
});
