import { ownerTitle } from "./owner-language-v5.mjs";

export function renderViewerV5(project) {
  const projectTitle = ownerTitle(project.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'">
  <title>${html(projectTitle)} · 3D 看房</title>
  <link rel="stylesheet" href="viewer.css">
</head>
<body data-engine="three-interior-v5" data-view-mode="overview" data-ceiling="hidden" data-labels="visible">
  <main class="viewer-app">
    <header class="viewer-bar">
      <div class="viewer-brand"><strong>${html(projectTitle)}</strong><span>3D 看房</span></div>
      <div class="viewer-actions" aria-label="查看方式">
        <button type="button" data-view="overview" aria-pressed="true">鸟瞰</button>
        <button type="button" data-view="plan" aria-pressed="false">平面</button>
        <button type="button" data-action="walk">进入室内</button>
        <button type="button" data-action="ceiling" aria-pressed="false">顶面</button>
        <button type="button" data-action="reset">复位</button>
        <a href="../index.html">返回设计册</a>
      </div>
    </header>
    <section class="model-stage" id="model-stage" aria-label="可鸟瞰并进入室内漫游的装修三维模型">
      <canvas id="model-canvas" tabindex="0"></canvas>
      <div id="viewer-loading" class="viewer-loading">正在准备 3D 看房…</div>
      <aside class="room-nav" aria-labelledby="room-nav-title">
        <strong id="room-nav-title">直接进入空间</strong>
        <div id="room-buttons"></div>
      </aside>
      <div id="model-labels" class="model-labels"></div>
      <div class="walk-help" id="walk-help" hidden>
        <strong>室内漫游</strong>
        <span>移动鼠标观察，WASD 或方向键移动，Esc 释放鼠标。</span>
        <div><button type="button" data-action="resume-walk">继续漫游</button><button type="button" data-action="exit-walk">退出室内</button></div>
      </div>
      <div class="viewer-hint" id="viewer-hint">拖动旋转 · 滚轮缩放 · 也可从左侧直接进入房间</div>
      <div class="viewer-boundary">概念设计展示 · 施工与定制生产前须现场复尺并由专业人员复核</div>
    </section>
  </main>
  <script src="model-data.js"></script>
  <script src="viewer.bundle.js"></script>
</body>
</html>
`;
}

function html(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
