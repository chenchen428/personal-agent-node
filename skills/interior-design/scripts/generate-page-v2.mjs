import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadInteriorTemplateContract, loadSourcePlanAsset } from './page-assets.mjs';
import { PascalInteriorAdapter } from './pascal-adapter.mjs';
import { canonicalJson, readProject, selectedConcept, sha256 } from './project-v2.mjs';
import { compiledSceneHash } from './scene-hash.mjs';

const TEMPLATE_ID = 'interior-design-delivery';
const PAGE_LIMIT = 20 * 1024 * 1024;

export function generateProfessionalPage({ projectDir: projectDirInput, context, output, skillRoot, template = loadInteriorTemplateContract(skillRoot) }) {
  if (template.id !== TEMPLATE_ID || Number(template.implementation.version) !== 2) throw new Error(`${TEMPLATE_ID} implementation version 2 is required`);
  const { projectDir, project } = readProject(projectDirInput, context);
  const scenePayload = readJson(path.join(projectDir, 'scene.json'), 10 * 1024 * 1024);
  const audit = readJson(path.join(projectDir, 'derived', 'audit.json'), 4 * 1024 * 1024);
  if (audit.projectId !== project.projectId || audit.revision !== project.revision) throw new Error('quality report does not match the current project revision');
  const { sha256: recordedAuditHash, ...auditReport } = audit;
  const computedAuditHash = sha256(canonicalJson(auditReport));
  if (recordedAuditHash !== computedAuditHash || project.quality.sha256 !== recordedAuditHash) throw new Error('quality report hash does not match the governed project');
  if (!audit.ok || audit.blockingCount > 0) throw new Error(`quality gate blocks Page generation with ${audit.blockingCount} issue(s)`);
  if (scenePayload.projectId !== project.projectId || scenePayload.revision !== project.revision || scenePayload.sceneHash !== project.scene.sha256) throw new Error('compiled scene does not match the current project');
  if (compiledSceneHash(scenePayload.scene, scenePayload.furniture || []) !== scenePayload.sceneHash) throw new Error('compiled scene hash does not match its content');
  const sourcePlan = loadProjectSourcePlan(projectDir, project);
  const concept = selectedConcept(project);
  const { payload: pagePayload, pageMappings } = new PascalInteriorAdapter().exportForPage(scenePayload);
  const conceptMappings = Object.fromEntries(project.concepts.map((entry, index) => [entry.conceptId, `page-concept-${String(index + 1).padStart(2, '0')}`]));
  const fallbackSvg = renderProjectPlan(concept, 'model-derived-plan');
  const planSvg = renderProjectPlan(concept, 'revision-derived-plan');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer-v2.css'), 'utf8');
  const viewer = fs.readFileSync(path.join(skillRoot, 'assets', 'pascal-viewer.bundle'), 'utf8');
  const title = escapeHtml(project.title);
  const requirements = renderRequirements(project, pageMappings);
  const issues = renderIssues(audit, pageMappings);
  const concepts = renderConcepts(project, conceptMappings);
  const assumptions = renderAssumptions(project);
  const revisions = renderRevisions(project);
  const levelButtons = concept.levels.map((level, index) => `<button type="button" data-level-id="${escapeAttr(pageMappings[level.levelId] || '')}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(level.name)}</span></button>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light"><meta name="personal-agent-page-template" content="${escapeAttr(template.implementation.artifactMarker)}"><meta name="personal-agent-page-template-id" content="${TEMPLATE_ID}"><meta name="personal-agent-page-template-version" content="2"><meta name="personal-agent-interior-engine" content="pascal-v2"><title>${title} · 专业装修设计</title><style>${style}</style></head>
<body data-template-marker="${escapeAttr(template.implementation.artifactMarker)}" data-template-id="${TEMPLATE_ID}" data-template-version="2" data-engine="pascal-v2" data-viewer-state="loading"><main id="app">
<header class="top"><span class="mark">PA</span><div class="identity"><small>PERSONAL AGENT · PROFESSIONAL INTERIOR</small><strong>${title}</strong><span>Revision ${project.revision} · ${concept.levels.length} 层 · 概念设计</span></div><span class="status"><i></i>视觉与交互等待用户验收</span></header>
<section class="stage">
<section class="presentation-panel presentation-model" data-presentation-panel="model"><aside class="navigator"><h2>设计模型</h2><h3>楼层</h3><button class="active" type="button" data-level-id=""><b>00</b><span>全部楼层</span></button>${levelButtons}<h3>方案</h3><select class="concept-picker" id="concept-picker" aria-label="比较设计方案">${project.concepts.map((entry) => `<option value="${escapeAttr(conceptMappings[entry.conceptId])}"${entry.conceptId === project.selectedConceptId ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select><p class="summary">Pascal 建筑场景 · 门窗真实开洞 · 确定性质量门禁<br>所有施工尺寸仍需现场与专业人员复核。</p></aside><div class="viewport"><div id="scene" role="img" aria-label="${title} 可旋转的 Pascal 建筑场景"></div><span class="gesture">拖动旋转 · 滚轮缩放 · 右键平移</span><div id="fallback"><figure>${fallbackSvg}<figcaption><span>模型派生平面视图</span><span>3D 不可用时仍可核对空间关系</span></figcaption></figure></div><div class="viewer-tools" role="group" aria-label="设计模型查看工具"><button class="active" type="button" data-camera-mode="perspective">3D</button><button type="button" data-camera-mode="orthographic">平面</button><span class="divider"></span><button class="active" type="button" data-level-mode="stacked">堆叠</button><button type="button" data-level-mode="exploded">分解</button><button type="button" data-level-mode="solo">单层</button><span class="divider"></span><button class="active" type="button" data-label-mode="visible" aria-pressed="true">标签</button></div></div></section>
<article class="presentation-panel document-panel plan-panel" data-presentation-panel="plan" hidden><header><div><small>DESIGN EVIDENCE</small><h2>原始图与调整标注</h2></div><p>原图来自项目中允许交付的脱敏证据；标注由当前 revision 的模型派生。</p></header><div class="document-grid"><figure class="card plan-card" data-plan-mode="source"><div class="card-head"><strong>户型依据</strong><span class="segmented"><button class="active" type="button" data-plan-mode="source">原始图</button><button type="button" data-plan-mode="revision">调整标注</button></span></div><img class="plan-source-image" src="${escapeAttr(sourcePlan.dataUrl)}" alt="${escapeAttr(sourcePlan.alt)}">${planSvg}<figcaption class="plan-caption">概念模型不替代现场测绘、施工图、结构鉴定或所在地法规审核。</figcaption></figure><aside class="card"><div class="card-head"><strong>版本脉络</strong></div><div class="stack">${revisions}</div></aside></div></article>
<article class="presentation-panel document-panel" data-presentation-panel="requirements" hidden><header><div><small>REQUIREMENT TRACE</small><h2>需求与专业边界</h2></div><p>点击有模型关联的需求，可在 3D 场景中定位对应构件。</p></header><div class="document-grid"><section class="card"><div class="card-head"><strong>需求状态</strong></div><div class="requirement-list">${requirements}</div></section><aside class="card"><div class="card-head"><strong>假设、未知与专业核验</strong></div><div class="stack">${assumptions}</div></aside></div></article>
<article class="presentation-panel document-panel" data-presentation-panel="review" hidden><header><div><small>QUALITY GATE</small><h2>质量报告与方案比较</h2></div><p>${audit.blockingCount} 个阻断 · ${audit.warningCount} 个警告 · 规则集 ${escapeHtml(audit.ruleSet)}</p></header><div class="document-grid"><section class="card"><div class="card-head"><strong>审计结果</strong></div><div class="issue-list">${issues}</div></section><aside class="card"><div class="card-head"><strong>方案比较</strong></div><div class="stack">${concepts}</div></aside></div></article>
<nav class="presentation-switch" aria-label="装修设计资料切换"><button class="active" type="button" data-presentation="model">设计模型</button><button type="button" data-presentation="plan">户型依据</button><button type="button" data-presentation="requirements">需求</button><button type="button" data-presentation="review">质量</button></nav>
</section><p class="orientation-hint">横屏查看空间更完整</p><script id="pascal-scene" type="application/json">${safeJson(pagePayload)}</script><script>${pageController()}</script><script>${viewer}</script></main></body></html>`;
  verifyNoGovernanceIdentifiers(html, project);
  const verification = verifyProfessionalPageHtml(html, template);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const staging = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.mkdirSync(staging, { mode: 0o700 });
  const indexPath = path.join(staging, 'index.html');
  fs.writeFileSync(indexPath, html, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, 'scene.json'), `${JSON.stringify(pagePayload, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, 'audit.json'), `${JSON.stringify(sanitizeAudit(audit, pageMappings), null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, 'template.json'), `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
  const files = ['index.html', 'scene.json', 'audit.json', 'template.json'];
  const manifest = {
    schemaVersion: 1,
    templateId: template.id,
    templateVersion: template.implementation.version,
    artifactMarker: template.implementation.artifactMarker,
    visualAcceptance: 'user',
    files: Object.fromEntries(files.map((name) => {
      const value = fs.readFileSync(path.join(staging, name));
      return [name, { bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') }];
    })),
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const totalBytes = [...files, 'manifest.json'].reduce((sum, name) => sum + fs.statSync(path.join(staging, name)).size, 0);
  if (totalBytes > PAGE_LIMIT) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`generated Page exceeds ${PAGE_LIMIT} bytes`);
  }
  commitDirectory(staging, output);
  return { indexPath: path.join(output, 'index.html'), totalBytes, manifest, verification };
}

function verifyNoGovernanceIdentifiers(html, project) {
  const identifiers = [
    project.projectId,
    project.spaceId,
    project.ownerId,
    ...project.evidence.map((entry) => entry.evidenceId),
    ...project.brief.requirements.map((entry) => entry.requirementId),
    ...project.concepts.map((entry) => entry.conceptId),
    ...project.decisions.map((entry) => entry.decisionId),
  ].filter((value) => typeof value === 'string' && value.length >= 4);
  const exposed = identifiers.find((identifier) => html.includes(identifier));
  if (exposed) throw new Error('generated Page contains a governed project identifier');
}

export function verifyProfessionalPageHtml(html, template) {
  const required = [
    `name="personal-agent-page-template" content="${template.implementation.artifactMarker}"`,
    `data-template-id="${template.id}"`,
    'data-template-version="2"',
    'data-engine="pascal-v2"',
    'id="pascal-scene"',
    'id="model-derived-plan"',
    'data-level-mode="stacked"',
    'data-level-mode="exploded"',
    'data-level-mode="solo"',
    'data-label-mode="visible"',
    'data-presentation="model"',
    'data-presentation="plan"',
    'data-presentation="requirements"',
    'data-presentation="review"',
    "connect-src 'none'",
    '视觉与交互等待用户验收',
  ];
  const missing = required.filter((marker) => !html.includes(marker));
  if (missing.length) throw new Error(`generated Page does not match ${template.id} v2: ${missing.join(', ')}`);
  if (/<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i.test(html)) throw new Error('generated Page contains a remote executable asset');
  if (/editor\.pascal\.app|cdn\.jsdelivr\.net|127\.0\.0\.1|localhost|file:\/\//i.test(html)) throw new Error('generated Page contains a forbidden remote or local runtime reference');
  if (/sourceMappingURL|\/Users\/|\/home\/[a-z0-9._-]+\/|[A-Z]:\\Users\\/i.test(html)) throw new Error('generated Page contains a development path or source-map reference');
  const embeddedPayload = html.match(/<script id="pascal-scene" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '';
  if (/"(?:spaceId|ownerId|managedObjectId|projectId|sourceId|requirementIds|decisionIds|evidenceIds)"\s*:/i.test(embeddedPayload)) {
    throw new Error('generated Page contains private project identity or trace fields');
  }
  return { ok: true, templateId: template.id, templateVersion: 2, artifactMarker: template.implementation.artifactMarker, engine: 'pascal-v2', visualAcceptance: 'user' };
}

function loadProjectSourcePlan(projectDir, project) {
  const evidence = project.evidence.find((entry) => ['structure-reference', 'edit-target'].includes(entry.classification)
    && entry.relativePath
    && ['redacted', 'not-required'].includes(entry.redactionStatus));
  if (!evidence) throw new Error('project needs a redacted structure-reference or edit-target evidence file for Page delivery');
  const target = path.resolve(projectDir, evidence.relativePath);
  const evidenceRoot = path.resolve(projectDir, 'evidence');
  const relative = path.relative(evidenceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source plan evidence must stay inside the project evidence directory');
  if (fs.lstatSync(evidenceRoot).isSymbolicLink()) throw new Error('project evidence directory must not be a symbolic link');
  const realEvidenceRoot = fs.realpathSync(evidenceRoot);
  const realTarget = fs.realpathSync(target);
  if (!isInside(realEvidenceRoot, realTarget) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error('source plan evidence must not escape through a symbolic link');
  }
  return loadSourcePlanAsset(target);
}

function sanitizeAudit(audit, mappings) {
  return {
    schemaVersion: audit.schemaVersion,
    revision: audit.revision,
    ruleSet: audit.ruleSet,
    ruleSetVersion: audit.ruleSetVersion,
    ok: audit.ok,
    blockingCount: audit.blockingCount,
    warningCount: audit.warningCount,
    findings: audit.findings.map((entry) => ({
      issueId: entry.issueId,
      ruleId: entry.ruleId,
      severity: entry.severity,
      message: entry.message,
      nodeIds: entry.nodeIds.map((id) => mappings[id]).filter(Boolean),
      measurement: entry.measurement,
      threshold: entry.threshold,
      thresholdSource: entry.thresholdSource,
      fix: entry.fix,
      professionalVerification: entry.professionalVerification,
    })),
  };
}

export function renderProjectPlan(concept, svgId) {
  const levels = concept.levels;
  const width = 920;
  const height = 580;
  const gap = levels.length > 1 ? 28 : 0;
  const panelWidth = (width - gap * (levels.length - 1)) / levels.length;
  const levelMarkup = levels.map((level, levelIndex) => {
    const points = level.rooms.flatMap((room) => room.polygon);
    const bounds = {
      minX: Math.min(...points.map((point) => point[0])),
      minZ: Math.min(...points.map((point) => point[1])),
      maxX: Math.max(...points.map((point) => point[0])),
      maxZ: Math.max(...points.map((point) => point[1])),
    };
    const panelX = levelIndex * (panelWidth + gap);
    const paddingX = 34;
    const paddingTop = 58;
    const paddingBottom = 30;
    const scale = Math.min(
      (panelWidth - paddingX * 2) / Math.max(0.1, bounds.maxX - bounds.minX),
      (height - paddingTop - paddingBottom) / Math.max(0.1, bounds.maxZ - bounds.minZ),
    );
    const point = ([x, z]) => [
      panelX + paddingX + (x - bounds.minX) * scale,
      height - paddingBottom - (z - bounds.minZ) * scale,
    ];
    const roomMarkup = level.rooms.map((room, index) => {
      const polygon = room.polygon.map((entry) => point(entry).map((value) => value.toFixed(1)).join(',')).join(' ');
      const center = room.polygon.reduce((sum, entry) => [sum[0] + entry[0] / room.polygon.length, sum[1] + entry[1] / room.polygon.length], [0, 0]);
      const label = point(center);
      return `<polygon class="room" points="${polygon}" fill="${index % 2 ? '#d8d2c8' : '#c8d5cc'}"/><text x="${label[0].toFixed(1)}" y="${label[1].toFixed(1)}">${escapeHtml(room.name)}</text>`;
    }).join('');
    const wallMarkup = level.walls.map((wall) => {
      const start = point(wall.start);
      const end = point(wall.end);
      return `<line class="wall" x1="${start[0].toFixed(1)}" y1="${start[1].toFixed(1)}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}"/>`;
    }).join('');
    const openingMarkup = level.openings.map((opening) => {
      const wall = level.walls.find((entry) => entry.wallId === opening.wallId);
      if (!wall) return '';
      const center = [wall.start[0] + (wall.end[0] - wall.start[0]) * opening.position, wall.start[1] + (wall.end[1] - wall.start[1]) * opening.position];
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      const ratio = opening.width / Math.max(length, 0.01) / 2;
      const start = point([center[0] - (wall.end[0] - wall.start[0]) * ratio, center[1] - (wall.end[1] - wall.start[1]) * ratio]);
      const end = point([center[0] + (wall.end[0] - wall.start[0]) * ratio, center[1] + (wall.end[1] - wall.start[1]) * ratio]);
      return `<line class="opening" x1="${start[0].toFixed(1)}" y1="${start[1].toFixed(1)}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}"/>`;
    }).join('');
    const furnitureMarkup = level.items.map((item) => {
      const center = point(item.position);
      const boxWidth = item.size[0] * scale;
      const boxHeight = item.size[1] * scale;
      return `<rect class="furniture" x="${(center[0] - boxWidth / 2).toFixed(1)}" y="${(center[1] - boxHeight / 2).toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}" rx="4" transform="rotate(${(-item.rotation).toFixed(1)} ${center[0].toFixed(1)} ${center[1].toFixed(1)})"/>`;
    }).join('');
    return `<g data-level-plan="${levelIndex + 1}"><rect class="level-frame" x="${(panelX + 8).toFixed(1)}" y="8" width="${(panelWidth - 16).toFixed(1)}" height="${height - 16}" rx="12"/><text class="level-title" x="${(panelX + panelWidth / 2).toFixed(1)}" y="34">${escapeHtml(level.name)} · ${level.elevation.toFixed(2)}m</text>${roomMarkup}${wallMarkup}${openingMarkup}${furnitureMarkup}</g>`;
  }).join('');
  return `<svg class="plan-svg" id="${escapeAttr(svgId)}" viewBox="0 0 ${width} ${height}" role="img" aria-label="当前设计 revision 的分层模型派生平面图">${levelMarkup}</svg>`;
}

export function renderProjectCoverSvg(concept) {
  const plan = renderProjectPlan(concept, 'generated-template-cover-plan')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('class="plan-svg"', 'class="plan-svg" width="1200" height="675"');
  return `${plan.replace('>', `><style>
    .level-frame{fill:#f3f1ea;stroke:#28312b;stroke-width:2}
    .room{stroke:#f9f8f4;stroke-width:8}
    .wall{stroke:#26302a;stroke-width:9;stroke-linecap:square}
    .opening{stroke:#b45f43;stroke-width:13}
    .furniture{fill:#fffaf1;stroke:#80664d;stroke-width:2}
    text{fill:#26302a;font:600 16px Arial,sans-serif;text-anchor:middle}
    .level-title{font-size:18px;letter-spacing:1px}
  </style><rect width="920" height="580" fill="#dfe5de"/>`)}\n`;
}

function renderRequirements(project, mappings) {
  if (!project.brief.requirements.length) return '<p class="empty">当前项目未记录需求。</p>';
  return project.brief.requirements.map((entry) => {
    const ids = (entry.sceneNodeIds || []).map((id) => mappings[id]).filter(Boolean);
    return `<button type="button" data-highlight="${escapeAttr(ids.join(','))}"><span class="badge">${escapeHtml(entry.priority)}</span><strong>${escapeHtml(entry.summary || '未命名需求')}</strong><em>${escapeHtml(entry.status)}</em></button>`;
  }).join('');
}

function renderIssues(audit, mappings) {
  if (!audit.findings.length) return '<p class="empty">确定性质量门禁未发现问题。</p>';
  return audit.findings.map((entry) => {
    const ids = entry.nodeIds.map((id) => mappings[id]).filter(Boolean);
    return `<button type="button" data-highlight="${escapeAttr(ids.join(','))}"><span class="badge ${escapeAttr(entry.severity)}">${escapeHtml(entry.severity)}</span><strong>${escapeHtml(entry.message)}</strong><em>${escapeHtml(entry.ruleId)}</em></button>`;
  }).join('');
}

function renderConcepts(project, conceptMappings) {
  return project.concepts.map((entry) => `<article class="concept-card" data-concept-id="${escapeAttr(conceptMappings[entry.conceptId])}"${entry.conceptId === project.selectedConceptId ? '' : ' hidden'}><b>${entry.conceptId === project.selectedConceptId ? 'SELECTED' : 'OPTION'}</b><strong>${escapeHtml(entry.name)}</strong><p>${escapeHtml(entry.summary)}</p><p>${escapeHtml(entry.tradeoffs.join(' · '))}</p></article>`).join('');
}

function renderAssumptions(project) {
  const budget = project.brief.budget;
  const budgetText = budget.totalMinor
    ? `${budget.currency} ${(budget.totalMinor / 100).toLocaleString('zh-CN')} · ${budget.confidence}`
    : `预算未校准 · ${budget.confidence}`;
  const scheduleText = project.brief.schedule.phases?.length
    ? `${project.brief.schedule.phases.length} 个阶段 · ${project.brief.schedule.confidence}`
    : `阶段计划待深化 · ${project.brief.schedule.confidence}`;
  const entries = [
    ['项目范围', project.brief.scope.join(' · ') || '范围待确认', `${budgetText}；${scheduleText}`],
    ...project.assumptions.map((entry) => ['假设', entry.summary, entry.confidence || '']),
    ...project.unknowns.map((entry) => ['未知', entry.summary, '']),
    ...project.professionalVerifications.map((entry) => ['需专业核验', entry.summary, entry.status]),
  ];
  return entries.map(([label, summary, detail]) => `<article><b>${escapeHtml(label)}</b><strong>${escapeHtml(summary)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</article>`).join('');
}

function renderRevisions(project) {
  return project.decisions.length ? project.decisions.slice(-12).reverse().map((entry, index) => `<article><b>R${Math.max(1, project.revision - index)}</b><strong>${escapeHtml(entry.summary)}</strong><p>${escapeHtml(entry.rationale)}</p></article>`).join('') : '<p class="empty">当前是首个设计 revision。</p>';
}

function pageController() {
  return `(function(){const one=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];function active(group,target){all(group).forEach(b=>{const on=b===target;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}all('[data-presentation]').forEach(b=>b.addEventListener('click',()=>{all('[data-presentation-panel]').forEach(p=>p.hidden=p.dataset.presentationPanel!==b.dataset.presentation);active('[data-presentation]',b)}));all('[data-plan-mode]').forEach(b=>b.addEventListener('click',()=>{const card=b.closest('.plan-card');if(!card)return;card.dataset.planMode=b.dataset.planMode;active('[data-plan-mode]',b)}));function call(name,value){const api=window.PersonalAgentPascalViewer;return Boolean(api&&typeof api[name]==='function'&&api[name](value))}all('[data-level-mode]').forEach(b=>b.addEventListener('click',()=>{if(call('setLevelMode',b.dataset.levelMode))active('[data-level-mode]',b)}));all('[data-camera-mode]').forEach(b=>b.addEventListener('click',()=>{if(call('setCameraMode',b.dataset.cameraMode))active('[data-camera-mode]',b)}));all('[data-label-mode]').forEach(b=>b.addEventListener('click',()=>{const hidden=document.body.dataset.labels==='hidden';document.body.dataset.labels=hidden?'visible':'hidden';b.classList.toggle('active',hidden);b.setAttribute('aria-pressed',String(hidden))}));all('[data-level-id]').forEach(b=>b.addEventListener('click',()=>{call('setLevel',b.dataset.levelId);active('[data-level-id]',b)}));all('[data-highlight]').forEach(b=>b.addEventListener('click',()=>{const ids=b.dataset.highlight.split(',').filter(Boolean);call('highlight',ids);if(ids.length)one('[data-presentation="model"]').click()}));const picker=one('#concept-picker');if(picker)picker.addEventListener('change',()=>all('[data-concept-id]').forEach(card=>card.hidden=card.dataset.conceptId!==picker.value));document.addEventListener('keydown',event=>{if(event.key==='Escape')call('highlight',[])});})();`;
}

function safeJson(value) { return JSON.stringify(value).replaceAll('<', '\\u003c'); }
function readJson(file, limit) { const stat = fs.statSync(file); if (stat.size > limit) throw new Error(`${path.basename(file)} exceeds its size limit`); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
function isInside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }

function commitDirectory(staging, output) {
  const backup = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.previous`);
  if (fs.existsSync(backup)) throw new Error('stale Page output backup requires recovery');
  let movedPrevious = false;
  try {
    if (fs.existsSync(output)) {
      fs.renameSync(output, backup);
      movedPrevious = true;
    }
    fs.renameSync(staging, output);
    if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(output) && movedPrevious && fs.existsSync(backup)) fs.renameSync(backup, output);
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
