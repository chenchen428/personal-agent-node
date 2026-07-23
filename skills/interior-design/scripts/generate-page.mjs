import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_ID = 'interior-design-delivery';

export function loadInteriorTemplateContract(skillRoot) {
  const registryPath = path.resolve(skillRoot, '..', '..', 'registry', 'page-templates.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const template = registry.templates?.find((item) => item.id === TEMPLATE_ID);
  if (!template) throw new Error(`registered Page template is missing: ${TEMPLATE_ID}`);
  if (template.skill !== 'interior-design') throw new Error(`${TEMPLATE_ID} must be linked to interior-design`);
  return template;
}

export function loadSourcePlanAsset(filePath) {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = ({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  })[extension];
  if (!mimeType) throw new Error('--source-plan must be a redacted JPG, PNG, SVG, or WebP image');
  const buffer = fs.readFileSync(resolved);
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('--source-plan must be between 1 byte and 12 MB');
  if (mimeType === 'image/svg+xml' && /<(?:script|foreignObject|iframe|image|use|link|style)\b|(?:href|src|on[a-z]+)\s*=|url\s*\(/i.test(buffer.toString('utf8'))) {
    throw new Error('--source-plan SVG must not contain executable or remote-reference markup');
  }
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    alt: '用户提供并脱敏的原始户型图',
  };
}

export function generatePage({ model, output, skillRoot, sourcePlan, template = loadInteriorTemplateContract(skillRoot) }) {
  if (template.id !== TEMPLATE_ID) throw new Error(`interior-design only generates ${TEMPLATE_ID}`);
  if (!sourcePlan?.dataUrl || !sourcePlan?.alt) throw new Error('a redacted user source plan is required');
  fs.mkdirSync(output, { recursive: true });
  const script = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.bundle'), 'utf8');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer.css'), 'utf8');
  const safeModel = JSON.stringify(model).replaceAll('<', '\\u003c');
  const title = escapeHtml(model.project.title);
  const area = Number(model.project.areaM2 || 0).toFixed(1);
  const marker = escapeAttr(template.implementation.artifactMarker);
  const version = Number(template.implementation.version);
  const roomButtons = model.rooms.map((room, index) => `<button type="button" data-room="${escapeAttr(room.id)}"><b>${String(index + 1).padStart(2, '0')}</b><strong>${escapeHtml(room.name)}</strong><small>进入空间</small></button>`).join('');
  const roomOptions = model.rooms.map((room) => `<option value="${escapeAttr(room.id)}">${escapeHtml(room.name)} · 进入近景</option>`).join('');
  const requirements = (model.qualityReview?.requirementTrace || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const revisions = (model.project.notes || []).map((item, index) => `<li><b>R${index + 1}</b><span>${escapeHtml(item)}</span></li>`).join('');
  const plan = renderPlan(model);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><meta name="color-scheme" content="light"><meta name="personal-agent-page-template" content="${marker}"><meta name="personal-agent-page-template-id" content="${TEMPLATE_ID}"><meta name="personal-agent-page-template-version" content="${version}"><title>${title} · 装修设计交付</title><style>${style}</style></head>
<body data-template-marker="${marker}" data-template-id="${TEMPLATE_ID}" data-template-version="${version}"><main id="app">
<header class="top"><span class="mark">PA</span><div class="identity"><small>PERSONAL AGENT · SU DESIGN</small><strong>${title}</strong><span>${area}㎡ · ${model.rooms.length} 个空间 · 概念模型</span></div><label class="mobile-room"><span>当前空间</span><select id="room-select" aria-label="进入空间查看细节"><option value="">整体方案 · 完整户型</option>${roomOptions}</select></label><span class="status"><i></i>完成态模型 · 手动查看</span></header>
<section class="stage">
<div class="presentation-panel presentation-model" data-presentation-panel="model"><nav class="rooms" aria-label="浏览空间"><span>浏览空间</span><button class="active" type="button" data-room=""><b>00</b><strong>整体方案</strong><small>完整户型</small></button>${roomButtons}</nav><div class="viewport"><canvas id="scene" aria-label="${title} 可旋转、平移和缩放的 3D 概念户型"></canvas><span class="gesture">拖动旋转 · 缩放 · 平移</span></div>
<div class="views" role="group" aria-label="SU 设计稿查看工具"><span>设计层 · 1 层</span><button class="active" type="button" data-view="iso">3D</button><button type="button" data-view="top">平面</button><button type="button" data-view="walk">室内</button><button id="reset" type="button" aria-label="复位 SU 设计稿" title="复位">↺</button></div></div>
<article class="presentation-panel plan-panel" data-presentation-panel="plan" data-plan-mode="source" hidden><header><div><small>户型调整依据</small><h2>原始图与调整标注</h2></div><div role="group" aria-label="切换户型图层"><button class="active" type="button" data-plan-mode="source">原始图</button><button type="button" data-plan-mode="revision">调整标注</button></div></header><div class="plan-layout"><figure><img class="plan-source-image" src="${escapeAttr(sourcePlan.dataUrl)}" alt="${escapeAttr(sourcePlan.alt)}">${plan}<figcaption>原始图来自用户材料的脱敏副本；调整标注按归一化模型生成，尺寸与结构结论仍以现场复核为准。</figcaption></figure><aside><strong>调整说明</strong><ul>${revisions || '<li><b>R1</b><span>本轮未记录结构调整；保留原始空间关系。</span></li>'}</ul></aside></div></article>
<article class="presentation-panel requirements-panel" data-presentation-panel="requirements" hidden><header><small>用户需求</small><h2>方案约束与需求追踪</h2><p>以下每一项都已进入模型审计；视觉与交互体验等待用户打开页面验收。</p></header><ol>${requirements}</ol><section><strong>迭代脉络</strong><ul>${revisions || '<li><b>R1</b><span>根据当前用户材料生成首版概念方案。</span></li>'}</ul></section></article>
<nav class="presentation-switch" aria-label="方案资料切换"><button class="active" type="button" data-presentation="model">SU 设计稿</button><button type="button" data-presentation="plan">户型图</button><button type="button" data-presentation="requirements">用户需求</button></nav>
</section>
<aside id="fallback" hidden><strong>3D 投影模式</strong><span>当前设备未启用 WebGL，拖动仍可从不同方向查看空间关系。</span></aside><p class="orientation-hint">横屏查看空间更完整</p><script id="model" type="application/json">${safeModel}</script><script>${script}</script></main></body></html>`;
  verifyGeneratedPageHtml(html, template);
  const index = path.join(output, 'index.html');
  fs.writeFileSync(index, html);
  fs.writeFileSync(path.join(output, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'template.json'), `${JSON.stringify(template, null, 2)}\n`);
  return index;
}

export function verifyGeneratedPageHtml(html, template) {
  const required = [
    `name="personal-agent-page-template" content="${template.implementation.artifactMarker}"`,
    `data-template-id="${template.id}"`,
    `data-template-version="${template.implementation.version}"`,
    'data-presentation-panel="model"',
    'data-presentation-panel="plan"',
    'data-presentation-panel="requirements"',
    'data-presentation="model"',
    'data-presentation="plan"',
    'data-presentation="requirements"',
    'class="plan-source-image"',
    'alt="用户提供并脱敏的原始户型图"',
  ];
  const missing = required.filter((item) => !html.includes(item));
  if (missing.length) throw new Error(`generated Page does not match ${template.id}: ${missing.join(', ')}`);
  if (/<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i.test(html)) {
    throw new Error('generated Page must not contain remote executable assets');
  }
  return {
    ok: true,
    templateId: template.id,
    templateVersion: template.implementation.version,
    artifactMarker: template.implementation.artifactMarker,
    visualAcceptance: 'user',
  };
}

function renderPlan(model) {
  const bounds = model.project.bounds || calculateBounds(model.rooms.flatMap((room) => room.polygon));
  const spanX = Math.max(0.1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0.1, bounds.maxZ - bounds.minZ);
  const width = 900;
  const height = 560;
  const padding = 48;
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ);
  const point = ([x, z]) => [
    padding + (x - bounds.minX) * scale,
    height - padding - (z - bounds.minZ) * scale,
  ];
  const rooms = model.rooms.map((room, index) => {
    const points = room.polygon.map((entry) => point(entry).map((value) => value.toFixed(1)).join(',')).join(' ');
    const center = room.polygon.reduce((sum, entry) => [sum[0] + entry[0], sum[1] + entry[1]], [0, 0]).map((value) => value / room.polygon.length);
    const [labelX, labelY] = point(center);
    const fill = model.materials.find((material) => material.id === room.material)?.color || (index % 2 ? '#d8d2c8' : '#c8c2b8');
    return `<polygon points="${points}" fill="${escapeAttr(fill)}"/><text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}">${escapeHtml(room.name)}</text>`;
  }).join('');
  const walls = model.walls.map((wall) => {
    const [x1, y1] = point(wall.from);
    const [x2, y2] = point(wall.to);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  return `<svg class="plan-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(model.project.title)} 户型依据图"><g class="plan-source">${rooms}<g class="plan-walls">${walls}</g></g><g class="plan-revisions"><path d="M${padding} ${padding - 15}h140"/><circle cx="${padding}" cy="${padding - 15}" r="5"/><circle cx="${padding + 140}" cy="${padding - 15}" r="5"/><text x="${padding + 70}" y="${padding - 25}">现场尺寸复核</text></g></svg>`;
}

function calculateBounds(points) {
  return {
    minX: Math.min(...points.map((entry) => entry[0])),
    minZ: Math.min(...points.map((entry) => entry[1])),
    maxX: Math.max(...points.map((entry) => entry[0])),
    maxZ: Math.max(...points.map((entry) => entry[1])),
  };
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
