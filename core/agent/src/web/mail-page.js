export function renderMailPage({
  events = [],
  total = 0,
  selectedEvent = null,
  selectedRuns = [],
  content = null,
  query = "",
  filter = "all",
  basePath = "/",
  adminUrl = "/admin",
  tasksUrl = "/app/workers/schedules",
} = {}) {
  const selected = Boolean(selectedEvent);
  const backHref = mailHref(basePath, { q: query, filter });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(selectedEvent?.title || "邮件")}</title>
  <style>${mailStyles()}</style>
</head>
<body class="${selected ? "mail-has-selection" : ""}">
  <main class="mail-app">
    <header class="mail-topbar">
      <a class="mail-brand" href="${escapeAttr(backHref)}" aria-label="邮件首页">
        <span class="mail-brand-mark">${icon("mail")}</span>
        <span><strong>邮件</strong><small>agent@personal-agent.local</small></span>
      </a>
      <nav class="mail-nav" aria-label="相关页面">
        <span class="mail-auth">${icon("shield-check")}个人认证</span>
        <a href="${escapeAttr(tasksUrl)}">自动化</a>
        <a class="mail-icon-link" href="${escapeAttr(adminUrl)}" title="返回站点导航" aria-label="返回站点导航">${icon("grid")}</a>
      </nav>
    </header>
    <div class="mail-workspace">
      <aside class="mail-list-pane" aria-label="邮件列表">
        <div class="mail-list-header">
          <div><strong>收件</strong><span>${escapeHtml(String(total))} 封</span></div>
          <form class="mail-search" action="${escapeAttr(basePath)}" method="get">
            ${icon("search")}
            <input type="search" name="q" value="${escapeAttr(query)}" placeholder="搜索发件人或主题" aria-label="搜索邮件">
            ${filter !== "all" ? `<input type="hidden" name="filter" value="${escapeAttr(filter)}">` : ""}
          </form>
          <nav class="mail-filters" aria-label="邮件筛选">
            ${filterLink(basePath, "all", "全部", filter, query)}
            ${filterLink(basePath, "matched", "已创建任务", filter, query)}
            ${filterLink(basePath, "attachments", "有附件", filter, query)}
          </nav>
        </div>
        <div class="mail-list">
          ${events.length ? events.map((event) => renderMailRow(event, selectedEvent?.id, basePath, query, filter)).join("") : renderEmptyList(query)}
        </div>
        ${total > events.length ? `<p class="mail-list-limit">显示最近 ${events.length} 封匹配邮件</p>` : ""}
      </aside>
      <section class="mail-reader" aria-label="邮件内容">
        ${selectedEvent ? renderMailDetail({ event: selectedEvent, runs: selectedRuns, content, backHref, basePath }) : renderReaderEmpty()}
      </section>
    </div>
  </main>
</body>
</html>`;
}

function renderMailRow(event, selectedId, basePath, query, filter) {
  const sender = senderLabel(event.sender);
  const preview = String(event.payload?.textPreview || "").trim();
  const attachments = Array.isArray(event.payload?.attachments) ? event.payload.attachments.length : 0;
  const href = mailHref(basePath, { message: event.id, q: query, filter });
  return `<a class="mail-row ${event.id === selectedId ? "selected" : ""}" href="${escapeAttr(href)}" aria-current="${event.id === selectedId ? "page" : "false"}">
    <span class="mail-row-sender">${escapeHtml(sender)}</span>
    <time datetime="${escapeAttr(event.receivedAt)}">${escapeHtml(compactDate(event.receivedAt))}</time>
    <strong>${escapeHtml(event.title || "（无主题）")}</strong>
    <span class="mail-row-preview">${escapeHtml(preview || "暂无正文预览")}</span>
    <span class="mail-row-meta">${event.matched ? `<i class="mail-state matched">已创建任务</i>` : `<i class="mail-state">已归档</i>`}${attachments ? `<i>${icon("paperclip")}${attachments}</i>` : ""}</span>
  </a>`;
}

function renderMailDetail({ event, runs, content, backHref, basePath }) {
  const recipients = content?.to?.length ? content.to : addressesFromPayload(event.payload?.recipients);
  const sender = content?.from?.[0] || event.sender || {};
  const matchedRun = runs.find((run) => run.matched);
  const archiveBase = basePath === "/" ? `/message/${encodeURIComponent(event.id)}` : `/mail/messages/${encodeURIComponent(event.id)}`;
  const attachments = content?.attachments || [];
  return `<article class="mail-message">
    <header class="mail-message-header">
      <a class="mail-mobile-back" href="${escapeAttr(backHref)}">${icon("arrow-left")}返回收件</a>
      <div class="mail-subject-row">
        <h1>${escapeHtml(content?.subject || event.title || "（无主题）")}</h1>
        <a class="mail-tool" href="${escapeAttr(`${archiveBase}/raw`)}" title="下载原始邮件">${icon("download")}<span>原始邮件</span></a>
      </div>
      <div class="mail-address-row">
        <span class="mail-avatar" aria-hidden="true">${escapeHtml(senderInitial(sender))}</span>
        <div class="mail-address-copy">
          <strong>${escapeHtml(sender.name || sender.displayName || sender.address || "未知发件人")}</strong>
          <small>${escapeHtml(sender.address || "")}</small>
          <span>发送至 ${escapeHtml(recipients.map(addressLabel).join("、") || "未知收件人")}</span>
        </div>
        <time datetime="${escapeAttr(event.receivedAt)}">${escapeHtml(fullDate(content?.date || event.receivedAt))}</time>
      </div>
    </header>
    <section class="mail-judgement ${matchedRun ? "matched" : ""}" aria-label="Agent 处理状态">
      <span>${icon(matchedRun ? "sparkles" : "archive")}</span>
      <div><strong>${matchedRun ? "已创建任务" : "已安全归档"}</strong><p>${escapeHtml(matchedRun?.reason || runs[0]?.reason || "邮件已保存，当前无需创建任务。")}</p></div>
      ${matchedRun?.sessionId ? `<a href="/app/chat/session/${escapeAttr(matchedRun.sessionId)}/live">查看任务</a>` : ""}
    </section>
    ${content?.error ? `<div class="mail-error">${icon("alert-circle")}<span>${escapeHtml(content.error)}</span></div>` : ""}
    ${attachments.length ? `<section class="mail-attachments" aria-label="附件"><strong>${attachments.length} 个附件</strong><div>${attachments.map((attachment) => `<a href="${escapeAttr(`${archiveBase}/attachments/${attachment.index}`)}">${icon("paperclip")}<span><strong>${escapeHtml(attachment.name)}</strong><small>${escapeHtml(`${attachment.contentType} · ${formatFileSize(attachment.sizeBytes)}`)}</small></span>${icon("download")}</a>`).join("")}</div></section>` : ""}
    <section class="mail-body" aria-label="邮件正文">${escapeHtml(content?.body || event.payload?.textPreview || "暂无可显示的纯文本正文。")}</section>
    ${content?.bodyTruncated ? `<p class="mail-truncated">正文较长，页面仅显示前 ${formatInteger(200_000)} 个字符；可下载原始邮件查看完整内容。</p>` : ""}
  </article>`;
}

function renderEmptyList(query) {
  return `<div class="mail-empty">${icon("inbox")}<strong>${query ? "没有匹配的邮件" : "暂时没有邮件"}</strong><span>${query ? "换一个关键词继续查找" : "收到邮件后会出现在这里"}</span></div>`;
}

function renderReaderEmpty() {
  return `<div class="mail-reader-empty">${icon("mail-open")}<strong>选择一封邮件</strong><span>查看正文、附件和 Agent 处理记录</span></div>`;
}

function filterLink(basePath, value, label, active, query) {
  return `<a href="${escapeAttr(mailHref(basePath, { filter: value, q: query }))}" aria-current="${value === active ? "page" : "false"}">${escapeHtml(label)}</a>`;
}

function mailHref(basePath, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value && !(key === "filter" && value === "all")) params.set(key, String(value));
  }
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

function addressesFromPayload(values) {
  return (Array.isArray(values) ? values : []).map((address) => ({ address: String(address || ""), name: "" }));
}

function senderLabel(sender = {}) {
  return String(sender.displayName || sender.name || sender.address || "未知发件人");
}

function senderInitial(sender = {}) {
  const value = String(sender.name || sender.displayName || sender.address || "邮").trim();
  return [...value][0]?.toUpperCase() || "邮";
}

function addressLabel(address = {}) {
  return String(address.name ? `${address.name} <${address.address}>` : address.address || "");
}

function compactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (date.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  return new Intl.DateTimeFormat("zh-CN", { year: "2-digit", month: "numeric", day: "numeric" }).format(date);
}

function fullDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function icon(name) {
  const paths = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
    "mail-open": '<path d="m22 10-10 5L2 10"></path><path d="M3.5 8.5 12 3l8.5 5.5"></path><path d="M2 10v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9"></path>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>',
    search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"></path><path d="m9 12 2 2 4-4"></path>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>',
    "arrow-left": '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    sparkles: '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"></path><path d="M5 3v4"></path><path d="M3 5h4"></path>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path>',
    "alert-circle": '<circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mail}</svg>`;
}

function mailStyles() {
  return `
:root{color-scheme:light;--canvas:#eef0ec;--paper:#fbfcf9;--paper-strong:#fff;--ink:#18201b;--muted:#69736c;--line:#d9ddd7;--line-strong:#b9c1ba;--green:#245b45;--green-soft:#e5efe8;--amber:#9a671b;--amber-soft:#f7edda;font-family:"Aptos","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{background:var(--canvas);color:var(--ink);font-size:14px}a{color:inherit;text-decoration:none}button,input{font:inherit;letter-spacing:0}svg{display:block;width:1rem;height:1rem}.mail-app{width:100%;height:100%;display:flex;flex-direction:column;background:var(--paper)}
.mail-topbar{height:4rem;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:0 1rem;background:var(--paper-strong)}.mail-brand{min-width:0;display:flex;align-items:center;gap:.65rem}.mail-brand-mark{width:2.25rem;height:2.25rem;display:grid;place-items:center;background:var(--green);color:#fff;border-radius:6px}.mail-brand-mark svg{width:1.15rem;height:1.15rem}.mail-brand>span:last-child{min-width:0;display:grid;gap:.05rem}.mail-brand strong{font-size:.95rem}.mail-brand small{color:var(--muted);font-size:10px}.mail-nav{display:flex;align-items:center;gap:.85rem;color:var(--muted);font-size:11px}.mail-nav>a:not(.mail-icon-link){border-bottom:1px solid transparent;padding:.3rem 0}.mail-nav>a:not(.mail-icon-link):hover{border-color:var(--line-strong);color:var(--ink)}.mail-auth{display:inline-flex;align-items:center;gap:.3rem;color:var(--green)}.mail-auth svg{width:.8rem;height:.8rem}.mail-icon-link{width:2.25rem;height:2.25rem;display:grid;place-items:center;border:1px solid var(--line);border-radius:6px;background:var(--paper)}
.mail-workspace{min-width:0;min-height:0;flex:1;display:grid;grid-template-columns:minmax(18rem,24rem) minmax(0,1fr)}.mail-list-pane{min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line);background:#f7f8f5}.mail-list-header{flex:0 0 auto;display:grid;gap:.75rem;border-bottom:1px solid var(--line);padding:1rem}.mail-list-header>div{display:flex;align-items:baseline;justify-content:space-between}.mail-list-header>div strong{font-size:1rem}.mail-list-header>div span{color:var(--muted);font-size:10px}.mail-search{position:relative}.mail-search>svg{position:absolute;left:.7rem;top:50%;width:.9rem;height:.9rem;transform:translateY(-50%);color:var(--muted)}.mail-search input{width:100%;height:2.45rem;border:1px solid var(--line);border-radius:6px;background:var(--paper-strong);padding:0 .75rem 0 2.15rem;color:var(--ink);outline:0}.mail-search input:focus{border-color:var(--green);box-shadow:0 0 0 2px rgba(36,91,69,.1)}.mail-filters{height:2rem;display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:6px;padding:2px;background:#ecefea}.mail-filters a{display:flex;align-items:center;justify-content:center;border-radius:4px;color:var(--muted);font-size:10px}.mail-filters a[aria-current="true"],.mail-filters a[aria-current="page"]{background:var(--paper-strong);color:var(--ink);font-weight:700;box-shadow:0 1px 2px rgba(24,32,27,.08)}
.mail-list{min-height:0;overflow-y:auto}.mail-row{min-width:0;min-height:7.7rem;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"sender date" "subject subject" "preview preview" "meta meta";align-content:center;gap:.2rem .75rem;border-bottom:1px solid var(--line);padding:.85rem 1rem;background:transparent}.mail-row:hover{background:#f1f4ef}.mail-row.selected{background:var(--paper-strong);box-shadow:inset 3px 0 0 var(--green)}.mail-row-sender{grid-area:sender;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem;font-weight:700}.mail-row time{grid-area:date;color:var(--muted);font-size:9px}.mail-row>strong{grid-area:subject;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem}.mail-row-preview{grid-area:preview;display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--muted);font-size:10px;line-height:1.5}.mail-row-meta{grid-area:meta;display:flex;align-items:center;gap:.65rem;margin-top:.15rem;color:var(--muted);font-size:9px}.mail-row-meta i{display:inline-flex;align-items:center;gap:.2rem;font-style:normal}.mail-row-meta svg{width:.65rem;height:.65rem}.mail-state{border:1px solid var(--line);border-radius:999px;padding:.08rem .35rem}.mail-state.matched{border-color:#b9d3c1;background:var(--green-soft);color:var(--green)}.mail-list-limit{margin:0;border-top:1px solid var(--line);padding:.7rem 1rem;color:var(--muted);font-size:9px}.mail-empty{min-height:16rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.35rem;color:var(--muted);text-align:center}.mail-empty svg{width:1.5rem;height:1.5rem;margin-bottom:.35rem}.mail-empty strong{color:var(--ink);font-size:.8rem}.mail-empty span{font-size:10px}
.mail-reader{min-width:0;min-height:0;overflow-y:auto;background:var(--paper-strong)}.mail-reader-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.45rem;color:var(--muted)}.mail-reader-empty svg{width:2rem;height:2rem;margin-bottom:.4rem;color:var(--line-strong)}.mail-reader-empty strong{color:var(--ink);font-family:Georgia,"Songti SC",serif;font-size:1.1rem;font-weight:500}.mail-reader-empty span{font-size:10px}.mail-message{width:min(100%,58rem);min-height:100%;margin:0 auto;padding:2rem clamp(1.25rem,4vw,4rem) 5rem}.mail-mobile-back{display:none}.mail-message-header{border-bottom:1px solid var(--line);padding-bottom:1.25rem}.mail-subject-row{display:flex;align-items:flex-start;justify-content:space-between;gap:1.5rem}.mail-subject-row h1{min-width:0;margin:0;font-family:Georgia,"Songti SC",serif;font-size:clamp(1.35rem,2.4vw,2rem);font-weight:500;line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}.mail-tool{height:2.2rem;flex:0 0 auto;display:inline-flex;align-items:center;gap:.35rem;border:1px solid var(--line);border-radius:6px;padding:0 .65rem;color:var(--muted);font-size:10px}.mail-tool:hover{border-color:var(--line-strong);color:var(--ink)}.mail-tool svg{width:.8rem;height:.8rem}.mail-address-row{display:grid;grid-template-columns:2.35rem minmax(0,1fr) auto;align-items:center;gap:.65rem;margin-top:1.4rem}.mail-avatar{width:2.35rem;height:2.35rem;display:grid;place-items:center;border-radius:50%;background:var(--green-soft);color:var(--green);font-family:Georgia,"Songti SC",serif;font-weight:700}.mail-address-copy{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:.05rem .4rem}.mail-address-copy strong{font-size:.78rem}.mail-address-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:9px}.mail-address-copy span{grid-column:1/-1;color:var(--muted);font-size:9px}.mail-address-row>time{color:var(--muted);font-size:9px;text-align:right}
.mail-judgement{display:grid;grid-template-columns:2rem minmax(0,1fr) auto;align-items:center;gap:.75rem;border-left:3px solid var(--line-strong);margin:1.25rem 0;padding:.7rem .85rem;background:#f6f7f4}.mail-judgement.matched{border-left-color:var(--green);background:var(--green-soft)}.mail-judgement>span{width:2rem;height:2rem;display:grid;place-items:center;color:var(--muted)}.mail-judgement.matched>span{color:var(--green)}.mail-judgement>div{min-width:0}.mail-judgement strong{font-size:.72rem}.mail-judgement p{margin:.12rem 0 0;color:var(--muted);font-size:10px;line-height:1.5}.mail-judgement>a{font-size:10px;font-weight:700;color:var(--green)}.mail-error{display:flex;align-items:flex-start;gap:.5rem;margin:1rem 0;border:1px solid #e4c6aa;background:#fff7ed;padding:.75rem;color:#8b4c14;font-size:10px}.mail-error svg{flex:0 0 auto;width:.9rem;height:.9rem}.mail-attachments{display:grid;gap:.6rem;border-bottom:1px solid var(--line);padding:0 0 1.25rem}.mail-attachments>strong{font-size:10px}.mail-attachments>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}.mail-attachments a{min-width:0;min-height:3.2rem;display:grid;grid-template-columns:1.5rem minmax(0,1fr) 1rem;align-items:center;gap:.55rem;border:1px solid var(--line);border-radius:6px;padding:.45rem .6rem;background:#f8f9f6}.mail-attachments a>svg{width:.85rem;height:.85rem;color:var(--muted)}.mail-attachments a>span{min-width:0;display:grid;gap:.1rem}.mail-attachments a strong,.mail-attachments a small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mail-attachments a strong{font-size:10px}.mail-attachments a small{color:var(--muted);font-size:8px}.mail-body{padding:2rem 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:"Aptos","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:.92rem;line-height:1.85;color:#273029}.mail-truncated{border-top:1px solid var(--line);margin:0;padding-top:.75rem;color:var(--muted);font-size:9px}
@media(max-width:760px){.mail-topbar{height:3.5rem;padding:0 .75rem}.mail-brand-mark{width:2rem;height:2rem}.mail-brand small,.mail-auth,.mail-nav>a:not(.mail-icon-link){display:none}.mail-workspace{display:block}.mail-list-pane,.mail-reader{height:calc(100vh - 3.5rem);height:calc(100dvh - 3.5rem)}.mail-list-pane{border-right:0}.mail-reader{display:none}.mail-has-selection .mail-list-pane{display:none}.mail-has-selection .mail-reader{display:block}.mail-list-header{padding:.85rem .75rem}.mail-row{min-height:7.25rem;padding:.75rem}.mail-message{padding:1rem .9rem 3.5rem}.mail-mobile-back{width:max-content;display:inline-flex;align-items:center;gap:.35rem;margin-bottom:1.1rem;color:var(--muted);font-size:10px}.mail-mobile-back svg{width:.8rem;height:.8rem}.mail-subject-row{gap:.7rem}.mail-subject-row h1{font-size:1.35rem}.mail-tool{width:2.2rem;padding:0;justify-content:center}.mail-tool span{display:none}.mail-address-row{grid-template-columns:2.2rem minmax(0,1fr);margin-top:1.1rem}.mail-avatar{width:2.2rem;height:2.2rem}.mail-address-row>time{grid-column:2;text-align:left}.mail-judgement{grid-template-columns:1.8rem minmax(0,1fr);margin:1rem 0}.mail-judgement>a{grid-column:2}.mail-attachments>div{grid-template-columns:1fr}.mail-body{padding:1.5rem 0;font-size:.88rem;line-height:1.8}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
}
