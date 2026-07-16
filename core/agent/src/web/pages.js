import { renderMarkdown } from "./markdown.js";

export function renderDashboard({ sessions = [], totalSessions = sessions.length, pagination = {}, pageSize = 20, initialLoading = false, tokenUsage = emptyTokenUsage() } = {}) {
  const activeSessions = sessions.filter((session) => session.status !== "archived");
  return layout({
    title: "Codex · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page">
        <div class="console-frame">
          <header class="console-header">
            ${siteHomeButton()}
            <div class="console-title">
              <span>Codex</span>
              <small>
                <i class="presence-dot online" aria-hidden="true"></i>
                <span>本机 · ${totalSessions} 个会话</span>
              </small>
            </div>
            <div class="console-header-actions">
              <button class="console-token-button" type="button" data-token-open title="Token 用量" aria-label="查看 Token 用量">
                ${icon("chart-bar")}
                <span data-token-total-label>${escapeHtml(formatTokenCount(tokenUsage.totalTokens))}</span>
              </button>
              <div class="console-menu-wrap">
                <button class="console-icon-button" type="button" data-console-menu-trigger title="更多" aria-label="更多" aria-haspopup="menu" aria-expanded="false">${icon("more-horizontal")}</button>
                <div class="console-menu-popover" data-console-menu role="menu" hidden>
                  <a href="/app/data" role="menuitem">${icon("database")}<span>数据</span></a>
                  <a href="/app/automations" role="menuitem">${icon("workflow")}<span>自动化</span></a>
                  <a href="/app/channels" role="menuitem">${icon("radio")}<span>渠道管理</span></a>
                  <a href="/app/skills" role="menuitem">${icon("book-open")}<span>技能清单</span></a>
                  <a href="/app/schedules" role="menuitem">${icon("calendar-clock")}<span>定时任务</span></a>
                  <a href="/app/update" role="menuitem">${icon("rotate-cw")}<span>更新与回滚</span></a>
                  <button type="button" data-refresh role="menuitem">${icon("rotate-cw")}<span>刷新</span></button>
                </div>
              </div>
            </div>
          </header>

          <div class="console-search">
            ${icon("search")}
            <input data-console-search type="search" autocomplete="off" placeholder="搜索聊天记录" aria-label="搜索聊天记录">
          </div>

          <main class="agent-bridge-app-content console-scroll">
            <div class="console-list" data-console-list>
              ${initialLoading ? renderConsoleLoading() : renderConsoleSessionsFragment(activeSessions, { empty: true })}
            </div>
            <button class="console-load-more" type="button" data-console-more data-next-cursor="${escapeAttr(pagination.nextCursor || "")}" data-page-size="${escapeAttr(String(pageSize))}" ${pagination.hasMore ? "" : "hidden"} aria-live="polite">
              <span class="console-loading-dot" aria-hidden="true"></span>
              <span data-console-more-label>加载更多</span>
            </button>
          </main>

          <a class="compose-fab wechat-only-hidden" href="/app/chat/new" aria-hidden="true" tabindex="-1">${icon("square-pen")}<span>聊天</span></a>
        </div>
      </section>
      ${renderTokenUsageDialog(tokenUsage)}
      <script>${consoleScript()}</script>
    `,
  });
}

function renderTokenUsageDialog(tokenUsage) {
  return `<dialog class="agent-bridge-theme task-dialog token-dialog" data-token-dialog aria-labelledby="token-dialog-title">
    <div class="task-dialog-content">
      <header class="task-dialog-header">
        <div>
          <span><i class="presence-dot online" aria-hidden="true"></i>服务运行中</span>
          <h2 id="token-dialog-title">Token 统计</h2>
        </div>
        <button class="task-dialog-close" type="button" data-token-close aria-label="关闭">${icon("x")}</button>
      </header>
      <div class="token-dialog-body">
        <nav class="token-range-tabs" aria-label="统计时间范围">
          ${[["today", "今日"], ["7d", "7 天"], ["30d", "30 天"]].map(([value, label]) => `<button type="button" data-token-range="${value}" aria-pressed="${tokenUsage.range === value ? "true" : "false"}">${label}</button>`).join("")}
        </nav>
        <section class="token-total-band">
          <div class="token-total-copy">
            <span data-token-range-label>${escapeHtml(tokenRangeLabel(tokenUsage.range))}</span>
            <strong data-token-value="totalTokens" data-token-format="compact">${escapeHtml(formatTokenCount(tokenUsage.totalTokens))}</strong>
            <small>Tokens consumed · <span data-token-updated>${escapeHtml(tokenUsage.updatedAt ? `更新于 ${formatTime(tokenUsage.updatedAt)}` : "暂无用量记录")}</span></small>
          </div>
          <div class="token-pulse" aria-hidden="true">${icon("activity")}<strong>Pulse</strong><span data-token-pulse-label>${escapeHtml(tokenRangeLabel(tokenUsage.range))}</span></div>
          <dl class="token-signal-metrics">
            ${tokenMetric("会话", "sessionCount", tokenUsage.sessionCount, "cyan")}
            ${tokenMetric("请求", "requestCount", tokenUsage.requestCount, "blue")}
            ${tokenMetric("缓存", "cacheRate", tokenUsage.cacheRate, "green", "%")}
          </dl>
        </section>
        <section class="token-breakdown">
          <div class="token-section-heading"><h3>Token 分项</h3><span data-token-error hidden>暂时无法刷新</span></div>
          <dl class="token-metrics">
            ${tokenMetric("输入", "inputTokens", tokenUsage.inputTokens, "cyan")}
            ${tokenMetric("缓存输入", "cachedInputTokens", tokenUsage.cachedInputTokens, "green")}
            ${tokenMetric("输出", "outputTokens", tokenUsage.outputTokens, "blue")}
            ${tokenMetric("推理输出", "reasoningOutputTokens", tokenUsage.reasoningOutputTokens, "violet")}
          </dl>
        </section>
        <section class="token-heatmap-section">
          <div class="token-section-heading"><div><h3>Token 热力图</h3><small>最近 12 周 · 每日增量</small></div><div class="token-heatmap-legend"><span>低</span><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>高</span></div></div>
          <div class="token-heatmap" data-token-heatmap>${renderTokenHeatmap(tokenUsage.dailyUsage)}</div>
        </section>
        <section class="token-recent">
          <div class="token-section-heading">
            <h3>最近会话</h3>
          </div>
          <div class="token-session-list" data-token-sessions>
            ${renderTokenSessionRows(tokenUsage.recentSessions)}
          </div>
        </section>
      </div>
    </div>
  </dialog>`;
}

function tokenMetric(label, key, value, accent = "cyan", suffix = "") {
  return `<div data-accent="${escapeAttr(accent)}"><dt>${escapeHtml(label)}</dt><dd><span data-token-value="${escapeAttr(key)}">${escapeHtml(formatTokenCount(value))}</span>${escapeHtml(suffix)}</dd></div>`;
}

function tokenRangeLabel(range) {
  return range === "30d" ? "最近 30 天" : range === "7d" ? "最近 7 天" : "今日";
}

function renderTokenHeatmap(days = []) {
  const values = Array.isArray(days) ? days : [];
  const maximum = Math.max(...values.map((day) => Number(day.totalTokens) || 0), 0);
  return values.map((day) => {
    const total = Number(day.totalTokens) || 0;
    const level = !total || !maximum ? 0 : Math.max(1, Math.min(4, Math.ceil((total / maximum) * 4)));
    return `<span data-token-day="${escapeAttr(day.day || "")}" data-level="${level}" title="${escapeAttr(`${day.day || ""} · ${formatTokenCount(total)} tokens`)}"></span>`;
  }).join("");
}

function renderTokenSessionRows(sessions = []) {
  if (!sessions.length) return `<div class="token-empty">暂无会话用量</div>`;
  return sessions.map((session) => `<a class="token-session-row" href="/app/chat/session/${encodeURIComponent(session.sessionId)}/live">
    <span><strong>${escapeHtml(session.title || "未命名会话")}</strong><small>${escapeHtml(session.threadCount === 1 ? "1 个线程" : `${session.threadCount} 个线程`)}</small></span>
    <span><b>${escapeHtml(formatTokenCount(session.totalTokens))}</b><time>${escapeHtml(timeAgo(session.updatedAt))}</time></span>
  </a>`).join("");
}

export function renderConsoleSessionsFragment(sessions, { empty = false, search = false } = {}) {
  if (sessions.length) {
    const groups = [
      { key: "main", label: "主会话", sessions: sessions.filter((session) => session.role === "main") },
      { key: "other", label: "其他会话", sessions: sessions.filter((session) => session.role !== "main") },
    ];
    return groups.filter((group) => group.sessions.length).map((group) => `<section class="console-session-group ${group.key === "main" ? "main-session-group" : ""}" data-console-session-group="${group.key}">
      <header class="console-session-group-heading"><strong>${group.label}</strong><span data-session-group-count>${group.sessions.length} 个</span></header>
      <div class="console-session-group-list" data-session-group-list>${group.sessions.map(renderConsoleSession).join("")}</div>
    </section>`).join("");
  }
  if (!empty) return "";
  return renderConsoleEmpty(search ? "没有匹配的聊天记录" : "暂无会话");
}

function renderConsoleLoading() {
  return `<div class="console-initial-loading" role="status" aria-label="正在加载会话">
    ${Array.from({ length: 5 }, (_, index) => `<div class="console-loading-row" style="--loading-index:${index}"><span class="console-loading-mark"></span><span class="console-loading-copy"><i></i><i></i></span><span class="console-loading-time"></span></div>`).join("")}
  </div>`;
}

export function renderNewSession({ workspaces = [], initialWorkspaceName = "", initialPrompt = "" }) {
  const selectedWorkspace = selectedWorkspaceForCompose(workspaces, initialWorkspaceName);
  const workspaceSelector = renderWorkspaceSelector(workspaces, selectedWorkspace);
  return layout({
    title: "新建对话 · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page compose-page">
        <div class="console-frame compose-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <span class="console-header-title">新建对话</span>
            <span class="console-header-spacer" aria-hidden="true"></span>
          </header>

          <main class="compose-main wechat-only-hidden" aria-hidden="true">
            ${workspaceSelector ? `<div class="selector-stack">${workspaceSelector}</div>` : ""}

            <form class="mobile-chat-prompt-input compose-prompt" data-new-session>
              <input type="hidden" name="workspaceName" value="${escapeAttr(selectedWorkspace?.name || "")}">
              <div class="prompt-input-body">
                <textarea class="chat-input-placeholder" name="content" rows="3" placeholder="向 Codex 提问" autofocus>${escapeHtml(initialPrompt)}</textarea>
              </div>
              <div class="prompt-input-footer">
                <div class="prompt-input-tools">
                  <button class="prompt-tool-button" type="button" title="添加" aria-label="添加">${icon("plus")}</button>
                  <span class="prompt-chip">${icon("sparkles")}<span>Codex</span></span>
                  <span class="prompt-chip">高度</span>
                </div>
                <div class="prompt-input-actions">
                  <button class="prompt-send-button" type="submit" aria-label="发送">${icon("send")}</button>
                </div>
              </div>
            </form>
            <p class="compose-error" data-compose-error hidden></p>
          </main>
        </div>
      </section>
      <script>${composeScript()}</script>
    `,
  });
}

export function renderCronPage({ tasks = [], workspaces = [] }) {
  const examplePrompt = "请帮我创建一个定时任务：每个工作日 9:00（Asia/Shanghai）整理项目待办，触发时通过微信通知我，并开启新的 Codex 会话。";
  return layout({
    title: "定时任务 · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page cron-page">
        <div class="console-frame cron-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <div class="console-title">
              <span>定时任务</span>
              <small>
                <i class="presence-dot online" aria-hidden="true"></i>
                <span>本机 · ${tasks.length} 个任务</span>
              </small>
            </div>
            <button class="console-icon-button" type="button" data-refresh title="刷新" aria-label="刷新">${icon("more-horizontal")}</button>
          </header>

          <main class="agent-bridge-app-content console-scroll cron-scroll">
            <section class="cron-agent-guide wechat-only-hidden" aria-hidden="true">
              <div class="cron-agent-guide-icon" aria-hidden="true">${icon("message-square")}</div>
              <div class="cron-agent-guide-copy">
                <strong>告诉 Agent 你想定时做什么</strong>
                <p>说明任务内容、触发时间和是否需要微信通知。任务周期最短为 15 分钟。</p>
                <blockquote>${escapeHtml(examplePrompt)}</blockquote>
              </div>
              <a class="cron-agent-guide-action" href="/app/chat/new?prompt=${encodeURIComponent(examplePrompt)}">${icon("message-square")}<span>告诉 Agent</span></a>
            </section>

            <div class="cron-list-heading"><strong>任务列表</strong><span>${tasks.length} 个</span></div>
            <div class="cron-list">
              ${tasks.length ? tasks.map(renderCronTask).join("") : renderCronEmpty()}
            </div>
          </main>
          ${renderTaskDetailDialog(workspaces)}
          ${renderTaskActionDialog()}
        </div>
      </section>
      <script>${cronScript()}</script>
    `,
  });
}

export function renderDataPage({ status = {}, selectedObject = "", result = null, operations = [], query = {} }) {
  const objects = Array.isArray(status.objects) ? status.objects : [];
  const selected = objects.find((object) => object.name === selectedObject) || objects[0] || null;
  const description = result?.object || null;
  const columns = description?.columns?.filter((column) => !column.hidden) || [];
  const rows = result?.rows || [];
  const page = result?.page || { number: 1, size: 50, totalRows: 0, totalPages: 1 };
  const queryString = (patch = {}) => {
    const values = { ...query, object: selected?.name || "", ...patch };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    return `/app/data?${params}`;
  };
  return layout({
    title: "数据 · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page data-page">
        <div class="console-frame data-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <div class="console-title"><span>数据</span><small>${escapeHtml(`${objects.length} 个对象 · ${formatFileSize(status.sizeBytes || 0)}`)}</small></div>
            <button class="console-icon-button data-catalog-trigger" type="button" data-data-catalog-trigger title="选择数据表" aria-label="选择数据表">${icon("table")}</button>
          </header>
          <main class="agent-bridge-app-content data-workspace">
            <aside class="data-catalog" aria-label="数据对象">
              <div class="data-catalog-heading"><strong>表与视图</strong><span>${objects.length}</span></div>
              ${renderDataCatalog(objects, selected?.name)}
              <div class="data-storage-status"><span>Schema v${escapeHtml(String(status.schemaVersion || 0))}</span><span>${escapeHtml(String(status.snapshotCount || 0))} 个快照</span></div>
            </aside>
            <section class="data-surface">
              ${selected ? `
                <div class="data-object-heading">
                  <div><span>${selected.type === "view" ? "视图" : "数据表"}</span><h1>${escapeHtml(selected.name)}</h1></div>
                  <dl><div><dt>记录</dt><dd>${escapeHtml(formatInteger(selected.rowCount || 0))}</dd></div><div><dt>字段</dt><dd>${escapeHtml(formatInteger(selected.columnCount || 0))}</dd></div></dl>
                </div>
                <form class="data-query-toolbar" method="get" action="/app/data">
                  <input type="hidden" name="object" value="${escapeAttr(selected.name)}">
                  <label class="data-search">${icon("search")}<input type="search" name="search" value="${escapeAttr(query.search || "")}" placeholder="搜索当前表" aria-label="搜索当前表"></label>
                  <button class="data-tool-button" type="button" data-data-filter-toggle aria-expanded="${query.field ? "true" : "false"}">${icon("filter")}<span>筛选</span></button>
                  <button class="data-tool-button" type="button" data-data-aggregate-toggle aria-expanded="${query.groupBy || query.metricField ? "true" : "false"}">${icon("chart-bar")}<span>聚合</span></button>
                  <div class="data-filter-row" data-data-filter-row ${query.field ? "" : "hidden"}>
                    <label><span>字段</span><select name="field"><option value="">选择字段</option>${columns.map((column) => `<option value="${escapeAttr(column.name)}" ${query.field === column.name ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("")}</select></label>
                    <label><span>条件</span><select name="operator">${dataOperatorOptions(query.operator)}</select></label>
                    <label class="data-filter-value"><span>值</span><input name="value" value="${escapeAttr(query.value || "")}" placeholder="筛选值"></label>
                  </div>
                  <div class="data-aggregate-row" data-data-aggregate-row ${query.groupBy || query.metricField ? "" : "hidden"}>
                    <label><span>分组</span><select name="groupBy"><option value="">不分组</option>${columns.map((column) => `<option value="${escapeAttr(column.name)}" ${query.groupBy === column.name ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("")}</select></label>
                    <label><span>函数</span><select name="metricFunction">${["count", "sum", "avg", "min", "max"].map((value) => `<option value="${value}" ${query.metricFunction === value ? "selected" : ""}>${value.toUpperCase()}</option>`).join("")}</select></label>
                    <label><span>字段</span><select name="metricField"><option value="">记录数</option>${columns.map((column) => `<option value="${escapeAttr(column.name)}" ${query.metricField === column.name ? "selected" : ""}>${escapeHtml(column.name)}</option>`).join("")}</select></label>
                  </div>
                  <input type="hidden" name="sortField" value="${escapeAttr(query.sortField || "")}">
                  <input type="hidden" name="sortDirection" value="${escapeAttr(query.sortDirection || "asc")}">
                  <button class="data-query-submit" type="submit">${icon("search")}<span>查询</span></button>
                  <a class="data-query-reset" href="/app/data?object=${encodeURIComponent(selected.name)}" title="清除查询" aria-label="清除查询">${icon("rotate-cw")}</a>
                </form>
                <div class="data-result-meta"><span>共 ${escapeHtml(formatInteger(page.totalRows))} 条</span>${query.groupBy || query.metricField ? `<span>聚合结果</span>` : ""}</div>
                ${renderDataGrid({ rows, columns: result?.columns || columns.map((column) => column.name), query, queryString })}
                ${renderDataPagination(page, queryString)}
              ` : `<div class="console-empty data-empty">${icon("database")}<strong>暂无结构化数据</strong><span>Agent 创建第一张表后会自动出现在这里。</span></div>`}
            </section>
            <aside class="data-activity" aria-label="最近数据操作">
              <div class="data-catalog-heading"><strong>最近操作</strong><span>${operations.length}</span></div>
              ${operations.length ? operations.slice(0, 12).map((operation) => `<div class="data-operation"><span class="data-operation-kind">${escapeHtml(operation.kind)}</span><strong>${escapeHtml(operation.status)}</strong><small>${escapeHtml(operation.schemaChanged ? "Schema 已变化" : operation.actor)} · ${escapeHtml(timeAgo(operation.createdAt))}</small></div>`).join("") : `<p class="data-side-empty">暂无操作</p>`}
            </aside>
          </main>
          ${renderDataCatalogSheet(objects, selected?.name)}
          ${renderDataRecordDialog()}
        </div>
      </section>
      <script>${dataPageScript(rows)}</script>
    `,
  });
}

export function renderAutomationPage({ sources = [], rules = [], events = [], runs = [], templates = [], policies = [], totals = {}, protection = {} }) {
  const runTotal = Number(totals.runs ?? runs.length);
  return layout({
    title: "自动化 · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page automation-page">
        <div class="console-frame automation-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <div class="console-title"><span>自动化</span><small>${escapeHtml(`${rules.filter((rule) => rule.enabled).length} 个运行中 · ${sources.length} 个来源`)}</small></div>
            <span class="console-header-spacer" aria-hidden="true"></span>
          </header>
          <nav class="automation-tabs" aria-label="自动化视图">
            ${[["rules", "自动化", rules.length], ["sources", "来源", sources.length], ["runs", "运行", runTotal], ["protection", "防护", protection.mail?.policyCount ?? policies.length], ["templates", "模板", templates.length]].map(([value, label, count], index) => `<button type="button" data-automation-tab="${value}" aria-pressed="${index === 0 ? "true" : "false"}"><span>${label}</span><small>${count}</small></button>`).join("")}
          </nav>
          <main class="agent-bridge-app-content automation-scroll">
            <section data-automation-panel="rules">
              <div class="automation-list-heading"><strong>Agent 关注规则</strong><span>只读 · 通过对话调整</span></div>
              <div class="automation-list">${rules.length ? rules.map((rule) => renderAutomationRule(rule, sources)).join("") : renderAutomationEmpty("暂无自动化规则")}</div>
            </section>
            <section data-automation-panel="sources" hidden>
              <div class="automation-list-heading"><strong>信息来源</strong><span>渠道与健康状态</span></div>
              <div class="automation-list">${sources.length ? sources.map(renderAutomationSource).join("") : renderAutomationEmpty("暂无信息来源")}</div>
            </section>
            <section data-automation-panel="runs" hidden>
              <div class="automation-list-heading"><strong>最近运行</strong><span>${escapeHtml(String(totals.events ?? events.length))} 个事件</span></div>
              <div class="automation-list" data-automation-runs>${runs.length ? renderAutomationRunsFragment(runs, rules, events) : renderAutomationEmpty("暂无运行记录")}</div>
              <button class="automation-load-more" type="button" data-automation-more data-offset="${runs.length}" data-total="${runTotal}" ${runs.length < runTotal ? "" : "hidden"}><span class="console-loading-dot" aria-hidden="true"></span><span data-automation-more-label>下滑加载更多</span></button>
            </section>
            <section data-automation-panel="protection" hidden>
              <div class="automation-list-heading"><strong>邮件与并发防护</strong><span>系统自动执行 · Agent 可审计调整</span></div>
              ${renderAutomationProtection(protection, policies)}
            </section>
            <section data-automation-panel="templates" hidden>
              <div class="automation-list-heading"><strong>解析模板</strong><span>版本与健康状态</span></div>
              <div class="automation-list">${templates.length ? templates.map(renderAutomationTemplate).join("") : renderAutomationEmpty("暂无解析模板")}</div>
            </section>
          </main>
        </div>
      </section>
      <script>${automationPageScript()}</script>
    `,
  });
}

export function renderSkillCatalogPage({ categories = [], skills = [] }) {
  const groups = categories.map((category) => ({
    ...category,
    skills: skills.filter((skill) => skill.category === category.id),
  })).filter((group) => group.skills.length);
  return layout({
    title: "技能清单 · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page skill-page">
        <div class="console-frame skill-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <div class="console-title">
              <span>技能清单</span>
              <small><i class="presence-dot online" aria-hidden="true"></i><span>当前工作区 · ${skills.length} 个技能</span></small>
            </div>
            <span class="skill-count" aria-label="${skills.length} 个技能">${escapeHtml(String(skills.length))}</span>
          </header>
          <main class="agent-bridge-app-content console-scroll skill-scroll">
            <label class="skill-search">
              ${icon("search")}
              <input type="search" data-skill-search autocomplete="off" placeholder="搜索技能" aria-label="搜索技能">
            </label>
            <div class="skill-groups" data-skill-groups>
              ${groups.map(renderSkillGroup).join("")}
            </div>
            <div class="skill-empty" data-skill-empty hidden>没有匹配的技能</div>
          </main>
          ${renderSkillDetailSheet()}
        </div>
      </section>
      <script>${skillCatalogScript()}</script>
    `,
  });
}

export function renderReleaseNotesPage({ releases = [], selectedRelease = null } = {}) {
  const selectedId = selectedRelease?.releaseId || "";
  return layout({
    title: "Release Notes · Agent Bridge",
    body: `
      <section class="agent-bridge-app-viewport agent-bridge-theme console-page release-notes-page">
        <div class="console-frame release-notes-frame">
          <header class="console-header">
            ${consoleBackButtons()}
            <div class="console-title">
              <span>Release Notes</span>
              <small><i class="presence-dot online" aria-hidden="true"></i><span>${releases.length} accepted release${releases.length === 1 ? "" : "s"}</span></small>
            </div>
            <span class="console-header-spacer" aria-hidden="true"></span>
          </header>
          <main class="release-notes-workspace">
            <nav class="release-notes-list" aria-label="Release history">
              <div class="release-notes-list-heading"><span>History</span><strong>${escapeHtml(String(releases.length))}</strong></div>
              ${releases.length ? releases.map((release) => renderReleaseNotesListItem(release, release.releaseId === selectedId)).join("") : `<div class="release-notes-empty">${icon("file-text")}<strong>No releases recorded</strong><span>The next accepted production release will appear here.</span></div>`}
            </nav>
            <div class="release-notes-detail-wrap">
              ${selectedRelease ? renderReleaseNotesDetail(selectedRelease) : `<div class="release-notes-empty release-notes-empty-main">${icon("file-text")}<strong>No release selected</strong><span>Accepted release details are stored on this Node.</span></div>`}
            </div>
          </main>
        </div>
      </section>
    `,
  });
}

function renderReleaseNotesListItem(release, selected) {
  return `<a class="release-notes-list-item${selected ? " selected" : ""}" href="/app/releases/${encodeURIComponent(release.releaseId)}" ${selected ? 'aria-current="page"' : ""}>
    <span class="release-list-status" aria-hidden="true"></span>
    <span class="release-list-copy"><strong>${escapeHtml(release.summary)}</strong><small>${escapeHtml(release.releaseId)}</small></span>
    <time datetime="${escapeAttr(release.releasedAt)}">${escapeHtml(formatReleaseDate(release.releasedAt))}</time>
  </a>`;
}

function renderReleaseNotesDetail(release) {
  return `<article class="release-notes-detail" data-release-id="${escapeAttr(release.releaseId)}">
    <header class="release-detail-header">
      <div class="release-detail-kicker"><span>${icon("check")} Accepted</span><time datetime="${escapeAttr(release.releasedAt)}">${escapeHtml(formatReleaseDateTime(release.releasedAt))}</time></div>
      <h1>${escapeHtml(release.summary)}</h1>
      <p>Immutable production artifact verified on the private Site Node.</p>
    </header>
    <dl class="release-detail-meta">
      <div><dt>Release</dt><dd><code>${escapeHtml(release.releaseId)}</code></dd></div>
      <div><dt>Source commit</dt><dd><code>${escapeHtml(release.commit)}</code></dd></div>
      <div><dt>Previous release</dt><dd>${release.previousReleaseId ? `<code>${escapeHtml(release.previousReleaseId)}</code>` : "First recorded release"}</dd></div>
      <div><dt>Artifact built</dt><dd><time datetime="${escapeAttr(release.builtAt)}">${escapeHtml(formatReleaseDateTime(release.builtAt))}</time></dd></div>
    </dl>
    <section class="release-detail-section">
      <div class="release-section-title"><span>Changes</span><strong>${release.changes.length}</strong></div>
      <ol class="release-change-list">${release.changes.map((change) => `<li><code>${escapeHtml(change.commit.slice(0, 8))}</code><span>${escapeHtml(change.subject)}</span></li>`).join("")}</ol>
    </section>
    <section class="release-detail-section">
      <div class="release-section-title"><span>Acceptance checks</span><strong>${release.checks.length}</strong></div>
      <ul class="release-check-list">${release.checks.map((check) => `<li>${icon("check")}<span>${escapeHtml(check)}</span></li>`).join("")}</ul>
    </section>
    <section class="release-detail-section">
      <div class="release-section-title"><span>Affected services</span><strong>${release.services.length}</strong></div>
      <ul class="release-service-list">${release.services.map((service) => `<li>${escapeHtml(service)}</li>`).join("")}</ul>
    </section>
  </article>`;
}

function formatReleaseDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function formatReleaseDateTime(value) {
  return `${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value))} GMT+8`;
}

export function renderSessionDetail({ session }) {
  return layout({
    title: `${session.title} · Agent Bridge`,
    body: `
      <section class="agent-bridge-app-viewport session-page" data-session-id="${escapeAttr(session.id)}">
        <div class="agent-bridge-theme agent-bridge-mobile-chat">
          <header class="mobile-chat-topbar">
            <div class="mobile-chat-topbar-inner">
              <span class="mobile-chat-leading">${siteHomeButton("mobile-chat-icon-button ghost")}<a class="mobile-chat-icon-button ghost" href="/app/chat" data-session-back title="返回对话" aria-label="返回对话">${icon("arrow-left")}</a></span>
              <div class="mobile-chat-title">
                <div class="mobile-chat-title-row">
                  <h1 class="session-name-mobile">${escapeHtml(conciseTitle(session.title))}</h1>
                </div>
                <div class="mobile-chat-subtitle">
                  <span class="truncate">${escapeHtml(workspaceNameFromSession(session))}</span>
                  <span class="meta-dot" aria-hidden="true"></span>
                  <span>${escapeHtml(statusLabel(session.status))}</span>
                  <span class="hide-xs">${escapeHtml(session.role === "main" ? "主会话" : "子会话")}</span>
                </div>
              </div>
              <button class="mobile-chat-icon-button ghost wechat-only-hidden" data-stop title="停止" aria-label="停止" aria-hidden="true" tabindex="-1">${icon("square")}</button>
            </div>
          </header>
          <main class="chat-surface">
            ${session.childSessions.length ? `<nav class="child-strip">${session.childSessions.map((child) => `<a href="/app/chat/session/${escapeAttr(child.id)}/live"><span>${escapeHtml(child.title)}</span><small>${escapeHtml(statusLabel(child.status))}</small></a>`).join("")}</nav>` : ""}
            <div class="mobile-chat-messages" data-messages>
              ${renderMessagesFragment({ session })}
            </div>
          </main>
          <footer class="mobile-chat-composer wechat-only-hidden" aria-hidden="true">
            <div class="mobile-chat-composer-inner">
              <form class="mobile-chat-prompt-input" data-composer>
                <div class="prompt-input-body">
                  <textarea class="chat-input-placeholder" name="content" rows="2" placeholder="${session.status === "running" ? "跟进..." : "继续这个会话"}"></textarea>
                </div>
                <div class="prompt-input-footer">
                  <div class="prompt-input-tools">
                    <button class="prompt-tool-button" type="button" title="添加" aria-label="添加">${icon("plus")}</button>
                    <span class="prompt-chip">${icon("sparkles")}<span>Codex</span></span>
                    <span class="prompt-chip">高度</span>
                  </div>
                  <div class="prompt-input-actions">
                    <span class="status-chip">${escapeHtml(statusLabel(session.status))}</span>
                    <button class="prompt-send-button" type="submit" aria-label="发送">${icon("send")}</button>
                  </div>
                </div>
              </form>
            </div>
          </footer>
        </div>
      </section>
      <script>${sessionScript()}</script>
    `,
  });
}

export function renderMessagesFragment({ session }) {
  const visibleMessages = session.messages.filter((message) => !isSystemRole(message) && !isInternalHookMessage(message));
  return visibleMessages.length
    ? `<div class="message-stream">${visibleMessages.map(renderMessage).join("")}</div>`
    : `<div class="empty-session-state">等待 Codex 输出。</div>`;
}

export function renderPagesIndex({ assets }) {
  const publicAssets = assets.map((asset) => ({
    ...asset,
    href: `/public${String(asset.publicPath || "").startsWith("/") ? asset.publicPath : `/${asset.publicPath || ""}`}`,
  }));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>公开页面 · Personal Agent</title>
  <style>
    :root{--paper:#f3f5f1;--surface:#fffefa;--ink:#18201d;--muted:#69736e;--line:#dce2dd;--forest:#17634d;--coral:#c9583b;--shadow:0 22px 70px rgba(24,32,29,.09)}
    *{box-sizing:border-box}html{min-height:100%;background:var(--paper)}body{min-height:100vh;margin:0;color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:radial-gradient(circle at 8% 4%,rgba(201,88,59,.12),transparent 28rem),radial-gradient(circle at 92% 0,rgba(23,99,77,.12),transparent 32rem),var(--paper)}
    a{color:inherit}.shell{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:28px 0 56px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:inline-flex;align-items:center;gap:12px;text-decoration:none;font-weight:760;letter-spacing:-.02em}.brand-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:11px;color:#fff;background:var(--forest);box-shadow:0 8px 20px rgba(23,99,77,.2)}.brand-mark svg{width:19px;height:19px}.workspace-link{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:rgba(255,254,250,.8);font-size:14px;font-weight:650;text-decoration:none}.workspace-link:hover{border-color:#aab8b0;background:#fff}
    .hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,.75fr);gap:28px;align-items:end;padding:88px 0 42px}.eyebrow{display:flex;align-items:center;gap:9px;margin:0 0 18px;color:var(--forest);font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow::before{content:"";width:24px;height:2px;background:var(--coral)}h1{max-width:720px;margin:0;font-family:Georgia,"Noto Serif SC",serif;font-size:clamp(44px,7vw,82px);font-weight:500;line-height:.98;letter-spacing:-.055em}.lede{max-width:620px;margin:24px 0 0;color:var(--muted);font-size:18px;line-height:1.75}.privacy-note{padding:22px 24px;border:1px solid rgba(23,99,77,.18);border-radius:22px;background:rgba(255,254,250,.65);color:var(--muted);font-size:14px;line-height:1.7}.privacy-note strong{display:block;margin-bottom:6px;color:var(--ink);font-size:15px}
    .collection{overflow:hidden;border:1px solid var(--line);border-radius:28px;background:var(--surface);box-shadow:var(--shadow)}.collection-head{display:flex;align-items:end;justify-content:space-between;gap:18px;padding:26px 28px;border-bottom:1px solid var(--line)}.collection-head h2{margin:0;font-size:20px;letter-spacing:-.025em}.count{color:var(--muted);font-size:13px}.asset-list{display:grid}.asset{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:21px 28px;border-bottom:1px solid var(--line);text-decoration:none;transition:background .18s ease}.asset:last-child{border-bottom:0}.asset:hover{background:#f7faf7}.asset-name{display:flex;align-items:center;gap:14px;min-width:0}.asset-icon{display:grid;flex:0 0 auto;width:42px;height:42px;place-items:center;border-radius:13px;color:var(--forest);background:#eaf2ed;font-weight:800}.asset-path{min-width:0}.asset-path strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.asset-path span{display:block;overflow:hidden;margin-top:5px;color:var(--muted);font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.asset-time{color:var(--muted);font-size:13px;white-space:nowrap}.empty{padding:64px 28px;text-align:center;color:var(--muted)}.empty strong{display:block;margin-bottom:8px;color:var(--ink);font-size:17px}.footer{display:flex;justify-content:space-between;gap:20px;padding:26px 4px 0;color:var(--muted);font-size:12px}
    @media(max-width:760px){.shell{width:min(100% - 24px,1120px);padding-top:18px}.topbar{align-items:flex-start}.workspace-link span{display:none}.hero{grid-template-columns:1fr;padding:64px 4px 32px}.privacy-note{padding:18px}.collection{border-radius:22px}.collection-head,.asset{padding-left:20px;padding-right:20px}.asset{grid-template-columns:minmax(0,1fr)}.asset-time{padding-left:56px}.footer{display:block;line-height:1.8}}
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/public" aria-label="Personal Agent 公开页面"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2.7 14.5 9l6.3 2.5-6.3 2.5L12 20.3 9.5 14l-6.3-2.5L9.5 9 12 2.7Z" fill="currentColor"/></svg></span><span>Personal Agent</span></a>
      <a class="workspace-link" href="/"><span>进入私人工作台</span><b aria-hidden="true">→</b></a>
    </header>
    <section class="hero">
      <div><p class="eyebrow">Public pages</p><h1>公开页面</h1><p class="lede">这里展示所有者明确发布的内容。每个页面都拥有可直接分享的公开地址。</p></div>
      <aside class="privacy-note"><strong>公开与私密相互隔离</strong>只有 <code>/public</code> 下的内容无需登录；工作台、设置和私人数据始终需要密码。</aside>
    </section>
    <section class="collection" aria-labelledby="collection-title">
      <div class="collection-head"><h2 id="collection-title">已发布内容</h2><span class="count">${publicAssets.length} 个页面</span></div>
      <div class="asset-list">${publicAssets.length ? publicAssets.map((asset) => `<a class="asset" href="${escapeAttr(asset.href)}"><span class="asset-name"><span class="asset-icon" aria-hidden="true">↗</span><span class="asset-path"><strong>${escapeHtml(String(asset.publicPath || "").split("/").filter(Boolean).pop() || "公开页面")}</strong><span>${escapeHtml(asset.href)}</span></span></span><time class="asset-time">${escapeHtml(formatTime(asset.updatedAt))}</time></a>`).join("") : `<div class="empty"><strong>暂时还没有公开页面</strong><span>从工作台发布后，内容会出现在这里。</span></div>`}</div>
    </section>
    <footer class="footer"><span>由 Personal Agent 安全发布</span><span>公开内容无需登录 · 其他区域需要密码</span></footer>
  </div>
</body>
</html>`;
}

export function renderPrivateFilePreview({ fileName, rawUrl, mimeType, sizeBytes = 0, kind = "download", textContent = "" }) {
  const safeName = escapeHtml(fileName || "微信文件");
  const safeRawUrl = escapeAttr(rawUrl);
  const preview = kind === "image"
    ? `<img class="private-preview-image" src="${safeRawUrl}" alt="${safeName}">`
    : kind === "pdf"
      ? `<iframe class="private-preview-frame" src="${safeRawUrl}" title="${safeName}"></iframe>`
      : kind === "video"
        ? `<video class="private-preview-media" src="${safeRawUrl}" controls preload="metadata"></video>`
        : kind === "audio"
          ? `<audio class="private-preview-audio" src="${safeRawUrl}" controls preload="metadata"></audio>`
          : kind === "text"
            ? `<pre class="private-preview-text">${escapeHtml(textContent)}</pre>`
            : `<div class="private-preview-fallback">${icon("file-text")}<strong>此格式请下载后查看</strong><span>文件仍受私密认证保护。</span></div>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; frame-src 'self'">
  <title>${safeName} · 私密预览</title>
  <style>
    :root{color-scheme:light;--paper:#f7eedb;--surface:#fffaf0;--ink:#261f1a;--muted:#73685c;--line:#c8b99d;--red:#d8492f;--green:#486052;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--paper);color:var(--ink)}.private-preview-page{width:min(100%,72rem);min-height:100dvh;margin:auto;display:flex;flex-direction:column}.private-preview-header{min-height:4rem;display:flex;align-items:center;gap:.8rem;border-bottom:1px solid var(--ink);padding:.65rem 1rem}.private-preview-home,.private-preview-mark{width:2.2rem;height:2.2rem;display:grid;place-items:center;font-weight:800;text-decoration:none}.private-preview-home{border:1px solid var(--green);color:var(--green)}.private-preview-mark{border:2px solid var(--red);color:var(--red);font-family:"Songti SC",serif}.private-preview-copy{min-width:0;flex:1;display:grid;gap:.1rem}.private-preview-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem}.private-preview-copy span{color:var(--muted);font-size:11px}.private-preview-download{height:2.35rem;border:1px solid var(--green);border-radius:4px;color:#fff;background:var(--green);display:inline-flex;align-items:center;padding:0 .8rem;text-decoration:none;font-size:.8rem;font-weight:700}.private-preview-stage{min-width:0;min-height:0;flex:1;display:grid;place-items:center;padding:1rem}.private-preview-image{display:block;max-width:100%;max-height:calc(100dvh - 7rem);object-fit:contain}.private-preview-frame{width:100%;height:calc(100dvh - 6.5rem);border:1px solid var(--line);background:#fff}.private-preview-media{display:block;width:min(100%,62rem);max-height:calc(100dvh - 8rem);background:#151515}.private-preview-audio{width:min(100%,36rem)}.private-preview-text{width:100%;max-height:calc(100dvh - 7rem);margin:0;overflow:auto;border:1px solid var(--line);background:var(--surface);padding:1rem;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.private-preview-fallback{display:grid;justify-items:center;gap:.55rem;color:var(--muted);text-align:center}.private-preview-fallback svg{width:2rem;height:2rem;color:var(--green)}.private-preview-fallback strong{color:var(--ink)}
    @media(max-width:640px){.private-preview-header{padding:.55rem .75rem}.private-preview-copy span{display:none}.private-preview-stage{padding:.75rem}.private-preview-download{padding:0 .65rem}}
  </style>
</head>
<body><main class="private-preview-page"><header class="private-preview-header"><a class="private-preview-home" href="/app" title="返回工作台" aria-label="返回工作台">A</a><span class="private-preview-mark">私</span><span class="private-preview-copy"><strong>${safeName}</strong><span>${escapeHtml(mimeType || "文件")}${sizeBytes ? ` · ${escapeHtml(formatFileSize(sizeBytes))}` : ""}</span></span><a class="private-preview-download" href="${safeRawUrl}?download=1">下载</a></header><section class="private-preview-stage">${preview}</section></main></body>
</html>`;
}

export function renderPrivateFileBatch({ title, createdAt, items = [] }) {
  const imageCount = items.filter((item) => item.kind === "image").length;
  const fileCount = items.length - imageCount;
  return layout({
    title: `${title} · 私密文件`,
    body: `
      <section class="private-batch-page agent-bridge-theme">
        <header class="private-batch-header">
          ${siteHomeButton()}
          <div><span>私密文件</span><h1>${escapeHtml(title)}</h1></div>
          <span class="private-batch-count">${escapeHtml(String(items.length))}</span>
        </header>
        <main class="private-batch-main">
          <div class="private-batch-summary">
            <strong>${escapeHtml([imageCount ? `图片 ${imageCount}` : "", fileCount ? `文件 ${fileCount}` : ""].filter(Boolean).join(" · "))}</strong>
            <time datetime="${escapeAttr(createdAt || "")}">${escapeHtml(createdAt ? timeAgo(createdAt) : "")}</time>
          </div>
          <div class="private-batch-list">
            ${items.map((item) => `<a class="private-batch-item" href="${escapeAttr(item.previewUrl)}">
              <span class="private-batch-reference">${escapeHtml(item.referenceName)}</span>
              <span class="private-batch-copy"><strong>${escapeHtml(item.fileName)}</strong><small>${escapeHtml(`${item.kind === "image" ? "图片" : "文件"} · ${formatFileSize(item.sizeBytes)}`)}</small></span>
              ${icon("chevron-right")}
            </a>`).join("")}
          </div>
        </main>
      </section>
    `,
  });
}

function renderDataCatalog(objects, selectedName) {
  if (!objects.length) return `<p class="data-side-empty">暂无表或视图</p>`;
  return `<nav class="data-catalog-list">${objects.map((object) => `<a href="/app/data?object=${encodeURIComponent(object.name)}" aria-current="${object.name === selectedName ? "page" : "false"}">
    <span class="data-object-icon">${icon(object.type === "view" ? "eye" : "table")}</span>
    <span><strong>${escapeHtml(object.name)}</strong><small>${escapeHtml(`${formatInteger(object.rowCount || 0)} 条 · ${object.columnCount} 字段`)}</small></span>
  </a>`).join("")}</nav>`;
}

function renderDataCatalogSheet(objects, selectedName) {
  return `<div class="memory-overlay memory-sheet data-catalog-sheet" data-data-catalog-sheet role="dialog" aria-modal="true" aria-labelledby="data-catalog-sheet-title" hidden>
    <div class="memory-sheet-content">
      <header class="memory-sheet-header"><div><span>数据</span><h2 id="data-catalog-sheet-title">选择表或视图</h2></div><button type="button" data-data-catalog-close aria-label="关闭">${icon("x")}</button></header>
      <div class="memory-sheet-options">${objects.length ? objects.map((object) => `<a class="memory-sheet-option" href="/app/data?object=${encodeURIComponent(object.name)}" aria-current="${object.name === selectedName ? "page" : "false"}"><span class="memory-sheet-option-mark">${icon(object.type === "view" ? "eye" : "table")}</span><span><strong>${escapeHtml(object.name)}</strong><small>${escapeHtml(`${formatInteger(object.rowCount || 0)} 条记录 · ${object.columnCount} 个字段`)}</small></span></a>`).join("") : `<p class="memory-sheet-empty">暂无数据对象</p>`}</div>
    </div>
  </div>`;
}

function renderDataGrid({ rows, columns, query, queryString }) {
  if (!rows.length) return `<div class="console-empty data-empty"><strong>没有匹配的记录</strong><span>调整筛选条件后再试。</span></div>`;
  return `<div class="data-grid-scroll"><table class="data-grid"><thead><tr>${columns.map((column) => {
    const direction = query.sortField === column && query.sortDirection === "asc" ? "desc" : "asc";
    return `<th scope="col"><a href="${escapeAttr(queryString({ sortField: column, sortDirection: direction, page: 1 }))}"><span>${escapeHtml(column)}</span>${query.sortField === column ? icon(query.sortDirection === "desc" ? "arrow-down" : "arrow-up") : ""}</a></th>`;
  }).join("")}<th class="data-row-action" aria-label="详情"></th></tr></thead><tbody data-data-rows>${renderDataRowsFragment(rows, columns)}</tbody></table></div>`;
}

export function renderDataRowsFragment(rows = [], columns = []) {
  return rows.map((row, index) => `<tr>${columns.map((column) => `<td data-label="${escapeAttr(column)}">${renderDataValue(row[column])}</td>`).join("")}<td class="data-row-action"><button type="button" data-data-row="${index}" title="查看记录" aria-label="查看第 ${index + 1} 条记录">${icon("chevron-right")}</button></td></tr>`).join("");
}

function renderDataValue(value) {
  if (value === null || value === undefined) return `<span class="data-null">NULL</span>`;
  if (typeof value === "object") return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
  if (typeof value === "number") return `<span class="data-number">${escapeHtml(String(value))}</span>`;
  if (typeof value === "boolean") return value ? "是" : "否";
  return `<span>${escapeHtml(String(value))}</span>`;
}

function renderDataPagination(page, queryString) {
  if (!page || page.totalPages <= 1) return `<div class="data-pagination" data-data-pagination data-has-more="false"><span data-data-page-label>第 1 / 1 页</span></div>`;
  return `<nav class="data-pagination" data-data-pagination data-has-more="${page.number < page.totalPages ? "true" : "false"}" aria-label="数据分页">
    <a href="${escapeAttr(queryString({ page: Math.max(page.number - 1, 1) }))}" aria-disabled="${page.number <= 1}">${icon("arrow-left")}<span>上一页</span></a>
    <span data-data-page-label>第 ${escapeHtml(formatInteger(page.number))} / ${escapeHtml(formatInteger(page.totalPages))} 页</span>
    <a data-data-next href="${escapeAttr(queryString({ page: Math.min(page.number + 1, page.totalPages) }))}" aria-disabled="${page.number >= page.totalPages}"><span>下一页</span>${icon("chevron-right")}</a>
  </nav>`;
}

function renderDataRecordDialog() {
  return `<dialog class="agent-bridge-theme task-dialog data-record-dialog" data-data-record-dialog aria-labelledby="data-record-title">
    <div class="task-dialog-content"><header class="task-dialog-header"><div><span>数据记录</span><h2 id="data-record-title">记录详情</h2></div><button class="task-dialog-close" type="button" data-data-record-close aria-label="关闭">${icon("x")}</button></header><dl class="data-record-fields" data-data-record-fields></dl></div>
  </dialog>`;
}

function dataOperatorOptions(selected) {
  const options = [["eq", "等于"], ["ne", "不等于"], ["contains", "包含"], ["startsWith", "开头是"], ["endsWith", "结尾是"], ["gt", "大于"], ["gte", "大于等于"], ["lt", "小于"], ["lte", "小于等于"], ["isNull", "为空"], ["notNull", "不为空"]];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function dataPageScript(rows) {
  return `
const dataRows=${serializeForInlineScript(rows)};
const filterToggle=document.querySelector('[data-data-filter-toggle]');
const aggregateToggle=document.querySelector('[data-data-aggregate-toggle]');
const filterRow=document.querySelector('[data-data-filter-row]');
const aggregateRow=document.querySelector('[data-data-aggregate-row]');
filterToggle?.addEventListener('click',()=>{const open=filterRow.hidden;filterRow.hidden=!open;filterToggle.setAttribute('aria-expanded',String(open));});
aggregateToggle?.addEventListener('click',()=>{const open=aggregateRow.hidden;aggregateRow.hidden=!open;aggregateToggle.setAttribute('aria-expanded',String(open));});
const catalogSheet=document.querySelector('[data-data-catalog-sheet]');
document.querySelector('[data-data-catalog-trigger]')?.addEventListener('click',()=>{catalogSheet.hidden=false;document.documentElement.classList.add('memory-modal-open');});
document.querySelector('[data-data-catalog-close]')?.addEventListener('click',()=>{catalogSheet.hidden=true;document.documentElement.classList.remove('memory-modal-open');});
catalogSheet?.addEventListener('click',(event)=>{if(event.target===catalogSheet){catalogSheet.hidden=true;document.documentElement.classList.remove('memory-modal-open');}});
const recordDialog=document.querySelector('[data-data-record-dialog]');
const recordFields=document.querySelector('[data-data-record-fields]');
document.querySelector('[data-data-rows]')?.addEventListener('click',(event)=>{const button=event.target.closest('[data-data-row]');if(!button)return;const row=dataRows[Number(button.dataset.dataRow)]||{};recordFields.innerHTML=Object.entries(row).map(([key,value])=>'<div><dt>'+escapeDataHtml(key)+'</dt><dd>'+escapeDataHtml(value===null?'NULL':typeof value==='object'?JSON.stringify(value,null,2):String(value))+'</dd></div>').join('');if(typeof recordDialog.showModal==='function')recordDialog.showModal();else recordDialog.setAttribute('open','');});
document.querySelector('[data-data-record-close]')?.addEventListener('click',()=>recordDialog.close?.());
const dataPagination=document.querySelector('[data-data-pagination]');
const mobileData=window.matchMedia('(max-width:767px)');
let loadingDataPage=false;
async function loadNextDataPage(){if(!mobileData.matches||loadingDataPage||dataPagination?.dataset.hasMore!=='true')return;const next=dataPagination.querySelector('[data-data-next]');if(!next||next.getAttribute('aria-disabled')==='true')return;loadingDataPage=true;dataPagination.dataset.loading='true';const label=dataPagination.querySelector('[data-data-page-label]');if(label)label.textContent='正在加载更多';try{const url=new URL(next.href,location.href);url.searchParams.set('fragment','rows');const response=await fetch(url,{headers:{accept:'application/json'},cache:'no-store'});const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.error||response.statusText);const holder=document.createElement('tbody');holder.innerHTML=result.html||'';const items=Array.from(holder.children);const offset=dataRows.length;for(const [index,row] of (result.rows||[]).entries()){dataRows.push(row);const item=items[index];const button=item?.querySelector('[data-data-row]');if(button){button.dataset.dataRow=String(offset+index);button.setAttribute('aria-label','查看第 '+(offset+index+1)+' 条记录');}if(item)document.querySelector('[data-data-rows]')?.append(item);}dataPagination.dataset.hasMore=String(Boolean(result.hasMore));if(result.nextUrl){next.href=result.nextUrl;next.setAttribute('aria-disabled','false');}else next.setAttribute('aria-disabled','true');if(label)label.textContent=result.hasMore?'继续下滑加载':'已加载全部 '+dataRows.length+' 条';}catch(error){if(label)label.textContent='加载失败，继续下滑重试';}finally{loadingDataPage=false;dataPagination.dataset.loading='false';}}
if(dataPagination&&'IntersectionObserver'in window){const observer=new IntersectionObserver((entries)=>{if(entries.some((entry)=>entry.isIntersecting))void loadNextDataPage();},{root:document.querySelector('.data-workspace'),rootMargin:'180px 0px'});observer.observe(dataPagination);}
function escapeDataHtml(value){return String(value).replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}`;
}

function renderAutomationRule(rule, sources) {
  const source = sources.find((item) => item.id === rule.sourceId);
  return `<details class="automation-item"><summary><span class="automation-item-icon">${icon("workflow")}</span><span class="automation-item-copy"><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(`${source?.name || "全部来源"} · ${automationEventLabel(rule.eventType)} · v${rule.version}`)}</small></span><span class="automation-status ${rule.enabled ? "enabled" : "disabled"}">${rule.enabled ? "运行中" : "已停用"}</span>${icon("chevron-right")}</summary><div class="automation-detail"><p>${escapeHtml(rule.description || "暂无说明")}</p><div class="automation-definition-grid">${renderAutomationDefinition("关注条件", rule.conditions, "conditions")}${renderAutomationDefinition("后续动作", rule.action, "action")}${renderAutomationDefinition("权限范围", rule.permissions, "permissions")}</div><footer><span>更新于 ${escapeHtml(timeAgo(rule.updatedAt))}</span><span>用户只读</span></footer></div></details>`;
}

function renderAutomationSource(source) {
  return `<article class="automation-item automation-source"><div class="automation-source-row"><span class="automation-item-icon">${icon(source.kind === "email" ? "mail" : "radio")}</span><span class="automation-item-copy"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(`${source.kind} · ${source.accountRef || "未设置账户"}`)}</small></span><span class="automation-status ${source.enabled ? "enabled" : "disabled"}">${escapeHtml(source.enabled ? source.health : "已停用")}</span></div><dl class="automation-source-meta"><div><dt>能力</dt><dd>${escapeHtml(source.capabilities.join("、") || "无")}</dd></div><div><dt>敏感级别</dt><dd>${escapeHtml(source.sensitivity)}</dd></div><div><dt>最近事件</dt><dd>${escapeHtml(source.lastEventAt ? timeAgo(source.lastEventAt) : "暂无")}</dd></div><div><dt>配置版本</dt><dd>v${escapeHtml(String(source.configVersion))}</dd></div></dl></article>`;
}

function renderAutomationRun(run, rules, events) {
  const rule = rules.find((item) => item.id === run.ruleId);
  const event = events.find((item) => item.id === run.eventId);
  return `<article class="automation-item automation-run"><div class="automation-source-row"><span class="automation-item-icon">${icon(run.matched ? "play" : "archive")}</span><span class="automation-item-copy"><strong>${escapeHtml(rule?.name || run.ruleId || "已删除规则")}</strong><small>${escapeHtml(event?.title || run.eventId || "无事件")} · ${escapeHtml(timeAgo(run.createdAt))}</small></span><span class="automation-status ${run.status === "failed" ? "failed" : run.matched ? "enabled" : "disabled"}">${escapeHtml(run.status)}</span></div><p class="automation-run-reason">${escapeHtml(run.reason || run.error || "暂无判断理由")}</p>${run.sessionId ? `<a class="automation-session-link" href="/app/chat/session/${escapeAttr(run.sessionId)}/live">查看 Agent 会话 ${icon("chevron-right")}</a>` : ""}</article>`;
}

export function renderAutomationRunsFragment(runs = [], rules = [], events = []) {
  return runs.map((run) => renderAutomationRun(run, rules, events)).join("");
}

function renderAutomationProtection(protection = {}, policies = []) {
  const concurrency = protection.concurrency || {};
  const mail = protection.mail || {};
  const limits = mail.limits || {};
  return `<div class="automation-protection">
    <section class="protection-metrics" aria-label="自动化保护状态">
      ${protectionMetric("今日邮件", mail.receivedCount || 0, `全局上限 ${limits.globalDailyLimit || "-"}`)}
      ${protectionMetric("已拦截", mail.suppressedCount || 0, `${mail.riskCount || 0} 封高风险`)}
      ${protectionMetric("活动任务", concurrency.active || 0, `并发上限 ${concurrency.limit || "-"}`)}
      ${protectionMetric("等待队列", concurrency.queued || 0, `队列上限 ${concurrency.queueLimit || "-"}`)}
    </section>
    <section class="protection-limits">
      <header><strong>分层日配额</strong><span>可信发件人仍受全局硬限制</span></header>
      <dl><div><dt>普通发件人</dt><dd>${escapeHtml(String(limits.senderDailyLimit || "-"))}</dd></div><div><dt>可信发件人</dt><dd>${escapeHtml(String(limits.trustedSenderDailyLimit || "-"))}</dd></div><div><dt>发件域</dt><dd>${escapeHtml(String(limits.domainDailyLimit || "-"))}</dd></div><div><dt>全部邮件</dt><dd>${escapeHtml(String(limits.globalDailyLimit || "-"))}</dd></div></dl>
    </section>
    <section class="protection-policies">
      <header><strong>发件人策略</strong><span>${mail.trustedCount || 0} 个可信 · ${mail.blockedCount || 0} 个阻断</span></header>
      <div class="automation-list">${policies.length ? policies.map(renderAutomationPolicy).join("") : `<p class="protection-empty">收到邮件后会在这里建立可审计的信誉策略。</p>`}</div>
    </section>
  </div>`;
}

function protectionMetric(label, value, note) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatInteger(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

function renderAutomationPolicy(policy) {
  const status = policy.policy === "blocked" ? "failed" : policy.policy === "trusted" ? "enabled" : "disabled";
  const label = policy.policy === "blocked" ? "已阻断" : policy.policy === "trusted" ? "可信" : "观察中";
  return `<article class="automation-item automation-policy"><div class="automation-source-row"><span class="automation-item-icon">${icon(policy.policy === "blocked" ? "shield-alert" : "shield-check")}</span><span class="automation-item-copy"><strong>${escapeHtml(policy.senderKey)}</strong><small>${escapeHtml(policy.reason || "自动信誉评估")}</small></span><span class="automation-status ${status}">${label}</span></div><dl class="automation-source-meta"><div><dt>来源</dt><dd>${policy.origin === "agent" ? "Agent 规则" : "自动识别"}</dd></div><div><dt>安全记录</dt><dd>${escapeHtml(formatInteger(policy.safeCount || 0))}</dd></div><div><dt>违规记录</dt><dd>${escapeHtml(formatInteger(policy.violationCount || 0))}</dd></div><div><dt>最近出现</dt><dd>${escapeHtml(timeAgo(policy.lastSeenAt))}</dd></div></dl></article>`;
}

function renderAutomationTemplate(template) {
  const total = template.successCount + template.failureCount;
  const successRate = total ? Math.round(template.successCount / total * 100) : 0;
  return `<article class="automation-item automation-source"><div class="automation-source-row"><span class="automation-item-icon">${icon("file-code")}</span><span class="automation-item-copy"><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(`${template.runtime} · v${template.version}`)}</small></span><span class="automation-status ${template.status === "active" ? "enabled" : "disabled"}">${escapeHtml(template.status)}</span></div><dl class="automation-source-meta"><div><dt>用途</dt><dd>${escapeHtml(template.purpose || "未说明")}</dd></div><div><dt>成功率</dt><dd>${successRate}%</dd></div><div><dt>指纹</dt><dd>${escapeHtml(template.sourceFingerprint || "未绑定")}</dd></div><div><dt>SHA-256</dt><dd>${escapeHtml(template.sha256 ? template.sha256.slice(0, 12) : "未记录")}</dd></div></dl></article>`;
}

function renderAutomationDefinition(title, value, kind) {
  const definition = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const iconName = kind === "conditions" ? "filter" : kind === "action" ? "play" : "check";
  const entries = Object.entries(definition).filter(([key, item]) => item !== undefined && !(kind === "conditions" && key === "matchAll"));
  const summary = kind === "conditions"
    ? definition.matchAll === true ? "同时满足以下条件" : definition.matchAll === false ? "满足任一条件" : "由 Agent 综合判断"
    : kind === "action" ? automationActionSummary(definition) : "Agent 执行时可使用的范围";
  return `<section class="automation-definition automation-definition-${kind}"><header><span class="automation-definition-icon">${icon(iconName)}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(summary)}</small></span></header><div class="automation-fields">${entries.length ? entries.map(([key, item]) => renderAutomationField(key, item, kind, 0)).join("") : `<p class="automation-field-empty">未配置额外项目</p>`}</div></section>`;
}

function renderAutomationField(key, value, kind, depth) {
  const label = automationFieldLabel(key);
  if (Array.isArray(value)) {
    const primitives = value.filter((item) => item === null || typeof item !== "object");
    const structured = value.filter((item) => item && typeof item === "object");
    return `<div class="automation-field"><dt>${escapeHtml(label)}</dt><dd>${primitives.length ? `<span class="automation-tag-list">${primitives.map((item) => `<span class="automation-tag">${escapeHtml(automationValueLabel(key, item, kind))}</span>`).join("")}</span>` : ""}${structured.length ? `<div class="automation-nested-list">${structured.map((item, index) => `<section><strong>${escapeHtml(automationItemTitle(item, index))}</strong>${renderAutomationObject(item, kind, depth + 1)}</section>`).join("")}</div>` : ""}${!value.length ? `<span class="automation-muted">无</span>` : ""}</dd></div>`;
  }
  if (value && typeof value === "object") {
    return `<div class="automation-field automation-field-group"><dt>${escapeHtml(label)}</dt><dd>${renderAutomationObject(value, kind, depth + 1)}</dd></div>`;
  }
  if (typeof value === "boolean") {
    const allowed = value === true;
    return `<div class="automation-field"><dt>${escapeHtml(label)}</dt><dd><span class="automation-permission ${allowed ? "allowed" : "blocked"}">${icon(allowed ? "check" : "x")}<span>${allowed ? "允许" : "不允许"}</span></span></dd></div>`;
  }
  return `<div class="automation-field"><dt>${escapeHtml(label)}</dt><dd><span class="automation-value">${escapeHtml(automationValueLabel(key, value, kind))}</span></dd></div>`;
}

function renderAutomationObject(value, kind, depth) {
  if (depth > 4) return `<span class="automation-muted">更深层配置由 Agent 管理</span>`;
  const entries = Object.entries(value || {}).filter(([, item]) => item !== undefined);
  return entries.length ? `<dl class="automation-nested">${entries.map(([key, item]) => renderAutomationField(key, item, kind, depth)).join("")}</dl>` : `<span class="automation-muted">未配置</span>`;
}

function automationItemTitle(value, index) {
  return value?.name || value?.label || value?.type && automationValueLabel("type", value.type, "action") || `第 ${index + 1} 项`;
}

function automationActionSummary(value) {
  if (!value?.type) return "命中后交由 Agent 决定";
  return automationValueLabel("type", value.type, "action");
}

function automationEventLabel(value) {
  const labels = { "message.received": "收到消息", "mail.received": "收到邮件", "file.received": "收到文件", "schedule.triggered": "定时触发" };
  return labels[value] || value || "任意事件";
}

function automationFieldLabel(key) {
  const labels = {
    semanticIntent: "关注意图", keywords: "关键词", keyword: "关键词", sender: "发件人", recipients: "收件人",
    subject: "主题", attachments: "附件", attachmentTypes: "附件类型", required: "是否必需", operator: "判断方式",
    value: "匹配内容", values: "匹配内容", anyOf: "任一条件", allOf: "全部条件", noneOf: "排除条件",
    type: "执行方式", prompt: "Agent 指令", workspace: "工作区", workspaceName: "工作区", queue: "任务队列",
    steps: "处理步骤", output: "产出", destination: "目标位置", readCurrentEvent: "读取当前事件",
    readAttachments: "读取附件", data: "数据权限", automationWrite: "修改自动化", writeData: "写入数据",
    createTables: "创建数据表", publishPages: "发布 Online Pages", notify: "发送通知", channel: "通知渠道",
  };
  if (labels[key]) return labels[key];
  return String(key || "配置项").replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function automationValueLabel(key, value, kind) {
  if (value === null || value === undefined || value === "") return "未设置";
  const text = String(value);
  const labels = {
    "agent-task": "创建 Agent 任务", "agent-analysis": "交由 Agent 分析", "store-data": "写入结构化数据",
    contains: "包含", equals: "等于", startsWith: "开头是", endsWith: "结尾是", matches: "符合模式",
    admin: "完全管理", read: "只读", write: "可读写", none: "不可访问", healthy: "正常", restricted: "受限",
  };
  if (labels[text]) return labels[text];
  if (kind === "permissions" && key === "data") return text === "admin" ? "完全管理" : text;
  return text;
}

function renderAutomationEmpty(message) {
  return `<div class="console-empty automation-empty">${icon("workflow")}<strong>${escapeHtml(message)}</strong><span>Agent 创建后会显示在这里。</span></div>`;
}

function automationPageScript() {
  return `
const automationMore=document.querySelector('[data-automation-more]');
for(const button of document.querySelectorAll('[data-automation-tab]'))button.addEventListener('click',()=>{for(const item of document.querySelectorAll('[data-automation-tab]'))item.setAttribute('aria-pressed',String(item===button));for(const panel of document.querySelectorAll('[data-automation-panel]'))panel.hidden=panel.dataset.automationPanel!==button.dataset.automationTab;if(button.dataset.automationTab==='runs')setTimeout(()=>automationMore?.scrollIntoView({block:'nearest'}),0);});
async function loadMoreAutomationRuns(){if(!automationMore||automationMore.hidden||automationMore.disabled)return;automationMore.disabled=true;automationMore.dataset.loading='true';const label=automationMore.querySelector('[data-automation-more-label]');if(label)label.textContent='正在加载';try{const offset=Number(automationMore.dataset.offset||0);const response=await fetch('/api/app/automations/runs?format=html&limit=20&offset='+offset,{headers:{accept:'application/json'},cache:'no-store'});const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.error||response.statusText);document.querySelector('[data-automation-runs]')?.insertAdjacentHTML('beforeend',result.html||'');const next=offset+(result.runs||[]).length;automationMore.dataset.offset=String(next);automationMore.hidden=!result.hasMore;if(label)label.textContent=result.hasMore?'下滑加载更多':'已加载全部';}catch(error){if(label)label.textContent='加载失败，点击重试';}finally{automationMore.disabled=false;automationMore.dataset.loading='false';}}
automationMore?.addEventListener('click',()=>void loadMoreAutomationRuns());
if(automationMore&&'IntersectionObserver'in window){const observer=new IntersectionObserver((entries)=>{const runsTab=document.querySelector('[data-automation-tab="runs"]');if(entries.some((entry)=>entry.isIntersecting)&&runsTab?.getAttribute('aria-pressed')==='true')void loadMoreAutomationRuns();},{root:document.querySelector('.automation-scroll'),rootMargin:'180px 0px'});observer.observe(automationMore);}`;
}

function serializeForInlineScript(value) {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function layout({ title, body }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <style>${styles()}${releaseNotesStyles()}</style>
</head>
<body>${body}</body>
</html>`;
}

function renderWorkspaceGroup(group, index) {
  const open = index === 0 || group.online || group.sessions.length > 0;
  const searchText = [group.name, group.workspace?.workspaceRoot, ...group.sessions.map((session) => sessionTitle(session))].join(" ");
  return `<details class="workspace-group" ${open ? "open" : ""} data-console-group data-search-text="${escapeAttr(searchText)}">
    <summary class="workspace-summary">
      <span class="workspace-symbol">${icon("package")}</span>
      <span class="workspace-copy">
        <span>${escapeHtml(group.name)}</span>
        <small>${escapeHtml(group.workspace?.workspaceRoot || "本机工作区")}</small>
      </span>
      <i class="presence-dot ${group.online ? "online" : ""}" aria-hidden="true"></i>
      ${group.sessions.length ? `<span class="session-count">${group.sessions.length}</span>` : ""}
      <span class="workspace-chevron">${icon("chevron-right")}</span>
    </summary>
    <div class="workspace-sessions">
      ${group.sessions.length ? group.sessions.map(renderConsoleSession).join("") : `<p class="workspace-empty">暂无会话</p>`}
    </div>
  </details>`;
}

function renderConsoleSession(session) {
  const title = sessionTitle(session);
  const workspace = workspaceNameFromSession(session);
  const searchText = `${title} ${workspace} ${session.status}`;
  return `<a class="console-session" href="/app/chat/session/${escapeAttr(session.id)}/live" data-console-session data-search-text="${escapeAttr(searchText)}">
    <i class="session-state ${escapeAttr(statusClass(session.status))}" aria-hidden="true"></i>
    <span class="console-session-copy">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(statusLabel(session.status))} · ${escapeHtml(workspace)}</small>
    </span>
    <time>${escapeHtml(timeAgo(session.updatedAt))}</time>
  </a>`;
}

function renderConsoleEmpty(title = "暂无会话") {
  return `<div class="console-empty">
    ${icon("message-square")}
    <strong>${escapeHtml(title)}</strong>
    <span>${title === "暂无会话" ? "点击右下角按钮开始一个 Codex 会话。" : ""}</span>
  </div>`;
}

function renderWorkspaceSelector(workspaces, selectedWorkspace) {
  if (workspaces.length > 1) {
    return `<label class="selector-row selector-row-select">
      ${icon("package")}
      <select data-workspace-select aria-label="选择工作区">
        ${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.name)}" ${workspace.name === selectedWorkspace?.name ? "selected" : ""}>${escapeHtml(workspace.name)}</option>`).join("")}
      </select>
    </label>`;
  }
  return "";
}

function renderCronTask(task) {
  return `<button class="cron-task-row" type="button" data-task-open
      data-task-id="${escapeAttr(task.id)}"
      data-task-name="${escapeAttr(task.name)}"
      data-task-cron="${escapeAttr(task.cron)}"
      data-task-timezone="${escapeAttr(task.timezone)}"
      data-task-workspace-name="${escapeAttr(task.workspaceName)}"
      data-task-recipient-id="${escapeAttr(task.recipientId)}"
      data-task-prompt="${escapeAttr(task.prompt)}"
      data-task-enabled="${task.enabled ? "1" : "0"}"
      data-task-run-count="${escapeAttr(String(task.runCount))}"
      data-task-next-run-at="${escapeAttr(task.nextRunAt || "")}"
      data-task-last-run-at="${escapeAttr(task.lastRunAt || "")}"
      data-task-last-session-id="${escapeAttr(task.lastSessionId || "")}"
      data-task-last-error="${escapeAttr(task.lastError || "")}"
      aria-label="查看任务 ${escapeAttr(task.name)}">
      <span class="cron-task-row-icon">${icon("calendar-clock")}</span>
      <span class="cron-task-copy">
        <strong>${escapeHtml(task.name)}</strong>
        <small>${escapeHtml(task.cron)} · ${escapeHtml(task.timezone)}${task.nextRunAt ? ` · 下次 ${escapeHtml(formatTime(task.nextRunAt))}` : ""}</small>
      </span>
      <span class="cron-task-status ${task.enabled ? "enabled" : "disabled"}">${task.enabled ? "启用" : "停用"}</span>
      <span class="workspace-chevron">${icon("chevron-right")}</span>
  </button>`;
}

function renderTaskDetailDialog(workspaces) {
  return `<dialog class="task-dialog wechat-only-hidden" data-task-dialog aria-labelledby="task-dialog-title">
    <div class="task-dialog-content">
      <header class="task-dialog-header">
        <div>
          <span>定时任务</span>
          <h2 id="task-dialog-title" data-task-dialog-name>任务详情</h2>
        </div>
        <button class="task-dialog-close" type="button" data-task-dialog-close title="关闭" aria-label="关闭">${icon("x")}</button>
      </header>
      <form class="cron-task-form task-dialog-form" data-task-form>
      <div class="cron-grid">
        <label><span>名称</span><input name="name" required></label>
        <label><span>Cron</span><input name="cron" required></label>
        <label><span>时区</span><select name="timezone">${timezoneOptions("Asia/Shanghai")}</select></label>
        <label><span>工作区</span><select name="workspaceName">${workspaceOptions(workspaces, "")}</select></label>
        <label><span>微信接收人</span><input name="recipientId" placeholder="留空使用最近联系人"></label>
      </div>
      <label class="cron-prompt"><span>任务内容</span><textarea name="prompt" required rows="4"></textarea></label>
      <div class="cron-meta">
        <span data-task-run-count></span>
        <span data-task-next-run></span>
        <span data-task-last-run></span>
        <a data-task-last-session hidden>上次会话</a>
        <span class="cron-error-text" data-task-last-error hidden></span>
      </div>
      <div class="cron-actions">
        <label class="cron-enabled"><input name="enabled" type="checkbox"><span>启用</span></label>
        <button class="cron-secondary" type="button" data-run-task>${icon("play")}<span>运行</span></button>
        <button class="cron-secondary danger" type="button" data-delete-task>${icon("trash-2")}<span>删除</span></button>
        <button class="cron-primary" type="submit">${icon("save")}<span>保存</span></button>
      </div>
      <p class="compose-error" data-task-error hidden></p>
      </form>
    </div>
  </dialog>`;
}

function renderCronEmpty() {
  return `<div class="console-empty">
    ${icon("calendar-clock")}
    <strong>暂无定时任务</strong>
    <span>告诉 Agent 你的计划，创建后的任务会显示在这里。</span>
  </div>`;
}

function renderTaskActionDialog() {
  return `<dialog class="alert-dialog wechat-only-hidden" data-action-dialog aria-labelledby="task-action-title" aria-describedby="task-action-description">
    <div class="alert-dialog-content">
      <div class="alert-dialog-icon" data-action-icon="delete" aria-hidden="true">${icon("trash-2")}</div>
      <div class="alert-dialog-icon run" data-action-icon="run" aria-hidden="true" hidden>${icon("play")}</div>
      <div class="alert-dialog-copy">
        <h2 id="task-action-title" data-action-title>确认操作</h2>
        <p id="task-action-description"><span data-action-description></span>“<strong data-action-task-name></strong>”</p>
      </div>
      <p class="alert-dialog-error" data-action-dialog-error hidden></p>
      <div class="alert-dialog-actions">
        <button class="alert-dialog-cancel" type="button" data-action-cancel>取消</button>
        <button class="alert-dialog-confirm" type="button" data-action-confirm data-variant="destructive"><span data-action-confirm-icon="delete">${icon("trash-2")}</span><span data-action-confirm-icon="run" hidden>${icon("play")}</span><span data-action-confirm-label>确认</span></button>
      </div>
    </div>
  </dialog>`;
}

function renderSkillGroup(group) {
  return `<section class="skill-group" data-skill-group>
    <header class="skill-group-heading">
      <span><strong>${escapeHtml(skillCategoryLabel(group.id, group.label))}</strong><small>${escapeHtml(group.label)}</small></span>
      <b data-skill-group-count>${group.skills.length}</b>
    </header>
    <div class="skill-list">
      ${group.skills.map((skill) => renderSkillRow(skill, group)).join("")}
    </div>
  </section>`;
}

function renderSkillRow(skill, category) {
  const maturity = skillMaturityLabel(skill.maturity);
  const searchText = `${skill.name} ${skill.description} ${category.label} ${skillCategoryLabel(category.id, category.label)}`;
  return `<button class="skill-row" type="button" data-skill-open
      data-skill-name="${escapeAttr(skill.name)}"
      data-skill-description="${escapeAttr(skill.description)}"
      data-skill-category="${escapeAttr(skillCategoryLabel(category.id, category.label))}"
      data-skill-maturity="${escapeAttr(maturity)}"
      data-skill-cli="${escapeAttr(skill.cli.join("、"))}"
      data-skill-related="${escapeAttr(skill.related.join("、"))}"
      data-search-text="${escapeAttr(searchText)}"
      aria-label="查看技能 ${escapeAttr(skill.name)}">
    <span class="skill-mark" aria-hidden="true">${escapeHtml(skillInitials(skill.name))}</span>
    <span class="skill-row-copy"><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span>
    <span class="skill-row-meta"><span>${escapeHtml(maturity)}</span>${icon("chevron-right")}</span>
  </button>`;
}

function renderSkillDetailSheet() {
  return `<div class="skill-detail-overlay" data-skill-detail role="dialog" aria-modal="true" aria-labelledby="skill-detail-title" hidden>
    <div class="skill-detail-sheet">
      <header class="skill-detail-header">
        <span class="skill-mark" data-skill-detail-mark aria-hidden="true">SK</span>
        <div><span data-skill-detail-category>技能</span><h2 id="skill-detail-title" data-skill-detail-name>技能详情</h2></div>
        <button type="button" data-skill-detail-close aria-label="关闭">${icon("x")}</button>
      </header>
      <div class="skill-detail-body">
        <p data-skill-detail-description></p>
        <dl class="skill-detail-meta">
          <div><dt>状态</dt><dd data-skill-detail-maturity></dd></div>
          <div data-skill-detail-cli-row hidden><dt>命令</dt><dd data-skill-detail-cli></dd></div>
          <div data-skill-detail-related-row hidden><dt>关联技能</dt><dd data-skill-detail-related></dd></div>
        </dl>
      </div>
    </div>
  </div>`;
}

function skillCategoryLabel(id, fallback) {
  return ({
    "research-knowledge": "研究与知识",
    "writing-content": "写作与内容",
    "visual-media": "视觉与媒体",
    "publishing-automation": "发布与自动化",
    "travel-location": "旅行与位置",
    "product-engineering": "产品与研发",
  })[id] || fallback || "其他";
}

function skillMaturityLabel(value) {
  return ({ stable: "稳定", beta: "测试中", experimental: "实验中" })[value] || value || "可用";
}

function skillInitials(name) {
  const parts = String(name || "skill").split(/[-_\s]+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map((part) => part[0]) : [parts[0]?.slice(0, 2)])
    .join("")
    .toUpperCase();
}

function workspaceOptions(workspaces, selectedName) {
  const options = workspaces.length ? workspaces : [{ name: "", workspaceRoot: "" }];
  return options.map((workspace) => `<option value="${escapeAttr(workspace.name || "")}" ${workspace.name === selectedName ? "selected" : ""}>${escapeHtml(workspace.name || "默认工作区")}</option>`).join("");
}

function timezoneOptions(selectedTimezone) {
  const common = ["Asia/Shanghai", "UTC", "local"];
  const values = common.includes(selectedTimezone) ? common : [selectedTimezone, ...common];
  return values.map((timezone) => `<option value="${escapeAttr(timezone)}" ${timezone === selectedTimezone ? "selected" : ""}>${escapeHtml(timezone === "local" ? "服务器本地时区" : timezone)}</option>`).join("");
}

function workspaceGroups(sessions, workspaces) {
  const groups = new Map();
  for (const workspace of workspaces) {
    groups.set(workspace.name, {
      name: workspace.name,
      workspace,
      online: workspaceOnline(workspace),
      sessions: [],
      updatedAt: workspace.updatedAt || "",
    });
  }
  for (const session of sessions) {
    const name = workspaceNameFromSession(session);
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        workspace: null,
        online: false,
        sessions: [],
        updatedAt: session.updatedAt || "",
      });
    }
    const group = groups.get(name);
    group.sessions.push(session);
    if (!group.updatedAt || new Date(session.updatedAt) > new Date(group.updatedAt)) group.updatedAt = session.updatedAt;
  }
  return Array.from(groups.values())
    .map((group) => ({ ...group, sessions: group.sessions.slice().sort(sortByUpdatedAt) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || dateValue(b.updatedAt) - dateValue(a.updatedAt) || a.name.localeCompare(b.name));
}

function selectedWorkspaceForCompose(workspaces, initialWorkspaceName) {
  const requested = String(initialWorkspaceName || "").trim();
  return workspaces.find((workspace) => workspace.name === requested)
    || workspaces[0]
    || null;
}

function workspaceOnline(workspace) {
  return Boolean(workspace && workspace.appServer?.status === "online");
}

function sessionTitle(session) {
  return conciseTitle(session.title || session.taskDescription || "新会话");
}

function sortByUpdatedAt(left, right) {
  return dateValue(right.updatedAt) - dateValue(left.updatedAt);
}

function dateValue(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function statusClass(status) {
  if (status === "running" || status === "start") return "online";
  if (status === "paused") return "warn";
  if (status === "archived") return "muted";
  return "";
}

function renderMessage(message, index, messages) {
  const previous = Array.isArray(messages) ? messages[index - 1] : null;
  const grouped = Boolean(previous && previous.role === message.role && !isSystemRole(previous) && sameMinute(previous.createdAt, message.createdAt));
  if (isSystemRole(message)) {
    return `<article class="chat-message mobile-chat-system-message ${escapeAttr(message.role)}" data-seq="${message.sequence}">
      <div class="system-message-row">
        ${grouped ? `<div class="role-icon-spacer" aria-hidden="true"></div>` : roleIcon(message.role)}
        <div class="system-message-copy">
          <div class="message-meta"><span>${escapeHtml(roleLabel(message.role))}</span><time>${escapeHtml(formatTime(message.createdAt))}</time></div>
          <p>${escapeHtml(message.content || "")}</p>
        </div>
      </div>
    </article>`;
  }
  const isUser = message.role === "user";
  const body = renderMarkdown(message.content || "");
  return `<article class="chat-message ${isUser ? "user" : "assistant"}" data-seq="${message.sequence}">
    ${!isUser && !grouped ? roleIcon(message.role) : ""}
    ${!isUser && grouped ? `<div class="role-icon-spacer hide-mobile" aria-hidden="true"></div>` : ""}
    <div class="message-content ${isUser ? "message-content-user" : "message-content-assistant"}">
      <div class="message-bubble markdown-body ${isUser ? "user-bubble" : "assistant-copy"}">${body}</div>
    </div>
    ${isUser && !grouped ? roleIcon(message.role) : ""}
  </article>`;
}

function isSystemRole(message) {
  return message.role === "system" || message.role === "tool" || message.role === "agent" || message.role === "error" || message.level === "error";
}

function isInternalHookMessage(message) {
  return message.role === "user" && String(message.content || "").startsWith("[worker-hook:");
}

function sameMinute(a, b) {
  if (!a || !b) return false;
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return Math.abs(left.getTime() - right.getTime()) < 60_000;
}

function roleIcon(role) {
  const name = role === "user" ? "user" : role === "assistant" ? "bot" : role === "tool" ? "wrench" : "terminal";
  return `<span class="role-icon ${escapeAttr(role)}">${icon(name)}</span>`;
}

function icon(name) {
  const attrs = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    "arrow-left": `<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>`,
    square: `<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="currentColor"></rect>`,
    send: `<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>`,
    plus: `<path d="M12 5v14"></path><path d="M5 12h14"></path>`,
    sparkles: `<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"></path><path d="M5 3v4"></path><path d="M3 5h4"></path><path d="M19 17v4"></path><path d="M17 19h4"></path>`,
    user: `<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>`,
    bot: `<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="3"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M9 13h.01"></path><path d="M15 13h.01"></path>`,
    terminal: `<path d="m4 17 6-6-6-6"></path><path d="M12 19h8"></path>`,
    wrench: `<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2-2Z"></path>`,
    monitor: `<rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>`,
    package: `<path d="m7.5 4.3 9 5.2"></path><path d="M21 8 12 3 3 8l9 5 9-5Z"></path><path d="M3 8v8l9 5 9-5V8"></path><path d="M12 13v8"></path>`,
    search: `<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>`,
    "square-pen": `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"></path>`,
    "more-horizontal": `<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"></path>`,
    "chevrons-up-down": `<path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path>`,
    "message-square": `<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path>`,
    "calendar-clock": `<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h10"></path><circle cx="17" cy="17" r="5"></circle><path d="M17 14.5V17l1.8 1.1"></path>`,
    "chart-bar": `<path d="M3 3v18h18"></path><path d="M7 16v1"></path><path d="M11 12v5"></path><path d="M15 8v9"></path><path d="M19 5v12"></path>`,
    database: `<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>`,
    table: `<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 4v16"></path>`,
    workflow: `<rect x="3" y="3" width="6" height="6" rx="1"></rect><rect x="15" y="15" width="6" height="6" rx="1"></rect><path d="M9 6h3a3 3 0 0 1 3 3v6"></path><path d="m12 12 3 3 3-3"></path>`,
    filter: `<path d="M4 5h16"></path><path d="M7 12h10"></path><path d="M10 19h4"></path>`,
    eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>`,
    mail: `<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>`,
    radio: `<path d="M4.9 19.1a10 10 0 0 1 0-14.2"></path><path d="M7.8 16.2a6 6 0 0 1 0-8.4"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8a6 6 0 0 1 0 8.4"></path><path d="M19.1 4.9a10 10 0 0 1 0 14.2"></path>`,
    archive: `<rect x="3" y="5" width="18" height="4" rx="1"></rect><path d="M5 9v10h14V9"></path><path d="M10 13h4"></path>`,
    "file-code": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="m10 13-2 2 2 2"></path><path d="m14 13 2 2-2 2"></path>`,
    "arrow-up": `<path d="m18 15-6-6-6 6"></path>`,
    "arrow-down": `<path d="m6 9 6 6 6-6"></path>`,
    activity: `<path d="M3 12h4l2.5-7 5 14 2.5-7h4"></path>`,
    brain: `<path d="M9.5 4A2.5 2.5 0 0 0 7 6.5v.2A3 3 0 0 0 5 12a3 3 0 0 0 2 5.3v.2A2.5 2.5 0 0 0 9.5 20c1 0 1.8-.5 2.5-1.2V5.2A3.2 3.2 0 0 0 9.5 4Z"></path><path d="M14.5 4A2.5 2.5 0 0 1 17 6.5v.2a3 3 0 0 1 2 5.3 3 3 0 0 1-2 5.3v.2a2.5 2.5 0 0 1-2.5 2.5c-1 0-1.8-.5-2.5-1.2"></path><path d="M7 8.5h2.5"></path><path d="M14.5 15.5H17"></path><path d="M7 15a3 3 0 0 0 3 3"></path><path d="M17 9a3 3 0 0 1-3 3"></path>`,
    "book-open": `<path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3Z"></path><path d="M21 18a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3v15a3 3 0 0 1 3-3Z"></path>`,
    "rotate-cw": `<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"></path><path d="M21 3v5h-5"></path>`,
    "trash-2": `<path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>`,
    "file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path>`,
    save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8A2 2 0 0 1 21 8.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>`,
    play: `<path d="M5 5a2 2 0 0 1 3-1.7l10 7a2 2 0 0 1 0 3.4l-10 7A2 2 0 0 1 5 19Z"></path>`,
    grid: `<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>`,
    "shield-check": `<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"></path><path d="m9 12 2 2 4-4"></path>`,
    "shield-alert": `<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path>`,
    check: `<path d="m20 6-11 11-5-5"></path>`,
    x: `<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>`,
  };
  return `<svg ${attrs}>${paths[name] || paths.terminal}</svg>`;
}

function siteHomeButton(className = "console-icon-button") {
  return `<a class="${escapeAttr(className)} site-home-button" href="/app" title="返回工作台" aria-label="返回工作台">${icon("grid")}</a>`;
}

function consoleBackButtons() {
  return `<span class="console-header-leading">${siteHomeButton()}<a class="console-icon-button" href="/app/chat" title="返回对话" aria-label="返回对话">${icon("arrow-left")}</a></span>`;
}

function conciseTitle(value) {
  const text = String(value || "AgentBridge session").trim();
  return text.length > 42 ? `${text.slice(0, 41)}...` : text;
}

function workspaceNameFromSession(session) {
  return session.metadata?.workspaceName || session.workspaceName || "本机";
}

function consoleScript() {
  return `
document.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload());
const menuTrigger = document.querySelector('[data-console-menu-trigger]');
const menuPopover = document.querySelector('[data-console-menu]');
function closeConsoleMenu() {
  if (!menuPopover || !menuTrigger) return;
  menuPopover.hidden = true;
  menuTrigger.setAttribute('aria-expanded', 'false');
}
menuTrigger?.addEventListener('click', (event) => {
  event.stopPropagation();
  const opening = menuPopover?.hidden;
  if (!menuPopover) return;
  menuPopover.hidden = !opening;
  menuTrigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (opening) menuPopover.querySelector('[role="menuitem"]')?.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.console-menu-wrap')) closeConsoleMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeConsoleMenu();
});
const search = document.querySelector('[data-console-search]');
const list = document.querySelector('[data-console-list]');
const scroller = document.querySelector('.console-scroll');
const more = document.querySelector('[data-console-more]');
const moreLabel = document.querySelector('[data-console-more-label]');
const tokenDialog = document.querySelector('[data-token-dialog]');
const tokenOpen = document.querySelector('[data-token-open]');
const tokenClose = document.querySelector('[data-token-close]');
const tokenError = document.querySelector('[data-token-error]');
const tokenRanges = Array.from(document.querySelectorAll('[data-token-range]'));
const sessionTotal = document.querySelector('.console-title small span');
let nextCursor = more?.dataset.nextCursor || '';
let query = '';
let loading = false;
let controller;
let searchTimer;
let tokenRange = document.querySelector('[data-token-range][aria-pressed="true"]')?.dataset.tokenRange || 'today';

async function loadPage({ reset = false } = {}) {
  if (!list || !more) return;
  if (reset) {
    controller?.abort();
    loading = false;
    nextCursor = '';
  } else if (loading || !nextCursor) {
    return;
  }
  loading = true;
  list.setAttribute('aria-busy', 'true');
  controller = new AbortController();
  more.hidden = false;
  more.disabled = true;
  more.dataset.loading = 'true';
  moreLabel.textContent = '加载中';
  const params = new URLSearchParams({ limit: more.dataset.pageSize || '20' });
  if (!reset && nextCursor) params.set('cursor', nextCursor);
  if (query) params.set('query', query);
  try {
    const response = await fetch('/api/chat/sessions?' + params, { signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || data.ok === false) throw new Error(data.error || text || response.statusText);
    if (reset) list.innerHTML = data.html || '';
    else if (data.html) mergeSessionGroups(data.html);
    nextCursor = data.nextCursor || '';
    if (sessionTotal && Number.isFinite(Number(data.totalSessions))) {
      sessionTotal.textContent = '本机 · ' + tokenInteger(data.totalSessions) + ' 个会话';
    }
    more.dataset.nextCursor = nextCursor;
    more.hidden = !data.hasMore;
    moreLabel.textContent = '加载更多';
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (reset) list.innerHTML = '<div class="console-empty console-load-error"><strong>暂时无法加载会话</strong><span>点击下方按钮重试。</span></div>';
      more.hidden = false;
      moreLabel.textContent = '重新加载';
    }
  } finally {
    loading = false;
    more.disabled = false;
    more.dataset.loading = 'false';
    list.setAttribute('aria-busy', 'false');
  }
}

function mergeSessionGroups(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const incomingGroups = Array.from(template.content.querySelectorAll('[data-console-session-group]'));
  if (!incomingGroups.length) {
    list.insertAdjacentHTML('beforeend', html);
    return;
  }
  for (const incoming of incomingGroups) {
    const key = incoming.dataset.consoleSessionGroup;
    const current = list.querySelector('[data-console-session-group="' + key + '"]');
    if (!current) {
      list.append(incoming);
      continue;
    }
    const target = current.querySelector('[data-session-group-list]');
    const source = incoming.querySelector('[data-session-group-list]');
    if (target && source) target.append(...source.children);
    const count = current.querySelector('[data-session-group-count]');
    if (count && target) count.textContent = target.querySelectorAll('[data-console-session]').length + ' 个';
  }
}

search?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = search.value.trim();
    loadPage({ reset: true });
  }, 250);
});
more?.addEventListener('click', () => loadPage());
if (more && scroller) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadPage();
  }, { root: scroller, rootMargin: '240px 0px' });
  observer.observe(more);
}

function openTokenDialog() {
  if (!tokenDialog) return;
  if (typeof tokenDialog.showModal === 'function') {
    try {
      tokenDialog.showModal();
      return;
    } catch {}
  }
  tokenDialog.classList.add('token-dialog-fallback');
  tokenDialog.setAttribute('open', '');
  document.documentElement.classList.add('token-modal-open');
}

function closeTokenDialog() {
  if (!tokenDialog) return;
  if (!tokenDialog.classList.contains('token-dialog-fallback') && typeof tokenDialog.close === 'function') {
    tokenDialog.close();
    return;
  }
  tokenDialog.removeAttribute('open');
  tokenDialog.classList.remove('token-dialog-fallback');
  document.documentElement.classList.remove('token-modal-open');
}

async function loadTokenUsage(range = tokenRange) {
  tokenRange = range;
  tokenRanges.forEach((button) => button.setAttribute('aria-pressed', button.dataset.tokenRange === tokenRange ? 'true' : 'false'));
  if (tokenError) tokenError.hidden = true;
  try {
    const response = await fetch('/api/chat/token-usage?range=' + encodeURIComponent(tokenRange));
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
    updateTokenUsage(data.tokenUsage || {});
  } catch {
    if (tokenError) tokenError.hidden = false;
  }
}

tokenOpen?.addEventListener('click', () => {
  openTokenDialog();
  loadTokenUsage();
});
tokenRanges.forEach((button) => button.addEventListener('click', () => loadTokenUsage(button.dataset.tokenRange || 'today')));
tokenClose?.addEventListener('click', closeTokenDialog);
tokenDialog?.addEventListener('click', (event) => {
  if (event.target === tokenDialog) closeTokenDialog();
});

function updateTokenUsage(usage) {
  const totalLabel = document.querySelector('[data-token-total-label]');
  if (totalLabel) totalLabel.textContent = tokenCompact(usage.totalTokens);
  for (const key of ['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'sessionCount', 'requestCount']) {
    const element = document.querySelector('[data-token-value="' + key + '"]');
    if (element) element.textContent = element.dataset.tokenFormat === 'integer'
      ? tokenInteger(usage[key])
      : tokenCompact(usage[key]);
  }
  const cacheRate = document.querySelector('[data-token-value="cacheRate"]');
  if (cacheRate) cacheRate.textContent = tokenInteger(usage.cacheRate);
  const range = usage.range || tokenRange;
  const rangeLabel = range === '30d' ? '最近 30 天' : range === '7d' ? '最近 7 天' : '今日';
  document.querySelectorAll('[data-token-range-label], [data-token-pulse-label]').forEach((element) => {
    element.textContent = rangeLabel;
  });
  const updated = document.querySelector('[data-token-updated]');
  if (updated) updated.textContent = usage.updatedAt
    ? '更新于 ' + new Date(usage.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '暂无用量记录';
  renderTokenHeatmapClient(Array.isArray(usage.dailyUsage) ? usage.dailyUsage : []);
  renderTokenSessions(Array.isArray(usage.recentSessions) ? usage.recentSessions : []);
}

function renderTokenHeatmapClient(days) {
  const container = document.querySelector('[data-token-heatmap]');
  if (!container) return;
  const maximum = Math.max(0, ...days.map((day) => Number(day.totalTokens) || 0));
  const fragment = document.createDocumentFragment();
  for (const day of days) {
    const total = Number(day.totalTokens) || 0;
    const cell = document.createElement('span');
    cell.dataset.tokenDay = day.day || '';
    cell.dataset.level = !total || !maximum ? '0' : String(Math.max(1, Math.min(4, Math.ceil(total / maximum * 4))));
    cell.title = (day.day || '') + ' · ' + tokenCompact(total) + ' tokens';
    fragment.append(cell);
  }
  container.replaceChildren(fragment);
}

function renderTokenSessions(sessions) {
  const container = document.querySelector('[data-token-sessions]');
  if (!container) return;
  const fragment = document.createDocumentFragment();
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'token-empty';
    empty.textContent = '暂无会话用量';
    fragment.append(empty);
  }
  for (const session of sessions) {
    const row = document.createElement('a');
    row.className = 'token-session-row';
    row.href = '/app/chat/session/' + encodeURIComponent(session.sessionId) + '/live';
    const primary = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = session.title || '未命名会话';
    const threads = document.createElement('small');
    threads.textContent = Number(session.threadCount) === 1 ? '1 个线程' : tokenInteger(session.threadCount) + ' 个线程';
    primary.append(title, threads);
    const secondary = document.createElement('span');
    const total = document.createElement('b');
    total.textContent = tokenCompact(session.totalTokens);
    const time = document.createElement('time');
    time.textContent = session.updatedAt ? new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    secondary.append(total, time);
    row.append(primary, secondary);
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}

function tokenInteger(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function tokenCompact(value) {
  const number = Math.max(0, Number(value) || 0);
  const units = [[1000000000, 'B'], [1000000, 'M'], [1000, 'K']];
  for (const [threshold, suffix] of units) {
    if (number >= threshold) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(number / threshold) + suffix;
    }
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(number);
}

loadPage({ reset: true });
loadTokenUsage();`;
}

function composeScript() {
  return `
const form = document.querySelector('[data-new-session]');
const textarea = form?.elements.content;
const hiddenWorkspace = form?.elements.workspaceName;
const workspaceSelect = document.querySelector('[data-workspace-select]');
const error = document.querySelector('[data-compose-error]');
workspaceSelect?.addEventListener('change', (event) => {
  if (hiddenWorkspace) hiddenWorkspace.value = event.currentTarget.value;
});
textarea?.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.4) + 'px';
});
textarea?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form?.requestSubmit();
  }
});
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = textarea.value.trim();
  if (!content) return;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  if (error) error.hidden = true;
  try {
    const workspaceName = hiddenWorkspace?.value || workspaceSelect?.value || '';
    const created = await json('/api/chat/bridge/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'new',
        role: 'worker',
        workspaceName,
        taskDescription: content,
        title: content.slice(0, 80),
      }),
    });
    await json('/api/chat/bridge/sessions/' + encodeURIComponent(created.session.id) + '/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'send', content, workspaceName }),
    });
    location.href = '/app/chat/session/' + encodeURIComponent(created.session.id) + '/live';
  } catch (err) {
    if (error) {
      error.textContent = err.message || String(err);
      error.hidden = false;
    }
    submitButton.disabled = false;
  }
});
async function json(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) throw new Error(data.error || text || res.statusText);
  return data;
}`;
}

function cronScript() {
  return `
document.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload());
const taskDialog = document.querySelector('[data-task-dialog]');
const taskDialogName = taskDialog?.querySelector('[data-task-dialog-name]');
const taskDialogClose = taskDialog?.querySelector('[data-task-dialog-close]');
const taskForm = taskDialog?.querySelector('[data-task-form]');
const actionDialog = document.querySelector('[data-action-dialog]');
const actionTitle = actionDialog?.querySelector('[data-action-title]');
const actionDescription = actionDialog?.querySelector('[data-action-description]');
const actionTaskName = actionDialog?.querySelector('[data-action-task-name]');
const actionDialogError = actionDialog?.querySelector('[data-action-dialog-error]');
const actionCancel = actionDialog?.querySelector('[data-action-cancel]');
const actionConfirm = actionDialog?.querySelector('[data-action-confirm]');
const actionConfirmLabel = actionDialog?.querySelector('[data-action-confirm-label]');
let pendingAction = null;

for (const button of document.querySelectorAll('[data-task-open]')) {
  button.addEventListener('click', () => openTaskDialog(button.dataset));
}

function openTaskDialog(task) {
  if (!taskForm || !taskDialog) return;
  taskForm.dataset.taskId = task.taskId || '';
  taskForm.dataset.taskName = task.taskName || '';
  taskForm.elements.name.value = task.taskName || '';
  taskForm.elements.cron.value = task.taskCron || '';
  setSelectValue(taskForm.elements.timezone, task.taskTimezone || 'Asia/Shanghai');
  setSelectValue(taskForm.elements.workspaceName, task.taskWorkspaceName || '');
  taskForm.elements.recipientId.value = task.taskRecipientId || '';
  taskForm.elements.prompt.value = task.taskPrompt || '';
  taskForm.elements.enabled.checked = task.taskEnabled === '1';
  if (taskDialogName) taskDialogName.textContent = task.taskName || '任务详情';
  setText('[data-task-run-count]', '运行 ' + (task.taskRunCount || '0') + ' 次');
  setText('[data-task-next-run]', task.taskNextRunAt ? '下次 ' + formatClientTime(task.taskNextRunAt) : '');
  setText('[data-task-last-run]', task.taskLastRunAt ? '上次 ' + formatClientTime(task.taskLastRunAt) : '');
  const sessionLink = taskDialog.querySelector('[data-task-last-session]');
  if (sessionLink) {
    sessionLink.hidden = !task.taskLastSessionId;
    sessionLink.href = task.taskLastSessionId ? '/app/chat/session/' + encodeURIComponent(task.taskLastSessionId) + '/live' : '#';
  }
  const lastError = taskDialog.querySelector('[data-task-last-error]');
  if (lastError) {
    lastError.hidden = !task.taskLastError;
    lastError.textContent = task.taskLastError || '';
  }
  const formError = taskForm.querySelector('[data-task-error]');
  if (formError) formError.hidden = true;
  taskDialog.showModal();
  requestAnimationFrame(() => taskDialogClose?.focus());
}

function setText(selector, value) {
  const element = taskDialog?.querySelector(selector);
  if (element) {
    element.textContent = value;
    element.hidden = !value;
  }
}

function setSelectValue(select, value) {
  if (!select) return;
  if (value && !Array.from(select.options).some((option) => option.value === value)) {
    select.add(new Option(value, value));
  }
  select.value = value;
}

function formatClientTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

taskDialogClose?.addEventListener('click', () => taskDialog?.close('close'));
taskForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = taskForm.dataset.taskId;
  const error = taskForm.querySelector('[data-task-error]');
  await submitCronForm(taskForm, '/api/app/schedules/tasks/' + encodeURIComponent(id), 'PATCH', error);
});
taskForm?.querySelector('[data-delete-task]')?.addEventListener('click', () => openActionDialog('delete'));
taskForm?.querySelector('[data-run-task]')?.addEventListener('click', () => openActionDialog('run'));

function openActionDialog(type) {
  if (!taskForm || !actionDialog) return;
  pendingAction = { type, id: taskForm.dataset.taskId, name: taskForm.dataset.taskName, form: taskForm };
  const deleting = type === 'delete';
  if (actionTitle) actionTitle.textContent = deleting ? '删除定时任务？' : '立即运行这个任务？';
  if (actionDescription) actionDescription.textContent = deleting ? '任务将被永久删除，此操作无法撤销：' : '将立即发送微信通知并开启新的 Codex 会话：';
  if (actionTaskName) actionTaskName.textContent = pendingAction.name || '未命名任务';
  if (actionConfirmLabel) actionConfirmLabel.textContent = deleting ? '删除任务' : '立即运行';
  if (actionConfirm) actionConfirm.dataset.variant = deleting ? 'destructive' : 'default';
  for (const iconElement of actionDialog.querySelectorAll('[data-action-icon], [data-action-confirm-icon]')) {
    const iconType = iconElement.dataset.actionIcon || iconElement.dataset.actionConfirmIcon;
    iconElement.hidden = iconType !== type;
  }
  if (actionDialogError) actionDialogError.hidden = true;
  taskDialog?.close('action');
  actionDialog.showModal();
  requestAnimationFrame(() => actionCancel?.focus());
}

actionCancel?.addEventListener('click', () => actionDialog?.close('cancel'));
actionDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  actionDialog.close('cancel');
});
actionDialog?.addEventListener('close', () => {
  if (actionConfirm) actionConfirm.disabled = false;
  if (actionDialog.returnValue === 'cancel' && pendingAction?.form) {
    requestAnimationFrame(() => taskDialog?.showModal());
    return;
  }
  pendingAction = null;
});
actionConfirm?.addEventListener('click', async () => {
  if (!pendingAction || !actionConfirm) return;
  actionConfirm.disabled = true;
  if (actionDialogError) actionDialogError.hidden = true;
  try {
    if (pendingAction.type === 'delete') {
      await json('/api/app/schedules/tasks/' + encodeURIComponent(pendingAction.id), { method: 'DELETE' });
      actionDialog.close('complete');
      location.reload();
      return;
    }
    const result = await json('/api/app/schedules/tasks/' + encodeURIComponent(pendingAction.id) + '/run', { method: 'POST' });
    actionDialog.close('complete');
    if (result.session?.url) location.href = result.session.url;
    else location.reload();
  } catch (err) {
    showError(actionDialogError, err);
    actionConfirm.disabled = false;
  }
});

async function submitCronForm(form, url, method, error) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  if (error) error.hidden = true;
  try {
    await json(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cronPayload(form)),
    });
    location.reload();
  } catch (err) {
    showError(error, err);
    button.disabled = false;
  }
}
function cronPayload(form) {
  const data = new FormData(form);
  return {
    name: String(data.get('name') || '').trim(),
    cron: String(data.get('cron') || '').trim(),
    timezone: String(data.get('timezone') || 'Asia/Shanghai').trim(),
    workspaceName: String(data.get('workspaceName') || '').trim(),
    recipientId: String(data.get('recipientId') || '').trim(),
    prompt: String(data.get('prompt') || '').trim(),
    enabled: data.get('enabled') === 'on',
  };
}
function showError(error, err) {
  if (!error) return;
  error.textContent = err.message || String(err);
  error.hidden = false;
}
async function json(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) throw new Error(data.error || text || res.statusText);
  return data;
}`;
}

function skillCatalogScript() {
  return `
const skillSearch = document.querySelector('[data-skill-search]');
const skillRows = Array.from(document.querySelectorAll('[data-skill-open]'));
const skillGroups = Array.from(document.querySelectorAll('[data-skill-group]'));
const skillEmpty = document.querySelector('[data-skill-empty]');
const skillDetail = document.querySelector('[data-skill-detail]');
const skillDetailClose = document.querySelector('[data-skill-detail-close]');
let skillDetailTrigger = null;

function filterSkills() {
  const query = (skillSearch?.value || '').trim().toLocaleLowerCase('zh-CN');
  let visible = 0;
  for (const row of skillRows) {
    const matches = !query || (row.dataset.searchText || '').toLocaleLowerCase('zh-CN').includes(query);
    row.hidden = !matches;
    if (matches) visible += 1;
  }
  for (const group of skillGroups) {
    const count = Array.from(group.querySelectorAll('[data-skill-open]')).filter((row) => !row.hidden).length;
    group.hidden = count === 0;
    const countLabel = group.querySelector('[data-skill-group-count]');
    if (countLabel) countLabel.textContent = String(count);
  }
  if (skillEmpty) skillEmpty.hidden = visible !== 0;
}

function setSkillDetail(row) {
  if (!skillDetail) return;
  skillDetailTrigger = row;
  const values = {
    '[data-skill-detail-name]': row.dataset.skillName || '',
    '[data-skill-detail-description]': row.dataset.skillDescription || '',
    '[data-skill-detail-category]': row.dataset.skillCategory || '',
    '[data-skill-detail-maturity]': row.dataset.skillMaturity || '',
    '[data-skill-detail-cli]': row.dataset.skillCli || '',
    '[data-skill-detail-related]': row.dataset.skillRelated || '',
    '[data-skill-detail-mark]': row.querySelector('.skill-mark')?.textContent || 'SK',
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = skillDetail.querySelector(selector);
    if (element) element.textContent = value;
  }
  const cliRow = skillDetail.querySelector('[data-skill-detail-cli-row]');
  const relatedRow = skillDetail.querySelector('[data-skill-detail-related-row]');
  if (cliRow) cliRow.hidden = !row.dataset.skillCli;
  if (relatedRow) relatedRow.hidden = !row.dataset.skillRelated;
  skillDetail.hidden = false;
  document.documentElement.classList.add('skill-detail-open');
  requestAnimationFrame(() => skillDetailClose?.focus({ preventScroll: true }));
}

function closeSkillDetail() {
  if (!skillDetail || skillDetail.hidden) return;
  skillDetail.hidden = true;
  document.documentElement.classList.remove('skill-detail-open');
  skillDetailTrigger?.focus({ preventScroll: true });
}

skillSearch?.addEventListener('input', filterSkills);
for (const row of skillRows) row.addEventListener('click', () => setSkillDetail(row));
skillDetailClose?.addEventListener('click', closeSkillDetail);
skillDetail?.addEventListener('click', (event) => {
  if (event.target === skillDetail) closeSkillDetail();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSkillDetail();
});`;
}

function sessionScript() {
  return `
const root = document.querySelector('[data-session-id]');
const sessionId = root?.dataset.sessionId || '';
const messages = document.querySelector('[data-messages]');
let lastSeq = Number(Array.from(messages?.querySelectorAll('[data-seq]') || []).at(-1)?.dataset?.seq || 0);
messages.scrollTop = messages.scrollHeight;
document.querySelector('[data-session-back]')?.addEventListener('click', (event) => {
  const referrer = document.referrer ? new URL(document.referrer) : null;
  if (referrer?.origin === location.origin && referrer.pathname === '/app/chat') {
    event.preventDefault();
    history.back();
  }
});
document.querySelector('[data-composer]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const textarea = event.currentTarget.elements.content;
  const content = textarea.value.trim();
  if (!content) return;
  textarea.value = '';
  textarea.style.height = '';
  await fetch('/api/chat/bridge/sessions/' + encodeURIComponent(sessionId) + '/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'send', content }),
  });
});
document.querySelector('[data-composer] textarea')?.addEventListener('input', (event) => {
  const textarea = event.currentTarget;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.4) + 'px';
});
document.querySelector('[data-stop]')?.addEventListener('click', () => {
  fetch('/api/chat/bridge/sessions/' + encodeURIComponent(sessionId) + '/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'stop' }),
  });
});
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws');
window.addEventListener('pagehide', () => ws.close(), { once: true });
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.type !== 'session.delta' || message.event.sessionId !== sessionId) return;
  if (message.event.seq <= lastSeq) return;
  lastSeq = message.event.seq;
  fetch(location.pathname + '?fragment=messages').then((res) => res.text()).then((html) => {
    messages.innerHTML = html;
    messages.scrollTop = messages.scrollHeight;
  });
});`;
}

function styles() {
  return `
:root{color-scheme:light;--paper:#f5f1e8;--surface:#fffdf8;--surface-2:#f9f6ef;--ink:#161718;--muted:#6d716f;--line:#d8d2c5;--green:#0b7a63;--green-2:#dff1e9;--blue:#3867a8;--red:#b84d36;--amber:#b48114;--shadow:0 10px 28px rgba(22,23,24,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;overflow:hidden;background:radial-gradient(circle at 50% 0,#fffdf8 0,#f5f1e8 42%,#ece6d9 100%);color:var(--ink)}a{color:inherit;text-decoration:none}button,textarea{font:inherit}
.app-shell{width:100%;min-width:0;height:100dvh;margin:0 auto;display:flex;flex-direction:column;overflow:hidden}.dashboard-shell{max-width:1120px;padding:14px}.session-shell{max-width:760px;background:rgba(255,253,248,.58);border-left:1px solid rgba(216,210,197,.7);border-right:1px solid rgba(216,210,197,.7)}
.topbar{height:58px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);background:rgba(255,253,248,.86);backdrop-filter:blur(14px);flex:0 0 auto}.topbar-slot{width:40px}.topbar-title{min-width:0;flex:1;text-align:center;display:grid;gap:2px}.topbar-title strong{font-size:15px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.topbar-title span{color:var(--muted);font-size:12px;display:flex;justify-content:center;align-items:center;gap:6px;min-width:0}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);flex:0 0 auto}.dot.ok{background:var(--green)}.dot.bad{background:var(--red)}.dot.warn{background:var(--amber)}
.icon-button,.button,.send-button{border:1px solid var(--line);background:var(--surface);color:var(--ink);min-height:36px;border-radius:8px;display:inline-grid;place-items:center;cursor:pointer}.icon-button{width:40px;flex:0 0 40px;padding:0}.button{padding:0 13px}.text-link{color:var(--green);font-size:13px}
.dashboard-grid{min-height:0;flex:1;display:grid;grid-template-columns:140px minmax(0,1fr) 300px;gap:16px;padding-top:16px}.rail{display:grid;align-content:start;gap:8px}.rail-row{border-top:1px solid var(--line);padding:11px 0;display:flex;align-items:baseline;justify-content:space-between}.rail-row span{color:var(--muted);font-size:12px}.rail-row b{font-size:24px}
.inbox,.ops{min-width:0}.section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}.section-head h1,.section-head h2{margin:0;font-size:18px;line-height:1.2}.section-head h2{font-size:14px}.section-head.tight{margin-top:2px}.pages-head{margin-top:22px}
.session-list,.workspace-list,.asset-list{display:grid;gap:8px}.session-row,.workspace-row,.asset-list a,.child-strip a{min-width:0;border:1px solid var(--line);background:rgba(255,253,248,.82);border-radius:8px;display:flex;align-items:center;gap:10px;padding:10px}.avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#e6efe9;color:var(--green);font-weight:700;flex:0 0 auto}.session-row.worker .avatar{background:#e9edf5;color:var(--blue)}
.row-main,.workspace-row span{min-width:0;flex:1;display:grid;gap:3px}.row-main span{min-width:0;display:flex;align-items:center;gap:8px}.row-main b,.workspace-row b,.asset-list span,.child-strip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-main em{font-style:normal;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 7px;flex:0 0 auto}.row-main small,.session-row time,.workspace-row time,.workspace-row small,.asset-list small,.child-strip small{color:var(--muted);font-size:12px}.empty{border:1px dashed var(--line);border-radius:8px;color:var(--muted);padding:22px;text-align:center}.empty.compact{padding:14px;font-size:13px}
.chat-surface{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.child-strip{flex:0 0 auto;display:flex;gap:8px;overflow:auto;padding:8px 10px;border-bottom:1px solid rgba(216,210,197,.72)}.child-strip a{min-width:190px;padding:8px 10px;display:grid;gap:2px}.messages{min-width:0;min-height:0;flex:1;overflow:auto;padding:14px 14px 18px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.message{min-width:0;max-width:min(590px,86%);border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--surface);box-shadow:0 1px 0 rgba(22,23,24,.03);overflow-wrap:anywhere}.message.user{align-self:flex-end;background:var(--green-2);border-color:#c9e7dc}.message.assistant{align-self:flex-start;background:var(--surface)}.message.system,.message.tool,.message.agent,.message.error{align-self:stretch;max-width:100%;background:rgba(255,253,248,.72)}.message.error{background:#fff2ed;border-color:#efb7a5}.message header{min-width:0;display:flex;justify-content:space-between;gap:14px;color:var(--muted);font-size:11px;margin-bottom:6px}.message header span{min-width:0;overflow:hidden;text-overflow:ellipsis}.message header time{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.message-body{min-width:0;font-size:14px;line-height:1.62;overflow-wrap:anywhere;word-break:break-word}.message-body p{margin:0 0 8px}.message-body p:last-child{margin-bottom:0}.message-body code{background:rgba(56,103,168,.10);border:1px solid rgba(56,103,168,.18);border-radius:5px;padding:1px 4px}
.composer{min-width:0;flex:0 0 auto;border-top:1px solid var(--line);display:flex;gap:8px;padding:10px;background:rgba(255,253,248,.92)}.composer textarea{min-width:0;flex:1 1 auto;resize:none;border:1px solid var(--line);border-radius:8px;padding:10px 11px;background:#fff;line-height:1.4;max-height:120px}.send-button{flex:0 0 auto;background:var(--green);color:#fff;border-color:var(--green);padding:0 18px;min-width:54px}
.wechat-dialog{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:18px;box-shadow:var(--shadow);width:min(430px,92vw)}.wechat-dialog::backdrop{background:rgba(22,23,24,.28)}.wechat-dialog h2{margin:0 0 8px;font-size:18px}.wechat-dialog p{color:var(--muted);overflow-wrap:anywhere}.wechat-dialog .close{float:right}.qr-box{display:grid;place-items:center;min-height:280px;background:#fff;border:1px solid var(--line);border-radius:8px;margin:12px 0}.qr-box svg{max-width:280px;width:100%;height:auto}.dialog-actions{display:flex;gap:8px;flex-wrap:wrap}
.pages-index{max-width:860px;margin:40px auto;padding:24px}.pages-index h1{font-size:36px;margin:0 0 16px}.eyebrow{margin:0 0 6px;color:var(--blue);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.wide{margin-top:18px}
@media (max-width:880px){.dashboard-shell{padding:0}.dashboard-grid{grid-template-columns:1fr;padding:10px}.rail{grid-template-columns:repeat(4,1fr);gap:0}.rail-row{padding:8px;border-top:0;border-right:1px solid var(--line);display:grid}.rail-row:last-child{border-right:0}.ops{display:none}.session-shell{border:0}.message{max-width:92%}}
@media (max-width:520px){.topbar{height:56px;padding:7px 8px}.messages{padding:12px 10px 16px}.message{max-width:88%;padding:9px 10px}.message.system,.message.tool,.message.agent,.message.error{max-width:100%}.composer{padding:8px}.send-button{padding:0 14px}.section-head h1{font-size:16px}.rail-row b{font-size:20px}}

.agent-bridge-theme{--background:48 33% 97%;--foreground:60 2% 8%;--card:39 35% 90%;--card-foreground:60 2% 8%;--popover:48 33% 97%;--popover-foreground:60 2% 8%;--primary:15 52% 58%;--primary-foreground:0 0% 100%;--secondary:38 31% 94%;--secondary-foreground:60 2% 8%;--muted:38 31% 94%;--muted-foreground:42 4% 41%;--accent:171 36% 54%;--accent-foreground:60 2% 8%;--destructive:0 52% 52%;--destructive-foreground:0 0% 100%;--border:36 31% 87%;--input:36 31% 87%;--ring:15 52% 58%;--radius:.75rem;background:linear-gradient(180deg,hsl(48 33% 97%) 0%,hsl(38 31% 94%) 100%);color:hsl(var(--foreground));font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.console-page{width:100%;height:100dvh;min-height:100dvh;overflow:hidden;display:flex;justify-content:center;padding:.5rem;background:hsl(38 31% 94%)}
.console-frame{position:relative;min-width:0;min-height:0;width:min(100%,72rem);flex:1;display:flex;flex-direction:column;overflow:hidden;border:1px solid hsl(var(--border));border-radius:.75rem;background:hsl(var(--background));box-shadow:0 18px 44px -28px hsl(var(--foreground) / .38)}
.console-header{position:relative;z-index:40;height:3.25rem;flex:0 0 auto;display:flex;align-items:center;gap:.5rem;overflow:visible;border-bottom:1px solid hsl(var(--border));background:hsl(var(--background) / .95);padding:.5rem .75rem;backdrop-filter:blur(16px)}
.console-header-actions{display:flex;align-items:center;gap:.35rem;flex:0 0 auto}
.console-header-leading,.mobile-chat-leading{display:inline-flex;align-items:center;gap:.3rem;flex:0 0 auto}.site-home-button{color:hsl(var(--primary))}.pages-home-link{width:max-content;display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--line);border-radius:.45rem;background:var(--surface);padding:.45rem .6rem;font-size:.75rem;font-weight:650}.pages-home-link svg{width:.9rem;height:.9rem}
.console-header-title{flex:1;text-align:center}.compose-frame .console-header-spacer{width:4.8rem}
.console-menu-wrap{position:relative;z-index:50;display:flex}.console-menu-popover{position:absolute;z-index:60;top:calc(100% + .4rem);right:0;width:10.5rem;overflow:hidden;border:1px solid hsl(var(--border));border-radius:.5rem;background:#fffdf8;color:hsl(var(--popover-foreground));padding:.3rem;box-shadow:0 20px 48px -18px hsl(var(--foreground) / .58)}.console-menu-popover[hidden]{display:none}.console-menu-popover a,.console-menu-popover button{width:100%;height:2.4rem;border:0;border-radius:.4rem;background:transparent;color:hsl(var(--foreground));display:flex;align-items:center;gap:.65rem;padding:0 .65rem;font:inherit;font-size:.8125rem;text-align:left;cursor:pointer}.console-menu-popover a:focus-visible,.console-menu-popover button:focus-visible{background:hsl(var(--card) / .72);outline:0}.console-menu-popover svg{width:1rem;height:1rem;color:hsl(var(--muted-foreground));flex:0 0 auto}
.console-header-spacer,.console-icon-button{width:2.25rem;height:2.25rem;min-width:2.25rem}.console-icon-button,.console-token-button{border:1px solid hsl(var(--border));border-radius:.55rem;background:hsl(var(--card) / .7);color:hsl(var(--muted-foreground));display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.console-token-button{height:2.25rem;min-width:4.2rem;max-width:5.5rem;gap:.35rem;padding:0 .55rem;font-size:.75rem;font-weight:650;white-space:nowrap}.console-token-button span{min-width:0;overflow:hidden;text-overflow:ellipsis}.console-icon-button svg,.console-token-button svg,.console-title svg,.console-search svg,.workspace-symbol svg,.workspace-chevron svg,.selector-row svg,.compose-fab svg,.console-empty svg{width:1rem;height:1rem;display:block;flex:0 0 auto}
.console-title{min-width:0;flex:1;text-align:center;display:grid;gap:.1rem}.console-title>span,.console-header-title{font-size:.875rem;font-weight:650;line-height:1.25}.console-title small{min-width:0;display:flex;align-items:center;justify-content:center;gap:.35rem;color:hsl(var(--muted-foreground));font-size:11px;line-height:1.25}.console-title small span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.presence-dot{width:.375rem;height:.375rem;min-width:.375rem;border-radius:999px;background:hsl(var(--muted-foreground) / .42)}.presence-dot.online{background:#10b981}.session-state{width:.375rem;height:.375rem;min-width:.375rem;border-radius:999px;background:hsl(var(--muted-foreground) / .42)}.session-state.online{background:#10b981}.session-state.warn{background:#d97706}.session-state.muted{background:hsl(var(--muted-foreground) / .28)}
.console-notice{margin:.75rem .75rem 0;display:flex;align-items:center;gap:.5rem;border:1px solid hsl(var(--border));border-radius:.65rem;background:hsl(var(--card) / .42);padding:.65rem .75rem;color:hsl(var(--muted-foreground));font-size:.8125rem}.console-notice svg{width:1rem;height:1rem;flex:0 0 auto}
.console-search{position:relative;flex:0 0 auto;border-bottom:1px solid hsl(var(--border));background:hsl(var(--card) / .35);padding:.75rem 1rem}.console-search svg{position:absolute;left:1.85rem;top:50%;transform:translateY(-50%);color:hsl(var(--muted-foreground));pointer-events:none}.console-search input{width:100%;height:2.25rem;border:1px solid hsl(var(--input));border-radius:.55rem;background:hsl(var(--background));padding:0 .85rem 0 2.35rem;color:hsl(var(--foreground));font:inherit;font-size:.875rem;outline:0}.console-search input:focus{border-color:hsl(var(--primary) / .45);box-shadow:0 0 0 1px hsl(var(--primary) / .14)}.console-search input::placeholder{color:hsl(var(--muted-foreground) / .62)}
.console-initial-loading{display:flex;flex-direction:column;gap:.2rem;padding-top:2.15rem}.console-loading-row{height:3.05rem;display:flex;align-items:center;gap:.65rem;padding:.5rem .55rem;animation:console-skeleton-pulse 1.15s ease-in-out infinite alternate;animation-delay:calc(var(--loading-index) * 70ms)}.console-loading-mark{width:1.75rem;height:1.75rem;flex:0 0 auto;border-radius:.5rem;background:hsl(var(--muted))}.console-loading-copy{min-width:0;flex:1;display:grid;gap:.4rem}.console-loading-copy i,.console-loading-time{display:block;border-radius:.2rem;background:hsl(var(--muted))}.console-loading-copy i:first-child{width:min(15rem,62%);height:.65rem}.console-loading-copy i:last-child{width:min(22rem,82%);height:.45rem}.console-loading-time{width:2.75rem;height:.45rem;flex:0 0 auto}@keyframes console-skeleton-pulse{from{opacity:.42}to{opacity:.82}}
.console-scroll{min-width:0;min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;padding:.75rem .75rem 6rem;-webkit-overflow-scrolling:touch}.console-list{width:100%;max-width:42rem;margin:0 auto;display:flex;flex-direction:column;gap:.25rem}.console-load-more{width:min(100%,42rem);min-height:2.5rem;margin:.65rem auto 0;border:0;background:transparent;color:hsl(var(--muted-foreground));display:flex;align-items:center;justify-content:center;gap:.45rem;font:inherit;font-size:.75rem;cursor:pointer}.console-load-more[hidden]{display:none}.console-load-more:disabled{cursor:default}.console-loading-dot{width:.45rem;height:.45rem;border-radius:999px;background:hsl(var(--primary) / .55)}.console-load-more[data-loading="true"] .console-loading-dot{animation:console-pulse .9s ease-in-out infinite alternate}@keyframes console-pulse{to{opacity:.28;transform:scale(.72)}}.workspace-group{min-width:0}.workspace-group[hidden],.console-session[hidden]{display:none}.workspace-group summary{list-style:none}.workspace-group summary::-webkit-details-marker{display:none}
.token-dialog{width:min(calc(100% - 2rem),52rem);max-width:52rem}.token-dialog::backdrop{background:hsl(60 2% 8% / .56);backdrop-filter:blur(3px)}.token-dialog .task-dialog-content{isolation:isolate;background:hsl(var(--background));box-shadow:0 28px 80px -22px hsl(60 2% 8% / .72)}.token-dialog-body{min-height:0;overflow-y:auto;padding:1rem 1.1rem 1.25rem}.token-range-tabs{width:max-content;margin:0 0 .9rem auto;display:flex;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--card) / .35);padding:.2rem}.token-range-tabs button{height:2rem;min-width:4.25rem;border:0;border-radius:.35rem;background:transparent;color:hsl(var(--muted-foreground));font:inherit;font-size:.75rem;font-weight:650;cursor:pointer}.token-range-tabs button[aria-pressed="true"]{background:hsl(var(--background));color:hsl(var(--foreground));box-shadow:0 1px 4px hsl(var(--foreground) / .12)}.token-total-band{display:grid;grid-template-columns:minmax(0,1.45fr) 10rem;gap:1rem;border-top:3px solid #2fb7c7;border-bottom:1px solid hsl(var(--border));padding:1.1rem 0}.token-total-copy{min-width:0;display:grid;align-content:start;gap:.35rem}.token-total-copy>span,.token-total-copy>small{color:hsl(var(--muted-foreground));font-size:.75rem}.token-total-copy>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:clamp(2.25rem,8vw,4.35rem);line-height:1.05;font-weight:760;letter-spacing:0}.token-pulse{grid-column:2;grid-row:1 / span 2;min-height:9.5rem;border:1px solid #2d99b7;border-radius:.5rem;background:#eaf7f7;color:#16788b;display:grid;grid-template-columns:auto 1fr;align-content:center;gap:.6rem .7rem;padding:1rem}.token-pulse svg{width:2rem;height:2rem;grid-column:1 / -1}.token-pulse strong{font-size:1.05rem;text-transform:uppercase}.token-pulse span{align-self:center;color:#52747a;font-size:.75rem}.token-signal-metrics{grid-column:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;margin:.55rem 0 0}.token-signal-metrics>div{min-width:0;border-left:3px solid currentColor;background:hsl(var(--card) / .38);padding:.7rem .75rem}.token-signal-metrics dt,.token-metrics dt{color:hsl(var(--muted-foreground));font-size:11px}.token-signal-metrics dd,.token-metrics dd{min-width:0;margin:.25rem 0 0;overflow:hidden;text-overflow:ellipsis;font-size:1.25rem;font-weight:750}.token-signal-metrics [data-accent="cyan"],.token-metrics [data-accent="cyan"]{color:#118fa5}.token-signal-metrics [data-accent="blue"],.token-metrics [data-accent="blue"]{color:#386fd2}.token-signal-metrics [data-accent="green"],.token-metrics [data-accent="green"]{color:#248757}.token-metrics [data-accent="violet"]{color:#7654ad}.token-breakdown,.token-heatmap-section,.token-recent{padding-top:1rem}.token-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:.75rem;margin-bottom:.55rem}.token-section-heading>div{min-width:0;display:grid;gap:.15rem}.token-section-heading h3{margin:0;font-size:.8125rem;letter-spacing:0}.token-section-heading small{color:hsl(var(--muted-foreground));font-size:11px}.token-section-heading>span{color:hsl(var(--destructive));font-size:11px}.token-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border-top:1px solid hsl(var(--border));border-bottom:1px solid hsl(var(--border))}.token-metrics>div{min-width:0;display:grid;gap:.1rem;padding:.8rem .7rem;border-right:1px solid hsl(var(--border))}.token-metrics>div:last-child{border-right:0}.token-heatmap-legend{display:flex!important;grid-auto-flow:column;align-items:center;gap:.3rem;color:hsl(var(--muted-foreground));font-size:11px}.token-heatmap-legend i,.token-heatmap span{display:block;border-radius:.2rem;background:hsl(var(--muted) / .75)}.token-heatmap-legend i{width:.75rem;height:.75rem}.token-heatmap{display:grid;grid-template-rows:repeat(7,.8rem);grid-auto-flow:column;grid-auto-columns:.8rem;gap:.24rem;max-width:100%;overflow-x:auto;padding:.25rem 0 .4rem}.token-heatmap span{width:.8rem;height:.8rem}.token-heatmap [data-level="1"],.token-heatmap-legend [data-level="1"]{background:#b9e4e2}.token-heatmap [data-level="2"],.token-heatmap-legend [data-level="2"]{background:#67c5c4}.token-heatmap [data-level="3"],.token-heatmap-legend [data-level="3"]{background:#438de0}.token-heatmap [data-level="4"],.token-heatmap-legend [data-level="4"]{background:#295bb7}.token-session-list{display:grid}.token-session-row{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid hsl(var(--border));padding:.7rem .1rem}.token-session-row:last-child{border-bottom:1px solid hsl(var(--border))}.token-session-row:hover strong{color:hsl(var(--primary))}.token-session-row>span{min-width:0;display:grid;gap:.15rem}.token-session-row>span:last-child{flex:0 0 auto;text-align:right}.token-session-row strong{min-width:0;max-width:28rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8125rem}.token-session-row small,.token-session-row time{color:hsl(var(--muted-foreground));font-size:11px}.token-session-row b{font-size:.8125rem}.token-empty{border-top:1px solid hsl(var(--border));border-bottom:1px solid hsl(var(--border));padding:1rem 0;color:hsl(var(--muted-foreground));font-size:.8125rem;text-align:center}.token-dialog-fallback[open]{position:fixed!important;z-index:1000!important;inset:0!important;width:100%!important;max-width:none!important;height:100%!important;max-height:none!important;margin:0!important;display:flex!important;align-items:center;justify-content:center;border:0!important;background:hsl(60 2% 8% / .56)!important;padding:1rem!important}.token-modal-open{overflow:hidden}
.workspace-summary{min-width:0;display:flex;align-items:center;gap:.5rem;border-radius:.55rem;padding:.4rem .45rem;cursor:pointer;transition:background-color .15s ease}.workspace-summary:hover{background:hsl(var(--card) / .58)}.workspace-symbol{width:1.75rem;height:1.75rem;min-width:1.75rem;border-radius:.5rem;color:hsl(var(--primary));display:inline-flex;align-items:center;justify-content:center}.workspace-copy{min-width:0;flex:1;display:grid;gap:.05rem}.workspace-copy span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.875rem;font-weight:650}.workspace-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font-size:11px}.session-count{height:1.3rem;min-width:1.3rem;border:1px solid hsl(var(--border));border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0 .35rem;color:hsl(var(--muted-foreground));font-size:11px}.workspace-chevron{color:hsl(var(--muted-foreground));transition:transform .15s ease}.workspace-group[open] .workspace-chevron{transform:rotate(90deg)}
.workspace-sessions{margin-left:2.05rem;display:flex;flex-direction:column}.workspace-empty{margin:.25rem 0 .5rem;border:1px dashed hsl(var(--border));border-radius:.5rem;background:hsl(var(--card) / .2);padding:.8rem;color:hsl(var(--muted-foreground));text-align:center;font-size:11px}.console-session{min-width:0;display:flex;align-items:center;gap:.55rem;border-radius:.55rem;padding:.52rem .55rem;transition:background-color .15s ease}.console-session:hover{background:hsl(var(--card) / .7)}.console-session-copy{min-width:0;flex:1;display:grid;gap:.12rem}.console-session-copy span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--foreground));font-size:.875rem}.console-session-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font-size:11px}.console-session time{flex:0 0 auto;color:hsl(var(--muted-foreground));font-size:11px}
.console-empty{min-height:16rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.45rem;border:1px dashed hsl(var(--border));border-radius:.75rem;background:hsl(var(--card) / .28);padding:1.25rem;text-align:center;color:hsl(var(--muted-foreground))}.console-empty svg{width:1.35rem;height:1.35rem;color:hsl(var(--primary))}.console-empty strong{color:hsl(var(--foreground));font-size:.95rem}.console-empty span{max-width:18rem;font-size:.8125rem;line-height:1.5}
.compose-fab{position:absolute;right:1rem;bottom:max(1rem,env(safe-area-inset-bottom));height:3rem;border-radius:999px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));display:inline-flex;align-items:center;justify-content:center;gap:.45rem;padding:0 1.25rem;font-size:.875rem;font-weight:650;box-shadow:0 14px 28px -18px hsl(var(--foreground) / .65);transition:transform .15s ease}.compose-fab:active{transform:translateY(1px)}
.compose-frame{max-width:72rem}.compose-main{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:.75rem;overflow-y:auto;padding:1rem}.selector-stack{display:flex;flex-direction:column;gap:.5rem;width:min(100%,42rem);margin:0 auto}.selector-row{min-width:0;width:100%;height:2.75rem;border:1px solid hsl(var(--border));border-radius:.65rem;background:hsl(var(--card) / .7);display:flex;align-items:center;gap:.6rem;padding:0 .75rem;color:hsl(var(--foreground))}.selector-row span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.875rem;font-weight:550}.selector-row svg{color:hsl(var(--muted-foreground))}.selector-row-select select{min-width:0;flex:1;border:0;background:transparent;color:hsl(var(--foreground));font:inherit;font-size:.875rem;font-weight:550;outline:0}.compose-prompt{width:min(100%,42rem);margin:0 auto}.compose-prompt .chat-input-placeholder{min-height:96px}.compose-error{width:min(100%,42rem);margin:0 auto;color:hsl(var(--destructive));font-size:.75rem;line-height:1.4}
.cron-scroll{padding-bottom:2rem}.cron-list{width:min(100%,48rem);margin:0 auto;display:flex;flex-direction:column;gap:.75rem}.cron-card{width:min(100%,48rem);margin:0 auto;border:1px solid hsl(var(--border));border-radius:.75rem;background:hsl(var(--background) / .78);box-shadow:0 1px 2px hsl(var(--foreground) / .05);overflow:hidden}.cron-create{display:flex;flex-direction:column;gap:.75rem;padding:.9rem}.cron-card-title{display:flex;align-items:center;gap:.5rem;font-size:.9rem}.cron-card-title svg{width:1rem;height:1rem;color:hsl(var(--primary))}.cron-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.cron-grid label,.cron-prompt{min-width:0;display:grid;gap:.3rem}.cron-grid span,.cron-prompt span{color:hsl(var(--muted-foreground));font-size:11px}.cron-grid input,.cron-grid select,.cron-prompt textarea{min-width:0;width:100%;border:1px solid hsl(var(--input));border-radius:.55rem;background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:.875rem;outline:0}.cron-grid input,.cron-grid select{height:2.35rem;padding:0 .65rem}.cron-prompt textarea{resize:vertical;min-height:6rem;padding:.65rem;line-height:1.55}.cron-grid input:focus,.cron-grid select:focus,.cron-prompt textarea:focus{border-color:hsl(var(--primary) / .45);box-shadow:0 0 0 1px hsl(var(--primary) / .12)}.cron-actions{display:flex;align-items:center;justify-content:flex-end;gap:.5rem;flex-wrap:wrap}.cron-enabled{margin-right:auto;display:inline-flex;align-items:center;gap:.35rem;color:hsl(var(--muted-foreground));font-size:.8125rem}.cron-primary,.cron-secondary{height:2.35rem;border:1px solid hsl(var(--border));border-radius:.55rem;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;padding:0 .75rem;font:inherit;font-size:.8125rem;font-weight:650;cursor:pointer}.cron-primary{background:hsl(var(--primary));border-color:hsl(var(--primary));color:hsl(var(--primary-foreground))}.cron-secondary{background:hsl(var(--card) / .5);color:hsl(var(--foreground))}.cron-secondary.danger{color:hsl(var(--destructive))}.cron-primary svg,.cron-secondary svg{width:.95rem;height:.95rem}.cron-task summary{list-style:none}.cron-task summary::-webkit-details-marker{display:none}.cron-task-summary{display:flex;align-items:center;gap:.55rem;padding:.65rem .75rem;cursor:pointer}.cron-task-copy{min-width:0;flex:1;display:grid;gap:.1rem}.cron-task-copy strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem}.cron-task-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font-size:11px}.cron-task[open] .workspace-chevron{transform:rotate(90deg)}.cron-task-form{border-top:1px solid hsl(var(--border) / .7);padding:.8rem;display:flex;flex-direction:column;gap:.75rem}.cron-meta{display:flex;gap:.6rem;flex-wrap:wrap;color:hsl(var(--muted-foreground));font-size:11px}.cron-meta a{color:hsl(var(--primary));font-weight:600}.cron-error-text{color:hsl(var(--destructive))}
.alert-dialog{width:min(calc(100% - 2rem),28rem);max-width:28rem;margin:auto;border:0;border-radius:.5rem;background:transparent;padding:0;color:hsl(var(--foreground));overflow:visible}.alert-dialog::backdrop{background:hsl(60 2% 8% / .48);backdrop-filter:blur(2px)}.alert-dialog-content{display:grid;gap:1rem;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--background));padding:1.25rem;box-shadow:0 24px 70px -22px hsl(var(--foreground) / .55);animation:alert-dialog-in .16s ease-out}.alert-dialog-icon{width:2.25rem;height:2.25rem;border-radius:.5rem;background:hsl(var(--destructive) / .1);color:hsl(var(--destructive));display:inline-flex;align-items:center;justify-content:center}.alert-dialog-icon svg,.alert-dialog-confirm svg{width:1rem;height:1rem}.alert-dialog-copy{display:grid;gap:.45rem}.alert-dialog-copy h2{margin:0;font-size:1rem;line-height:1.4;letter-spacing:0}.alert-dialog-copy p{margin:0;color:hsl(var(--muted-foreground));font-size:.875rem;line-height:1.6;overflow-wrap:anywhere}.alert-dialog-copy strong{color:hsl(var(--foreground));font-weight:650}.alert-dialog-actions{display:flex;justify-content:flex-end;gap:.5rem}.alert-dialog-cancel,.alert-dialog-confirm{height:2.35rem;border-radius:.5rem;padding:0 .85rem;display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-size:.8125rem;font-weight:650;cursor:pointer}.alert-dialog-cancel{border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground))}.alert-dialog-confirm{border:1px solid hsl(var(--destructive));background:hsl(var(--destructive));color:hsl(var(--destructive-foreground))}.alert-dialog-confirm:disabled{opacity:.55;cursor:wait}.alert-dialog-error{margin:0;color:hsl(var(--destructive));font-size:.75rem;line-height:1.45}.alert-dialog-error[hidden]{display:none}@keyframes alert-dialog-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
.memory-scroll{padding:1rem 1rem 2rem}.memory-toolbar{width:min(100%,52rem);margin:0 auto;display:grid;grid-template-columns:minmax(15rem,1.35fr) minmax(12rem,1fr) 8.5rem;gap:.55rem}.memory-session-select,.memory-search{position:relative;min-width:0;height:2.5rem;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));display:flex;align-items:center}.memory-session-select>svg:first-child,.memory-search>svg{position:absolute;left:.7rem;width:1rem;height:1rem;color:hsl(var(--muted-foreground));pointer-events:none}.memory-session-select>svg:last-child{position:absolute;right:.65rem;width:.9rem;height:.9rem;color:hsl(var(--muted-foreground));pointer-events:none}.memory-session-select select,.memory-search input,.memory-type-filter{width:100%;height:100%;min-width:0;border:0;background:transparent;color:hsl(var(--foreground));font:inherit;font-size:.8125rem;outline:0}.memory-session-select select{appearance:none;padding:0 2.1rem 0 2.15rem;text-overflow:ellipsis}.memory-search input{padding:0 .75rem 0 2.15rem}.memory-type-filter{height:2.5rem;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));padding:0 .65rem}.memory-session-select:focus-within,.memory-search:focus-within,.memory-type-filter:focus{border-color:hsl(var(--ring) / .55);box-shadow:0 0 0 1px hsl(var(--ring) / .14)}.memory-stats{width:min(100%,52rem);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:1rem auto 1.2rem;border-top:1px solid hsl(var(--border));border-bottom:1px solid hsl(var(--border))}.memory-stats>div{display:grid;gap:.2rem;padding:.8rem 1rem;border-right:1px solid hsl(var(--border))}.memory-stats>div:last-child{border-right:0}.memory-stats dt{color:hsl(var(--muted-foreground));font-size:11px}.memory-stats dd{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:700}.memory-list-heading{width:min(100%,52rem);margin:0 auto .5rem;display:flex;align-items:center;justify-content:space-between}.memory-list-heading strong{font-size:.8125rem}.memory-list-heading span{color:hsl(var(--muted-foreground));font-size:11px}.memory-list{width:min(100%,52rem);margin:0 auto;display:grid;gap:.45rem}.memory-row{width:100%;min-height:4.4rem;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--background));color:hsl(var(--foreground));display:grid;grid-template-columns:4.5rem minmax(0,1fr) auto;align-items:center;gap:.7rem;padding:.7rem .75rem;text-align:left;font:inherit;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}.memory-row[hidden]{display:none}.memory-row:hover{border-color:hsl(var(--primary) / .38);background:hsl(var(--card) / .24);box-shadow:0 8px 24px -20px hsl(var(--foreground) / .5)}.memory-row:focus-visible{outline:2px solid hsl(var(--ring) / .45);outline-offset:2px}.memory-type-badge{width:4.5rem;height:1.5rem;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0 .45rem;font-size:11px;font-weight:650;white-space:nowrap}.memory-type-badge.type-preference{background:#fce7d8;color:#9a3412}.memory-type-badge.type-fact{background:#dff3ef;color:#11645a}.memory-type-badge.type-decision{background:#e9e6f5;color:#55458a}.memory-type-badge.type-context{background:#e8eef5;color:#315b78}.memory-type-badge.type-todo{background:#f6edcf;color:#785b12}.memory-type-badge.type-instruction{background:#e7efe0;color:#3f672c}.memory-row-copy{min-width:0;display:grid;gap:.25rem}.memory-row-copy strong{min-width:0;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:.8125rem;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.memory-row-copy small{color:hsl(var(--muted-foreground));font-size:11px}.memory-filter-empty{border:1px dashed hsl(var(--border));border-radius:.5rem;padding:2rem;color:hsl(var(--muted-foreground));font-size:.8125rem;text-align:center}.memory-filter-empty[hidden]{display:none}.memory-detail-form{display:grid;gap:1rem}.memory-detail-form>label{display:grid;gap:.4rem}.memory-detail-form>label>span{color:hsl(var(--muted-foreground));font-size:.75rem}.memory-detail-form select,.memory-detail-form textarea{width:100%;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));color:hsl(var(--foreground));padding:.65rem .75rem;font:inherit;font-size:.875rem;outline:0}.memory-detail-form select{height:2.5rem;padding-top:0;padding-bottom:0}.memory-detail-form textarea{min-height:10rem;resize:vertical;line-height:1.6}.memory-detail-form select:focus,.memory-detail-form textarea:focus{border-color:hsl(var(--ring) / .55);box-shadow:0 0 0 1px hsl(var(--ring) / .14)}.memory-detail-meta{display:flex;flex-wrap:wrap;gap:.35rem .75rem;border-top:1px solid hsl(var(--border));padding-top:.75rem;color:hsl(var(--muted-foreground));font-size:11px}.memory-detail-actions{border-top:0;padding-top:0}.memory-detail-actions .danger{margin-right:auto}
.cron-agent-guide{width:min(100%,48rem);margin:0 auto 1.15rem;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:.8rem;border-left:3px solid hsl(var(--primary));background:hsl(var(--card) / .32);padding:.85rem .95rem}.cron-agent-guide-icon{width:2rem;height:2rem;color:hsl(var(--primary));display:inline-flex;align-items:center;justify-content:center}.cron-agent-guide-icon svg,.cron-agent-guide-action svg{width:1rem;height:1rem}.cron-agent-guide-copy{min-width:0;display:grid;gap:.3rem}.cron-agent-guide-copy strong{font-size:.9rem}.cron-agent-guide-copy p{margin:0;color:hsl(var(--muted-foreground));font-size:.8125rem;line-height:1.55}.cron-agent-guide-copy blockquote{margin:.2rem 0 0;border:0;color:hsl(var(--foreground));font-size:.8125rem;line-height:1.55;overflow-wrap:anywhere}.cron-agent-guide-action{height:2.35rem;border:1px solid hsl(var(--primary));border-radius:.5rem;background:hsl(var(--primary));color:hsl(var(--primary-foreground));display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:0 .75rem;font-size:.8125rem;font-weight:650;white-space:nowrap}.cron-list-heading{width:min(100%,48rem);margin:0 auto .5rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem}.cron-list-heading strong{font-size:.8125rem}.cron-list-heading span{color:hsl(var(--muted-foreground));font-size:11px}.cron-task-row{width:100%;min-height:4rem;border:1px solid hsl(var(--border));border-radius:.55rem;background:hsl(var(--background));color:hsl(var(--foreground));display:flex;align-items:center;gap:.65rem;padding:.65rem .75rem;text-align:left;font:inherit;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}.cron-task-row:hover{border-color:hsl(var(--primary) / .35);background:hsl(var(--card) / .28);box-shadow:0 7px 20px -18px hsl(var(--foreground) / .45)}.cron-task-row:focus-visible{outline:2px solid hsl(var(--ring) / .45);outline-offset:2px}.cron-task-row-icon{width:2rem;height:2rem;min-width:2rem;border-radius:.5rem;background:hsl(var(--card) / .55);color:hsl(var(--primary));display:inline-flex;align-items:center;justify-content:center}.cron-task-row-icon svg{width:1rem;height:1rem}.cron-task-status{height:1.45rem;border-radius:999px;display:inline-flex;align-items:center;padding:0 .45rem;font-size:11px;font-weight:600}.cron-task-status.enabled{background:#dcfce7;color:#166534}.cron-task-status.disabled{background:hsl(var(--muted));color:hsl(var(--muted-foreground))}.task-dialog{width:min(calc(100% - 2rem),44rem);max-width:44rem;max-height:min(90dvh,48rem);margin:auto;border:0;border-radius:.5rem;background:transparent;padding:0;color:hsl(var(--foreground));overflow:visible}.task-dialog::backdrop{background:hsl(60 2% 8% / .42);backdrop-filter:blur(2px)}.task-dialog-content{max-height:min(90dvh,48rem);display:flex;flex-direction:column;overflow:hidden;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--background));box-shadow:0 24px 70px -22px hsl(var(--foreground) / .55);animation:alert-dialog-in .16s ease-out}.task-dialog-header{min-height:4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--border));padding:.75rem 1rem}.task-dialog-header>div{min-width:0;display:grid;gap:.1rem}.task-dialog-header span{color:hsl(var(--muted-foreground));font-size:11px}.task-dialog-header h2{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;letter-spacing:0}.task-dialog-close{width:2.25rem;height:2.25rem;min-width:2.25rem;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--background));color:hsl(var(--muted-foreground));display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.task-dialog-close svg{width:1rem;height:1rem}.task-dialog-form{min-height:0;overflow-y:auto;border-top:0;padding:1rem}.alert-dialog-icon[hidden],[data-action-confirm-icon][hidden]{display:none}.alert-dialog-icon.run{background:hsl(var(--primary) / .1);color:hsl(var(--primary))}.alert-dialog-confirm[data-variant="default"]{border-color:hsl(var(--primary));background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.session-page{width:100%;height:100dvh;min-height:100dvh;overflow:hidden;background:hsl(38 31% 94%);display:flex;justify-content:center}
.agent-bridge-mobile-chat{--safe-area-inset-bottom:env(safe-area-inset-bottom,0px);width:100%;max-width:760px;height:100dvh;min-height:100dvh;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(circle at 50% -20%,hsl(38 31% 94% / .95),transparent 38%),linear-gradient(180deg,hsl(48 33% 97%) 0%,hsl(38 31% 94%) 100%);border-left:1px solid hsl(var(--border) / .62);border-right:1px solid hsl(var(--border) / .62)}
.mobile-chat-topbar{flex:0 0 auto;border-bottom:1px solid hsl(var(--border));background:hsl(var(--background) / .9);padding:.5rem;backdrop-filter:blur(18px);box-shadow:0 1px 0 hsl(var(--border) / .55)}
.mobile-chat-topbar-inner{width:100%;max-width:56rem;margin:0 auto;display:flex;align-items:center;gap:.5rem}
.mobile-chat-icon-button{width:2.25rem;height:2.25rem;min-width:2.25rem;min-height:2.25rem;border:0;border-radius:.55rem;background:transparent;color:hsl(var(--foreground));display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .15s ease,color .15s ease}
.mobile-chat-icon-button svg,.prompt-tool-button svg,.prompt-send-button svg,.role-icon svg,.prompt-chip svg{width:1rem;height:1rem;display:block}
.mobile-chat-icon-button:hover{background:hsl(var(--card) / .65)}
.mobile-chat-title{min-width:0;flex:1;overflow:hidden}
.mobile-chat-title-row{min-width:0;display:flex;align-items:center;gap:.5rem}
.session-name-mobile{min-width:0;max-width:100%;margin:0;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.875rem;font-weight:650;line-height:1.25;letter-spacing:0;color:hsl(var(--foreground))}
.mobile-chat-subtitle{margin-top:.125rem;min-width:0;display:flex;align-items:center;gap:.375rem;font-size:11px;line-height:1.25;color:hsl(var(--muted-foreground))}
.truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta-dot{width:.25rem;height:.25rem;flex:0 0 auto;border-radius:999px;background:hsl(var(--muted-foreground) / .45)}
.chat-surface{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
.mobile-chat-messages{position:relative;min-width:0;min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;padding:.75rem 0 calc(1.5rem + env(safe-area-inset-bottom,0px));scroll-padding-bottom:calc(2rem + env(safe-area-inset-bottom,0px));touch-action:pan-y;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:hsl(var(--muted-foreground) / .25) transparent}
.mobile-chat-messages::-webkit-scrollbar,.chat-input-placeholder::-webkit-scrollbar{width:6px}.mobile-chat-messages::-webkit-scrollbar-track,.chat-input-placeholder::-webkit-scrollbar-track{background:transparent}.mobile-chat-messages::-webkit-scrollbar-thumb,.chat-input-placeholder::-webkit-scrollbar-thumb{background:hsl(var(--muted-foreground) / .25);border-radius:999px}
.message-stream{max-width:56rem;min-height:100%;width:100%;margin:0 auto;display:flex;flex-direction:column;gap:1rem;padding:0 .75rem;overflow:hidden}
.chat-message{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}.chat-message pre,.chat-message code{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.chat-message.user,.chat-message.assistant{display:flex;align-items:flex-start;gap:.75rem}.chat-message.user{width:100%;justify-content:flex-end}.chat-message.assistant{justify-content:flex-start}.message-content{min-width:0;max-width:100%}.message-content-user{max-width:90%;display:flex;flex-direction:column;align-items:flex-end}.message-content-assistant{flex:1}
.message-bubble{min-width:0;max-width:100%;font-size:.875rem;line-height:1.75;overflow-wrap:anywhere;word-break:break-word}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body p{margin:.15rem 0 .65rem}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{margin:1rem 0 .45rem;line-height:1.4;letter-spacing:0}.markdown-body h1{font-size:1.12rem}.markdown-body h2{font-size:1.02rem}.markdown-body h3,.markdown-body h4{font-size:.94rem}.markdown-body ul,.markdown-body ol{margin:.35rem 0 .75rem;padding-left:1.35rem}.markdown-body li{margin:.18rem 0}.markdown-body li>p{margin:.1rem 0}.markdown-body blockquote{margin:.6rem 0;border-left:3px solid hsl(var(--primary) / .55);padding:.1rem 0 .1rem .75rem;color:hsl(var(--muted-foreground))}.markdown-body a{color:hsl(var(--primary));font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}.markdown-body hr{margin:1rem 0;border:0;border-top:1px solid hsl(var(--border))}.markdown-body code{border:1px solid hsl(var(--border) / .7);border-radius:.35rem;background:hsl(var(--muted) / .65);padding:.05rem .25rem}.markdown-body pre{max-width:100%;margin:.65rem 0;overflow-x:auto;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--foreground) / .045);padding:.7rem .8rem;line-height:1.55}.markdown-body pre code{display:block;min-width:max-content;border:0;border-radius:0;background:transparent;padding:0;white-space:pre;word-break:normal}.markdown-body table{display:block;max-width:100%;margin:.65rem 0;overflow-x:auto;border-collapse:collapse;font-size:.8125rem}.markdown-body th,.markdown-body td{border:1px solid hsl(var(--border));padding:.4rem .55rem;text-align:left;white-space:nowrap}.markdown-body th{background:hsl(var(--card) / .72);font-weight:650}.markdown-image-placeholder{color:hsl(var(--muted-foreground));font-size:.8125rem}.user-bubble .markdown-body a,.user-bubble a{color:inherit}.user-bubble .markdown-body blockquote,.user-bubble blockquote{color:inherit;border-left-color:currentColor}.user-bubble pre{background:hsl(0 0% 100% / .12);border-color:hsl(0 0% 100% / .25)}.user-bubble code{background:hsl(0 0% 100% / .12);border-color:hsl(0 0% 100% / .22)}
.user-bubble{min-width:0;max-width:100%;border-radius:.75rem;border-bottom-right-radius:.35rem;background:hsl(var(--primary));color:hsl(var(--primary-foreground));padding:.75rem 1rem;box-shadow:0 1px 2px hsl(var(--foreground) / .08)}
.assistant-copy{padding:.25rem .125rem;color:hsl(var(--foreground))}
.mobile-chat-system-message{width:100%;max-width:100%;border:1px solid hsl(var(--border));border-radius:.75rem;background:linear-gradient(180deg,hsl(48 33% 97% / .78),hsl(39 35% 90% / .54));padding:.625rem .75rem;box-shadow:0 1px 2px hsl(var(--foreground) / .05)}
.mobile-chat-system-message.error{border-color:hsl(var(--destructive) / .25);background:hsl(var(--destructive) / .05)}
.system-message-row{display:flex;align-items:flex-start;gap:.75rem}.system-message-copy{min-width:0;flex:1}.system-message-copy p{margin:.2rem 0 0;white-space:pre-wrap;word-break:break-word;font-size:.875rem;line-height:1.5}
.message-meta{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:.75rem;font-size:11px;line-height:1.2;color:hsl(var(--muted-foreground))}.message-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600;color:hsl(var(--foreground))}.message-meta time{min-width:0;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.role-icon,.role-icon-spacer{width:2.25rem;height:2.25rem;min-width:2.25rem;border-radius:.7rem;display:inline-flex;align-items:center;justify-content:center}.role-icon{border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--primary))}.role-icon.user{border-radius:999px;color:hsl(var(--accent-foreground));background:hsl(var(--accent) / .18)}.role-icon.assistant{border-radius:999px}.role-icon.error{color:hsl(var(--destructive))}
.mobile-chat-composer{flex:0 0 auto;padding:.5rem;padding-bottom:calc(.5rem + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,hsl(38 31% 94% / 0),hsl(48 33% 97% / .94) 34%,hsl(48 33% 97%))}
.mobile-chat-composer-inner{width:100%;max-width:56rem;margin:0 auto}.mobile-chat-prompt-input{position:relative;overflow:hidden;border:1px solid hsl(var(--border));border-radius:.75rem;background:linear-gradient(180deg,hsl(var(--card) / .92),hsl(48 33% 97% / .95));box-shadow:0 1px 2px hsl(var(--foreground) / .06);backdrop-filter:blur(8px);transition:border-color .2s ease,box-shadow .2s ease}.mobile-chat-prompt-input:focus-within{border-color:hsl(var(--primary) / .35);box-shadow:0 8px 22px -18px hsl(var(--foreground) / .45),0 0 0 1px hsl(var(--primary) / .15)}
.prompt-input-body{position:relative}.chat-input-placeholder{display:block;width:100%;min-height:76px;max-height:40vh;resize:none;overflow-y:auto;border:0;background:transparent;padding:.75rem 1rem;font-size:1rem;line-height:1.5;color:hsl(var(--foreground));outline:0}.chat-input-placeholder::placeholder{color:hsl(var(--muted-foreground) / .62);opacity:1}
.prompt-input-footer{display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-top:1px solid hsl(var(--border) / .3);padding:.5rem .75rem}.prompt-input-tools,.prompt-input-actions{min-width:0;display:flex;align-items:center;gap:.35rem}.prompt-tool-button,.prompt-chip,.status-chip{height:2rem;border:1px solid hsl(var(--border) / .6);border-radius:.55rem;background:transparent;color:hsl(var(--muted-foreground));display:inline-flex;align-items:center;justify-content:center;gap:.3rem}.prompt-tool-button{width:2rem;cursor:pointer}.prompt-chip,.status-chip{padding:0 .5rem;font-size:.75rem;font-weight:500;white-space:nowrap}.prompt-tool-button:hover,.prompt-chip:hover{background:hsl(var(--card) / .7)}.prompt-send-button{width:2.5rem;height:2.5rem;border:0;border-radius:.55rem;background:hsl(var(--primary));color:hsl(var(--primary-foreground));display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.prompt-send-button svg{width:1.1rem;height:1.1rem}
.empty-session-state{min-height:260px;display:flex;align-items:center;justify-content:center;color:hsl(var(--muted-foreground));font-size:.875rem}.hide-mobile{display:block}
@media (max-width:767px){html:has(.agent-bridge-app-viewport),body:has(.agent-bridge-app-viewport){height:100%;overflow:hidden;overscroll-behavior:none}.agent-bridge-app-viewport,.agent-bridge-mobile-chat{height:100dvh;min-height:100dvh;overflow:hidden;overscroll-behavior:none}.agent-bridge-mobile-chat{border:0}.agent-bridge-mobile-chat *,.console-page *{-webkit-tap-highlight-color:transparent}.console-page{padding:0}.console-frame{width:100%;border:0;border-radius:0;box-shadow:none}.console-header{padding:.45rem .5rem}.console-search{padding:.65rem .75rem}.console-search svg{left:1.55rem}.console-scroll{padding:.65rem .75rem 5.5rem}.console-list{max-width:none}.workspace-sessions{margin-left:1.75rem}.compose-main{padding:.75rem .75rem max(.85rem,env(safe-area-inset-bottom));justify-content:flex-end}.selector-stack,.compose-prompt,.compose-error{max-width:none;width:100%}.cron-scroll,.memory-scroll{padding:.75rem .75rem 1.25rem}.cron-list,.cron-card{max-width:none;width:100%}.cron-agent-guide{grid-template-columns:auto minmax(0,1fr);padding:.8rem}.cron-agent-guide-action{grid-column:1 / -1;width:100%}.cron-task-row{min-height:3.7rem;padding:.6rem}.cron-task-status{display:none}.memory-toolbar{grid-template-columns:1fr 1fr}.memory-session-select{grid-column:1 / -1}.memory-stats>div{padding:.7rem .55rem}.memory-row{grid-template-columns:4rem minmax(0,1fr) auto;padding:.65rem}.memory-type-badge{width:4rem}.memory-detail-actions{flex-direction:row}.memory-detail-actions .cron-secondary,.memory-detail-actions .cron-primary{flex:1}.task-dialog{width:calc(100% - 1rem);max-height:92dvh}.task-dialog-content{max-height:92dvh}.task-dialog-form{padding:.85rem}.cron-grid{grid-template-columns:1fr}.cron-actions{justify-content:flex-start}.cron-enabled{width:100%;margin-right:0}.alert-dialog-actions{flex-direction:column-reverse}.alert-dialog-cancel,.alert-dialog-confirm{width:100%}.message-content-user{max-width:85%}.role-icon.user{display:none}.hide-mobile{display:none}.mobile-chat-topbar{padding:.45rem .5rem}.message-stream{gap:.85rem;padding:0 .75rem}.status-chip{display:none}.hide-xs{display:none}}
@media (max-width:767px){.console-token-button{min-width:3.8rem;padding:0 .45rem}.token-dialog{width:calc(100% - 1rem)}.token-dialog-body{padding:.75rem}.token-range-tabs{width:100%;margin-bottom:.65rem}.token-range-tabs button{min-width:0;flex:1}.token-total-band{grid-template-columns:minmax(0,1fr) 6.5rem;gap:.7rem;padding:.85rem 0}.token-total-copy>strong{font-size:2.65rem}.token-pulse{min-height:7rem;padding:.7rem;grid-template-columns:1fr}.token-pulse svg{width:1.5rem;height:1.5rem}.token-pulse strong{font-size:.9rem}.token-pulse span{display:none}.token-signal-metrics{grid-column:1 / -1;gap:.35rem;margin-top:.2rem}.token-signal-metrics>div{padding:.55rem}.token-signal-metrics dd{font-size:1.05rem}.token-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.token-metrics>div:nth-child(2n){border-right:0}.token-metrics>div:nth-child(n+3){border-top:1px solid hsl(var(--border))}.token-session-row strong{max-width:56vw}.token-dialog-fallback[open]{padding:.5rem!important}}
.console-session-group{min-width:0;display:grid;gap:.2rem;margin-bottom:.85rem}.console-session-group-heading{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.3rem .55rem;color:hsl(var(--muted-foreground));font-size:11px}.console-session-group-heading strong{color:hsl(var(--foreground));font-size:.75rem}.console-session-group-list{display:flex;flex-direction:column;gap:.12rem}.main-session-group{border:1px solid hsl(var(--primary) / .22);border-radius:.55rem;background:hsl(var(--card) / .28);padding:.25rem}.main-session-group .console-session-group-heading{border-bottom:1px solid hsl(var(--primary) / .16);padding-bottom:.5rem}.main-session-group .console-session{background:hsl(var(--background) / .72)}
.memory-selector{min-width:0;height:2.5rem;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));color:hsl(var(--foreground));display:flex;align-items:center;gap:.55rem;padding:0 .7rem;font:inherit;font-size:.8125rem;text-align:left;cursor:pointer}.memory-selector>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.memory-selector>svg{position:static!important;width:1rem!important;height:1rem!important;color:hsl(var(--muted-foreground));pointer-events:none}.memory-selector:focus-visible,.memory-selector:hover{border-color:hsl(var(--ring) / .55);box-shadow:0 0 0 1px hsl(var(--ring) / .14);outline:0}.memory-selector:disabled{cursor:default;opacity:.55}.memory-detail-type{width:100%;height:2.5rem;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));color:hsl(var(--foreground));display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:0 .75rem;font:inherit;font-size:.875rem;cursor:pointer}.memory-detail-type svg{width:1rem;height:1rem;color:hsl(var(--muted-foreground))}.memory-detail-form textarea:focus,.memory-detail-type:focus-visible{border-color:hsl(var(--ring) / .55);box-shadow:0 0 0 1px hsl(var(--ring) / .14);outline:0}
.memory-sheet{width:min(100%,42rem);max-width:42rem;max-height:min(80dvh,42rem);margin:auto auto 0;border:0;background:transparent;padding:0;color:hsl(var(--foreground));overflow:visible}.memory-sheet::backdrop{background:hsl(60 2% 8% / .48);backdrop-filter:blur(2px)}.memory-sheet-content{max-height:min(80dvh,42rem);display:flex;flex-direction:column;overflow:hidden;border:1px solid hsl(var(--border));border-bottom:0;border-radius:.5rem .5rem 0 0;background:hsl(var(--background));box-shadow:0 -20px 60px -24px hsl(var(--foreground) / .55);animation:memory-sheet-in .18s ease-out}.memory-sheet-header{min-height:4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--border));padding:.75rem 1rem}.memory-sheet-header>div{min-width:0;display:grid;gap:.1rem}.memory-sheet-header span{color:hsl(var(--muted-foreground));font-size:11px}.memory-sheet-header h2{margin:0;font-size:1rem;letter-spacing:0}.memory-sheet-header button{width:2.25rem;height:2.25rem;border:1px solid hsl(var(--border));border-radius:.5rem;background:transparent;color:hsl(var(--muted-foreground));display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.memory-sheet-header button svg{width:1rem;height:1rem}.memory-sheet-options{min-height:0;overflow-y:auto;padding:.45rem max(.75rem,env(safe-area-inset-right)) max(.75rem,env(safe-area-inset-bottom))}.memory-sheet-option{width:100%;min-height:3.8rem;border:0;border-bottom:1px solid hsl(var(--border));background:transparent;color:hsl(var(--foreground));display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.7rem;padding:.55rem .35rem;font:inherit;text-align:left;cursor:pointer}.memory-sheet-option:hover,.memory-sheet-option:focus-visible,.memory-sheet-option[aria-pressed="true"]{background:hsl(var(--card) / .4);outline:0}.memory-sheet-option>span:nth-child(2){min-width:0;display:grid;gap:.12rem}.memory-sheet-option strong,.memory-sheet-option small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.memory-sheet-option strong{font-size:.875rem}.memory-sheet-option small{color:hsl(var(--muted-foreground));font-size:11px}.memory-sheet-option>svg{width:1rem;height:1rem;color:hsl(var(--muted-foreground))}.memory-sheet-option-mark{width:2rem;height:2rem;border-radius:.5rem;background:hsl(var(--card) / .7);color:hsl(var(--muted-foreground));display:inline-flex;align-items:center;justify-content:center}.memory-sheet-option-mark.main{background:hsl(var(--primary) / .12);color:hsl(var(--primary))}.memory-sheet-option-mark svg{width:1rem;height:1rem}.memory-type-options .memory-type-badge{width:4rem}.memory-type-badge.type-all{background:hsl(var(--muted));color:hsl(var(--muted-foreground))}.memory-sheet-empty{margin:0;padding:2rem;color:hsl(var(--muted-foreground));text-align:center;font-size:.8125rem}@keyframes memory-sheet-in{from{opacity:.4;transform:translateY(1.5rem)}to{opacity:1;transform:translateY(0)}}
@media(max-width:767px){.memory-sheet{width:100%;max-width:none}.memory-sheet-content{border-inline:0}.console-session-group{margin-bottom:.7rem}}
.skill-count{width:2.25rem;height:2.25rem;min-width:2.25rem;border:1px solid hsl(var(--border));border-radius:50%;display:grid;place-items:center;color:hsl(var(--foreground));font-size:.75rem;font-weight:750}.skill-scroll{padding:1rem 1rem 2rem}.skill-search{position:relative;width:min(100%,52rem);height:2.6rem;margin:0 auto 1rem;border:1px solid hsl(var(--input));border-radius:.5rem;background:hsl(var(--background));display:flex;align-items:center}.skill-search svg{position:absolute;left:.75rem;width:1rem;height:1rem;color:hsl(var(--muted-foreground));pointer-events:none}.skill-search input{width:100%;height:100%;border:0;background:transparent;padding:0 .8rem 0 2.25rem;color:hsl(var(--foreground));font:inherit;font-size:.8125rem;outline:0}.skill-search:focus-within{border-color:hsl(var(--ring) / .55);box-shadow:0 0 0 1px hsl(var(--ring) / .14)}.skill-groups{width:min(100%,52rem);margin:0 auto;display:grid;gap:1.15rem}.skill-group[hidden],.skill-row[hidden],.skill-empty[hidden]{display:none}.skill-group{min-width:0}.skill-group-heading{min-height:2.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--foreground));padding:.25rem .1rem}.skill-group-heading>span{min-width:0;display:flex;align-items:baseline;gap:.5rem}.skill-group-heading strong{font-size:.8125rem}.skill-group-heading small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font-size:11px}.skill-group-heading b{color:hsl(var(--muted-foreground));font-size:11px;font-weight:600}.skill-list{display:flex;flex-direction:column}.skill-row{width:100%;min-height:4.6rem;border:0;border-bottom:1px solid hsl(var(--border));background:transparent;color:hsl(var(--foreground));display:grid;grid-template-columns:2.5rem minmax(0,1fr) auto;align-items:center;gap:.75rem;padding:.7rem .1rem;font:inherit;text-align:left;cursor:pointer}.skill-row:focus-visible{outline:2px solid hsl(var(--ring) / .45);outline-offset:2px}.skill-mark{width:2.35rem;height:2.35rem;border:1px solid hsl(var(--primary) / .55);border-radius:.45rem;background:hsl(var(--primary) / .07);color:hsl(var(--primary));display:grid;place-items:center;font-size:.7rem;font-weight:800}.skill-row-copy{min-width:0;display:grid;gap:.18rem}.skill-row-copy strong{font-size:.875rem}.skill-row-copy small{min-width:0;display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:hsl(var(--muted-foreground));font-size:11px;line-height:1.45;overflow-wrap:anywhere}.skill-row-meta{display:flex;align-items:center;gap:.35rem;color:hsl(var(--muted-foreground));font-size:11px}.skill-row-meta svg{width:.95rem;height:.95rem}.skill-empty{width:min(100%,52rem);margin:0 auto;border-top:1px solid hsl(var(--foreground));padding:2rem 0;color:hsl(var(--muted-foreground));text-align:center;font-size:.8125rem}.skill-detail-overlay[hidden]{display:none!important}.skill-detail-overlay{position:fixed;z-index:1000;inset:0;display:flex;align-items:flex-end;justify-content:center;background:hsl(60 2% 8% / .48);padding:0}.skill-detail-sheet{width:min(100%,42rem);max-height:min(78dvh,42rem);display:flex;flex-direction:column;overflow:hidden;border:1px solid hsl(var(--border));border-bottom:0;border-radius:.5rem .5rem 0 0;background:hsl(var(--background));box-shadow:0 -20px 60px -24px hsl(var(--foreground) / .55);animation:memory-sheet-in .18s ease-out}.skill-detail-header{min-height:4.5rem;display:grid;grid-template-columns:2.5rem minmax(0,1fr) 2.25rem;align-items:center;gap:.75rem;border-bottom:1px solid hsl(var(--border));padding:.75rem 1rem}.skill-detail-header>div{min-width:0;display:grid;gap:.05rem}.skill-detail-header>div>span{color:hsl(var(--muted-foreground));font-size:11px}.skill-detail-header h2{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;letter-spacing:0}.skill-detail-header button{width:2.25rem;height:2.25rem;border:1px solid hsl(var(--border));border-radius:.5rem;background:transparent;color:hsl(var(--muted-foreground));display:grid;place-items:center;cursor:pointer}.skill-detail-header button svg{width:1rem;height:1rem}.skill-detail-body{min-height:0;overflow-y:auto;padding:1rem max(1rem,env(safe-area-inset-right)) max(1rem,env(safe-area-inset-bottom))}.skill-detail-body>p{margin:0;color:hsl(var(--foreground));font-size:.875rem;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}.skill-detail-meta{display:grid;margin:1rem 0 0;border-top:1px solid hsl(var(--border))}.skill-detail-meta>div{display:grid;grid-template-columns:5rem minmax(0,1fr);gap:.75rem;border-bottom:1px solid hsl(var(--border));padding:.7rem 0}.skill-detail-meta>div[hidden]{display:none}.skill-detail-meta dt{color:hsl(var(--muted-foreground));font-size:11px}.skill-detail-meta dd{min-width:0;margin:0;overflow-wrap:anywhere;font-size:.8125rem}.skill-detail-open{overflow:hidden}@media(max-width:767px){.skill-scroll{padding:.75rem .75rem 1.5rem}.skill-row{grid-template-columns:2.5rem minmax(0,1fr) auto}.skill-row-meta>span{display:none}.skill-detail-sheet{border-inline:0}}
.private-batch-page{min-height:100dvh;background:hsl(var(--background));color:hsl(var(--foreground))}.private-batch-header{position:sticky;top:0;z-index:10;min-height:4.25rem;display:grid;grid-template-columns:2.5rem minmax(0,1fr) 2.5rem;align-items:center;gap:.75rem;border-bottom:1px solid hsl(var(--border));background:hsl(var(--background) / .96);padding:.55rem max(1rem,env(safe-area-inset-right))}.private-batch-header>div{min-width:0;display:grid;gap:.05rem}.private-batch-header span{color:hsl(var(--muted-foreground));font-size:11px}.private-batch-header h1{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;letter-spacing:0}.private-batch-count{width:2.2rem;height:2.2rem;border:1px solid hsl(var(--border));border-radius:50%;display:grid;place-items:center;color:hsl(var(--foreground))!important;font-weight:700}.private-batch-main{width:min(100%,46rem);margin:0 auto;padding:1rem max(1rem,env(safe-area-inset-right)) max(2rem,env(safe-area-inset-bottom))}.private-batch-summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--foreground));padding:.5rem 0 1rem}.private-batch-summary strong{font-size:.875rem}.private-batch-summary time{color:hsl(var(--muted-foreground));font-size:11px}.private-batch-list{display:flex;flex-direction:column}.private-batch-item{min-width:0;min-height:4.5rem;display:grid;grid-template-columns:3rem minmax(0,1fr) auto;align-items:center;gap:.75rem;border-bottom:1px solid hsl(var(--border));color:inherit;text-decoration:none}.private-batch-item:hover,.private-batch-item:focus-visible{background:hsl(var(--card) / .45);outline:0}.private-batch-reference{width:2.7rem;height:2rem;border:1px solid hsl(var(--primary) / .35);border-radius:.4rem;display:grid;place-items:center;color:hsl(var(--primary));font-size:.75rem;font-weight:700}.private-batch-copy{min-width:0;display:grid;gap:.15rem}.private-batch-copy strong,.private-batch-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.private-batch-copy strong{font-size:.875rem}.private-batch-copy small{color:hsl(var(--muted-foreground));font-size:11px}.private-batch-item>svg{width:1rem;height:1rem;color:hsl(var(--muted-foreground))}
.data-frame{width:min(100%,88rem)}.data-workspace{min-width:0;min-height:0;flex:1;display:grid;grid-template-columns:14rem minmax(0,1fr) 13rem;overflow:hidden}.data-catalog,.data-activity{min-width:0;min-height:0;overflow-y:auto;background:hsl(var(--card) / .22);padding:.75rem}.data-catalog{border-right:1px solid hsl(var(--border))}.data-activity{border-left:1px solid hsl(var(--border))}.data-catalog-heading{height:2rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;color:hsl(var(--muted-foreground));font-size:11px}.data-catalog-heading strong{color:hsl(var(--foreground));font-size:.75rem}.data-catalog-list{display:grid;gap:.2rem}.data-catalog-list a{min-width:0;min-height:3.4rem;display:grid;grid-template-columns:2rem minmax(0,1fr);align-items:center;gap:.55rem;border:1px solid transparent;border-radius:.45rem;padding:.4rem .45rem}.data-catalog-list a[aria-current="page"]{border-color:hsl(var(--primary) / .28);background:hsl(var(--background));box-shadow:0 1px 2px hsl(var(--foreground) / .06)}.data-catalog-list a>span:last-child{min-width:0;display:grid;gap:.12rem}.data-catalog-list strong,.data-catalog-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.data-catalog-list strong{font-size:.8rem}.data-catalog-list small{color:hsl(var(--muted-foreground));font-size:10px}.data-object-icon,.automation-item-icon{width:2rem;height:2rem;border-radius:.45rem;background:hsl(var(--primary) / .09);color:hsl(var(--primary));display:grid;place-items:center}.data-object-icon svg,.automation-item-icon svg{width:1rem;height:1rem}.data-storage-status{display:grid;gap:.2rem;border-top:1px solid hsl(var(--border));margin-top:.7rem;padding-top:.7rem;color:hsl(var(--muted-foreground));font-size:10px}.data-surface{min-width:0;min-height:0;overflow:auto;padding:1rem}.data-object-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--foreground));padding:0 0 .8rem}.data-object-heading>div{min-width:0;display:grid;gap:.12rem}.data-object-heading span{color:hsl(var(--muted-foreground));font-size:11px}.data-object-heading h1{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1.05rem;letter-spacing:0}.data-object-heading dl{display:flex;gap:1rem;margin:0}.data-object-heading dl>div{display:grid;gap:.1rem;text-align:right}.data-object-heading dt{color:hsl(var(--muted-foreground));font-size:10px}.data-object-heading dd{margin:0;font-size:.875rem;font-weight:700}.data-query-toolbar{display:grid;grid-template-columns:minmax(12rem,1fr) auto auto auto auto;gap:.45rem;padding:.75rem 0}.data-search{position:relative;min-width:0}.data-search svg{position:absolute;left:.65rem;top:50%;width:1rem;height:1rem;transform:translateY(-50%);color:hsl(var(--muted-foreground))}.data-search input,.data-query-toolbar select,.data-query-toolbar input{width:100%;height:2.35rem;border:1px solid hsl(var(--input));border-radius:.45rem;background:hsl(var(--background));color:hsl(var(--foreground));padding:0 .65rem;font:inherit;font-size:.75rem;outline:0}.data-search input{padding-left:2rem}.data-tool-button,.data-query-submit,.data-query-reset{height:2.35rem;border:1px solid hsl(var(--border));border-radius:.45rem;background:hsl(var(--background));color:hsl(var(--foreground));display:inline-flex;align-items:center;justify-content:center;gap:.35rem;padding:0 .65rem;font:inherit;font-size:.75rem;cursor:pointer}.data-tool-button svg,.data-query-submit svg,.data-query-reset svg{width:.9rem;height:.9rem}.data-query-submit{background:hsl(var(--primary));border-color:hsl(var(--primary));color:hsl(var(--primary-foreground))}.data-query-reset{width:2.35rem;padding:0;color:hsl(var(--muted-foreground))}.data-filter-row,.data-aggregate-row{grid-column:1 / -1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45rem;border-left:3px solid hsl(var(--primary));background:hsl(var(--card) / .28);padding:.55rem}.data-filter-row[hidden],.data-aggregate-row[hidden]{display:none}.data-filter-row label,.data-aggregate-row label{min-width:0;display:grid;gap:.25rem}.data-filter-row label>span,.data-aggregate-row label>span{color:hsl(var(--muted-foreground));font-size:10px}.data-result-meta{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.2rem 0 .45rem;color:hsl(var(--muted-foreground));font-size:10px}.data-grid-scroll{min-width:0;overflow:auto;border:1px solid hsl(var(--border));border-radius:.45rem;background:hsl(var(--background))}.data-grid{width:100%;border-collapse:separate;border-spacing:0;font-size:.75rem}.data-grid th{position:sticky;z-index:2;top:0;background:hsl(var(--secondary));border-bottom:1px solid hsl(var(--border));color:hsl(var(--muted-foreground));font-weight:650;text-align:left}.data-grid th a{min-width:7rem;height:2.35rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:0 .65rem}.data-grid th svg{width:.8rem;height:.8rem}.data-grid td{max-width:22rem;border-bottom:1px solid hsl(var(--border));padding:.55rem .65rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.data-grid tr:last-child td{border-bottom:0}.data-grid code{font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.data-null{color:hsl(var(--muted-foreground) / .62);font-style:italic}.data-number{font-variant-numeric:tabular-nums}.data-row-action{width:2.5rem!important;min-width:2.5rem!important}.data-row-action button{width:2rem;height:2rem;border:0;border-radius:.4rem;background:transparent;color:hsl(var(--muted-foreground));display:grid;place-items:center;cursor:pointer}.data-row-action svg{width:.9rem;height:.9rem}.data-pagination{min-height:3.25rem;display:flex;align-items:center;justify-content:center;gap:1rem;color:hsl(var(--muted-foreground));font-size:11px}.data-pagination a{height:2rem;display:inline-flex;align-items:center;gap:.3rem;border:1px solid hsl(var(--border));border-radius:.4rem;padding:0 .55rem}.data-pagination a[aria-disabled="true"]{pointer-events:none;opacity:.38}.data-pagination svg{width:.8rem;height:.8rem}.data-operation{display:grid;gap:.15rem;border-bottom:1px solid hsl(var(--border));padding:.65rem 0}.data-operation-kind{width:max-content;border:1px solid hsl(var(--border));border-radius:999px;padding:.1rem .35rem;color:hsl(var(--muted-foreground));font-size:9px}.data-operation strong{font-size:.75rem}.data-operation small,.data-side-empty{color:hsl(var(--muted-foreground));font-size:10px}.data-side-empty{padding:.75rem 0}.data-record-fields{min-height:0;overflow:auto;margin:0;padding:.5rem 1rem 1rem}.data-record-fields>div{display:grid;grid-template-columns:minmax(6rem,10rem) minmax(0,1fr);gap:1rem;border-bottom:1px solid hsl(var(--border));padding:.65rem 0}.data-record-fields dt{color:hsl(var(--muted-foreground));font-size:11px}.data-record-fields dd{min-width:0;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8125rem;line-height:1.5}.data-catalog-trigger{display:none}
.automation-frame{width:min(100%,64rem)}.automation-tabs{height:3rem;flex:0 0 auto;display:flex;align-items:stretch;border-bottom:1px solid hsl(var(--border));background:hsl(var(--card) / .22);padding:0 .75rem}.automation-tabs button{min-width:6rem;border:0;border-bottom:2px solid transparent;background:transparent;color:hsl(var(--muted-foreground));display:flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-size:.75rem;cursor:pointer}.automation-tabs button[aria-pressed="true"]{border-bottom-color:hsl(var(--primary));color:hsl(var(--foreground));font-weight:700}.automation-tabs small{min-width:1.2rem;border-radius:999px;background:hsl(var(--muted));padding:.08rem .3rem;font-size:9px}.automation-scroll{min-width:0;min-height:0;flex:1;overflow:auto;padding:1rem}.automation-scroll>section{width:min(100%,52rem);margin:0 auto}.automation-list-heading{min-height:2.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid hsl(var(--foreground))}.automation-list-heading strong{font-size:.8rem}.automation-list-heading span{color:hsl(var(--muted-foreground));font-size:10px}.automation-list{display:flex;flex-direction:column}.automation-item{min-width:0;border-bottom:1px solid hsl(var(--border));background:transparent}.automation-item summary{min-height:4.5rem;list-style:none;display:flex;align-items:center;gap:.7rem;cursor:pointer}.automation-item summary::-webkit-details-marker{display:none}.automation-item summary>svg{width:.9rem;height:.9rem;color:hsl(var(--muted-foreground));transition:transform .15s}.automation-item[open] summary>svg{transform:rotate(90deg)}.automation-item-copy{min-width:0;flex:1;display:grid;gap:.15rem}.automation-item-copy strong,.automation-item-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.automation-item-copy strong{font-size:.82rem}.automation-item-copy small{color:hsl(var(--muted-foreground));font-size:10px}.automation-status{height:1.45rem;border-radius:999px;padding:0 .45rem;display:inline-flex;align-items:center;font-size:9px;font-weight:700}.automation-status.enabled{background:#dcfce7;color:#166534}.automation-status.disabled{background:hsl(var(--muted));color:hsl(var(--muted-foreground))}.automation-status.failed{background:#fee2e2;color:#991b1b}.automation-detail{display:grid;gap:.85rem;border-top:1px solid hsl(var(--border));padding:.9rem 0 1rem}.automation-detail>p,.automation-run-reason{margin:0;color:hsl(var(--muted-foreground));font-size:.75rem;line-height:1.6}.automation-definition-grid{display:grid;gap:.65rem}.automation-definition{overflow:hidden;border:1px solid hsl(var(--border));border-radius:.45rem;background:hsl(var(--background))}.automation-definition>header{min-height:3.25rem;display:flex;align-items:center;gap:.65rem;border-bottom:1px solid hsl(var(--border));background:hsl(var(--card) / .35);padding:.55rem .7rem}.automation-definition>header>span:last-child{min-width:0;display:grid;gap:.08rem}.automation-definition>header strong{font-size:.75rem}.automation-definition>header small{color:hsl(var(--muted-foreground));font-size:10px}.automation-definition-icon{width:1.8rem;height:1.8rem;flex:0 0 auto;border-radius:.4rem;background:hsl(var(--primary) / .09);color:hsl(var(--primary));display:grid;place-items:center}.automation-definition-icon svg{width:.9rem;height:.9rem}.automation-fields{margin:0;padding:.15rem .7rem}.automation-field{min-width:0;display:grid;grid-template-columns:minmax(5.5rem,8rem) minmax(0,1fr);gap:.7rem;border-bottom:1px solid hsl(var(--border) / .75);padding:.55rem 0}.automation-field:last-child{border-bottom:0}.automation-field dt{color:hsl(var(--muted-foreground));font-size:10px;line-height:1.5}.automation-field dd{min-width:0;margin:0;font-size:.75rem;line-height:1.5;overflow-wrap:anywhere}.automation-field-empty{margin:0;padding:.8rem 0;color:hsl(var(--muted-foreground));font-size:11px}.automation-value{white-space:pre-wrap}.automation-tag-list{display:flex;flex-wrap:wrap;gap:.3rem}.automation-tag{max-width:100%;border:1px solid hsl(var(--border));border-radius:999px;background:hsl(var(--card) / .45);padding:.12rem .42rem;font-size:10px;overflow-wrap:anywhere}.automation-permission{width:max-content;max-width:100%;display:inline-flex;align-items:center;gap:.3rem;font-size:10px;font-weight:700}.automation-permission svg{width:.8rem;height:.8rem}.automation-permission.allowed{color:#166534}.automation-permission.blocked{color:hsl(var(--muted-foreground))}.automation-nested{min-width:0;margin:0;border-left:2px solid hsl(var(--primary) / .2);padding-left:.6rem}.automation-nested .automation-field{grid-template-columns:minmax(5rem,7rem) minmax(0,1fr);padding:.4rem 0}.automation-nested-list{display:grid;gap:.45rem;margin-top:.35rem}.automation-nested-list>section{border-left:2px solid hsl(var(--primary) / .22);padding:.35rem 0 .35rem .6rem}.automation-nested-list>section>strong{font-size:10px}.automation-muted{color:hsl(var(--muted-foreground));font-size:10px}.automation-detail footer{display:flex;justify-content:space-between;color:hsl(var(--muted-foreground));font-size:9px}.automation-source,.automation-run{padding:.7rem 0}.automation-source-row{min-height:3rem;display:flex;align-items:center;gap:.7rem}.automation-source-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:.55rem 0 0;border-top:1px solid hsl(var(--border))}.automation-source-meta>div{min-width:0;display:grid;gap:.15rem;border-right:1px solid hsl(var(--border));padding:.55rem}.automation-source-meta>div:last-child{border-right:0}.automation-source-meta dt{color:hsl(var(--muted-foreground));font-size:9px}.automation-source-meta dd{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.automation-run-reason{padding:.35rem 0}.automation-session-link{width:max-content;display:flex;align-items:center;gap:.25rem;color:hsl(var(--primary));font-size:10px;font-weight:650}.automation-session-link svg{width:.8rem;height:.8rem}.automation-empty{margin-top:1rem}
@media(max-width:1100px){.data-workspace{grid-template-columns:13rem minmax(0,1fr)}.data-activity{display:none}}
.data-surface,.automation-scroll{max-width:100%;overflow-x:hidden}.data-grid-scroll{max-width:100%;overscroll-behavior-inline:contain}.automation-list{gap:.55rem;padding:.55rem 0}.automation-item{min-width:0;max-width:100%;overflow:hidden;border:1px solid hsl(var(--border));border-radius:.5rem;background:hsl(var(--background))}.automation-item summary{padding:0 .75rem}.automation-detail{padding:.9rem .75rem 1rem}.automation-source,.automation-run,.automation-policy{padding:.7rem .75rem}.automation-field dd,.automation-run-reason{min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;overflow-wrap:anywhere}.automation-value{display:block;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}.automation-load-more{width:100%;min-height:3rem;border:0;background:transparent;color:hsl(var(--muted-foreground));display:flex;align-items:center;justify-content:center;gap:.45rem;font:inherit;font-size:.75rem;cursor:pointer}.automation-load-more[hidden]{display:none}.automation-load-more[data-loading="true"] .console-loading-dot{animation:console-pulse .9s ease-in-out infinite alternate}.automation-protection{display:grid;gap:.75rem;padding:.75rem 0}.protection-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem}.protection-metrics>div{min-width:0;border:1px solid hsl(var(--border));border-top:3px solid hsl(var(--primary));border-radius:.45rem;background:hsl(var(--background));display:grid;gap:.25rem;padding:.7rem}.protection-metrics span,.protection-metrics small{color:hsl(var(--muted-foreground));font-size:9px}.protection-metrics strong{font-size:1.2rem;font-variant-numeric:tabular-nums}.protection-limits,.protection-policies{border:1px solid hsl(var(--border));border-radius:.45rem;background:hsl(var(--background));overflow:hidden}.protection-limits>header,.protection-policies>header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-bottom:1px solid hsl(var(--border));background:hsl(var(--card) / .35);padding:.65rem .75rem}.protection-limits header strong,.protection-policies header strong{font-size:.75rem}.protection-limits header span,.protection-policies header span{color:hsl(var(--muted-foreground));font-size:9px}.protection-limits dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0}.protection-limits dl>div{display:grid;gap:.2rem;border-right:1px solid hsl(var(--border));padding:.65rem .75rem}.protection-limits dl>div:last-child{border-right:0}.protection-limits dt{color:hsl(var(--muted-foreground));font-size:9px}.protection-limits dd{margin:0;font-size:.85rem;font-weight:700}.protection-policies .automation-list{padding:.55rem}.protection-empty{margin:0;padding:1rem;color:hsl(var(--muted-foreground));font-size:.75rem;text-align:center}
@media(max-width:767px){.data-workspace{display:block;overflow:auto}.data-catalog,.data-activity{display:none}.data-catalog-trigger{display:inline-flex}.data-surface{overflow:visible;padding:.75rem}.data-query-toolbar{grid-template-columns:minmax(0,1fr) auto auto}.data-query-submit{grid-column:1 / 3}.data-query-reset{grid-column:3}.data-tool-button span{display:none}.data-filter-row,.data-aggregate-row{grid-template-columns:1fr}.data-object-heading{align-items:center}.data-object-heading dl{gap:.65rem}.data-grid-scroll{border:0;background:transparent;overflow:visible}.data-grid,.data-grid tbody{display:block}.data-grid thead{display:none}.data-grid tr{display:block;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;border:1px solid hsl(var(--border));border-radius:.45rem;background:hsl(var(--background));margin-bottom:.55rem;padding:.35rem .55rem}.data-grid td{max-width:none;display:grid;grid-template-columns:minmax(6rem,38%) minmax(0,1fr);gap:.65rem;border-bottom:1px solid hsl(var(--border));padding:.5rem .1rem;white-space:normal;overflow:visible;overflow-wrap:anywhere}.data-grid td::before{content:attr(data-label);color:hsl(var(--muted-foreground));font-size:10px}.data-grid td.data-row-action{width:100%!important;display:flex;justify-content:flex-end;border-bottom:0;padding:.35rem 0 0}.data-grid td.data-row-action::before{display:none}.data-row-action button{border:1px solid hsl(var(--border))}.data-pagination{justify-content:center;gap:.4rem}.data-pagination a{display:none}.data-record-dialog{width:calc(100% - 1rem)}.automation-tabs{padding:0;overflow-x:auto}.automation-tabs button{min-width:4rem;flex:1}.automation-scroll{padding:.75rem}.automation-source-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.automation-source-meta>div:nth-child(2){border-right:0}.automation-source-meta>div:nth-child(n+3){border-top:1px solid hsl(var(--border))}.automation-status{display:none}.automation-definition>header{padding:.5rem .6rem}.automation-fields{padding:.1rem .6rem}.automation-field{grid-template-columns:minmax(5rem,34%) minmax(0,1fr);gap:.5rem}.automation-nested .automation-field{grid-template-columns:1fr;gap:.2rem}.automation-nested-list>section{padding-left:.5rem}.protection-metrics,.protection-limits dl{grid-template-columns:repeat(2,minmax(0,1fr))}.protection-metrics>div:nth-child(n+3){border-top-color:hsl(var(--accent))}.protection-limits dl>div:nth-child(2){border-right:0}.protection-limits dl>div:nth-child(n+3){border-top:1px solid hsl(var(--border))}.protection-limits>header,.protection-policies>header{align-items:flex-start;flex-direction:column;gap:.2rem}}
.wechat-only-hidden{display:none!important}
.memory-overlay[hidden]{display:none!important}.memory-overlay{position:fixed!important;z-index:1000!important;inset:0!important;width:100%!important;max-width:none!important;height:100%!important;max-height:none!important;margin:0!important;display:flex!important;align-items:flex-end;justify-content:center;border:0!important;background:hsl(60 2% 8% / .48)!important;padding:0!important}.memory-overlay.task-dialog,.memory-overlay.alert-dialog{align-items:center;padding:.5rem!important}.memory-overlay .memory-sheet-content{width:min(100%,42rem)}.memory-overlay .task-dialog-content{width:min(calc(100% - 1rem),44rem)}.memory-modal-open{overflow:hidden}
.token-session-row:hover strong{color:inherit}.workspace-summary:hover,.console-session:hover,.mobile-chat-icon-button:hover,.prompt-tool-button:hover,.prompt-chip:hover{background:transparent}.main-session-group .console-session:hover{background:hsl(var(--background) / .72)}.memory-row:hover,.cron-task-row:hover{border-color:hsl(var(--border));background:hsl(var(--background));box-shadow:none}.memory-selector:hover{border-color:hsl(var(--input));box-shadow:none}.memory-sheet-option:hover{background:transparent}.memory-sheet-option[aria-pressed="true"]{background:hsl(var(--card) / .4)}.private-batch-item:hover{background:transparent}
  `;
}

function releaseNotesStyles() {
  return `
.release-notes-workspace{min-width:0;min-height:0;flex:1;display:grid;grid-template-columns:17rem minmax(0,1fr);overflow:hidden}
.release-notes-list{min-width:0;overflow-y:auto;border-right:1px solid hsl(var(--border));background:hsl(var(--card) / .24);padding:.75rem}
.release-notes-list-heading{height:2rem;display:flex;align-items:center;justify-content:space-between;padding:0 .5rem;color:hsl(var(--muted-foreground));font-size:.7rem;text-transform:uppercase}
.release-notes-list-heading strong{min-width:1.35rem;height:1.35rem;border:1px solid hsl(var(--border));border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0 .3rem;color:hsl(var(--foreground));font-size:.65rem}
.release-notes-list-item{min-width:0;display:grid;grid-template-columns:.45rem minmax(0,1fr);gap:.55rem;border:1px solid transparent;border-radius:.55rem;padding:.65rem .55rem;color:hsl(var(--foreground));text-decoration:none}
.release-notes-list-item:hover{background:hsl(var(--background) / .7)}
.release-notes-list-item.selected{border-color:hsl(var(--border));background:hsl(var(--background));box-shadow:0 1px 3px hsl(var(--foreground) / .06)}
.release-list-status{width:.4rem;height:.4rem;margin-top:.3rem;border-radius:999px;background:#10b981}
.release-list-copy{min-width:0;display:grid;gap:.18rem}
.release-list-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem}
.release-list-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--muted-foreground));font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
.release-notes-list-item time{grid-column:2;color:hsl(var(--muted-foreground));font-size:10px}
.release-notes-detail-wrap{min-width:0;overflow-y:auto}
.release-notes-detail{width:min(100%,52rem);margin:0 auto;padding:1.5rem 1.75rem 3rem}
.release-detail-header{border-bottom:1px solid hsl(var(--border));padding-bottom:1.2rem}
.release-detail-kicker{display:flex;align-items:center;justify-content:space-between;gap:1rem;color:hsl(var(--muted-foreground));font-size:.7rem}
.release-detail-kicker>span{display:inline-flex;align-items:center;gap:.35rem;color:#14805a;font-weight:700;text-transform:uppercase}
.release-detail-kicker svg{width:.9rem;height:.9rem}
.release-detail-header h1{margin:.65rem 0 .45rem;font-size:1.55rem;line-height:1.25;letter-spacing:0;overflow-wrap:anywhere}
.release-detail-header p{margin:0;color:hsl(var(--muted-foreground));font-size:.8rem}
.release-detail-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;border-bottom:1px solid hsl(var(--border))}
.release-detail-meta>div{min-width:0;display:grid;gap:.25rem;padding:.85rem 0}
.release-detail-meta>div:nth-child(odd){padding-right:1rem}
.release-detail-meta dt{color:hsl(var(--muted-foreground));font-size:.65rem;text-transform:uppercase}
.release-detail-meta dd{min-width:0;margin:0;overflow-wrap:anywhere;font-size:.76rem}
.release-detail-meta code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
.release-detail-section{padding:1.15rem 0;border-bottom:1px solid hsl(var(--border))}
.release-section-title{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.65rem}
.release-section-title span{font-size:.78rem;font-weight:750}
.release-section-title strong{color:hsl(var(--muted-foreground));font-size:.7rem}
.release-change-list,.release-check-list,.release-service-list{margin:0;padding:0;list-style:none}
.release-change-list li{display:grid;grid-template-columns:4.5rem minmax(0,1fr);gap:.7rem;padding:.45rem 0;font-size:.78rem}
.release-change-list code{color:hsl(var(--primary));font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
.release-check-list{display:grid;gap:.45rem}
.release-check-list li{display:grid;grid-template-columns:1rem minmax(0,1fr);gap:.45rem;color:hsl(var(--muted-foreground));font-size:.76rem}
.release-check-list svg{width:.85rem;height:.85rem;color:#14805a}
.release-service-list{display:flex;flex-wrap:wrap;gap:.4rem}
.release-service-list li{border:1px solid hsl(var(--border));border-radius:.4rem;background:hsl(var(--card) / .36);padding:.35rem .5rem;font-size:.7rem}
.release-notes-empty{min-height:9rem;display:grid;place-items:center;align-content:center;gap:.35rem;padding:1rem;color:hsl(var(--muted-foreground));text-align:center}
.release-notes-empty svg{width:1.25rem;height:1.25rem}
.release-notes-empty strong{color:hsl(var(--foreground));font-size:.8rem}
.release-notes-empty span{font-size:.7rem}
.release-notes-empty-main{min-height:100%}
@media(max-width:767px){.release-notes-workspace{display:flex;flex-direction:column;overflow-y:auto}.release-notes-list{max-height:11rem;overflow-y:auto;border-right:0;border-bottom:1px solid hsl(var(--border));padding:.5rem}.release-notes-list-heading{display:none}.release-notes-list-item{padding:.5rem}.release-notes-detail-wrap{overflow:visible}.release-notes-detail{padding:1rem .85rem 2rem}.release-detail-kicker{align-items:flex-start;flex-direction:column;gap:.3rem}.release-detail-header h1{font-size:1.25rem}.release-detail-meta{grid-template-columns:1fr}.release-detail-meta>div{padding:.65rem 0}.release-detail-meta>div:nth-child(odd){padding-right:0}.release-change-list li{grid-template-columns:4rem minmax(0,1fr)}}
  `;
}

function emptyTokenUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    sessionCount: 0,
    threadCount: 0,
    requestCount: 0,
    cacheRate: 0,
    range: "today",
    dailyUsage: [],
    updatedAt: null,
    recentSessions: [],
  };
}

function formatInteger(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatTokenCount(value) {
  const number = Math.max(0, Number(value) || 0);
  const units = [[1_000_000_000, "B"], [1_000_000, "M"], [1_000, "K"]];
  for (const [threshold, suffix] of units) {
    if (number >= threshold) {
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number / threshold)}${suffix}`;
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number);
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function statusLabel(status) {
  return ({ start: "启动中", running: "运行中", idle: "空闲", paused: "已暂停", done: "已完成", archived: "已归档" })[status] || status;
}

function roleLabel(role) {
  return ({ user: "User", assistant: "Codex", tool: "Tool", system: "System", agent: "Agent", error: "Error" })[role] || role;
}

function timeAgo(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return "";
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatTime(value);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
