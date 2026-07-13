import fs from 'node:fs';
import path from 'node:path';

const domainPresentation = {
  'personal-agent.local': ['主页', '个人站点与服务入口', 'C'],
  'agent.personal-agent.local': ['Agent', '会话、记忆与定时任务', 'A'],
  'mail.personal-agent.local': ['邮件', 'Agent 收件与处理记录', '邮'],
  'pages.personal-agent.local': ['Pages', '发布页面与静态内容', 'P'],
  'tools.personal-agent.local': ['工具箱', '日常业务工具', 'T'],
  'blog.personal-agent.local': ['博客', '文章与长期内容', 'B'],
  'docs.personal-agent.local': ['文档', '文档与资料入口', 'D'],
  'demo.personal-agent.local': ['Demo', '产品演示与实验', 'M'],
  'sgtools.personal-agent.local': ['SG Tools', '新加坡常用工具', 'S'],
  'tjcds.personal-agent.local': ['TJCDS', '专题服务入口', 'J'],
  'sg.personal-agent.local': ['旅行页', '行程与旅行资料', '旅'],
  'resources.personal-agent.local': ['资源', '公开资源与文件', 'R'],
};

export function buildNavigationItems({ registry, panelConfig, hostHeader = '', clickState = {} }) {
  const hostname = String(hostHeader).split(':')[0].toLowerCase();
  const localMode = hostname === panelConfig.localBaseDomain || hostname.endsWith(`.${panelConfig.localBaseDomain}`);
  const clicks = clickState.clicks && typeof clickState.clicks === 'object' ? clickState.clicks : {};
  const items = [];
  let order = 0;
  const channelClick = clicks['admin:channels'] || {};
  items.push({
    id: 'admin:channels',
    domain: hostname || panelConfig.primaryDomain,
    href: `${localMode ? 'http://agent.personal-agent.local' : 'https://agent.personal-agent.local'}/agent-channels`,
    label: '小红书',
    description: '登录状态与只读检索',
    mark: '红',
    projectName: 'xiaohongshu-channel',
    clickCount: Number(channelClick.count) || 0,
    lastClickedAt: String(channelClick.lastClickedAt || ''),
    order: order++,
  });
  for (const project of registry.projects || []) {
    if (project.status === 'retired') continue;
    for (const domain of project.domains || []) {
      if (domain === panelConfig.primaryDomain) continue;
      const presentation = domainPresentation[domain] || [domain.split('.')[0], project.description || domain, domain[0].toUpperCase()];
      const localDomain = toLocalDomain(domain, panelConfig);
      const click = clicks[domain] || {};
      items.push({
        id: domain,
        domain: localMode ? localDomain : domain,
        href: `${localMode ? 'http' : 'https'}://${localMode ? localDomain : domain}`,
        label: presentation[0],
        description: presentation[1],
        mark: presentation[2],
        projectName: project.name,
        clickCount: Number(click.count) || 0,
        lastClickedAt: String(click.lastClickedAt || ''),
        order: order++,
      });
    }
  }
  return items.sort((left, right) => (
    right.clickCount - left.clickCount
    || right.lastClickedAt.localeCompare(left.lastClickedAt)
    || left.order - right.order
  ));
}

export function readNavigationState(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : { clicks: {} };
  } catch {
    return { clicks: {} };
  }
}

export function recordNavigationClick(filePath, id, allowedIds) {
  if (!allowedIds.has(id)) throw new Error('Unknown navigation target.');
  const state = readNavigationState(filePath);
  if (!state.clicks || typeof state.clicks !== 'object') state.clicks = {};
  const previous = state.clicks[id] || {};
  state.clicks[id] = {
    count: Math.min((Number(previous.count) || 0) + 1, Number.MAX_SAFE_INTEGER),
    lastClickedAt: new Date().toISOString(),
  };
  const target = path.resolve(filePath);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return state;
}

export function renderNavigationPage({ title, items }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7eedb">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light;--canvas:#d8c8aa;--paper:#f7eedb;--paper-light:#fff9eb;--ink:#261f1a;--muted:#73685c;--line:#c8b99d;--red:#d8492f;--red-deep:#a52f20;--green:#486052;--green-bright:#1d8b62;--blue:#526d83;--amber:#ad7b24;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    *{box-sizing:border-box}html,body{min-height:100%}body{margin:0;background:var(--canvas);color:var(--ink)}button{font:inherit}a{color:inherit;text-decoration:none}.app{position:relative;width:min(100%,74rem);min-height:100dvh;margin:0 auto;overflow:hidden;border-inline:1px solid rgba(73,58,43,.24);background-color:var(--paper);box-shadow:0 26px 80px rgba(38,31,26,.16)}.app:before{position:absolute;inset:0;z-index:0;pointer-events:none;content:"";opacity:.22;background-size:7px 7px;background-image:linear-gradient(90deg,rgba(72,96,82,.08) 1px,transparent 1px),linear-gradient(rgba(216,73,47,.05) 1px,transparent 1px)}.app>*{position:relative;z-index:1}
    .topbar{min-height:4rem;display:flex;align-items:center;gap:.85rem;padding:.55rem 1.25rem;border-bottom:1px solid var(--ink);background:rgba(247,238,219,.95);position:sticky;top:0;z-index:20}.brand-stamp{width:2.35rem;height:2.35rem;display:grid;place-items:center;border:2px solid var(--red);color:var(--red);font-family:"Songti SC","STSong",serif;font-size:1.25rem;font-weight:800;transform:rotate(-3deg)}.brand{min-width:0;flex:1;display:grid;gap:.08rem}.brand strong{font-family:"Songti SC","STSong",serif;font-size:1.05rem}.brand span{color:var(--muted);font-size:.68rem;text-transform:uppercase}.refresh{width:2.45rem;height:2.45rem;border:1px solid var(--ink);border-radius:4px;background:transparent;color:var(--ink);cursor:pointer;font-size:1.15rem}.refresh:hover,.refresh:focus-visible{border-color:var(--red);color:var(--red);outline:0}
    .editorial-intro{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(15rem,.75fr);gap:2rem;align-items:end;padding:2.25rem 1.25rem 1.5rem;border-bottom:1px solid var(--line)}.intro-kicker{margin:0 0 .55rem;color:var(--red-deep);font-size:.7rem;font-weight:800;text-transform:uppercase}.editorial-intro h1{max-width:11ch;margin:0;font-family:"Songti SC","STSong",serif;font-size:clamp(2rem,5vw,4.6rem);line-height:.98;letter-spacing:0}.intro-note{margin:0 0 .2rem;border-left:4px solid var(--green);padding:.2rem 0 .2rem 1rem;color:var(--muted);font-size:.82rem;line-height:1.7}.intro-note strong{display:block;margin-bottom:.2rem;color:var(--ink);font-family:"Songti SC","STSong",serif;font-size:1.05rem}
    .status-band{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1rem;align-items:center;margin:0 1.25rem;padding:1rem 0;border-bottom:1px solid var(--ink)}.status-index{width:3.35rem;height:3.35rem;display:grid;place-items:center;border:2px solid var(--green);border-radius:50%;color:var(--green);font-family:"Songti SC","STSong",serif;font-size:1.35rem;font-weight:800}.status-copy{min-width:0;display:grid;gap:.25rem}.status-title{display:flex;align-items:center;gap:.55rem;font-size:.95rem;font-weight:800}.status-detail{margin:0;color:var(--muted);font-size:.78rem;line-height:1.5}.dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--muted);flex:0 0 auto}.dot.good{background:#16a36f;box-shadow:0 0 0 3px rgba(22,163,111,.14)}.dot.bad{background:var(--red)}.dot.warn{background:var(--amber)}.wechat-actions{display:flex;gap:.45rem}.action{min-width:4rem;height:2.35rem;border:1px solid var(--ink);border-radius:4px;background:transparent;color:var(--ink);padding:0 .8rem;font-weight:700;font-size:.78rem;cursor:pointer}.action:hover,.action:focus-visible{background:var(--green);border-color:var(--green);color:#fff;outline:0}.action.danger{border-color:var(--red-deep);color:var(--red-deep)}.action.danger:hover{background:var(--red);border-color:var(--red);color:#fff}
    .qr-panel{display:grid;grid-template-columns:minmax(12rem,16rem) minmax(0,1fr);gap:1.25rem;align-items:center;margin:0 1.25rem;padding:1.25rem 0;border-bottom:1px solid var(--line)}.qr-panel[hidden]{display:none}.qr-box{aspect-ratio:1;width:100%;display:grid;place-items:center;border:1px solid var(--ink);background:#fff;padding:.65rem}.qr-box svg{display:block;width:100%;height:auto}.qr-copy{max-width:28rem;color:var(--muted);font-family:"Songti SC","STSong",serif;font-size:.95rem;line-height:1.7}
    .capacity-band{margin:0 1.25rem;padding:1rem 0;border-bottom:1px solid var(--ink)}.capacity-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.65rem}.capacity-heading strong{font-family:"Songti SC","STSong",serif;font-size:.95rem}.capacity-heading span{color:var(--muted);font-size:.68rem}.capacity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}.capacity-item{min-width:0;display:grid;gap:.25rem;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:.75rem .85rem;background:rgba(255,249,235,.26)}.capacity-item span{color:var(--muted);font-size:.68rem}.capacity-item strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"Songti SC","STSong",serif;font-size:1rem}.capacity-item small{color:var(--muted);font-size:.65rem}.capacity-band[data-state="warning"] .capacity-heading span{color:var(--amber)}.capacity-band[data-state="critical"] .capacity-heading span{color:var(--red-deep);font-weight:700}.content{padding:1.4rem 1.25rem 2.5rem}.section-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:.85rem}.section-head-title{display:flex;align-items:baseline;gap:.65rem}.section-no{color:var(--red);font-family:"Songti SC","STSong",serif;font-size:1.55rem;font-weight:800}.section-head h2{margin:0;font-family:"Songti SC","STSong",serif;font-size:1.2rem;letter-spacing:0}.detect-state{color:var(--muted);font-size:.7rem}.nav-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--ink);border-left:1px solid var(--ink)}.nav-item{position:relative;min-width:0;min-height:6.6rem;display:grid;grid-template-columns:3rem minmax(0,1fr) auto;align-items:center;gap:.9rem;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink);background:rgba(255,249,235,.38);padding:1rem;transition:background-color .15s ease,box-shadow .15s ease}.nav-item:hover{z-index:1;background:rgba(255,249,235,.86);box-shadow:inset 0 0 0 2px rgba(72,96,82,.2)}.nav-item:focus-visible{z-index:1;background:var(--paper-light);outline:2px solid var(--red);outline-offset:-3px}.nav-item:active{background:rgba(216,73,47,.08)}.nav-mark{width:2.85rem;height:2.85rem;display:grid;place-items:center;border:1px solid currentColor;border-radius:50%;color:var(--green);font-family:"Songti SC","STSong",serif;font-size:1rem;font-weight:800}.nav-item:nth-child(4n+2) .nav-mark{color:var(--red)}.nav-item:nth-child(4n+3) .nav-mark{color:var(--blue)}.nav-item:nth-child(4n) .nav-mark{border-radius:3px;color:var(--red-deep);transform:rotate(-2deg)}.nav-copy{min-width:0;display:grid;gap:.3rem}.nav-copy strong{font-family:"Songti SC","STSong",serif;font-size:1rem}.nav-copy small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.73rem}.nav-meta{display:grid;justify-items:end;gap:.45rem;color:var(--muted);font-size:.66rem}.nav-state{display:flex;align-items:center;gap:.35rem;white-space:nowrap}.nav-arrow{font-size:1.15rem;color:currentColor}
    .refresh:hover{border-color:var(--ink);color:var(--ink)}.action:hover{background:transparent;border-color:var(--ink);color:var(--ink)}.action.danger:hover{background:transparent;border-color:var(--red-deep);color:var(--red-deep)}.nav-item:hover,.nav-item:active{z-index:auto;background:rgba(255,249,235,.38);box-shadow:none}
    .footer-line{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);margin-top:1.5rem;padding-top:.75rem;color:var(--muted);font-size:.65rem;text-transform:uppercase}
    @media(max-width:700px){body{background:var(--paper)}.app{border:0;box-shadow:none}.topbar{padding-inline:.85rem}.editorial-intro{grid-template-columns:1fr;gap:1rem;padding:1.6rem .85rem 1.25rem}.editorial-intro h1{font-size:2.8rem}.status-band{grid-template-columns:auto minmax(0,1fr);margin-inline:.85rem}.wechat-actions{grid-column:1 / -1;width:100%}.action{flex:1}.qr-panel{grid-template-columns:1fr;margin-inline:.85rem}.qr-box{width:min(100%,16rem);margin:auto}.capacity-band{margin-inline:.85rem}.capacity-grid{grid-template-columns:1fr}.content{padding:1.2rem .85rem 2rem}.nav-grid{grid-template-columns:1fr}.nav-item{min-height:5.8rem}.section-head{align-items:center}.footer-line{flex-direction:column;gap:.25rem}}
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <span class="brand-stamp" aria-hidden="true">陈</span>
      <div class="brand"><strong>personal-agent.local</strong><span>Personal service ledger</span></div>
      <button class="refresh" type="button" data-refresh title="刷新状态" aria-label="刷新状态">↻</button>
    </header>
    <section class="editorial-intro">
      <div>
        <p class="intro-kicker">Navigation · Status · Daily tools</p>
        <h1>站点导航</h1>
      </div>
      <p class="intro-note"><strong>把常用服务放在顺手的位置</strong>访问过的入口会自动向前排列；这里只保留导航和当前可用状态。</p>
    </section>
    <section class="status-band" aria-labelledby="wechat-title">
      <span class="status-index" aria-hidden="true">微</span>
      <div class="status-copy">
        <div class="status-title" id="wechat-title"><span class="dot" data-wechat-dot></span><span data-wechat-label>微信状态检测中</span></div>
        <p class="status-detail" data-wechat-detail>正在连接消息通道…</p>
      </div>
      <div class="wechat-actions">
        <button class="action" type="button" data-wechat-refresh>刷新</button>
        <button class="action" type="button" data-wechat-action disabled>检测中</button>
      </div>
    </section>
    <section class="qr-panel" data-qr-panel hidden>
      <div class="qr-box" data-qr-box></div>
      <div class="qr-copy" data-qr-copy>请使用微信扫码并在手机上确认。</div>
    </section>
    <section class="capacity-band" data-capacity-band data-state="loading" aria-labelledby="capacity-title">
      <div class="capacity-heading"><strong id="capacity-title">服务器容量</strong><span data-capacity-state>检测中</span></div>
      <div class="capacity-grid">
        <div class="capacity-item"><span>磁盘</span><strong data-capacity-value="disk">--</strong><small data-capacity-detail="disk">根分区</small></div>
        <div class="capacity-item"><span>内存</span><strong data-capacity-value="memory">--</strong><small data-capacity-detail="memory">可用容量</small></div>
        <div class="capacity-item"><span>CPU 负载</span><strong data-capacity-value="cpu">--</strong><small data-capacity-detail="cpu">1 分钟</small></div>
      </div>
    </section>
    <section class="content">
      <div class="section-head">
        <div class="section-head-title"><span class="section-no">01</span><h2>常用入口</h2></div>
        <span class="detect-state" data-detect-state>服务检测中</span>
      </div>
      <nav class="nav-grid" aria-label="站点导航">
        ${items.map(renderNavigationItem).join('')}
      </nav>
      <footer class="footer-line"><span>personal-agent.local / service index</span><span>按使用频率自动排序</span></footer>
    </section>
  </main>
  <script>
    const wechat = { loggedIn: false, session: '', timer: 0 };
    const dot = document.querySelector('[data-wechat-dot]');
    const label = document.querySelector('[data-wechat-label]');
    const detail = document.querySelector('[data-wechat-detail]');
    const action = document.querySelector('[data-wechat-action]');
    const qrPanel = document.querySelector('[data-qr-panel]');
    const qrBox = document.querySelector('[data-qr-box]');
    const qrCopy = document.querySelector('[data-qr-copy]');
    const detectState = document.querySelector('[data-detect-state]');
    const capacityBand = document.querySelector('[data-capacity-band]');
    const capacityState = document.querySelector('[data-capacity-state]');

    document.querySelectorAll('[data-nav-id]').forEach((link) => link.addEventListener('click', () => {
      const body = new Blob([JSON.stringify({ id: link.dataset.navId })], { type: 'application/json' });
      navigator.sendBeacon('/api/navigation/click', body);
    }));

    async function readJson(response) {
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok || data.ok === false) throw new Error(data.error || text || response.statusText);
      return data;
    }

    async function loadProjects() {
      detectState.textContent = '服务检测中';
      try {
        const data = await readJson(await fetch('/api/projects', { cache: 'no-store' }));
        const byName = new Map((data.projects || []).map((project) => [project.name, project]));
        document.querySelectorAll('[data-project]').forEach((item) => {
          const project = byName.get(item.dataset.project);
          const state = project && project.status ? project.status.state : 'unknown';
          const entry = (project && project.checks && project.checks.entry && project.checks.entry.results || [])
            .find((result) => result.domain === item.dataset.domain);
          const stateDot = item.querySelector('.dot');
          const stateLabel = item.querySelector('[data-state-label]');
          const resolvedState = entry ? (entry.ok ? 'ready' : 'unreachable') : state;
          const healthy = resolvedState === 'running' || resolvedState === 'ready';
          stateDot.className = 'dot ' + (healthy ? 'good' : resolvedState === 'unknown' ? 'warn' : 'bad');
          stateLabel.textContent = healthy ? '在线' : resolvedState === 'unknown' ? '待确认' : '异常';
        });
        detectState.textContent = '状态已更新';
      } catch {
        detectState.textContent = '检测暂不可用';
      }
    }

    function formatCapacity(bytes) {
      const value = Number(bytes) || 0;
      return value >= 1073741824 ? (value / 1073741824).toFixed(1) + ' GB' : Math.round(value / 1048576) + ' MB';
    }

    async function loadCapacity() {
      try {
        const data = await readJson(await fetch('/api/server-status', { cache: 'no-store' }));
        capacityBand.dataset.state = data.state || 'healthy';
        capacityState.textContent = data.state === 'critical' ? '需要处理' : data.state === 'warning' ? '容量偏高' : '容量正常';
        document.querySelector('[data-capacity-value="disk"]').textContent = data.disk.usedPercent + '%';
        document.querySelector('[data-capacity-detail="disk"]').textContent = formatCapacity(data.disk.usedBytes) + ' / ' + formatCapacity(data.disk.totalBytes);
        document.querySelector('[data-capacity-value="memory"]').textContent = data.memory.usedPercent + '%';
        document.querySelector('[data-capacity-detail="memory"]').textContent = '可用 ' + formatCapacity(data.memory.availableBytes);
        document.querySelector('[data-capacity-value="cpu"]').textContent = data.cpu.loadPercent + '%';
        document.querySelector('[data-capacity-detail="cpu"]').textContent = data.cpu.cores + ' 核 · load ' + data.cpu.load1;
      } catch {
        capacityBand.dataset.state = 'unknown';
        capacityState.textContent = '暂不可用';
      }
    }

    function stopPolling() {
      if (wechat.timer) clearTimeout(wechat.timer);
      wechat.timer = 0;
    }

    async function loadWechat() {
      action.disabled = true;
      try {
        const data = await readJson(await fetch('/api/wechat/status', { cache: 'no-store' }));
        wechat.loggedIn = data.loggedIn === true;
        dot.className = 'dot ' + (wechat.loggedIn ? 'good' : 'bad');
        label.textContent = wechat.loggedIn ? '微信已登录' : '微信未登录';
        detail.textContent = wechat.loggedIn
          ? (data.polling === false ? '账号已连接，消息接收正在恢复。' : '账号已连接，消息通道正在运行。')
          : '登录后可接收消息和发布通知。';
        action.textContent = wechat.loggedIn ? '解绑' : '登录微信';
        action.className = 'action' + (wechat.loggedIn ? ' danger' : '');
        action.disabled = false;
        if (wechat.loggedIn) { stopPolling(); qrPanel.hidden = true; }
      } catch (error) {
        dot.className = 'dot warn';
        label.textContent = '微信状态不可用';
        detail.textContent = error.message || String(error);
        action.textContent = '重试';
        action.disabled = false;
      }
    }

    async function startLogin() {
      stopPolling();
      action.disabled = true;
      const data = await readJson(await fetch('/api/wechat/login/start', { method: 'POST' }));
      wechat.session = data.session || '';
      qrBox.innerHTML = data.qrSvg || '';
      qrCopy.textContent = '请使用微信扫码并在手机上确认。';
      qrPanel.hidden = false;
      action.disabled = false;
      pollLogin();
    }

    async function pollLogin() {
      if (!wechat.session) return;
      try {
        const data = await readJson(await fetch('/api/wechat/login/status?session=' + encodeURIComponent(wechat.session), { cache: 'no-store' }));
        if (data.connected || data.status === 'confirmed') {
          qrCopy.textContent = '登录成功。';
          stopPolling();
          await loadWechat();
          return;
        }
        if (data.status === 'scaned') qrCopy.textContent = '已扫码，请在手机上确认。';
        else if (data.status === 'expired' || data.status === 'missing') { qrCopy.textContent = '二维码已失效，请重新登录。'; stopPolling(); return; }
      } catch (error) {
        qrCopy.textContent = error.message || String(error);
      }
      wechat.timer = setTimeout(pollLogin, 1800);
    }

    async function unlinkWechat() {
      if (!window.confirm('确认在这台服务器上解绑微信账号？')) return;
      action.disabled = true;
      await readJson(await fetch('/api/wechat/logout', { method: 'POST' }));
      wechat.loggedIn = false;
      await loadWechat();
    }

    action.addEventListener('click', async () => {
      try { if (wechat.loggedIn) await unlinkWechat(); else await startLogin(); }
      catch (error) { detail.textContent = error.message || String(error); action.disabled = false; }
    });
    document.querySelector('[data-wechat-refresh]').addEventListener('click', loadWechat);
    document.querySelector('[data-refresh]').addEventListener('click', () => Promise.all([loadProjects(), loadWechat(), loadCapacity()]));
    Promise.all([loadProjects(), loadWechat(), loadCapacity()]);
  </script>
</body>
</html>`;
}

function renderNavigationItem(item) {
  return `<a class="nav-item" href="${escapeAttr(item.href)}" data-nav-id="${escapeAttr(item.id)}" data-project="${escapeAttr(item.projectName)}" data-domain="${escapeAttr(item.domain)}">
    <span class="nav-mark" aria-hidden="true">${escapeHtml(item.mark)}</span>
    <span class="nav-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span>
    <span class="nav-meta"><span class="nav-state"><span class="dot"></span><span data-state-label>检测中</span></span><span class="nav-arrow" aria-hidden="true">↗</span></span>
  </a>`;
}

function toLocalDomain(domain, panelConfig) {
  if (domain === panelConfig.baseDomain) return panelConfig.localBaseDomain;
  return domain.endsWith(`.${panelConfig.baseDomain}`)
    ? `${domain.slice(0, -panelConfig.baseDomain.length)}${panelConfig.localBaseDomain}`
    : domain;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
