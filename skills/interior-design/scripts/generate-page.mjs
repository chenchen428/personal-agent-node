import fs from 'node:fs';
import path from 'node:path';

export function generatePage({ model, output, skillRoot }) {
  fs.mkdirSync(output, { recursive: true });
  const script = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.bundle'), 'utf8');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.css'), 'utf8');
  const safeModel = JSON.stringify(model).replaceAll('<', '\\u003c');
  const title = escapeHtml(model.project.title);
  const area = Number(model.project.areaM2 || 0).toFixed(1);
  const roomButtons = model.rooms.map((room, index) => `<button type="button" data-room="${escapeAttr(room.id)}"><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(room.name)}</strong><small>进入空间</small></button>`).join('');
  const roomOptions = model.rooms.map((room) => `<option value="${escapeAttr(room.id)}">${escapeHtml(room.name)} · 进入近景</option>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><title>${title} · 装修设计交付</title><style>${style}</style></head>
<body><main id="app">
<header class="top"><span class="mark">PA</span><div class="identity"><strong>${title}</strong><span>概念建模 · ${area}㎡ · ${model.rooms.length} 个空间</span></div><label class="mobile-room"><span>当前空间</span><select id="room-select" aria-label="进入空间查看细节"><option value="">整体方案 · 完整户型</option>${roomOptions}</select></label><span class="status"><i></i>完成态模型 · 手动查看</span></header>
<section class="stage"><nav class="rooms" aria-label="浏览空间"><span>浏览空间</span><button class="active" type="button" data-room=""><b>00</b><strong>整体方案</strong><small>完整户型</small></button>${roomButtons}</nav><div class="viewport"><canvas id="scene" aria-label="${title} 可旋转、平移和缩放的 3D 概念户型"></canvas><span class="gesture">拖动旋转 · 滚轮或双指缩放 · 右键平移</span></div>
<div class="views" role="group" aria-label="切换查看视角"><button class="active" type="button" data-view="iso">3D 鸟瞰</button><button type="button" data-view="top">平面</button><button type="button" data-view="walk">室内</button><button id="reset" type="button" aria-label="重置为完整户型的 3D 鸟瞰" title="重置">↺</button></div></section>
<aside id="fallback" hidden><strong>3D 投影模式</strong><span>当前设备未启用 WebGL，拖动仍可从不同方向查看空间关系。</span></aside><p class="orientation-hint">横屏查看空间更完整</p><script id="model" type="application/json">${safeModel}</script><script>${script}</script></main></body></html>`;
  const index = path.join(output, 'index.html');
  fs.writeFileSync(index, html);
  fs.writeFileSync(path.join(output, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
  return index;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
