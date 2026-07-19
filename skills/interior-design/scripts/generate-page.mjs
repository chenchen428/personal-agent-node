import fs from 'node:fs';
import path from 'node:path';

export function generatePage({ model, output, skillRoot }) {
  fs.mkdirSync(output, { recursive: true });
  const script = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.bundle'), 'utf8');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.css'), 'utf8');
  const safeModel = JSON.stringify(model).replaceAll('<', '\\u003c');
  const title = escapeHtml(model.project.title);
  const area = Number(model.project.areaM2 || 0).toFixed(1);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><title>${title} · 3D 概念户型</title><style>${style}</style></head>
<body><main id="app"><canvas id="scene" aria-label="${title} 可旋转 3D 概念户型"></canvas>
<header class="top"><div><strong>${title}</strong><span>概念建模 · ${area}㎡ · ${model.rooms.length} 房间</span></div><div class="tools" aria-label="视图工具">
<button data-view="iso" title="等距视图">等距</button><button data-view="top" title="顶视图">顶视</button><button data-view="walk" title="漫游视图">漫游</button><button id="free" title="中断动画并自由查看">自由查看</button>
<select id="scheme" aria-label="材料方案"><option value="warm">现代温润</option><option value="stone">暖灰石材</option><option value="green">墨绿点缀</option></select><button id="light" title="切换日间与傍晚">日间</button></div></header>
<section class="timeline" aria-label="户型动画"><button id="play" aria-label="播放或暂停动画">暂停</button><button id="replay" aria-label="重播动画">重播</button><div class="track"><i id="progress"></i><b id="stage">地面出现</b></div><output id="time">0%</output></section>
<div id="fallback" hidden><strong>无法启动 3D 视图</strong><span>此设备未提供可用 WebGL。仍可下载概念模型数据进行校准。</span></div><script id="model" type="application/json">${safeModel}</script><script>${script}</script></main></body></html>`;
  const index = path.join(output, 'index.html');
  fs.writeFileSync(index, html);
  fs.writeFileSync(path.join(output, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
  return index;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
