export function renderBrief(brief, surface) {
  const root = document.querySelector(`[data-surface-view="${surface}"]`);
  if (!root) return;
  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  setText(root, "[data-date]", today);
  setText(root, '[data-count="mail"]', brief.mail.length);
  setText(root, '[data-count="pages"]', brief.pages.length);
  setText(root, '[data-count="data"]', brief.objects.length);
  setText(root, '[data-note="mail"]', brief.mail.length ? "最近收到" : "暂无邮件");
  setText(root, '[data-note="data"]', brief.objects.length ? "可读取对象" : "等待数据");
  setText(root, "[data-summary]", `${brief.mail.length} 封邮件、${brief.pages.length} 个发布页和 ${brief.objects.length} 个共享数据对象已汇总。`);
  renderMail(root, brief.mail, surface);
  renderPages(root, brief.pages, surface);
  renderData(root, brief.objects, brief.query);
  renderHistory(root, brief.history);
  root.querySelectorAll("[data-refresh]").forEach((button) => {
    button.disabled = false;
    button.textContent = "刷新简报";
  });
}

export function setUiState(surface, name) {
  const root = document.querySelector(`[data-surface-view="${surface}"]`);
  if (!root) return;
  root.querySelectorAll("[data-ui-state]").forEach((node) => { node.hidden = node.dataset.uiState !== name; });
  if (name === "loading") root.querySelectorAll("[data-refresh]").forEach((button) => {
    button.disabled = true;
    button.textContent = "正在刷新";
  });
}

function renderMail(root, messages, surface) {
  root.querySelectorAll('[data-list="mail"]').forEach((list) => {
    if (!messages.length) return renderEmpty(list, "还没有收到邮件", "新邮件会出现在这里。");
    list.replaceChildren(...messages.slice(0, 3).map((message) => listItem({
      href: mailRoute(message, surface),
      mark: "@",
      title: message.title || message.subject || "未命名邮件",
      detail: senderLabel(message),
      time: relativeTime(message.receivedAt || message.createdAt),
    })));
  });
}

function renderPages(root, pages, surface) {
  root.querySelectorAll('[data-list="pages"]').forEach((list) => {
    if (!pages.length) return renderEmpty(list, "还没有发布页", "最近发布的内容会出现在这里。");
    list.replaceChildren(...pages.slice(0, 3).map((page) => listItem({
      href: pageRoute(page, surface),
      mark: "▧",
      title: page.title || page.name || page.fileName || "未命名页面",
      detail: page.description || page.summary || visibilityLabel(page.visibility),
      time: relativeTime(page.createdAt || page.updatedAt || page.uploadedAt),
    })));
  });
}

function renderData(root, objects, query) {
  const object = objects[0];
  root.querySelectorAll("[data-data-label]").forEach((node) => {
    node.textContent = object ? `${object.name} · ${object.rowCount ?? query?.page?.totalRows ?? 0} 条` : "0 个对象";
  });
  root.querySelectorAll("[data-data-summary]").forEach((container) => {
    if (!object) return renderEmpty(container, "还没有共享数据", "Agent 创建数据对象后会在这里显示。");
    const overview = document.createElement("div");
    overview.className = "brief-data-overview";
    overview.innerHTML = `<span></span><strong></strong><small></small>`;
    overview.querySelector("span").textContent = object.name;
    overview.querySelector("strong").textContent = `${object.rowCount ?? query?.page?.totalRows ?? 0} 条`;
    overview.querySelector("small").textContent = query ? "已读取最新记录" : "结构可用";
    const rows = buildDataRows(query);
    container.replaceChildren(overview, ...(rows ? [rows] : []));
  });
}

function buildDataRows(query) {
  if (!query?.rows?.length) return null;
  const columns = (query.columns || Object.keys(query.rows[0])).slice(0, 3);
  const list = document.createElement("div");
  list.className = "brief-data-rows";
  for (const row of query.rows.slice(0, 3)) {
    const line = document.createElement("div");
    for (const column of columns) {
      const cell = document.createElement("span");
      cell.title = String(row[column] ?? "");
      cell.textContent = displayValue(row[column]);
      line.append(cell);
    }
    list.append(line);
  }
  return list;
}

function renderHistory(root, history) {
  setText(root, "[data-activity-count]", `${history.length} 次整理`);
  root.querySelectorAll("[data-activity-list]").forEach((list) => {
    if (!history.length) return renderEmpty(list, "还没有整理记录", "刷新后会记录本次整理。");
    list.replaceChildren(...history.map((entry) => {
      const item = document.createElement("li");
      const dot = document.createElement("i");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const summary = document.createElement("p");
      const source = document.createElement("span");
      source.textContent = sourceLabel(entry.sources?.[0] || "app");
      summary.append(source, document.createTextNode(entry.summary || ""));
      copy.append(title, summary);
      const time = document.createElement("time");
      time.textContent = relativeTime(entry.createdAt);
      item.append(dot, copy, time);
      return item;
    }));
  });
}

function listItem({ href, mark, title, detail, time }) {
  const link = document.createElement("a");
  link.className = "brief-list-item";
  link.href = href;
  const symbol = document.createElement("span");
  symbol.className = "brief-list-mark";
  symbol.textContent = mark;
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  copy.append(strong, paragraph);
  const timestamp = document.createElement("time");
  timestamp.textContent = time;
  link.append(symbol, copy, timestamp);
  return link;
}

function renderEmpty(container, title, detail) {
  const empty = document.createElement("div");
  empty.className = "brief-empty";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = detail;
  empty.append(strong, span);
  container.replaceChildren(empty);
}

function mailRoute(message, surface) {
  const id = message.id || message.messageId;
  if (!id) return surface === "mobile" ? "/app/mobile" : "/app/mail";
  return surface === "mobile" ? `/app/mobile/mail/${encodeURIComponent(id)}` : `/app/mail?message=${encodeURIComponent(id)}`;
}

function pageRoute(page, surface) {
  const id = page.id || page.assetId || page.pageId;
  if (id) return surface === "mobile" ? `/app/mobile/pages/${encodeURIComponent(id)}` : `/app/pages/${encodeURIComponent(id)}`;
  return surface === "mobile" ? "/app/mobile/pages" : "/app/pages";
}

function senderLabel(message) {
  const sender = message.sender || message.from;
  if (typeof sender === "string") return sender;
  return sender?.displayName || sender?.name || sender?.address || message.payload?.sender || "收到的邮件";
}

function sourceLabel(source) {
  return ({ mail: "邮件", data: "共享数据", pages: "发布页", app: "今日简报" })[source] || "今日简报";
}

function visibilityLabel(value) { return value === "public" ? "公开发布" : value === "private" ? "私有发布" : "最近发布"; }

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return value.type === "blob" ? `附件 ${value.size || 0} B` : JSON.stringify(value);
  return String(value);
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function setText(root, selector, value) { root.querySelectorAll(selector).forEach((node) => { node.textContent = String(value); }); }
