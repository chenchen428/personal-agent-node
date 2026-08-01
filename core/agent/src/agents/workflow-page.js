export function renderSpecialistWorkflowPage(definition, state, { title } = {}) {
  const currentIndex = definition.stages.findIndex((stage) => stage.id === state.stage);
  const completed = Math.max(0, currentIndex);
  const total = Math.max(1, definition.stages.length - 1);
  const progress = state.stage === "delivered" ? 100 : Math.round((completed / total) * 100);
  const current = definition.stages[currentIndex];
  const published = Boolean(state.progressPage.url || state.progressPage.internalUrl || state.progressPage.linkNotice);
  const synced = published && state.progressPage.publishedRevision === state.revision;
  const artifacts = state.artifacts.filter((artifact) => artifact.type === "page");
  const staleArtifacts = new Set(state.staleArtifacts);
  const confirmations = new Map(state.confirmations.flatMap((confirmation) => confirmation.stages.map((stage) => [stage, confirmation])));
  const pageTitle = title || `${current?.title || "专业任务"} · 项目进度`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(pageTitle)}</title>
  <style>${styles()}</style>
</head>
<body>
  <main>
    <header class="hero">
      <div><p class="eyebrow">PROJECT WORKFLOW · REV ${state.revision}</p><h1>${escapeHtml(pageTitle)}</h1><p>${escapeHtml(definition.goal)}</p></div>
      <div class="progress"><strong>${progress}%</strong><span>${completed}/${total} 个确认门已完成</span></div>
    </header>
    <div class="meter" aria-label="工作流完成度 ${progress}%"><span style="width:${progress}%"></span></div>
    ${synced ? "" : `<p class="notice">${published ? "当前内容正在覆盖发布。" : "这是待首次发布的进度 Page。"}进度 Page 同步完成前，工作流不能进入下一阶段。</p>`}
    <section class="current">
      <div><p class="eyebrow">CURRENT STAGE</p><h2>${escapeHtml(current?.title || "已完成")}</h2><p>${escapeHtml(current?.purpose || "")}</p></div>
      <span class="surface ${current?.review.surface || "terminal"}">${surfaceLabel(current?.review.surface)}</span>
    </section>
    ${current?.confirmationPrompt ? `<section class="gate"><p class="eyebrow">本阶段确认</p><strong>${escapeHtml(current.confirmationPrompt)}</strong><p>请回到与 Agent 的对话中明确回复确认或提出修改。Page 内不代替聊天身份完成批准。</p></section>` : ""}
    <section>
      <div class="section-title"><p class="eyebrow">STAGES</p><h2>阶段记录</h2></div>
      <ol class="stages">${definition.stages.map((stage, index) => renderStage(stage, index, currentIndex, confirmations.get(stage.id))).join("")}</ol>
    </section>
    <section>
      <div class="section-title"><p class="eyebrow">REVIEW PAGES</p><h2>中间产物</h2></div>
      ${artifacts.length ? `<div class="artifacts">${artifacts.map((artifact) => renderArtifact(artifact, staleArtifacts.has(artifactKey(artifact)))).join("")}</div>` : '<p class="empty">当前还没有可审阅的中间产物 Page。</p>'}
    </section>
    <section>
      <div class="section-title"><p class="eyebrow">REVISION HISTORY</p><h2>版本记录</h2></div>
      ${state.history.length ? `<ol class="history">${state.history.slice(-8).reverse().map((entry) => renderHistory(entry, definition)).join("")}</ol>` : '<p class="empty">工作流尚未发生阶段变化。</p>'}
    </section>
    <footer><p>${escapeHtml(state.projectKey)} · ${escapeHtml(state.mode === "recommended" ? "推荐方案模式" : "逐阶段确认模式")}</p><p>任何影响已确认事实的修改都会回退到最早受影响阶段并创建新版本。</p></footer>
  </main>
</body>
</html>`;
}

function renderStage(stage, index, currentIndex, confirmation) {
  const status = index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending";
  return `<li class="${status}">
    <span class="step">${String(index + 1).padStart(2, "0")}</span>
    <div><div class="stage-heading"><h3>${escapeHtml(stage.title)}</h3><span>${surfaceLabel(stage.review.surface)}</span></div><p>${escapeHtml(stage.purpose)}</p>${confirmation ? `<small>已确认 · ${escapeHtml(confirmation.summary)}</small>` : ""}</div>
  </li>`;
}

function renderArtifact(artifact, stale) {
  const href = artifact.url || artifact.internalUrl;
  return `<a class="${stale ? "stale" : ""}" href="${escapeAttribute(href)}"><span>${stale ? "STALE" : "PAGE"}</span><strong>${escapeHtml(artifact.title)}</strong><small>${escapeHtml(artifact.kind)}${stale ? " · 已过期，不能用于确认" : ""}</small></a>`;
}

function renderHistory(entry, definition) {
  const stageTitle = (id) => definition.stages.find((stage) => stage.id === id)?.title || id;
  const label = entry.reopened
    ? `反馈重开：${stageTitle(entry.from)} → ${stageTitle(entry.to)}`
    : `${entry.checkpoint ? "合并确认" : "阶段确认"}：${stageTitle(entry.from)} → ${stageTitle(entry.to)}`;
  return `<li><span>REV ${entry.revision}</span><div><strong>${escapeHtml(label)}</strong>${entry.reason ? `<p>${escapeHtml(entry.reason)}</p>` : ""}</div></li>`;
}

function artifactKey(artifact) { return `${artifact.kind}:${artifact.type}:${artifact.pageId || artifact.ref}`; }

function surfaceLabel(surface) {
  if (surface === "page") return "Page 确认";
  if (surface === "text") return "文字确认";
  return "交付终态";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) { return escapeHtml(value); }

function styles() {
  return `
    :root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#252821;background:#f3f1e9;line-height:1.55}
    *{box-sizing:border-box}body{margin:0}main{width:min(100%,760px);margin:auto;padding:20px 16px 48px}
    h1,h2,h3,p{margin:0}h1{font:600 clamp(28px,8vw,48px)/1.06 Georgia,"Songti SC",serif;margin:.35rem 0 .75rem}h2{font-size:21px}h3{font-size:16px}
    .hero{display:grid;gap:22px;padding:26px 22px;border-radius:26px;background:#242a24;color:#f8f5e9}.hero>div>p:last-child{color:#d6dacd}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#808b78}
    .progress{display:flex;align-items:baseline;gap:10px}.progress strong{font:600 42px/1 Georgia,serif}.progress span{font-size:13px;color:#c5cabd}
    .meter{height:7px;margin:15px 5px 26px;border-radius:99px;background:#ddd9cc;overflow:hidden}.meter span{display:block;height:100%;border-radius:inherit;background:#72856e}
    .notice,.gate{margin:0 0 18px;padding:16px;border:1px solid #d6b986;border-radius:18px;background:#fff8e9}.gate{display:grid;gap:7px}.gate strong{font-size:16px}.gate>p:last-child{font-size:13px;color:#706b60}
    .current{display:grid;gap:18px;margin-bottom:30px;padding:21px;border:1px solid #d9d5c8;border-radius:22px;background:#fff}.current h2{margin:.2rem 0 .45rem}.current>span{justify-self:start}
    .surface,.stage-heading span{display:inline-flex;padding:5px 9px;border-radius:99px;background:#e8eee4;color:#50634d;font-size:11px;font-weight:700}.surface.text{background:#ece9e1;color:#665f53}.surface.terminal{background:#e6e2f0;color:#5c5275}
    section+section{margin-top:30px}.section-title{margin-bottom:12px}.section-title h2{margin-top:3px}
    .stages{display:grid;gap:9px;padding:0;list-style:none}.stages li{display:grid;grid-template-columns:38px 1fr;gap:11px;padding:15px;border:1px solid #ddd9cd;border-radius:18px;background:#faf9f5}.stages li.pending{opacity:.62}.stages li.current{border-color:#81917b;background:#f3f7ef}.stages li.complete .step{background:#60705b;color:white}
    .step{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e5e2d8;font-size:11px;font-weight:800}.stage-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.stages p{margin-top:4px;color:#66685f;font-size:13px}.stages small{display:block;margin-top:7px;color:#4f674c}
    .artifacts{display:grid;gap:10px}.artifacts a{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;padding:16px;border-radius:17px;background:#fff;color:inherit;text-decoration:none;border:1px solid #dbd8cd}.artifacts a span{grid-row:1/3;padding:4px 8px;align-self:center;border-radius:8px;background:#252a24;color:white;font-size:10px;letter-spacing:.1em}.artifacts a.stale{background:#f1eee8;color:#78766f}.artifacts a.stale span{background:#8b7567}.artifacts small{color:#77796f}.history{display:grid;gap:8px;padding:0;list-style:none}.history li{display:grid;grid-template-columns:58px 1fr;gap:10px;padding:13px 0;border-bottom:1px solid #ddd9cd}.history li>span{font-size:10px;font-weight:800;color:#778172}.history strong{font-size:13px}.history p{margin-top:3px;font-size:12px;color:#71736b}.empty{padding:18px;border:1px dashed #cbc7b9;border-radius:17px;color:#71736b}footer{display:grid;gap:4px;margin-top:36px;padding-top:18px;border-top:1px solid #d4d0c3;color:#76786f;font-size:12px}
    @media (min-width:640px){main{padding:36px 24px 64px}.hero{grid-template-columns:1fr auto;align-items:end;padding:36px}.current{grid-template-columns:1fr auto;align-items:start}.current>span{justify-self:end}.artifacts{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (prefers-reduced-motion:no-preference){a{transition:transform .16s ease,border-color .16s ease}a:hover{transform:translateY(-2px);border-color:#899883}}
  `;
}
