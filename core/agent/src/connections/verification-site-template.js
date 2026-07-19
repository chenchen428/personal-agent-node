export function renderVerificationSite({ marker, domain }) {
  const safeMarker = escapeAttribute(marker);
  const safeDomain = escapeHtml(domain);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="personal-agent-verification" content="${safeMarker}">
  <meta name="description" content="Personal Agent Node 的公网发布与端到端连接验证页。">
  <title>Personal Agent Node · Verified publication</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f4f1e9;
      --surface: #fbfaf6;
      --ink: #25231f;
      --muted: #706b62;
      --line: #d8d1c4;
      --accent: #c35f3d;
      --success: #2f6a4d;
      --mono: ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, monospace;
      --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --serif: "Iowan Old Style", "Palatino Linotype", "Noto Serif SC", Georgia, serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); }
    a { color: inherit; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    .topbar { border-bottom: 1px solid var(--line); }
    .topbar-inner { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .brand { display: flex; align-items: center; gap: 13px; font-weight: 760; letter-spacing: -.02em; }
    .mark { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; background: var(--ink); color: var(--surface); font-size: 13px; }
    .publication-state { display: flex; align-items: center; gap: 9px; color: var(--success); font: 650 11px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .publication-state::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
    .hero { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(250px, .55fr); gap: clamp(48px, 9vw, 120px); padding: clamp(76px, 12vw, 156px) 0 clamp(70px, 10vw, 126px); }
    .kicker, .section-index { color: var(--accent); font: 700 11px/1.4 var(--mono); letter-spacing: .13em; text-transform: uppercase; }
    h1 { max-width: 850px; margin: 25px 0 30px; font: 500 clamp(56px, 8.6vw, 112px)/.91 var(--serif); letter-spacing: -.065em; }
    .lead { max-width: 720px; margin: 0; color: #514d46; font-size: clamp(18px, 2vw, 23px); line-height: 1.75; }
    .hero-aside { align-self: end; border-left: 1px solid var(--line); padding-left: 28px; }
    .hero-aside dl { margin: 0; }
    .hero-aside div { padding: 18px 0; border-top: 1px solid var(--line); }
    .hero-aside div:last-child { border-bottom: 1px solid var(--line); }
    dt { color: var(--muted); font: 600 10px/1.4 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    dd { margin: 7px 0 0; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
    .article { border-top: 1px solid var(--line); }
    .chapter { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: clamp(36px, 7vw, 96px); padding: clamp(64px, 9vw, 112px) 0; border-bottom: 1px solid var(--line); }
    .chapter h2 { max-width: 760px; margin: 0 0 24px; font: 500 clamp(34px, 5vw, 62px)/1.02 var(--serif); letter-spacing: -.045em; }
    .chapter-intro { max-width: 770px; margin: 0; color: #555048; font-size: 18px; line-height: 1.85; }
    .capabilities { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 64px; border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
    .capability { min-height: 245px; padding: clamp(26px, 4vw, 42px); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 58%, transparent); }
    .capability code { color: var(--accent); font: 650 11px/1 var(--mono); }
    .capability h3 { margin: 42px 0 13px; font: 650 21px/1.25 var(--sans); letter-spacing: -.025em; }
    .capability p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.75; }
    .verification-flow { margin-top: 54px; counter-reset: step; border-top: 1px solid var(--line); }
    .flow-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 24px; padding: 27px 0; border-bottom: 1px solid var(--line); }
    .flow-row::before { counter-increment: step; content: "0" counter(step); color: var(--accent); font: 700 12px/1.6 var(--mono); }
    .flow-row strong { display: block; margin-bottom: 7px; font-size: 17px; }
    .flow-row p { max-width: 720px; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.7; }
    .scenarios { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; margin-top: 48px; }
    .scenario { padding-top: 22px; border-top: 2px solid var(--ink); }
    .scenario h3 { margin: 0 0 12px; font-size: 17px; }
    .scenario p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
    .closing { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(260px, .6fr); gap: 64px; align-items: end; padding: clamp(80px, 12vw, 150px) 0; }
    .closing h2 { margin: 0; font: 500 clamp(40px, 6vw, 76px)/.98 var(--serif); letter-spacing: -.05em; }
    .closing p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.8; }
    footer { border-top: 1px solid var(--line); }
    .footer-inner { min-height: 92px; display: flex; align-items: center; justify-content: space-between; gap: 24px; color: var(--muted); font: 600 11px/1.5 var(--mono); }
    @media (max-width: 760px) {
      .shell { width: min(100% - 28px, 1180px); }
      .topbar-inner { min-height: 66px; }
      .publication-state span { display: none; }
      .hero { grid-template-columns: 1fr; gap: 54px; padding: 72px 0 78px; }
      h1 { font-size: clamp(50px, 17vw, 76px); }
      .hero-aside { padding-left: 20px; }
      .chapter { grid-template-columns: 1fr; gap: 28px; padding: 68px 0; }
      .capabilities, .scenarios { grid-template-columns: 1fr; }
      .capability { min-height: 0; }
      .closing { grid-template-columns: 1fr; gap: 32px; }
      .footer-inner { align-items: flex-start; flex-direction: column; justify-content: center; gap: 8px; }
    }
  </style>
</head>
<body data-verification="${safeMarker}">
  <header class="topbar">
    <div class="shell topbar-inner">
      <div class="brand"><span class="mark">PA</span><span>Personal Agent Node</span></div>
      <div class="publication-state"><span>Verified publication</span></div>
    </div>
  </header>
  <main>
    <section class="shell hero">
      <div>
        <div class="kicker">Local-first agent · public when you choose</div>
        <h1>你的 Node，已经有了自己的公开入口。</h1>
        <p class="lead">Personal Agent 在你的设备上理解上下文、执行工作并保存结果。这个域名让你在需要时，把确定要公开的内容安全地带到浏览器和手机。</p>
      </div>
      <aside class="hero-aside" aria-label="本次发布信息">
        <dl>
          <div><dt>Publication</dt><dd>Domain binding verification</dd></div>
          <div><dt>Public domain</dt><dd>${safeDomain}</dd></div>
          <div><dt>Data boundary</dt><dd>内容与工作状态仍由本机 Node 管理</dd></div>
        </dl>
      </aside>
    </section>

    <article class="article">
      <section class="shell chapter">
        <div class="section-index">01 / What it does</div>
        <div>
          <h2>一个属于你的、持续工作的合成 Node。</h2>
          <p class="chapter-intro">它把对话、任务、邮件、数据、连接器和发布页放进同一个本地工作环境。你负责目标与边界，Personal Agent 负责整理上下文、推进过程，并把可以复用的结果留下来。</p>
          <div class="capabilities">
            <section class="capability"><code>01</code><h3>在本机理解与执行</h3><p>围绕你的 Workspace 阅读文件、拆分任务并运行受控工具。原始上下文默认留在自己的设备上。</p></section>
            <section class="capability"><code>02</code><h3>连接真实工作入口</h3><p>按需连接邮件、内容平台与数据源，让 Agent 从真实事件开始工作，而不是依赖手动复制粘贴。</p></section>
            <section class="capability"><code>03</code><h3>沉淀可查看的结果</h3><p>任务过程、邮件归档、结构化数据和 Pages 各自保留清晰入口，方便之后继续查看与复用。</p></section>
            <section class="capability"><code>04</code><h3>只发布你选择的内容</h3><p>通过加密穿透把指定 Page 带到公网。公开入口不会把整个本地工作区变成一个远程文件夹。</p></section>
          </div>
        </div>
      </section>

      <section class="shell chapter">
        <div class="section-index">02 / Why this page</div>
        <div>
          <h2>为什么会看到这张验证发布？</h2>
          <p class="chapter-intro">域名被分配并不等于链路真正可用。绑定过程中，Node 会生成这张固定页面，再从最终公网地址重新请求它；只有返回内容与本次发布一致，Site 才会显示为“验证通过”。</p>
          <div class="verification-flow">
            <div class="flow-row"><div><strong>在本机生成</strong><p>欢迎页由当前 Personal Agent Node 写入受控发布目录，不依赖用户已有的 Page 或文件。</p></div></div>
            <div class="flow-row"><div><strong>经由域名穿透</strong><p>请求从分配给你的公网域名进入，并沿加密连接抵达正在运行的本机 Node。</p></div></div>
            <div class="flow-row"><div><strong>回读并核对</strong><p>服务确认 HTTP 状态、最终域名和隐藏发布标记一致，随后才提交绑定成功状态。</p></div></div>
          </div>
        </div>
      </section>

      <section class="shell chapter">
        <div class="section-index">03 / Useful moments</div>
        <div>
          <h2>这个公网入口，适合出现在这些时刻。</h2>
          <div class="scenarios">
            <section class="scenario"><h3>在手机上查看结果</h3><p>离开电脑之后，继续阅读 Agent 已经完成并明确发布的页面。</p></section>
            <section class="scenario"><h3>分享一份确定的交付</h3><p>把旅行方案、研究整理或数据报告作为稳定页面发给协作伙伴。</p></section>
            <section class="scenario"><h3>检查迁移后的连通性</h3><p>更换设备、网络或重新授权后，用真实公网回读确认发布链路恢复。</p></section>
          </div>
        </div>
      </section>
    </article>

    <section class="shell closing">
      <h2>Local by default.<br>Public by intent.</h2>
      <p>这张页面证明公开发布链路已经工作。接下来，你可以在 Personal Agent 中创建自己的 Page，并决定哪些结果值得被带到这个域名。</p>
    </section>
  </main>
  <footer><div class="shell footer-inner"><span>Personal Agent Node</span><span>${safeDomain} · verified publication</span></div></footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
