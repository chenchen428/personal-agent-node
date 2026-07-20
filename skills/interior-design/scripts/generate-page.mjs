import fs from 'node:fs';
import path from 'node:path';

export function generatePage({ model, output, skillRoot }) {
  fs.mkdirSync(output, { recursive: true });
  const script = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.bundle'), 'utf8');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.css'), 'utf8');
  const safeModel = JSON.stringify(model).replaceAll('<', '\\u003c');
  const title = escapeHtml(model.project.title);
  const area = Number(model.project.sourceAreaM2 || model.project.areaM2 || 0).toFixed(2);
  const levels = new Map((model.levels || [{ id: 'lower', name: '下层' }]).map((level) => [level.id, level.name]));
  const roomButtons = model.rooms.map((room, index) => `<button type="button" data-room="${escapeAttr(room.id)}"><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(levels.get(room.levelId || 'lower') || '下层')} · 进入空间</small></button>`).join('');
  const roomOptions = model.rooms.map((room) => `<option value="${escapeAttr(room.id)}">${escapeHtml(room.name)} · ${escapeHtml(levels.get(room.levelId || 'lower') || '下层')}</option>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>${title} · 装修设计原型</title><style>${style}</style></head>
<body><main id="app">
<header class="top"><span class="mark" aria-hidden="true">ID</span><div class="identity"><strong>${title}</strong><span>概念建模 · 原始户型约 ${area}㎡ · 双层方案</span></div><label class="mobile-room"><span>当前空间</span><select id="room-select" aria-label="选择要查看的空间"><option value="">整体方案 · 完整户型</option>${roomOptions}</select></label><span class="status"><i></i>结构原型 · 非施工测绘</span></header>
<section class="stage"><nav class="rooms" aria-label="浏览空间"><span>空间索引</span><button class="active" type="button" data-room=""><b>00</b><strong>整体方案</strong><small>上下层与 6m 挑空</small></button>${roomButtons}</nav><div class="viewport"><canvas id="scene" aria-label="${title}，可旋转、平移和缩放的三维概念户型"></canvas><span class="gesture">拖动旋转 · 滚轮或双指缩放 · 右键平移</span><div class="level-tools" role="group" aria-label="切换楼层与剖切模式"><button class="active" type="button" data-mode="overall">整体轴测</button><button type="button" data-mode="lower">下层</button><button type="button" data-mode="upper">上层</button><button type="button" data-mode="section">挑空剖切</button><button type="button" data-mode="free">自由查看</button></div></div>
<div class="views" role="group" aria-label="切换相机和光照"><button class="active" type="button" data-view="iso">轴测</button><button type="button" data-view="top">顶视</button><button type="button" data-view="walk">漫游</button><button id="light" type="button" aria-label="切换日间和傍晚光照">日间</button><button id="reset" type="button" aria-label="重置整体轴测视图">重置</button></div></section>
<aside id="fallback" hidden><strong>兼容投影模式</strong><span>当前设备未启用 WebGL，仍可拖动与缩放查看分层关系。</span></aside><p class="orientation-hint">横屏可获得更完整的设计工作区</p><script id="model" type="application/json">${safeModel}</script><script>${script}</script></main></body></html>`;
  const index = path.join(output, 'index.html');
  fs.writeFileSync(index, html);
  fs.writeFileSync(path.join(output, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
  return index;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
