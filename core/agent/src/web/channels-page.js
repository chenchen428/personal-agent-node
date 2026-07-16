export function renderChannelsPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>渠道管理 · Agent</title>
  <style>
    :root{--canvas:#e9e4da;--paper:#fffdf8;--ink:#241f1a;--muted:#736a60;--line:#d2c8bb;--red:#b73428;--green:#325d4a;--amber:#9b6717;--shadow:0 22px 70px rgba(39,31,24,.14);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:var(--ink);background:var(--canvas)}
    *{box-sizing:border-box;letter-spacing:0}body{margin:0;min-height:100dvh;background:var(--canvas)}button{font:inherit;cursor:pointer}.shell{width:min(100%,62rem);min-height:100dvh;margin:0 auto;background:var(--paper);border-inline:1px solid rgba(64,51,40,.22);box-shadow:var(--shadow)}
    .topbar{position:sticky;top:0;z-index:20;min-height:4rem;display:flex;align-items:center;gap:.8rem;padding:.6rem 1.1rem;border-bottom:1px solid var(--ink);background:rgba(255,253,248,.96)}.back,.refresh{width:2.5rem;height:2.5rem;display:grid;place-items:center;border:1px solid var(--ink);border-radius:4px;background:transparent;color:var(--ink);text-decoration:none;font-size:1.15rem}.brand{min-width:0;flex:1}.brand strong{display:block;font-family:"Songti SC","STSong",serif;font-size:1.05rem}.brand span{display:block;color:var(--muted);font-size:.68rem}.back:focus-visible,.refresh:focus-visible{outline:2px solid var(--red);outline-offset:2px}
    .header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.5rem;align-items:end;padding:2rem 1.2rem 1.35rem;border-bottom:1px solid var(--line)}.kicker{margin:0 0 .35rem;color:var(--red);font-size:.7rem;font-weight:800}.header h1{margin:0;font-family:"Songti SC","STSong",serif;font-size:2.4rem;line-height:1}.route{padding:.45rem .65rem;border:1px solid var(--green);color:var(--green);font-size:.72rem;font-weight:700}
    .status{display:grid;grid-template-columns:3.4rem minmax(0,1fr);gap:1rem;align-items:center;padding:1.15rem 1.2rem;border-bottom:1px solid var(--ink)}.seal{width:3.4rem;height:3.4rem;display:grid;place-items:center;border:2px solid var(--red);color:var(--red);font-family:"Songti SC","STSong",serif;font-size:1.25rem;font-weight:800;transform:rotate(-2deg)}.status-copy{min-width:0}.status-line{display:flex;align-items:center;gap:.55rem;font-weight:800}.status-copy p{margin:.28rem 0 0;color:var(--muted);font-size:.78rem;line-height:1.55}.dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--muted)}.dot.good{background:#159668;box-shadow:0 0 0 3px rgba(21,150,104,.14)}.dot.bad{background:var(--red)}.dot.warn{background:var(--amber)}
    .guide{padding:1.5rem 1.2rem 2.5rem}.guide-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;padding-bottom:.8rem;border-bottom:1px solid var(--line)}.guide h2{margin:0;font-family:"Songti SC","STSong",serif;font-size:1.25rem}.guide-head span{color:var(--muted);font-size:.7rem}.steps{list-style:none;margin:0;padding:0}.steps li{display:grid;grid-template-columns:2.3rem minmax(0,1fr);gap:.85rem;padding:1rem 0;border-bottom:1px solid var(--line)}.step-no{width:2.1rem;height:2.1rem;display:grid;place-items:center;border:1px solid var(--ink);font-size:.7rem;font-weight:800}.steps strong{display:block;margin:.1rem 0 .3rem;font-size:.86rem}.steps p{margin:0;color:var(--muted);font-size:.78rem;line-height:1.65}.phrase{display:inline-block;padding:.08rem .35rem;border:1px solid var(--line);background:#f5f0e7;color:var(--ink);font-weight:700}.policy{margin-top:1rem;padding:.9rem 1rem;border-left:3px solid var(--green);background:#f2f6f2;color:#45574e;font-size:.76rem;line-height:1.65}
    @media(max-width:760px){body{background:var(--paper)}.shell{border:0;box-shadow:none}.header{grid-template-columns:1fr;padding-inline:.85rem}.header h1{font-size:2rem}.route{justify-self:start}.status,.guide{padding-inline:.85rem}.status{grid-template-columns:3.1rem minmax(0,1fr)}.seal{width:3.1rem;height:3.1rem}.guide-head{align-items:start;flex-direction:column;gap:.35rem}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar"><a class="back" href="/app" aria-label="返回工作台" title="返回工作台">A</a><a class="back" href="/app/chat" aria-label="返回对话" title="返回对话">←</a><div class="brand"><strong>渠道管理</strong><span>Personal Agent /app/channels</span></div><button class="refresh" type="button" data-refresh aria-label="刷新状态" title="刷新">↻</button></header>
    <section class="header"><div><p class="kicker">CHANNEL 01</p><h1>小红书</h1></div><span class="route">direct-required · 只读</span></section>
    <section class="status" aria-live="polite"><span class="seal" aria-hidden="true">红</span><div class="status-copy"><div class="status-line"><span class="dot warn" data-dot></span><span data-status>状态检测中</span></div><p data-detail>正在读取 Agent 维护的渠道状态。</p></div></section>
    <section class="guide" aria-labelledby="guide-title">
      <div class="guide-head"><h2 id="guide-title">在微信中发起登录协作</h2><span>状态页不直接生成二维码</span></div>
      <ol class="steps">
        <li><span class="step-no">01</span><div><strong>告诉 Agent 你的意图</strong><p>在微信中发送 <span class="phrase">登录小红书</span>。</p></div></li>
        <li><span class="step-no">02</span><div><strong>确认现在开始</strong><p>Agent 会说明当前状态并再次询问；回复 <span class="phrase">确认开始</span> 后才会生成二维码。</p></div></li>
        <li><span class="step-no">03</span><div><strong>扫码、确认或回传验证码</strong><p>使用小红书 App 扫描微信中的二维码，并在 App 内点击确认登录。如果手机收到短信验证码，直接在微信回复验证码。</p></div></li>
        <li><span class="step-no">04</span><div><strong>等待 Agent 返回结果</strong><p>二维码发出后 Agent 会自动监听服务器浏览器，无需回复“已完成”；成功、失败或超时都会主动通知。</p></div></li>
      </ol>
      <div class="policy">Agent 不会在你确认前静默生成二维码。短信验证码只会由当前登录会话一次性代填，不进入普通 Agent 会话、动态或日志；没有活跃登录会话时，数字消息按普通消息处理。</div>
    </section>
  </main>
  <script>
    const dot=document.querySelector('[data-dot]');const statusLabel=document.querySelector('[data-status]');const statusDetail=document.querySelector('[data-detail]');const refresh=document.querySelector('[data-refresh]');
    async function loadStatus(){refresh.disabled=true;try{const response=await fetch('/api/channels/xiaohongshu/status',{cache:'no-store'});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||response.statusText);dot.className='dot '+(data.state==='logged_in'?'good':data.state==='needs_login'?'bad':'warn');statusLabel.textContent=data.statusLabel||'状态未知';statusDetail.textContent=data.error||(data.loggedIn?'服务器登录状态可用，Agent 可以执行只读任务。':'需要通过微信与 Agent 协作登录。')}catch(error){dot.className='dot warn';statusLabel.textContent='状态不可用';statusDetail.textContent=error.message}finally{refresh.disabled=false}}
    refresh.addEventListener('click',loadStatus);loadStatus();
  </script>
</body>
</html>`;
}
