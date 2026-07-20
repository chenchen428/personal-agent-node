import fs from 'node:fs';
import path from 'node:path';

export function generatePage({ model, output, skillRoot }) {
  fs.mkdirSync(output, { recursive: true });
  const script = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.bundle'), 'utf8');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.css'), 'utf8');
  const safeModel = JSON.stringify(model).replaceAll('<', '\\u003c');
  const title = escapeHtml(model.project.title); const area = Number(model.project.sourceAreaM2 || model.project.areaM2 || 0).toFixed(2);
  const levels = new Map((model.levels || [{ id: 'lower', name: '一层' }]).map((level) => [level.id, level.name]));
  const roomButtons = model.rooms.map((room, index) => `<button type="button" data-room="${escapeAttr(room.id)}"><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(levels.get(room.levelId || 'lower') || '一层')} · 进入空间</small></button>`).join('');
  const roomOptions = model.rooms.map((room) => `<option value="${escapeAttr(room.id)}">${escapeHtml(room.name)}</option>`).join('');
  const modes = model.views?.length ? model.views : [{ id: 'overall', label: '整体轴测' }, { id: 'lower', label: '下层' }, { id: 'upper', label: '上层' }, { id: 'section', label: '挑空剖切' }, { id: 'free', label: '自由查看' }];
  const modeButtons = modes.map((mode, index) => `<button class="${index === 0 ? 'active' : ''}" type="button" data-mode="${escapeAttr(mode.id)}">${escapeHtml(mode.label)}</button>`).join('');
  const design = model.design || {}; const highlights = (design.highlights || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>${title} · 室内设计原型</title><style>${style}</style></head>
<body><main id="app"><div id="viewer-shell"><header class="top"><span class="mark" aria-hidden="true">ID</span><div class="identity"><strong>${title}</strong><span>${escapeHtml(design.styleName || '装修概念')} · 原始户型约 ${area}㎡ · 单层方案</span></div><label class="mobile-room"><span>当前空间</span><select id="room-select" aria-label="选择要查看的空间"><option value="">整体方案 · 完整户型</option>${roomOptions}</select></label><span class="status"><i></i>单层概念 · 非施工测绘</span></header>
<section class="stage"><nav class="rooms" aria-label="浏览空间"><span>空间索引</span><button class="active" type="button" data-room=""><b>00</b><strong>整体方案</strong><small>原 C 户型 · 单层装修</small></button>${roomButtons}</nav><div class="viewport"><canvas id="scene" aria-label="${title}，可旋转、平移和缩放的单层三维装修概念"></canvas><span class="gesture">拖动旋转 · 滚轮或双指缩放 · 右键平移</span><div class="level-tools" role="group" aria-label="切换设计评审视图">${modeButtons}</div><label class="annotation-control"><span>标注</span><select id="annotation-select" aria-label="选择户型标注类别"><option value="off">关闭</option><option value="furniture">家具</option><option value="dimension">尺寸</option><option value="opening">门窗</option><option value="direction">方位</option><option value="circulation">动线</option></select></label><aside class="concept-note"><span>设计主张</span><strong>${escapeHtml(design.styleName || '单层生活提案')}</strong><p>${escapeHtml(design.intent || '')}</p>${highlights ? `<ul>${highlights}</ul>` : ''}</aside></div>
<div class="views" role="group" aria-label="切换相机和光照"><button class="active" type="button" data-view="iso">轴测</button><button type="button" data-view="top">顶视</button><button type="button" data-view="walk">漫游</button><button id="light" type="button" aria-label="切换日间和傍晚光照">日间</button><button id="reset" type="button" aria-label="重置整体轴测视图">重置</button></div></section>
<aside id="fallback" hidden><strong>兼容投影模式</strong><span>当前设备未启用 WebGL，仍可拖动与缩放查看空间关系。</span></aside></div><script id="model" type="application/json">${safeModel}</script><script>${script}</script></main></body></html>`;
  const index = path.join(output, 'index.html'); fs.writeFileSync(index, html); fs.writeFileSync(path.join(output, 'model.json'), `${JSON.stringify(model, null, 2)}\n`); return index;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
