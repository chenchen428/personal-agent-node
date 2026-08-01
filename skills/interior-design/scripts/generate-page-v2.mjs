import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadInteriorDeliveryContract, loadPlanImageAsset } from './page-assets.mjs';
import { PascalInteriorAdapter } from './pascal-adapter.mjs';
import { canonicalJson, readProject, selectedConcept, sha256 } from './project-v2.mjs';
import { compiledSceneHash } from './scene-hash.mjs';

const DELIVERY_ID = 'interior-c-layout-delivery';
const PAGE_ENTRY_LIMIT = 10 * 1024 * 1024;
const PAGE_ASSET_LIMIT = 20 * 1024 * 1024;
const ICONS = Object.freeze({
  layers: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3 7 3.8-7 3.8-7-3.8L10 3Z"/><path d="m3 10.2 7 3.8 7-3.8"/><path d="m3 13.7 7 3.8 7-3.8"/></svg>',
  view: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 6.5 3.7v7.5L10 17.5l-6.5-3.8V6.2L10 2.5Z"/><path d="m3.7 6.3 6.3 3.6 6.3-3.6M10 9.9v7.3"/></svg>',
  label: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5v7.1l5.4 5.4 8.5-8.5L12.4 4H3Z"/><circle cx="6.7" cy="7.7" r="1"/></svg>',
  reset: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.1 6.2A7 7 0 1 1 3 12"/><path d="M4.1 2.7v3.5h3.5"/></svg>',
  rotateRight: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.9 6.2A7 7 0 1 0 17 12"/><path d="M15.9 2.7v3.5h-3.5"/></svg>',
  plan: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.8h8l4 4V17H4V2.8Z"/><path d="M12 2.8v4h4M6.5 13l2.2-2.2 1.8 1.8 2.7-3"/></svg>',
  requirements: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5h8A1.5 1.5 0 0 1 15.5 5v12H4.5V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M7.5 3.5V2.3h5v1.2M7 8h6M7 11h6M7 14h4"/></svg>',
  render: '<svg class="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3z"/><path d="m5.5 13 3.1-3.2 2.2 2.1 1.8-1.8 2.1 2.9"/><circle cx="13.7" cy="7.2" r="1.2"/></svg>',
});

export function generateProfessionalPage({ projectDir: projectDirInput, context, output, skillRoot, delivery = loadInteriorDeliveryContract(skillRoot) }) {
  if (delivery.id !== DELIVERY_ID
    || delivery.agent?.id !== 'interior-designer'
    || Number(delivery.delivery?.version) !== 3
    || delivery.delivery?.engine !== 'pascal-v2') {
    throw new Error(`${DELIVERY_ID} for interior-designer delivery version 3 is required`);
  }
  const { projectDir, project } = readProject(projectDirInput, context);
  const scenePayload = readJson(path.join(projectDir, 'scene.json'), 10 * 1024 * 1024);
  const audit = readJson(path.join(projectDir, 'derived', 'audit.json'), 4 * 1024 * 1024);
  if (audit.projectId !== project.projectId || audit.revision !== project.revision) throw new Error('quality report does not match the current project revision');
  const { sha256: recordedAuditHash, ...auditReport } = audit;
  const computedAuditHash = sha256(canonicalJson(auditReport));
  if (recordedAuditHash !== computedAuditHash || project.quality.sha256 !== recordedAuditHash) throw new Error('quality report hash does not match the governed project');
  if (!audit.ok || audit.blockingCount > 0) throw new Error(`quality gate blocks Page generation with ${audit.blockingCount} issue(s)`);
  if (scenePayload.projectId !== project.projectId || scenePayload.revision !== project.revision || scenePayload.sceneHash !== project.scene.sha256) throw new Error('compiled scene does not match the current project');
  if (compiledSceneHash(scenePayload.scene, scenePayload.furniture || [], scenePayload.designQuality || {}) !== scenePayload.sceneHash) throw new Error('compiled scene hash does not match its content');
  const planAssets = loadProjectPlanAssets(projectDir, project);
  const conceptRenders = loadProjectConceptRenders(projectDir, project);
  if (planAssets.source.sha256 !== project.provenance.sourcePlanSha256
    || scenePayload.modelBasis?.sha256 !== planAssets.source.sha256
    || scenePayload.modelBasis?.evidenceId !== project.provenance.sourcePlanEvidenceId) {
    throw new Error('3D scene, project provenance, and user-uploaded source-plan image must share one verified model basis');
  }
  const concept = selectedConcept(project);
  const { payload: pagePayload, pageMappings } = new PascalInteriorAdapter().exportForPage(scenePayload);
  const conceptMappings = Object.fromEntries(project.concepts.map((entry, index) => [entry.conceptId, `page-concept-${String(index + 1).padStart(2, '0')}`]));
  const fallbackSvg = renderProjectPlan(concept, 'model-derived-plan');
  const viewerStyle = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-viewer-v2.css'), 'utf8');
  const reportStyle = fs.readFileSync(path.join(skillRoot, 'assets', 'interior-delivery-report.css'), 'utf8');
  const viewer = fs.readFileSync(path.join(skillRoot, 'assets', 'pascal-viewer.bundle'), 'utf8');
  const title = escapeHtml(project.title);
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
  const threeDHtml = renderThreeDPage({ delivery, displayTitle, fallbackSvg, pagePayload, subtitle, title, viewer, viewerStyle, conceptPicker, levelButtons, allLevelButton, concept });
  const html = renderDeliveryBooklet({ audit, concept, conceptRenders, delivery, displayTitle, fallbackSvg, planAssets, project, reportStyle, subtitle });
  verifyNoGovernanceIdentifiers(`${html}\n${threeDHtml}`, project);
  const verification = verifyProfessionalPageHtml({ html, threeDHtml }, delivery);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const staging = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.mkdirSync(staging, { mode: 0o700 });
  fs.mkdirSync(path.join(staging, '3d'), { recursive: true, mode: 0o700 });
  const indexPath = path.join(staging, 'index.html');
  fs.writeFileSync(indexPath, html, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, '3d', 'index.html'), threeDHtml, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, 'scene.json'), `${JSON.stringify(pagePayload, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(staging, 'audit.json'), `${JSON.stringify(sanitizeAudit(audit, pageMappings), null, 2)}\n`, { mode: 0o600 });
  const files = ['index.html', '3d/index.html', 'scene.json', 'audit.json'];
  const mediaAssets = writePageMediaAssets(staging, { planAssets, conceptRenders });
  files.push(...mediaAssets);
  const manifest = {
    schemaVersion: 1,
    agent: {
      id: delivery.agent.id,
      version: delivery.agent.version,
      exampleId: delivery.id,
    },
    delivery: {
      version: delivery.delivery.version,
      engine: delivery.delivery.engine,
      layoutProfile: delivery.delivery.layoutProfile,
      renderProfile: delivery.delivery.renderProfile,
      specialistPages: delivery.delivery.specialistPages,
    },
    visualAcceptance: 'user',
    files: Object.fromEntries(files.map((name) => {
      const value = fs.readFileSync(path.join(staging, name));
      return [name, { bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') }];
    })),
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const totalBytes = [...files, 'manifest.json'].reduce((sum, name) => sum + fs.statSync(path.join(staging, name)).size, 0);
  const entryBytes = fs.statSync(indexPath).size;
  const oversizedEntry = ['index.html', '3d/index.html'].find((name) => fs.statSync(path.join(staging, name)).size > PAGE_ENTRY_LIMIT);
  const oversized = files.find((name) => !name.endsWith('.html') && fs.statSync(path.join(staging, name)).size > PAGE_ASSET_LIMIT);
  if (oversizedEntry || oversized) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(oversized ? `generated Page asset exceeds ${PAGE_ASSET_LIMIT} bytes: ${oversized}` : `generated Page entry exceeds ${PAGE_ENTRY_LIMIT} bytes: ${oversizedEntry}`);
  }
  commitDirectory(staging, output);
  return { indexPath: path.join(output, 'index.html'), specialistPages: { threeD: path.join(output, '3d', 'index.html') }, totalBytes, entryBytes, manifest, verification };
}

function renderThreeDPage({ delivery, displayTitle, fallbackSvg, pagePayload, subtitle, title, viewer, viewerStyle, conceptPicker, levelButtons, allLevelButton, concept }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light"><meta name="personal-agent-id" content="${escapeAttr(delivery.agent.id)}"><meta name="personal-agent-example-id" content="${escapeAttr(delivery.id)}"><meta name="personal-agent-delivery-version" content="${escapeAttr(String(delivery.delivery.version))}"><meta name="personal-agent-interior-engine" content="pascal-v2"><title>${title} · 交互式 3D 设计</title><style>${viewerStyle}</style></head>
<body data-agent-id="${escapeAttr(delivery.agent.id)}" data-agent-example-id="${escapeAttr(delivery.id)}" data-delivery-version="${escapeAttr(String(delivery.delivery.version))}" data-engine="pascal-v2" data-layout-profile="su-design-classic" data-specialist-page="three-d" data-viewer-state="loading"><main id="app">
<header class="top"><a class="brand" href="../index.html"><span class="mark">PA</span><b>返回设计册</b></a><div class="identity"><small>PERSONAL AGENT · INTERACTIVE 3D</small><strong>${displayTitle}</strong><span>${escapeHtml(subtitle)}</span></div><span class="status" data-viewer-status><i></i><span>正在装配模型</span></span></header>
<section class="stage"><section class="presentation-panel presentation-model"><div class="viewport"><div id="scene" role="img" aria-label="${title} 可旋转的 Pascal 建筑场景"></div><div id="viewer-loading" role="status" aria-live="polite"><div class="loading-card"><span class="loading-mark"><i></i><i></i><i></i></span><small>PERSONAL AGENT · SU DESIGN</small><strong>正在构建设计模型</strong><p>正在装配空间、材质、家具与标注</p><span class="loading-line"><i></i></span></div></div><div id="fallback" hidden><figure>${fallbackSvg}<figcaption><span>3D 暂时不可用</span><span>已切换到模型派生平面图</span></figcaption></figure></div><div class="viewer-tools" role="group" aria-label="SU 设计稿查看工具">${conceptPicker}<span class="tool-label">${ICONS.layers}设计层</span><span class="level-tools">${allLevelButton}${levelButtons}</span><span class="divider"></span><span class="tool-label">${ICONS.view}视角</span><button class="active" type="button" data-camera-mode="perspective">3D</button><button type="button" data-camera-mode="orthographic">平面</button><span class="advanced-tools" data-level-count="${concept.levels.length}"><button class="active" type="button" data-level-mode="stacked">堆叠</button><button type="button" data-level-mode="exploded">分解</button><button type="button" data-level-mode="solo">单层</button></span><span class="divider"></span><button class="active icon-button" type="button" data-label-mode="visible" aria-label="隐藏细节标注" aria-pressed="true">${ICONS.label}</button><button class="icon-button" type="button" data-reset-view aria-label="复位 SU 设计稿">${ICONS.reset}</button></div><span class="gesture">拖动旋转 · 缩放 · 平移</span></div></section></section>
<script id="pascal-scene" type="application/json">${safeJson(pagePayload)}</script><script>${mobileLandscapeController()}${viewerPageController()}</script><script>${viewer}</script></main></body></html>`;
}

function renderDeliveryBooklet({ audit, concept, conceptRenders, delivery, displayTitle, fallbackSvg, planAssets, project, reportStyle, subtitle }) {
  const sourceExtension = path.extname(planAssets.source.evidence.relativePath).toLowerCase();
  const annotationExtension = path.extname(planAssets.annotation.evidence.relativePath).toLowerCase();
  const requirements = project.brief.requirements.map((entry) => `<article class="requirement-card"><header><b>${escapeHtml(entry.priority)}</b><em>${escapeHtml(entry.status)}</em></header><p>${escapeHtml(entry.summary)}</p></article>`).join('');
  const renderCards = conceptRenders.length
    ? conceptRenders.map((render) => `<figure class="render-card"><img src="${escapeAttr(render.dataUrl)}" alt="${escapeAttr(render.alt)}"><figcaption><b>${String(render.record.sequence).padStart(2, '0')} · ${escapeHtml(render.shot.space)}</b><span>${escapeHtml(render.shot.purpose)} · 概念效果不替代施工图或材料实样</span></figcaption></figure>`).join('')
    : '<p class="empty-state">当前项目没有纳入交付的效果图；主体设计册仍保留效果图章节和边界说明。</p>';
  const materialRows = (project.designIntent?.materials || []).map((material) => `<tr><td><span class="material-swatch" style="background:${escapeAttr(material.color)}"></span>${escapeHtml(material.name)}</td><td>${escapeHtml(material.category)}</td><td>${escapeHtml(String(material.roughness))}</td><td>${escapeHtml(material.wetAreaSuitability || '不适用/待核验')}</td><td>${escapeHtml(material.maintenance || '采购前核验样板与技术资料')}</td></tr>`).join('');
  const budgetRows = concept.budgetItems?.length
    ? concept.budgetItems.map((item) => `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.name || item.summary || '范围分配')}</td><td>${escapeHtml(item.confidence)}</td><td>${escapeHtml(`${project.brief.budget.currency} ${(item.amountMinor / 100).toLocaleString('zh-CN')}`)}</td></tr>`).join('')
    : `<tr><td colspan="4">当前预算为“${escapeHtml(project.brief.budget.confidence)}”，尚未形成报价分配。主体设计册只记录预算边界，不通过填充金额强行闭合。</td></tr>`;
  const process = renderBookletProcess(project);
  const consistencyRows = renderConsistencyMatrix(project, concept, conceptRenders);
  const boundaries = [
    ...project.assumptions.map((entry) => ['估算与假设', entry.summary, entry.confidence]),
    ...project.unknowns.map((entry) => ['待确认', entry.summary, 'site-measure-required']),
    ...project.professionalVerifications.map((entry) => ['专业复核', entry.summary, entry.status]),
  ].map(([label, summary, status]) => `<article class="boundary-card"><b>${escapeHtml(label)}</b><strong>${escapeHtml(status || '待处理')}</strong><p>${escapeHtml(summary)}</p></article>`).join('');
  const householdCount = project.brief.household.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const verifiedRequirements = project.brief.requirements.filter((entry) => entry.status === 'satisfied').length;
  const selectedDecision = project.decisions.at(-1);
  const styleLabel = project.demandWorkflow?.styleProfile?.primary?.label || project.designIntent?.style?.join(' · ') || '视觉方向待确认';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; worker-src 'none'; frame-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light"><meta name="personal-agent-id" content="${escapeAttr(delivery.agent.id)}"><meta name="personal-agent-example-id" content="${escapeAttr(delivery.id)}"><meta name="personal-agent-delivery-version" content="${escapeAttr(String(delivery.delivery.version))}"><title>${escapeHtml(project.title)} · 装修项目设计册</title><style>${reportStyle}</style></head>
<body data-agent-id="${escapeAttr(delivery.agent.id)}" data-agent-example-id="${escapeAttr(delivery.id)}" data-delivery-version="${escapeAttr(String(delivery.delivery.version))}" data-engine="pascal-v2" data-layout-profile="renovation-booklet" data-primary-delivery="true"><main class="book-shell">
<header class="book-cover" id="cover"><div><span class="book-mark"><i>PA</i> Personal Agent · Renovation Booklet</span><h1>${displayTitle}<br>前置设计交付</h1><p class="lead">以项目过程和确认记录为主线，把户型证据、空间策略、平面方案、效果图、材料与预算范围及专业边界整理成一份可持续修订的设计册。</p><div class="book-cover-meta"><span>Revision ${project.revision}</span><span>${escapeHtml(subtitle)}</span><span>用户视觉验收待确认</span></div></div><aside class="cover-side"><small>Delivery overview</small><strong>主体设计册 Page</strong><dl><div><dt>当前方案</dt><dd>${escapeHtml(concept.name)}</dd></div><div><dt>项目成员</dt><dd>${householdCount} 人</dd></div><div><dt>需求覆盖</dt><dd>${verifiedRequirements} / ${project.brief.requirements.length}</dd></div><div><dt>效果图</dt><dd>${conceptRenders.length} 张</dd></div><div><dt>自动阻断</dt><dd>${audit.blockingCount}</dd></div></dl></aside></header>
<nav class="book-nav" aria-label="设计册目录"><a href="#summary">项目摘要</a><a href="#analysis">户型分析</a><a href="#design">设计说明</a><a href="#plan">平面方案</a><a href="#renders">效果图</a><a href="#materials">材料预算</a><a href="#consistency">一致性</a><a href="#process">过程确认</a><a href="#boundaries">边界复尺</a></nav>
${bookSection('01', 'summary', '项目摘要与需求', '把生活方式、范围和优先级放在视觉表达之前。', `<div class="metric-grid"><article class="metric"><strong>${project.brief.requirements.length}</strong><span>条设计需求</span></article><article class="metric"><strong>${concept.levels.length}</strong><span>个楼层</span></article><article class="metric"><strong>${concept.levels.flatMap((level) => level.rooms).length}</strong><span>个空间</span></article><article class="metric"><strong>${audit.warningCount}</strong><span>条可见警告</span></article></div><div class="requirement-grid">${requirements}</div>`)}
${bookSection('02', 'analysis', '户型分析', '用户原图是唯一户型依据；标注图只表达本轮分析和调整建议。', `<div class="evidence-grid"><figure class="evidence-card"><img class="plan-source-image" src="media/source-plan${sourceExtension}" alt="${escapeAttr(planAssets.source.alt)}"><figcaption><b>原始户型依据</b><span>结构与尺寸仍须现场复核</span></figcaption></figure><figure class="evidence-card"><img class="plan-annotation-image" src="media/agent-annotation${annotationExtension}" alt="${escapeAttr(planAssets.annotation.alt)}"><figcaption><b>Agent 分析标注</b><span>拟调整、保留与待核验项</span></figcaption></figure></div>`)}
${bookSection('03', 'design', '完整设计说明', `当前视觉方向：${styleLabel}`, `<div class="design-grid"><article class="design-statement"><small>SELECTED CONCEPT</small><h3>${escapeHtml(concept.name)}</h3><p>${escapeHtml(concept.summary)}</p><ul class="plain-list">${concept.tradeoffs.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article><div><article class="report-card"><h3>关键决策</h3><p>${escapeHtml(selectedDecision?.summary || '当前方案尚未记录最终选择。')}</p>${selectedDecision?.rationale ? `<p>${escapeHtml(selectedDecision.rationale)}</p>` : ''}</article><a class="specialist-card" href="3d/index.html" target="_blank" rel="noreferrer" aria-label="在新的浏览器页面打开交互式 3D 设计"><span><small>PROFESSIONAL PAGE · 3D</small><strong>浏览器查看交互式 3D 设计</strong><p>楼层、3D/平面、标注与复位工具在独立 Page 中运行。</p></span><i>↗</i></a></div></div>`)}
${bookSection('04', 'plan', '平面设计方案', '模型派生平面用于核对空间关系，不替代现场测绘或施工图。', `<div class="plan-sheet">${fallbackSvg}</div>`)}
${bookSection('05', 'renders', '各空间效果图', '按照确认过的镜头脚本呈现；每张图都保留空间、目的与概念边界。', `<div class="render-grid">${renderCards}</div>`)}
${bookSection('06', 'materials', '材料清单与预算范围', '材料信息用于设计和采购沟通；价格、批次、性能与供货在实施前重新核验。', `<div class="table-wrap"><table><thead><tr><th>材料</th><th>类别</th><th>粗糙度</th><th>湿区适用</th><th>维护/采购核验</th></tr></thead><tbody>${materialRows}</tbody></table></div><div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>预算类别</th><th>范围</th><th>置信度</th><th>金额</th></tr></thead><tbody>${budgetRows}</tbody></table></div>`)}
${bookSection('07', 'consistency', '设计一致性检查', '逐项核对需求、场景节点、材质、效果图和验证状态，避免漂亮图片与真实方案断链。', `<div class="table-wrap"><table><thead><tr><th>需求</th><th>状态</th><th>场景节点</th><th>关联材质</th><th>效果图覆盖</th><th>验证方式</th></tr></thead><tbody>${consistencyRows}</tbody></table></div>`)}
${bookSection('08', 'process', '设计过程与确认点', '记录每次阶段推进、项目 revision 和用户确认范围；修改会回到最早受影响阶段。', `<div class="process-list">${process}</div>`)}
${bookSection('09', 'boundaries', '排除项、落地顺序与复尺清单', '本 Agent 的终点是前置设计稿，不以概念页面冒充施工图、报价或专业签章。', `<div class="boundary-grid">${boundaries || '<p class="empty-state">当前没有登记未决边界。</p>'}</div><div class="handoff-grid" style="margin-top:18px"><article class="report-card"><h3>不在本次交付范围</h3><p>施工图、结构结论、机电深化、消防审查、合同、采购付款和现场执行。</p></article><article class="report-card"><h3>建议落地顺序</h3><p>现场复尺与专业核验 → 深化设计与工程协调 → 报价和样板确认 → 施工与分阶段验收。</p></article></div>`)}
<footer class="book-footer"><p><strong>交付说明：</strong>主体设计册与独立 3D Page 来自同一项目 revision、场景和 manifest。视觉与内容验收归用户；结构、机电、防水、消防和现场尺寸由相应专业人员负责。</p><strong>Revision ${project.revision} · ${escapeHtml(audit.ruleSet)}</strong></footer>
</main></body></html>`;
}

function bookSection(number, id, title, detail, content) {
  return `<section class="book-section" id="${id}"><header class="section-head"><span class="section-number">${number}</span><div><small class="section-kicker">Renovation delivery</small><h2>${escapeHtml(title)}</h2></div><p>${escapeHtml(detail)}</p></header>${content}</section>`;
}

function renderBookletProcess(project) {
  const confirmations = new Map((project.demandWorkflow?.confirmations || []).map((entry) => [entry.confirmationId, entry]));
  const transitions = project.demandWorkflow?.transitions || [];
  if (!transitions.length) return '<p class="empty-state">当前项目文件尚未附带阶段确认快照；最终交付前必须从工作流状态补齐。</p>';
  return transitions.map((entry, index) => {
    const confirmation = confirmations.get(entry.confirmationId);
    const scope = confirmation?.scope?.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>确认范围未记录</li>';
    return `<article class="process-item"><header><strong>${String(index + 1).padStart(2, '0')} · ${escapeHtml(entry.summary || `${entry.from} → ${entry.to}`)}</strong><small>Revision ${entry.projectRevision}</small></header><p>${escapeHtml(entry.from)} → ${escapeHtml(entry.to)}</p><ul>${scope}</ul></article>`;
  }).join('');
}

function renderConsistencyMatrix(project, concept, conceptRenders) {
  const materials = new Map((project.designIntent?.materials || []).map((entry) => [entry.materialId, entry.name]));
  const nodes = concept.levels.flatMap((level) => [...level.rooms, ...level.items]);
  return project.brief.requirements.map((requirement) => {
    const linkedNodes = nodes.filter((node) => node.requirementIds?.includes(requirement.requirementId));
    const linkedMaterials = [...new Set(linkedNodes.map((node) => materials.get(node.materialId)).filter(Boolean))];
    const linkedRenders = conceptRenders.filter((render) => render.shot.requirementIds?.includes(requirement.requirementId));
    return `<tr><td>${escapeHtml(requirement.summary)}</td><td class="${requirement.status === 'satisfied' ? 'status-ok' : 'status-pending'}">${escapeHtml(requirement.status)}</td><td>${linkedNodes.length}</td><td>${escapeHtml(linkedMaterials.join('、') || '不适用/待补齐')}</td><td>${escapeHtml(linkedRenders.map((render) => render.shot.space).join('、') || '未纳入当前效果图组')}</td><td>${escapeHtml(`${requirement.verification?.method || '待定义'} · ${requirement.verification?.result || '待验证'}`)}</td></tr>`;
  }).join('');
}

function writePageMediaAssets(staging, { planAssets, conceptRenders }) {
  const mediaRoot = path.join(staging, 'media');
  fs.mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
  const assets = [
    ['source-plan', planAssets.source],
    ['agent-annotation', planAssets.annotation],
    ...conceptRenders.map((render) => [render.record.renderId, render]),
  ];
  return assets.map(([name, asset]) => {
    const extension = path.extname(asset.evidence.relativePath).toLowerCase();
    const relativePath = path.posix.join('media', `${name}${extension}`);
    const target = path.join(staging, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(asset.filePath, target);
    return relativePath;
  });
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

export function verifyProfessionalPageHtml({ html, threeDHtml }, delivery) {
  const requiredMain = [
    `name="personal-agent-id" content="${delivery.agent.id}"`,
    `name="personal-agent-example-id" content="${delivery.id}"`,
    `data-agent-id="${delivery.agent.id}"`,
    `data-agent-example-id="${delivery.id}"`,
    'data-delivery-version="3"',
    'data-layout-profile="renovation-booklet"',
    'data-primary-delivery="true"',
    'href="3d/index.html"',
    'target="_blank"',
    '项目摘要与需求',
    '户型分析',
    '完整设计说明',
    '平面设计方案',
    '各空间效果图',
    '材料清单与预算范围',
    '设计一致性检查',
    '设计过程与确认点',
    '排除项、落地顺序与复尺清单',
    'plan-source-image',
    'plan-annotation-image',
    "script-src 'none'",
  ];
  const requiredThreeD = [
    `name="personal-agent-id" content="${delivery.agent.id}"`,
    `name="personal-agent-example-id" content="${delivery.id}"`,
    `data-agent-id="${delivery.agent.id}"`,
    `data-agent-example-id="${delivery.id}"`,
    'data-delivery-version="3"',
    'data-engine="pascal-v2"',
    'data-layout-profile="su-design-classic"',
    'data-specialist-page="three-d"',
    'data-mobile-layout',
    'forced-landscape',
    'virtual-landscape',
    'landscape-mapped',
    'pascal-layout-change',
    '--landscape-viewport-width',
    'id="pascal-scene"',
    'id="viewer-loading"',
    'id="model-derived-plan"',
    'data-level-mode="stacked"',
    'data-level-mode="exploded"',
    'data-level-mode="solo"',
    'data-label-mode="visible"',
    'data-label-layout',
    "connect-src 'none'",
    'data-viewer-status',
    '正在装配模型',
  ];
  const missingMain = requiredMain.filter((marker) => !html.includes(marker));
  const missingThreeD = requiredThreeD.filter((marker) => !threeDHtml.includes(marker));
  if (missingMain.length || missingThreeD.length) throw new Error(`generated Page does not match ${delivery.id} v3: main[${missingMain.join(', ')}] 3d[${missingThreeD.join(', ')}]`);
  if (/<iframe\b/i.test(html)) throw new Error('primary renovation booklet must link specialist Pages instead of embedding them');
  for (const page of [html, threeDHtml]) {
    if (/<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i.test(page)) throw new Error('generated Page contains a remote executable asset');
    if (/editor\.pascal\.app|cdn\.jsdelivr\.net|127\.0\.0\.1|localhost|file:\/\//i.test(page)) throw new Error('generated Page contains a forbidden remote or local runtime reference');
    if (/sourceMappingURL|\/Users\/|\/home\/[a-z0-9._-]+\/|[A-Z]:\\Users\\/i.test(page)) throw new Error('generated Page contains a development path or source-map reference');
  }
  const embeddedPayload = threeDHtml.match(/<script id="pascal-scene" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '';
  if (/"(?:spaceId|ownerId|managedObjectId|projectId|sourceId|requirementIds|decisionIds|evidenceIds)"\s*:/i.test(embeddedPayload)) {
    throw new Error('generated Page contains private project identity or trace fields');
  }
  return {
    ok: true,
    agentId: delivery.agent.id,
    agentVersion: delivery.agent.version,
    exampleId: delivery.id,
    deliveryVersion: delivery.delivery.version,
    engine: delivery.delivery.engine,
    primaryLayout: delivery.delivery.layoutProfile,
    specialistPages: delivery.delivery.specialistPages,
    visualAcceptance: 'user',
  };
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

function loadProjectConceptRenders(projectDir, project) {
  const byEvidenceId = new Map(project.evidence.map((entry) => [entry.evidenceId, entry]));
  const selected = (project.demandWorkflow?.renderSet || [])
    .filter((entry) => entry.status === 'selected')
    .sort((a, b) => a.sequence - b.sequence);
  const records = selected.length
    ? selected
    : project.evidence.filter((entry) => entry.classification === 'concept-render').map((entry, index) => ({
      renderId: `render-${index + 1}`,
      evidenceId: entry.evidenceId,
      sequence: index + 1,
      shotId: null,
      status: 'selected',
    }));
  const shots = new Map((project.demandWorkflow?.renderStoryboard || []).map((entry) => [entry.shotId, entry]));
  return records.map((record) => {
    const evidence = byEvidenceId.get(record.evidenceId);
    if (!evidence || evidence.classification !== 'concept-render'
      || !evidence.relativePath
      || !['redacted', 'not-required'].includes(evidence.redactionStatus)
      || !evidence.allowedUses?.includes('delivery')) {
      throw new Error(`selected render evidence does not resolve: ${record.evidenceId}`);
    }
    if (evidence.generation?.generator !== 'imagegen'
      || !/^[a-f0-9]{64}$/.test(evidence.generation?.referenceImageSha256 || '')
      || !/^[a-f0-9]{64}$/.test(evidence.generation?.promptSha256 || '')) {
      throw new Error('concept render needs governed imagegen generation provenance');
    }
    const shot = shots.get(record.shotId) || { space: `空间视角 ${record.sequence}`, purpose: evidence.observations?.[0] || '' };
    const asset = loadProjectPlanAsset(projectDir, evidence, `${shot.space}概念效果图`);
    return { ...asset, dataUrl: `media/${record.renderId}${path.extname(evidence.relativePath).toLowerCase()}`, record, shot };
  });
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
  const asset = loadPlanImageAsset(target, { alt });
  if (asset.sha256 !== evidence.contentHash) throw new Error(`Page evidence hash does not match governed evidence: ${evidence.classification}`);
  return { ...asset, evidence, filePath: realTarget };
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

export function mobileLandscapeController() {
  return `(function(){const body=document.body;const root=document.documentElement;const ua=navigator.userAgent||'';const query=typeof location==='object'?location.search||'':'';const previewMobile=/(?:^|[?&])agent-output=1(?:&|$)/.test(query)&&/(?:^|[?&])device=mobile(?:&|$)/.test(query);const mobileUa=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);const touchScreen=Number(navigator.maxTouchPoints||0)>0&&Math.min(screen.width||innerWidth,screen.height||innerHeight)<=1024;const mobile=previewMobile||Boolean(navigator.userAgentData?.mobile)||mobileUa||touchScreen;if(!body.dataset.labels)body.dataset.labels=mobile?'hidden':'visible';function apply(){const portrait=innerHeight>innerWidth;body.dataset.mobileLayout=mobile?(portrait?'forced-landscape':'landscape'):'desktop';root.style.setProperty('--portrait-viewport-width',innerWidth+'px');root.style.setProperty('--landscape-viewport-width',(portrait?innerHeight:innerWidth)+'px');root.style.setProperty('--landscape-viewport-height',(portrait?innerWidth:innerHeight)+'px');window.dispatchEvent(new CustomEvent('pascal-layout-change'));window.dispatchEvent(new CustomEvent('pascal-viewer-visibility'))}apply();window.addEventListener('resize',apply);window.visualViewport?.addEventListener('resize',apply)})();`;
}

function viewerPageController() {
  return `(function(){const one=(s,r=document)=>r.querySelector(s),all=(s,r=document)=>[...r.querySelectorAll(s)];function active(group,target){all(group).forEach(b=>{const on=b===target;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}function call(name,value){const api=window.PersonalAgentPascalViewer;return Boolean(api&&typeof api[name]==='function'&&api[name](value))}all('[data-level-mode]').forEach(b=>b.addEventListener('click',()=>{if(call('setLevelMode',b.dataset.levelMode))active('[data-level-mode]',b)}));all('[data-camera-mode]').forEach(b=>b.addEventListener('click',()=>{if(call('setCameraMode',b.dataset.cameraMode))active('[data-camera-mode]',b)}));const labelButton=one('[data-label-mode]');if(labelButton){const hidden=document.body.dataset.labels==='hidden';labelButton.classList.toggle('active',!hidden);labelButton.setAttribute('aria-pressed',String(!hidden));labelButton.setAttribute('aria-label',hidden?'显示细节标注':'隐藏细节标注')}all('[data-label-mode]').forEach(b=>b.addEventListener('click',()=>{const hidden=document.body.dataset.labels==='hidden';document.body.dataset.labels=hidden?'visible':'hidden';b.classList.toggle('active',hidden);b.setAttribute('aria-pressed',String(hidden));b.setAttribute('aria-label',hidden?'隐藏细节标注':'显示细节标注')}));all('[data-level-id]').forEach(b=>b.addEventListener('click',()=>{call('setLevel',b.dataset.levelId);active('[data-level-id]',b)}));all('[data-reset-view]').forEach(b=>b.addEventListener('click',()=>{call('resetCamera');const camera=one('[data-camera-mode="perspective"]');if(camera)active('[data-camera-mode]',camera)}));document.addEventListener('keydown',event=>{if(event.key==='Escape')call('highlight',[])});})();`;
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
