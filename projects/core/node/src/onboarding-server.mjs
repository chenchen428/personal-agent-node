import http from 'node:http';
import { enrollWithCloud } from './cloud-enrollment.mjs';

export async function startOnboardingServer({ host = '127.0.0.1', port = 8842, cloudUrl, dataRoot, onEnrolled } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Onboarding 只能监听本机回环地址');
  const server = http.createServer(async (request, response) => {
    try {
      const requestHost = new URL(`http://${request.headers.host || ''}`).hostname;
      if (!['127.0.0.1', '::1', 'localhost'].includes(requestHost)) return json(response, 421, { error: 'Invalid local Host header' });
      const url = new URL(request.url || '/', `http://${host}:${port}`);
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      if (request.method === 'GET' && url.pathname === '/') return html(response, onboardingHtml(cloudUrl));
      if (request.method === 'GET' && url.pathname === '/healthz') return json(response, 200, { ok: true });
      if (request.method === 'POST' && url.pathname === '/api/enroll') {
        const input = await readJson(request);
        const result = await enrollWithCloud({ ...input, cloudUrl, dataRoot });
        let started = false;
        if (onEnrolled) { await onEnrolled(result); started = true; }
        return json(response, 201, { ...result, started });
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) { return json(response, Number(error.status || 400), { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return { server, url: `http://${host}:${address.port}/` };
}

function onboardingHtml(cloudUrl) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personal Agent Node 设置</title><style>*{box-sizing:border-box;letter-spacing:0}body{margin:0;background:#f2f5f1;color:#17201c;font-family:"Avenir Next","PingFang SC",sans-serif}main{width:min(720px,calc(100% - 32px));margin:8vh auto;background:#fff;border:1px solid #b8c2bb;padding:32px}h1{margin:0 0 10px;font:600 40px/1.1 "Iowan Old Style","Songti SC",serif}p{color:#627068;line-height:1.7}form{display:grid;gap:16px;margin-top:28px}label{display:grid;gap:7px;font-size:13px;font-weight:700}input{width:100%;min-height:44px;border:1px solid #aab5ae;border-radius:4px;padding:0 12px;font:inherit}button{min-height:44px;border:0;border-radius:4px;background:#17634c;color:#fff;font-weight:700;cursor:pointer}.status{min-height:24px;margin-top:18px;color:#17634c}.error{color:#b83e2c}small{color:#758078}@media(max-width:520px){main{margin:0;min-height:100vh;border:0;padding:28px 20px}h1{font-size:34px}}</style></head><body><main><small>LOCAL SETUP · ${escapeHtml(cloudUrl)}</small><h1>连接你的 Personal Agent</h1><p>使用邀请邮件中的授权码激活 Free Site。凭据只保存到这台机器，Cloud 不托管你的 Agent 数据。</p><form id="form"><label>邮箱<input name="email" type="email" autocomplete="email" required></label><label>授权码<input name="authorizationCode" autocomplete="one-time-code" required></label><label>专属前缀<input name="slug" pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]" placeholder="my-agent" required></label><button>激活并启动 Node</button></form><p id="status" class="status" role="status"></p></main><script>const form=document.querySelector('#form'),status=document.querySelector('#status');form.addEventListener('submit',async e=>{e.preventDefault();status.className='status';status.textContent='正在兑换授权码并接入 Edge...';const body=Object.fromEntries(new FormData(form));try{const r=await fetch('/api/enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),x=await r.json();if(!r.ok)throw new Error(x.error||'接入失败');status.textContent='接入成功：'+x.managedUrl+'。本机 Node 已启动。';form.hidden=true}catch(err){status.className='status error';status.textContent=err.message}});</script></body></html>`;
}
function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
async function readJson(request) { const chunks=[]; let size=0; for await (const chunk of request) { size+=chunk.length; if(size>16*1024) throw new Error('请求过大'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
function html(response, value) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(value); }
