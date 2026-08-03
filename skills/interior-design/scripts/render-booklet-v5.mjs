import { ownerTitle } from "./owner-language-v5.mjs";

export function renderBookletV5({ contract, project, quality, metrics, renders }) {
  const projectTitle = ownerTitle(project.title);
  const concept = project.design?.concept || {};
  const strategies = (project.design?.spaceStrategies || []).filter((entry) => !/专业接口|技术接口/.test(entry.space || ""));
  const materials = project.design?.materials || [];
  const budget = project.design?.budget || [];
  const confirmedNeeds = (project.requirements || []).filter((entry) => ["satisfied", "confirmed"].includes(entry.status));
  const ownerDecisions = (project.unknowns || []).filter((entry) => /业主/.test(entry.owner || ""));
  const projectChecks = [...(project.unknowns || []).filter((entry) => !/业主/.test(entry.owner || "")), ...(project.professionalVerifications || [])];
  const totalLow = budget.reduce((sum, entry) => sum + (Number(entry.low) || 0), 0);
  const totalHigh = budget.reduce((sum, entry) => sum + (Number(entry.high) || 0), 0);
  const heroRender = renders[0];
  const status = quality.constructionReady ? "已具备施工协调条件" : "方案可看，施工前需复尺";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'">
  <title>${html(projectTitle)} · 装修设计册</title>
  <link rel="stylesheet" href="assets/booklet.css">
</head>
<body data-contract="${html(contract)}">
  <main class="book">
    <section class="hero" aria-labelledby="page-title">
      <div class="hero-copy">
        <p class="eyebrow">住宅装修设计方案</p>
        <p class="project-name">${html(projectTitle)}</p>
        <h1 id="page-title">${html(concept.name || "家的空间方案")}</h1>
        <p class="hero-summary">${html(concept.summary || project.brief?.summary || "从日常动线、收纳、采光和长期使用出发，整理一套清楚、耐看的家。")}</p>
        <div class="hero-actions">
          <a class="button primary" href="#drawings">在线查看图纸</a>
          <a class="button secondary" href="3d/index.html" target="_blank" rel="noopener">进入 3D 看房</a>
        </div>
        <p class="hero-status"><span></span>${html(status)}</p>
      </div>
      <figure class="hero-media">
        ${heroRender ? `<img src="${url(heroRender.file)}" alt="${html(heroRender.title)}">` : `<img src="media/plan.svg" alt="装修平面方案">`}
        <figcaption>效果图用于沟通空间、材质与光线，最终以现场、样板和深化图为准。</figcaption>
      </figure>
    </section>

    <section class="readiness" aria-label="当前进度">
      <article><span class="step ready">1</span><div><small>现在可以</small><strong>审阅空间方案</strong></div></article>
      <article><span class="step hold">2</span><div><small>下一步需要</small><strong>确认需求与预算</strong></div></article>
      <article><span class="step hold">3</span><div><small>施工下单前</small><strong>现场复尺与专业深化</strong></div></article>
    </section>

    <section class="section overview" aria-labelledby="overview-title">
      <div class="section-kicker">方案速览</div>
      <div class="section-heading"><h2 id="overview-title">你会获得怎样的家</h2><p>${html(concept.rationale || "空间围绕每天真实发生的动作组织，让通行、收纳和设备各得其所。")}</p></div>
      <div class="home-metrics">
        <article><strong>${metrics.modeledAreaSqM}㎡</strong><span>当前方案面积</span></article>
        <article><strong>${metrics.rooms} 个</strong><span>独立使用空间</span></article>
        <article><strong>1 条</strong><span>连续公共生活轴</span></article>
        <article><strong>2 组</strong><span>收纳与设备核心</span></article>
      </div>
      <div class="strategy-grid">${strategies.map((entry) => `<article class="strategy"><h3>${html(entry.space)}</h3><p>${html(entry.strategy)}</p><small>确认方式：${html(entry.verification || "结合现场和实际使用确认")}</small></article>`).join("")}</div>
    </section>

    <section class="section" aria-labelledby="spaces-title">
      <div class="section-kicker">空间设计</div>
      <div class="section-heading"><h2 id="spaces-title">先感受空间，再看细节</h2><p>重点查看比例、动线、收纳位置和光线关系。柜体分格、灯位和设备尺寸会在确认需求后继续深化。</p></div>
      <div class="renders">${renderViews(renders)}</div>
    </section>

    <section class="section drawings-section" id="drawings" aria-labelledby="drawings-title">
      <div class="section-kicker">在线图纸</div>
      <div class="section-heading"><h2 id="drawings-title">六类设计图纸，解决六种不同问题</h2><p>每张图只表达一个专业主题，避免把同一张底图换颜色冒充不同图纸。可滚轮缩放、拖动查看，确认后仍可回到对应图纸修改。</p></div>
      <div class="drawing-shell">
        <div class="drawing-tabs" role="tablist" aria-label="选择图纸">
          <button id="drawing-tab-p-01-plan-layout" type="button" role="tab" aria-selected="true" aria-controls="drawing-p-01-plan-layout" data-drawing-tab="p-01-plan-layout">平面布置</button>
          <button id="drawing-tab-c-01-ceiling-lighting" type="button" role="tab" aria-selected="false" aria-controls="drawing-c-01-ceiling-lighting" data-drawing-tab="c-01-ceiling-lighting" tabindex="-1">天花灯具</button>
          <button id="drawing-tab-e-01-switch-control" type="button" role="tab" aria-selected="false" aria-controls="drawing-e-01-switch-control" data-drawing-tab="e-01-switch-control" tabindex="-1">开关控制</button>
          <button id="drawing-tab-e-02-socket-layout" type="button" role="tab" aria-selected="false" aria-controls="drawing-e-02-socket-layout" data-drawing-tab="e-02-socket-layout" tabindex="-1">插座点位</button>
          <button id="drawing-tab-w-01-plumbing" type="button" role="tab" aria-selected="false" aria-controls="drawing-w-01-plumbing" data-drawing-tab="w-01-plumbing" tabindex="-1">给排水</button>
          <button id="drawing-tab-m-01-cabinet" type="button" role="tab" aria-selected="false" aria-controls="drawing-m-01-cabinet" data-drawing-tab="m-01-cabinet" tabindex="-1">柜体深化</button>
        </div>
        <div class="drawing-toolbar" aria-label="图纸工具">
          <button type="button" data-drawing-action="zoom-out" aria-label="缩小图纸">−</button>
          <output data-drawing-scale aria-live="polite">100%</output>
          <button type="button" data-drawing-action="zoom-in" aria-label="放大图纸">＋</button>
          <button type="button" data-drawing-action="reset">复位</button>
          <a data-drawing-download href="assets/drawings/p-01-plan-layout.svg" download>下载当前图纸</a>
        </div>
        <div class="drawing-viewport" tabindex="0" aria-label="图纸画布，可滚轮缩放、拖动查看">
          <div class="drawing-surface">
            <div id="drawing-p-01-plan-layout" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-p-01-plan-layout" data-drawing-panel="p-01-plan-layout"><img src="assets/drawings/p-01-plan-layout.svg" alt="平面布置在线图纸"></div>
            <div id="drawing-c-01-ceiling-lighting" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-c-01-ceiling-lighting" data-drawing-panel="c-01-ceiling-lighting" hidden><img src="assets/drawings/c-01-ceiling-lighting.svg" alt="天花与灯具在线图纸"></div>
            <div id="drawing-e-01-switch-control" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-e-01-switch-control" data-drawing-panel="e-01-switch-control" hidden><img src="assets/drawings/e-01-switch-control.svg" alt="开关控制在线图纸"></div>
            <div id="drawing-e-02-socket-layout" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-e-02-socket-layout" data-drawing-panel="e-02-socket-layout" hidden><img src="assets/drawings/e-02-socket-layout.svg" alt="插座点位在线图纸"></div>
            <div id="drawing-w-01-plumbing" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-w-01-plumbing" data-drawing-panel="w-01-plumbing" hidden><img src="assets/drawings/w-01-plumbing.svg" alt="给排水在线图纸"></div>
            <div id="drawing-m-01-cabinet" class="drawing-panel" role="tabpanel" aria-labelledby="drawing-tab-m-01-cabinet" data-drawing-panel="m-01-cabinet" hidden><img src="assets/drawings/m-01-cabinet.svg" alt="柜体深化在线图纸"></div>
          </div>
        </div>
        <p class="drawing-note">蓝色表示门窗或给排水，橙色表示门扇或电气点位。图中尺寸单位为毫米。</p>
      </div>
    </section>

    <section class="section tour-callout" aria-labelledby="tour-title">
      <div><div class="section-kicker">从草图到最终漫游</div><h2 id="tour-title">先确认 3D 设计，再逐张生成实景</h2><p>3D 草图用于修改空间关系和相机；确认后，Imagegen 按设计稿一次生成一张照片级实景全景图。每张实景图单独确认，全部通过后才组装 krpano 漫游。</p></div>
      <div class="hero-actions"><a class="button primary" href="3d/index.html" target="_blank" rel="noopener">打开 3D 草图</a><a class="button secondary" href="panorama-review/index.html" target="_blank" rel="noopener">查看实景全景进度</a><a class="button secondary" href="tour/index.html" target="_blank" rel="noopener">最终漫游入口</a></div>
    </section>

    <section class="section" aria-labelledby="material-title">
      <div class="section-kicker">材料与灯光</div>
      <div class="section-heading"><h2 id="material-title">让家保持温暖、耐看和好维护</h2><p>${html(project.design?.lighting?.summary || "公共区采用分层照明，减少单一主灯造成的眩光。")}</p></div>
      <div class="material-grid">${materials.map((entry) => `<article class="material"><small>${html(entry.category || "材料")}</small><h3>${html(entry.name)}</h3><p>${html(entry.specification || entry.intent || "")}</p><p class="material-check">确认：${html(entry.boundary || "以现场样板和实际批次为准")}</p></article>`).join("")}</div>
    </section>

    <section class="section budget-section" aria-labelledby="budget-title">
      <div class="section-kicker">预算参考</div>
      <div class="section-heading"><h2 id="budget-title">先看投入范围，再决定取舍</h2><p>${html(project.brief?.budgetBoundary || "当前为概念估算，用于控制方向，不代替正式报价和合同。")}</p></div>
      <div class="budget-total"><small>当前概念投入区间</small><strong>${money(totalLow)}–${money(totalHigh)}</strong></div>
      <div class="budget-list">${budget.length ? budget.map((entry) => `<article><div><strong>${html(entry.category)}</strong><span>${html(entry.basis || "概念估算")}</span></div><b>${money(entry.low)}–${money(entry.high)}</b></article>`).join("") : `<p>你确认预算边界后，这里会补充各部分的投入范围。</p>`}</div>
    </section>

    <section class="section agreement" aria-labelledby="agreement-title">
      <div class="section-kicker">本轮共识</div>
      <div class="section-heading"><h2 id="agreement-title">这些需求已经进入方案</h2><p>它们是本轮需要保留的设计前提。若你的生活方式或优先级发生变化，告诉 Agent 后会重新调整相关空间。</p></div>
      <div class="agreement-grid">${confirmedNeeds.length ? confirmedNeeds.map((entry) => `<article><span>已纳入</span><h3>${html(entry.statement)}</h3><p>${html(entry.verification || "通过本轮方案继续确认")}</p></article>`).join("") : `<article><h3>还没有锁定的需求</h3><p>先从家庭成员、日常动作、收纳量和预算开始补充。</p></article>`}</div>
    </section>

    <section class="section decisions" aria-labelledby="decision-title">
      <div class="section-kicker">下一步</div>
      <div class="section-heading"><h2 id="decision-title">这些决定需要你确认</h2><p>你只需要确认生活方式和投入选择；尺寸、结构与工程问题由相应专业人员负责。</p></div>
      <div class="decision-columns">
        <article><h3>请业主确认</h3><ol>${renderDecisionList(ownerDecisions, "当前没有待确认的业主事项。")}</ol></article>
        <article><h3>交给专业人员</h3><ol>${renderDecisionList(projectChecks, "当前没有待专业复核的事项。")}</ol></article>
      </div>
      <p class="boundary">当前方案可以用于确认空间方向、材料气质和投入范围；不能直接用于施工或定制下单。进入下一阶段前，必须完成现场复尺和相应专业复核。</p>
    </section>

    <section class="section share-note" aria-labelledby="share-title">
      <div class="section-kicker">一起确认</div>
      <div class="section-heading"><h2 id="share-title">把这一版发给家人一起看</h2><p>重点讨论空间是否好用、风格是否喜欢、预算是否合适，以及哪些需求仍需补充。意见确认后，Agent 会更新同一个方案入口。</p></div>
      <div class="share-points"><span>看设计册</span><span>切换在线图纸</span><span>进入 3D 走一遍</span><span>反馈要保留与要调整的内容</span></div>
    </section>
    <footer>当前页面用于需求澄清与方案确认，不是施工图。施工与定制生产前须现场复尺并由相应专业人员深化。</footer>
  </main>
  <script src="assets/booklet.js"></script>
</body>
</html>
`;
}

function renderViews(renders) {
  if (!renders.length) return `<div class="empty">效果图正在准备中，可先查看在线图纸和 3D 空间。</div>`;
  return renders.map((entry, index) => `<figure class="render${index === 0 ? " featured" : ""}"><img src="${url(entry.file)}" alt="${html(entry.title)}"><figcaption><strong>${html(entry.title)}</strong><span>${html(shortDisclaimer(entry.disclaimer))}</span></figcaption></figure>`).join("");
}

function renderDecisionList(entries, empty) {
  if (!entries.length) return `<li>${html(empty)}</li>`;
  return entries.map((entry) => `<li><strong>${html(entry.statement)}</strong><span>${html(entry.holdPoint || "进入下一阶段前")}</span></li>`).join("");
}

function shortDisclaimer(value) {
  return String(value || "概念效果，以现场、实样和深化结果为准。").replace(/^原创概念效果图[，,]?/, "");
}

function html(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
function url(value) { return String(value || "").split("/").map(encodeURIComponent).join("/"); }
function money(value) { return Number.isFinite(value) && value > 0 ? `¥${Math.round(value).toLocaleString("zh-CN")}` : "待确认"; }
