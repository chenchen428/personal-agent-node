import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadInteriorTemplateContract, loadPlanImageAsset } from './page-assets.mjs';
import { PascalInteriorAdapter } from './pascal-adapter.mjs';
import { canonicalJson, readProject, selectedConcept, sha256 } from './project-v2.mjs';
import { loadProjectDesignRender } from './render-v2.mjs';
import { compiledSceneHash } from './scene-hash.mjs';

const TEMPLATE_ID = 'interior-design-delivery';
const PAGE_LIMIT = 20 * 1024 * 1024;
const ICONS = Object.freeze({
  layers: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3 7 3.8-7 3.8-7-3.8L10 3Z"/><path d="m3 10.2 7 3.8 7-3.8"/><path d="m3 13.7 7 3.8 7-3.8"/></svg>',
  view: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 6.5 3.7v7.5L10 17.5l-6.5-3.8V6.2L10 2.5Z"/><path d="m3.7 6.3 6.3 3.6 6.3-3.6M10 9.9v7.3"/></svg>',
  label: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5v7.1l5.4 5.4 8.5-8.5L12.4 4H3Z"/><circle cx="6.7" cy="7.7" r="1"/></svg>',
  reset: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.1 6.2A7 7 0 1 1 3 12"/><path d="M4.1 2.7v3.5h3.5"/></svg>',
  rotateLeft: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.1 6.2A7 7 0 1 1 3 12"/><path d="M4.1 2.7v3.5h3.5"/></svg>',
  rotateRight: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.9 6.2A7 7 0 1 0 17 12"/><path d="M15.9 2.7v3.5h-3.5"/></svg>',
  render: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3z"/><path d="m5.5 13 3.1-3.2 2.2 2.1 1.8-1.8 2.1 2.9"/><circle cx="13.7" cy="7.2" r="1.2"/></svg>',
  plan: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.8h8l4 4V17H4V2.8Z"/><path d="M12 2.8v4h4M6.5 13l2.2-2.2 1.8 1.8 2.7-3"/></svg>',
  requirements: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5h8A1.5 1.5 0 0 1 15.5 5v12H4.5V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M7.5 3.5V2.3h5v1.2M7 8h6M7 11h6M7 14h4"/></svg>',
});

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
  const planAssets = loadProjectPlanAssets(projectDir, project);
  if (planAssets.source.sha256 !== project.provenance.sourcePlanSha256
    || scenePayload.modelBasis?.sha256 !== planAssets.source.sha256
    || scenePayload.modelBasis?.evidenceId !== project.provenance.sourcePlanEvidenceId) {
    throw new Error('3D scene, project provenance, and user-uploaded source-plan image must share one verified model basis');
  }
  const designRender = loadProjectDesignRender(projectDir, project, scenePayload);
  const concept = selectedConcept(project);
  const { payload: pagePayload, pageMappings } = new PascalInteriorAdapter().exportForPage(scenePayload);
  const conceptMappings = Object.fromEntries(project.concepts.map((entry, index) => [entry.conceptId, `page-concept-${String(index + 1).padStart(2, '0')}`]));
  const fallbackSvg = renderProjectPlan(concept, 'model-derived-plan');
  const style = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer-v2.css'), 'utf8');
  const viewer = fs.readFileSync(path.join(skillRoot, 'assets', 'pascal-viewer.bundle'), 'utf8');
  const title = escapeHtml(project.title);
  const requirements = renderRequirements(project, pageMappings);
  const issues = renderIssues(audit, pageMappings);
  const concepts = renderConcepts(project, conceptMappings);
  const assumptions = renderAssumptions(project);
  const revisions = renderRevisions(project);
  const declaredArea = project.evidence.map((entry) => entry.calibration?.knownAreaSquareMetres).find(Number.isFinite);
  const displayTitle = title.replace(/全屋改造$/u, '');
  const rooms = concept.levels.flatMap((level) => level.rooms);
  const featuredRoom = rooms.find((room) => room.kind === 'balcony')?.name;
  const subtitle = declaredArea
    ? `${Number(declaredArea).toFixed(2)} m² · ${concept.levels.length} 层 · ${rooms.length} 个空间${featuredRoom ? ` · ${featuredRoom}` : ''}`
    : `${concept.levels.length} 层 · ${rooms.length} 个空间 · 概念模型`;
  const levelButtons = concept.levels.map((level, index) => `<button${concept.levels.length === 1 ? ' class="active"' : ''} type="button" data-level-id="${escapeAttr(pageMappings[level.levelId] || '')}">${index + 1} 层</button>`).join('');
  const allLevelButton = concept.levels.length > 1 ? '<button class="active" type="button" data-level-id="">全部</button>' : '';
  const conceptPicker = `<label class="concept-control${project.concepts.length === 1 ? ' is-single' : ''}"><span>设计方案</span><select class="concept-picker" id="concept-picker" aria-label="比较设计方案">${project.concepts.map((entry) => `<option value="${escapeAttr(conceptMappings[entry.conceptId])}"${entry.conceptId === project.selectedConceptId ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label>`;
  const renderPanel = designRender
    ? `<figure class="presentation-panel render-panel" data-presentation-panel="render" data-image-viewer data-image-rotatable hidden><div class="image-viewer-viewport" data-image-viewport aria-label="可旋转、缩放查看对应渲染稿"><div class="image-viewer-canvas" data-image-canvas><img src="${escapeAttr(designRender.dataUrl)}" alt="${escapeAttr(designRender.alt)}" draggable="false"></div></div>${renderImageViewerControls('渲染稿', { rotatable: true })}<figcaption><span><small>SU → PHOTOREAL RENDER</small><strong>对应渲染稿</strong></span><span>基于当前 SU 设计稿与场景修订生成 · 概念效果不替代施工图或材料实样</span></figcaption></figure>`
    : '';
  const renderSwitch = designRender
    ? `<button type="button" data-presentation="render" aria-pressed="false">${ICONS.render}渲染稿</button>`
    : '';
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light"><meta name="personal-agent-page-template" content="${escapeAttr(template.implementation.artifactMarker)}"><meta name="personal-agent-page-template-id" content="${TEMPLATE_ID}"><meta name="personal-agent-page-template-version" content="2"><meta name="personal-agent-interior-engine" content="pascal-v2"><title>${title} · 专业装修设计</title><style>${style}</style></head>
<body data-template-marker="${escapeAttr(template.implementation.artifactMarker)}" data-template-id="${TEMPLATE_ID}" data-template-version="2" data-engine="pascal-v2" data-layout-profile="su-design-classic" data-viewer-state="loading"><main id="app">
<header class="top"><span class="brand"><span class="mark">PA</span><b>Pages</b></span><div class="identity"><small>PERSONAL AGENT · SU DESIGN</small><strong>${displayTitle}</strong><span>${escapeHtml(subtitle)}</span></div><span class="status" data-viewer-status><i></i><span>正在装配模型</span></span></header>
<section class="stage">
<section class="presentation-panel presentation-model" data-presentation-panel="model"><div class="viewport"><div id="scene" role="img" aria-label="${title} 可旋转的 Pascal 建筑场景"></div><div id="viewer-loading" role="status" aria-live="polite"><div class="loading-card"><span class="loading-mark"><i></i><i></i><i></i></span><small>PERSONAL AGENT · SU DESIGN</small><strong>正在构建设计模型</strong><p>正在装配空间、材质、家具与标注</p><span class="loading-line"><i></i></span></div></div><div id="fallback" hidden><figure>${fallbackSvg}<figcaption><span>3D 暂时不可用</span><span>已切换到模型派生平面图</span></figcaption></figure></div><div class="viewer-tools" role="group" aria-label="SU 设计稿查看工具">${conceptPicker}<span class="tool-label">${ICONS.layers}设计层</span><span class="level-tools">${allLevelButton}${levelButtons}</span><span class="divider"></span><span class="tool-label">${ICONS.view}视角</span><button class="active" type="button" data-camera-mode="perspective">3D</button><button type="button" data-camera-mode="orthographic">平面</button><span class="advanced-tools" data-level-count="${concept.levels.length}"><button class="active" type="button" data-level-mode="stacked">堆叠</button><button type="button" data-level-mode="exploded">分解</button><button type="button" data-level-mode="solo">单层</button></span><span class="divider"></span><button class="active icon-button" type="button" data-label-mode="visible" aria-label="隐藏细节标注" aria-pressed="true">${ICONS.label}</button><button class="icon-button" type="button" data-reset-view aria-label="复位 SU 设计稿">${ICONS.reset}</button></div><span class="gesture">拖动旋转 · 缩放 · 平移</span></div></section>
${renderPanel}
<article class="presentation-panel document-panel requirements-panel" data-presentation-panel="requirements" hidden><header><div><small>REQUIREMENT &amp; EVIDENCE</small><h2>用户需求与户型依据</h2></div><p>用户原图是唯一户型依据；Agent 标注、结构化空间、3D、平面和标签均由同一原图生成。</p></header><div class="requirements-workspace"><figure class="card plan-card requirements-plan" data-plan-mode="source"><div class="card-head"><strong>户型依据</strong><span class="segmented"><button class="active" type="button" data-plan-mode="source">用户原图</button><button type="button" data-plan-mode="annotation">Agent 标注图</button></span></div><div class="plan-image-viewer" data-image-viewer><div class="image-viewer-viewport plan-image-viewport" data-image-viewport aria-label="可缩放查看户型图"><div class="image-viewer-canvas" data-image-canvas><img class="plan-reference-image plan-source-image" src="${escapeAttr(planAssets.source.dataUrl)}" alt="${escapeAttr(planAssets.source.alt)}" draggable="false"><img class="plan-reference-image plan-annotation-image" src="${escapeAttr(planAssets.annotation.dataUrl)}" alt="${escapeAttr(planAssets.annotation.alt)}" draggable="false"></div></div>${renderImageViewerControls('户型图')}</div><figcaption class="plan-caption">图片用于概念设计沟通，不替代现场测绘、施工图、结构鉴定或所在地法规审核。</figcaption></figure><div class="requirements-details"><section class="card"><div class="card-head"><strong>需求状态</strong></div><div class="requirement-list">${requirements}</div></section><aside class="card"><div class="card-head"><strong>假设、未知与专业核验</strong></div><div class="stack">${assumptions}</div></aside><aside class="card"><div class="card-head"><strong>版本脉络</strong></div><div class="stack">${revisions}</div></aside></div></div></article>
<article class="presentation-panel document-panel" data-presentation-panel="review" hidden><header><div><small>QUALITY GATE</small><h2>质量报告与方案比较</h2></div><p>${audit.blockingCount} 个阻断 · ${audit.warningCount} 个警告 · 规则集 ${escapeHtml(audit.ruleSet)}</p></header><div class="document-grid"><section class="card"><div class="card-head"><strong>审计结果</strong></div><div class="issue-list">${issues}</div></section><aside class="card"><div class="card-head"><strong>方案比较</strong></div><div class="stack">${concepts}</div></aside></div></article>
<nav class="presentation-switch" aria-label="装修设计资料切换"><button type="button" data-presentation="requirements" aria-pressed="false">${ICONS.requirements}用户需求</button><button class="active" type="button" data-presentation="model" aria-pressed="true">设计稿</button>${renderSwitch}</nav>
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
    ...(designRender ? {
      render: {
        kind: designRender.metadata.kind,
        revision: designRender.metadata.revision,
        sceneSha256: designRender.metadata.sceneSha256,
        imageSha256: designRender.metadata.imageSha256,
        referenceImageSha256: designRender.metadata.referenceImageSha256,
        promptSha256: designRender.metadata.promptSha256,
        generator: designRender.metadata.generator,
      },
    } : {}),
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
    'data-layout-profile="su-design-classic"',
    'id="pascal-scene"',
    'id="viewer-loading"',
    'id="model-derived-plan"',
    'plan-source-image',
    'plan-annotation-image',
    'data-image-viewer',
    'data-image-zoom="in"',
    'data-image-zoom="out"',
    'data-image-reset',
    '可缩放查看户型图',
    'data-level-mode="stacked"',
    'data-level-mode="exploded"',
    'data-level-mode="solo"',
    'data-label-mode="visible"',
    'data-presentation="model"',
    'data-presentation="requirements"',
    'data-presentation-panel="review"',
    "connect-src 'none'",
    'data-viewer-status',
    '正在装配模型',
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
  const hasRenderPanel = html.includes('data-presentation-panel="render"');
  const hasRenderSwitch = html.includes('data-presentation="render"');
  if (hasRenderPanel !== hasRenderSwitch || (hasRenderPanel && (!html.includes('SU → PHOTOREAL RENDER')
    || !html.includes('data-presentation-panel="render" data-image-viewer data-image-rotatable')
    || !html.includes('data-image-rotate="left"')
    || !html.includes('data-image-rotate="right"')
    || !html.includes('data-image-rotation')
    || !html.includes('可旋转、缩放查看对应渲染稿')))) {
    throw new Error('generated Page render panel and switch must form one complete delivery view');
  }
  const requirementsPanel = html.match(/data-presentation-panel="requirements"[\s\S]*?<\/article>/)?.[0] || '';
  if (!requirementsPanel.includes('plan-source-image')
    || !requirementsPanel.includes('plan-annotation-image')
    || html.includes('data-presentation="plan"')) {
    throw new Error('generated Page must keep source and annotated floor plans inside 用户需求 without a separate 户型图 switch');
  }
  const navigation = html.match(/<nav class="presentation-switch"[\s\S]*?<\/nav>/)?.[0] || '';
  const orderedViews = ['requirements', 'model', ...(hasRenderPanel ? ['render'] : [])];
  const viewPositions = orderedViews.map((view) => navigation.indexOf(`data-presentation="${view}"`));
  if (viewPositions.some((position) => position < 0)
    || viewPositions.some((position, index) => index > 0 && position <= viewPositions[index - 1])
    || !/<button class="active"[^>]+data-presentation="model"[^>]+aria-pressed="true"/.test(navigation)) {
    throw new Error('generated Page navigation must order 用户需求, 设计稿, 渲染稿 and default to 设计稿');
  }
  return { ok: true, templateId: template.id, templateVersion: 2, artifactMarker: template.implementation.artifactMarker, engine: 'pascal-v2', visualAcceptance: 'user' };
}

function loadProjectPlanAssets(projectDir, project) {
  const sourceEvidence = project.evidence.find((entry) => entry.classification === 'structure-reference'
    && entry.relativePath
    && ['redacted', 'not-required'].includes(entry.redactionStatus));
  const annotationEvidence = project.evidence.find((entry) => entry.classification === 'revision-annotation'
    && entry.relativePath
    && ['redacted', 'not-required'].includes(entry.redactionStatus));
  if (!sourceEvidence || !annotationEvidence) {
    throw new Error('project needs redacted user source-plan and Agent revision-annotation image evidence for Page delivery');
  }
  return {
    source: loadProjectPlanAsset(projectDir, sourceEvidence, '用户上传并脱敏的原始户型图'),
    annotation: loadProjectPlanAsset(projectDir, annotationEvidence, 'Agent 上传的户型分析标注图'),
  };
}

function loadProjectPlanAsset(projectDir, evidence, alt) {
  const target = path.resolve(projectDir, evidence.relativePath);
  const evidenceRoot = path.resolve(projectDir, 'evidence');
  const relative = path.relative(evidenceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('plan image evidence must stay inside the project evidence directory');
  if (fs.lstatSync(evidenceRoot).isSymbolicLink()) throw new Error('project evidence directory must not be a symbolic link');
  const realEvidenceRoot = fs.realpathSync(evidenceRoot);
  const realTarget = fs.realpathSync(target);
  if (!isInside(realEvidenceRoot, realTarget) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error('plan image evidence must not escape through a symbolic link');
  }
  return loadPlanImageAsset(target, { alt });
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
  const level = concept.levels[0];
  const points = level.rooms.flatMap((room) => room.polygon);
  const bounds = {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
  const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
  const scale = Math.min(42, 830 / Math.max(1, bounds.maxX - bounds.minX + bounds.maxZ - bounds.minZ));
  const project = ([x, z], y = 0) => [
    624 + ((x - center[0]) - (z - center[1])) * scale,
    360 + ((x - center[0]) + (z - center[1])) * scale * 0.43 - y * scale,
  ];
  const svgPoints = (entries) => entries.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const roomColors = ['#d9c7aa', '#c9d4ca', '#d6d0c5', '#bcc8c0', '#e3d8c8'];
  const floorMarkup = level.rooms.map((room, index) => {
    const color = /bath|laundry|kitchen|balcony|卫生|厨房|阳台/i.test(`${room.kind} ${room.name}`)
      ? '#aeb6b1'
      : roomColors[index % roomColors.length];
    return `<polygon points="${svgPoints(room.polygon.map((point) => project(point)))}" fill="${color}" stroke="#f4f1e9" stroke-width="3"/>`;
  }).join('');
  const wallMarkup = [...level.walls]
    .sort((first, second) => (first.start[0] + first.start[1] + first.end[0] + first.end[1]) - (second.start[0] + second.start[1] + second.end[0] + second.end[1]))
    .map((wall) => {
      const wallHeight = wall.exteriorEdge >= 0 ? 1.25 : 1.05;
      const baseStart = project(wall.start);
      const baseEnd = project(wall.end);
      const topEnd = project(wall.end, wallHeight);
      const topStart = project(wall.start, wallHeight);
      return `<polygon points="${svgPoints([baseStart, baseEnd, topEnd, topStart])}" fill="${wall.exteriorEdge >= 0 ? '#f6f3eb' : '#eae7df'}" stroke="#aeb1ab" stroke-width="1.5"/><line x1="${topStart[0].toFixed(1)}" y1="${topStart[1].toFixed(1)}" x2="${topEnd[0].toFixed(1)}" y2="${topEnd[1].toFixed(1)}" stroke="#ffffff" stroke-width="3"/>`;
    }).join('');
  const furnitureMarkup = [...level.items]
    .sort((first, second) => first.position[0] + first.position[1] - second.position[0] - second.position[1])
    .map((item) => renderIsometricFurniture(item, project, svgPoints))
    .join('');
  const labels = [
    ['客厅 · 多功能厅', 'living'],
    ['餐厅 · 六人位', 'dining'],
    ['卧室一', 'bed-left'],
    ['主卧', 'master'],
    ['卧室三', 'study'],
  ].map(([label, roomId]) => {
    const room = level.rooms.find((entry) => entry.roomId === roomId);
    if (!room) return '';
    const centroid = room.polygon.reduce((sum, point) => [sum[0] + point[0] / room.polygon.length, sum[1] + point[1] / room.polygon.length], [0, 0]);
    const [x, y] = project(centroid, 1.72);
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect x="-43" y="-12" width="86" height="23" rx="11.5" fill="#29332d" fill-opacity=".88"/><text y="4" fill="#fff" font-size="11" font-weight="700" text-anchor="middle">${escapeHtml(label)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${escapeAttr(concept.name)} 的模型派生轴测封面">
  <defs>
    <linearGradient id="cover-background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e9ece8"/><stop offset="1" stop-color="#cbd2cd"/></linearGradient>
    <filter id="cover-shadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#25322b" flood-opacity=".2"/></filter>
  </defs>
  <rect width="1200" height="675" fill="url(#cover-background)"/>
  <ellipse cx="620" cy="506" rx="430" ry="112" fill="#4c5851" fill-opacity=".16"/>
  <g filter="url(#cover-shadow)">${floorMarkup}${wallMarkup}${furnitureMarkup}</g>
  ${labels}
  <g transform="translate(48 48)">
    <rect width="330" height="98" rx="16" fill="#f9f7f1" fill-opacity=".94" stroke="#ffffff"/>
    <text x="22" y="28" fill="#68716b" font-family="Arial,sans-serif" font-size="10" font-weight="700" letter-spacing="2">PERSONAL AGENT · PASCAL V2</text>
    <text x="22" y="57" fill="#27322c" font-family="Georgia,serif" font-size="23">${escapeHtml(concept.name)}</text>
    <text x="22" y="80" fill="#727a74" font-family="Arial,sans-serif" font-size="11">${level.rooms.length} 个空间 · ${level.items.length} 件陈设 · ${level.openings.length} 个真实门窗开洞</text>
  </g>
  <g transform="translate(986 52)"><rect width="166" height="34" rx="17" fill="#29332d"/><circle cx="19" cy="17" r="4" fill="#8fc19d"/><text x="34" y="21" fill="#fff" font-family="Arial,sans-serif" font-size="11" font-weight="700">模型派生 · 非静态示意</text></g>
</svg>\n`;
}

function renderIsometricFurniture(item, project, svgPoints) {
  const [width, depth, height] = item.size;
  const angle = (item.rotation || 0) * Math.PI / 180;
  const rotate = ([x, z]) => [
    item.position[0] + x * Math.cos(angle) - z * Math.sin(angle),
    item.position[1] + x * Math.sin(angle) + z * Math.cos(angle),
  ];
  const base = [
    rotate([-width / 2, -depth / 2]),
    rotate([width / 2, -depth / 2]),
    rotate([width / 2, depth / 2]),
    rotate([-width / 2, depth / 2]),
  ];
  const visualHeight = Math.min(Math.max(height, 0.06), 1.55);
  const bottom = base.map((point) => project(point));
  const top = base.map((point) => project(point, visualHeight));
  const color = escapeAttr(item.color || '#c8b79f');
  const darker = /^#[0-9a-f]{6}$/i.test(color)
    ? `#${[1, 3, 5].map((index) => Math.max(0, Math.round(Number.parseInt(color.slice(index, index + 2), 16) * 0.78)).toString(16).padStart(2, '0')).join('')}`
    : '#6f756f';
  return `<g data-cover-item="${escapeAttr(item.kind)}"><polygon points="${svgPoints([bottom[1], bottom[2], top[2], top[1]])}" fill="${darker}" opacity=".9"/><polygon points="${svgPoints([bottom[2], bottom[3], top[3], top[2]])}" fill="${darker}" opacity=".72"/><polygon points="${svgPoints(top)}" fill="${color}" stroke="#ffffff" stroke-opacity=".68" stroke-width="1.2"/></g>`;
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

function renderImageViewerControls(label, { rotatable = false } = {}) {
  const rotationControls = rotatable
    ? `<button class="image-rotate-button" type="button" data-image-rotate="left" aria-label="向左旋转${escapeAttr(label)}" title="向左旋转 90°">${ICONS.rotateLeft}</button><output class="image-rotation-output" data-image-rotation aria-live="polite">0°</output><button class="image-rotate-button" type="button" data-image-rotate="right" aria-label="向右旋转${escapeAttr(label)}" title="向右旋转 90°">${ICONS.rotateRight}</button><span class="image-control-divider" aria-hidden="true"></span>`
    : '';
  return `<div class="image-viewer-controls" role="group" aria-label="${escapeAttr(label)}查看工具">${rotationControls}<button type="button" data-image-zoom="out" aria-label="缩小${escapeAttr(label)}">−</button><output data-image-scale aria-live="polite">100%</output><button type="button" data-image-zoom="in" aria-label="放大${escapeAttr(label)}">+</button><button type="button" data-image-reset>适配</button></div>`;
}

function pageController() {
  return `(function(){
const one=(selector,root=document)=>root.querySelector(selector);
const all=(selector,root=document)=>[...root.querySelectorAll(selector)];
const IMAGE_MIN_SCALE=1;
const IMAGE_MAX_SCALE=4;
const IMAGE_ZOOM_STEP=1.1;
const IMAGE_WHEEL_SENSITIVITY=.0008;
const IMAGE_PINCH_SENSITIVITY=.72;
function active(group,target){all(group).forEach(button=>{const on=button===target;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on))})}
function call(name,value){const api=window.PersonalAgentPascalViewer;return Boolean(api&&typeof api[name]==='function'&&api[name](value))}
function restoreModelView(){call('resetCamera');call('warmup')}
function installImageViewer(viewer){
  const viewport=one('[data-image-viewport]',viewer);
  const canvas=one('[data-image-canvas]',viewer);
  const output=one('[data-image-scale]',viewer);
  const rotationOutput=one('[data-image-rotation]',viewer);
  const rotatable=viewer.hasAttribute('data-image-rotatable');
  if(!viewport||!canvas||!output)return;
  const state={scale:1,x:0,y:0,rotation:0,pointers:new Map(),lastPoint:null,pinch:null};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  function apply(){
    const maxX=Math.max(0,(state.scale-1)*viewport.clientWidth/2);
    const maxY=Math.max(0,(state.scale-1)*viewport.clientHeight/2);
    state.x=clamp(state.x,-maxX,maxX);
    state.y=clamp(state.y,-maxY,maxY);
    canvas.style.transform='translate3d('+state.x+'px,'+state.y+'px,0) scale('+state.scale+')';
    const quarterTurn=rotatable&&state.rotation%180!==0;
    all('img',canvas).forEach(image=>{
      image.style.width=quarterTurn?viewport.clientHeight+'px':'100%';
      image.style.height=quarterTurn?viewport.clientWidth+'px':'100%';
      image.style.transform='translate(-50%,-50%) rotate('+state.rotation+'deg)';
    });
    viewer.classList.toggle('is-zoomed',state.scale>1);
    viewer.classList.toggle('is-rotated',state.rotation!==0);
    output.value=Math.round(state.scale*100)+'%';
    output.textContent=output.value;
    if(rotationOutput){rotationOutput.value=state.rotation+'°';rotationOutput.textContent=rotationOutput.value}
    const out=one('[data-image-zoom="out"]',viewer);
    const inside=one('[data-image-zoom="in"]',viewer);
    if(out)out.disabled=state.scale<=IMAGE_MIN_SCALE;
    if(inside)inside.disabled=state.scale>=IMAGE_MAX_SCALE;
  }
  function setScale(value,clientX,clientY){
    const previous=state.scale;
    const next=clamp(Math.round(value*1000)/1000,IMAGE_MIN_SCALE,IMAGE_MAX_SCALE);
    if(previous===next)return;
    if(Number.isFinite(clientX)&&Number.isFinite(clientY)){
      const bounds=viewport.getBoundingClientRect();
      const focalX=clientX-bounds.left-bounds.width/2;
      const focalY=clientY-bounds.top-bounds.height/2;
      const ratio=next/previous;
      state.x-=focalX*(ratio-1);
      state.y-=focalY*(ratio-1);
    }
    state.scale=next;
    if(next===IMAGE_MIN_SCALE){state.x=0;state.y=0}
    apply();
  }
  function reset(){state.scale=IMAGE_MIN_SCALE;state.x=0;state.y=0;state.rotation=0;state.pinch=null;apply()}
  function beginPinch(){
    if(state.pointers.size!==2){state.pinch=null;return}
    const points=[...state.pointers.values()];
    state.pinch={
      distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y),
      midpoint:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},
      scale:state.scale,
      x:state.x,
      y:state.y
    };
  }
  all('[data-image-zoom]',viewer).forEach(button=>button.addEventListener('click',()=>setScale(state.scale*(button.dataset.imageZoom==='in'?IMAGE_ZOOM_STEP:1/IMAGE_ZOOM_STEP))));
  all('[data-image-rotate]',viewer).forEach(button=>button.addEventListener('click',()=>{
    state.rotation=(state.rotation+(button.dataset.imageRotate==='right'?90:-90)+360)%360;
    state.x=0;state.y=0;apply();
  }));
  const resetButton=one('[data-image-reset]',viewer);
  if(resetButton)resetButton.addEventListener('click',reset);
  viewport.addEventListener('wheel',event=>{
    event.preventDefault();
    const delta=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*viewport.clientHeight:event.deltaY;
    setScale(state.scale*Math.exp(-delta*IMAGE_WHEEL_SENSITIVITY),event.clientX,event.clientY);
  },{passive:false});
  viewport.addEventListener('dblclick',event=>{event.preventDefault();if(state.scale>1)reset();else setScale(1.5,event.clientX,event.clientY)});
  viewport.addEventListener('pointerdown',event=>{
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    state.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(state.pointers.size===1)state.lastPoint={x:event.clientX,y:event.clientY};
    beginPinch();
    viewer.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove',event=>{
    if(!state.pointers.has(event.pointerId))return;
    state.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(state.pointers.size===2){
      if(!state.pinch)beginPinch();
      const points=[...state.pointers.values()];
      const distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
      const midpoint={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};
      const pinchRatio=Math.pow(distance/Math.max(1,state.pinch.distance),IMAGE_PINCH_SENSITIVITY);
      state.scale=clamp(state.pinch.scale*pinchRatio,IMAGE_MIN_SCALE,IMAGE_MAX_SCALE);
      state.x=state.pinch.x+midpoint.x-state.pinch.midpoint.x;
      state.y=state.pinch.y+midpoint.y-state.pinch.midpoint.y;
      apply();
    }else if(state.scale>1&&state.lastPoint){
      state.x+=event.clientX-state.lastPoint.x;
      state.y+=event.clientY-state.lastPoint.y;
      state.lastPoint={x:event.clientX,y:event.clientY};
      apply();
    }
  });
  function release(event){
    state.pointers.delete(event.pointerId);
    state.pinch=null;
    const remaining=[...state.pointers.values()][0];
    state.lastPoint=remaining?{...remaining}:null;
    if(!state.pointers.size)viewer.classList.remove('is-dragging');
  }
  viewport.addEventListener('pointerup',release);
  viewport.addEventListener('pointercancel',release);
  viewer.resetImageViewer=reset;
  viewer.refreshImageViewer=apply;
  window.addEventListener('resize',apply);
  apply();
}
all('[data-image-viewer]').forEach(installImageViewer);
all('[data-presentation]').forEach(button=>button.addEventListener('click',()=>{
  all('[data-presentation-panel]').forEach(panel=>{panel.hidden=panel.dataset.presentationPanel!==button.dataset.presentation});
  active('[data-presentation]',button);
  const panel=one('[data-presentation-panel="'+button.dataset.presentation+'"]');
  const imageViewer=panel&&(panel.matches('[data-image-viewer]')?panel:one('[data-image-viewer]',panel));
  if(imageViewer)requestAnimationFrame(()=>imageViewer.refreshImageViewer());
  if(button.dataset.presentation==='model'){
    requestAnimationFrame(()=>{restoreModelView();requestAnimationFrame(restoreModelView)});
    setTimeout(restoreModelView,180);setTimeout(restoreModelView,520);setTimeout(restoreModelView,1100);
  }
}));
all('[data-plan-mode]').forEach(button=>button.addEventListener('click',()=>{
  const card=button.closest('.plan-card');
  if(!card)return;
  card.dataset.planMode=button.dataset.planMode;
  active('[data-plan-mode]',button);
  const viewer=one('[data-image-viewer]',card);
  if(viewer)viewer.resetImageViewer();
}));
all('[data-level-mode]').forEach(button=>button.addEventListener('click',()=>{if(call('setLevelMode',button.dataset.levelMode))active('[data-level-mode]',button)}));
all('[data-camera-mode]').forEach(button=>button.addEventListener('click',()=>{if(call('setCameraMode',button.dataset.cameraMode))active('[data-camera-mode]',button)}));
all('[data-label-mode]').forEach(button=>button.addEventListener('click',()=>{const hidden=document.body.dataset.labels==='hidden';document.body.dataset.labels=hidden?'visible':'hidden';button.classList.toggle('active',hidden);button.setAttribute('aria-pressed',String(hidden));button.setAttribute('aria-label',hidden?'隐藏细节标注':'显示细节标注')}));
all('[data-level-id]').forEach(button=>button.addEventListener('click',()=>{call('setLevel',button.dataset.levelId);active('[data-level-id]',button)}));
all('[data-reset-view]').forEach(button=>button.addEventListener('click',()=>{call('resetCamera');const camera=one('[data-camera-mode="perspective"]');if(camera)active('[data-camera-mode]',camera)}));
all('[data-highlight]').forEach(button=>button.addEventListener('click',()=>{const ids=button.dataset.highlight.split(',').filter(Boolean);call('highlight',ids);if(ids.length)one('[data-presentation="model"]').click()}));
const picker=one('#concept-picker');
if(picker)picker.addEventListener('change',()=>all('[data-concept-id]').forEach(card=>{card.hidden=card.dataset.conceptId!==picker.value}));
document.addEventListener('keydown',event=>{if(event.key==='Escape')call('highlight',[])});
})();`;
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
