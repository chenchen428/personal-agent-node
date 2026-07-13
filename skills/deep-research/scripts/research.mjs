import fs from 'node:fs';
import path from 'node:path';
import {
  asArray,
  emit,
  readJson,
  relativeToRoot,
  requireOption,
  resolveFromCwd,
  slugify,
  timestamp,
  writeJson,
  writeText,
} from './runtime.mjs';

function projectPaths(value) {
  const requested = resolveFromCwd(value || '.');
  const projectFile = requested.endsWith('.json') ? requested : path.join(requested, 'project.json');
  return { projectFile, projectDir: path.dirname(projectFile) };
}

function normalizeDefinitions(values, fallback) {
  return (values.length ? values : fallback).map((value) => {
    const [idPart, ...labelParts] = value.split(':');
    const id = slugify(idPart).replaceAll('-', '_');
    return {
      id,
      label: labelParts.join(':').trim() || idPart.trim(),
      description: '',
      required: true,
    };
  });
}

function initResearch(options) {
  const topic = requireOption(options, 'topic');
  const outputDir = resolveFromCwd(options.out || slugify(topic));
  const projectFile = path.join(outputDir, 'project.json');
  const itemNames = asArray(options.items);
  const fields = normalizeDefinitions(asArray(options.fields), ['summary:Summary', 'recommendation:Recommendation']);
  const project = {
    schemaVersion: 1,
    topic,
    slug: slugify(options.slug || topic),
    createdAt: timestamp(),
    language: String(options.lang || 'zh-CN'),
    questions: asArray(options.questions),
    items: itemNames.map((name) => ({ id: slugify(name), name, context: '' })),
    fields,
    execution: {
      batchSize: Number(options['batch-size'] || 4),
      itemsPerAgent: Number(options['items-per-agent'] || 1),
      resultsDir: 'results',
    },
  };
  fs.mkdirSync(path.join(outputDir, 'results'), { recursive: true });
  writeJson(projectFile, project, { force: Boolean(options.force) });
  return { project: relativeToRoot(projectFile), items: project.items.length, fields: project.fields.length };
}

function validateResult(project, item, result, resultFile) {
  const errors = [];
  const warnings = [];
  if (result.itemId !== item.id) errors.push(`itemId must equal ${item.id}`);
  if (!['complete', 'partial'].includes(result.status)) errors.push('status must be complete or partial');
  if (!String(result.summary || '').trim()) errors.push('summary is required');
  if (!result.fields || typeof result.fields !== 'object' || Array.isArray(result.fields)) errors.push('fields must be an object');
  if (!Array.isArray(result.sources) || result.sources.length === 0) errors.push('at least one source is required');

  const sourceIds = new Set();
  for (const [index, source] of (result.sources || []).entries()) {
    if (!source?.id) errors.push(`sources[${index}].id is required`);
    else if (sourceIds.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
    else sourceIds.add(source.id);
    if (!source?.title) errors.push(`sources[${index}].title is required`);
    try {
      const url = new URL(source?.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      errors.push(`sources[${index}].url must be an HTTP(S) URL`);
    }
  }

  for (const field of project.fields) {
    const value = result.fields?.[field.id];
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`missing required field: ${field.id}`);
      continue;
    }
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'value')) {
      errors.push(`field ${field.id} must be {value, confidence, sourceIds}`);
      continue;
    }
    if (!['high', 'medium', 'low'].includes(value.confidence)) errors.push(`field ${field.id} has invalid confidence`);
    if (!Array.isArray(value.sourceIds) || value.sourceIds.length === 0) errors.push(`field ${field.id} needs sourceIds`);
    for (const sourceId of value.sourceIds || []) {
      if (!sourceIds.has(sourceId)) errors.push(`field ${field.id} references unknown source ${sourceId}`);
    }
  }

  if (!Array.isArray(result.gaps)) warnings.push('gaps should be an array');
  if (result.status === 'partial' && !(result.gaps || []).length) warnings.push('partial result should explain gaps');
  return { itemId: item.id, file: relativeToRoot(resultFile), errors, warnings };
}

export function validateResearchProject(projectValue, { allowIncomplete = false } = {}) {
  const { projectFile, projectDir } = projectPaths(projectValue);
  if (!fs.existsSync(projectFile)) throw new Error(`Research project not found: ${relativeToRoot(projectFile)}`);
  const project = readJson(projectFile);
  const resultsDir = path.resolve(projectDir, project.execution?.resultsDir || 'results');
  if (!(resultsDir === projectDir || resultsDir.startsWith(`${projectDir}${path.sep}`))) {
    throw new Error('Research resultsDir must stay inside the project directory');
  }
  if (!Array.isArray(project.items) || !Array.isArray(project.fields)) {
    throw new Error('Research project needs items and fields arrays');
  }
  const itemIds = new Set();
  for (const item of project.items) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id || '')) throw new Error(`Invalid research item id: ${item.id || '<missing>'}`);
    if (itemIds.has(item.id)) throw new Error(`Duplicate research item id: ${item.id}`);
    itemIds.add(item.id);
  }
  const fieldIds = new Set();
  for (const field of project.fields) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(field.id || '')) throw new Error(`Invalid research field id: ${field.id || '<missing>'}`);
    if (fieldIds.has(field.id)) throw new Error(`Duplicate research field id: ${field.id}`);
    fieldIds.add(field.id);
  }
  const checks = [];
  for (const item of project.items || []) {
    const resultFile = path.join(resultsDir, `${item.id}.json`);
    if (!fs.existsSync(resultFile)) {
      checks.push({ itemId: item.id, file: relativeToRoot(resultFile), errors: allowIncomplete ? [] : ['result file is missing'], warnings: allowIncomplete ? ['result file is missing'] : [] });
      continue;
    }
    checks.push(validateResult(project, item, readJson(resultFile), resultFile));
  }
  const errors = checks.flatMap((check) => check.errors.map((message) => `${check.itemId}: ${message}`));
  const warnings = checks.flatMap((check) => check.warnings.map((message) => `${check.itemId}: ${message}`));
  return { project, projectFile, projectDir, resultsDir, checks, errors, warnings };
}

function validateResearch(options) {
  const validation = validateResearchProject(options.project, { allowIncomplete: Boolean(options['allow-incomplete']) });
  const result = {
    project: relativeToRoot(validation.projectFile),
    items: validation.checks.length,
    passed: validation.checks.filter((check) => check.errors.length === 0).length,
    errors: validation.errors,
    warnings: validation.warnings,
  };
  if (validation.errors.length) throw new Error(`Research validation failed:\n- ${validation.errors.join('\n- ')}`);
  return result;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, child]) => `${key}: ${formatValue(child)}`).join('; ');
  return String(value ?? '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderValueHtml(value) {
  if (Array.isArray(value)) {
    return `<ul>${value.map((entry) => `<li>${renderValueHtml(entry)}</li>`).join('')}</ul>`;
  }
  if (value && typeof value === 'object') {
    return `<dl class="value-list">${Object.entries(value).map(([key, child]) => `<div><dt>${escapeHtml(key)}</dt><dd>${renderValueHtml(child)}</dd></div>`).join('')}</dl>`;
  }
  return `<p>${escapeHtml(value)}</p>`;
}

function renderResearchHtml(project, results) {
  const generatedAt = new Date().toISOString();
  const sourceCount = results.reduce((total, result) => total + (result.sources?.length || 0), 0);
  const gapCount = results.reduce((total, result) => total + (result.gaps?.length || 0), 0);
  const questions = (project.questions || []).filter(Boolean);
  const itemSections = project.items.map((item, index) => {
    const result = results[index];
    const fields = project.fields.map((field) => {
      const entry = result.fields[field.id];
      if (!entry) return '';
      const sources = entry.sourceIds.map((sourceId) => {
        const source = result.sources.find((candidate) => candidate.id === sourceId);
        return source ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.id)}</a>` : `<span>${escapeHtml(sourceId)}</span>`;
      }).join('');
      return `<section class="field-block" id="${escapeHtml(item.id)}-${escapeHtml(field.id)}">
        <div class="field-heading"><h3>${escapeHtml(field.label)}</h3><span class="confidence ${escapeHtml(entry.confidence)}">${escapeHtml(entry.confidence)}</span></div>
        ${renderValueHtml(entry.value)}
        <div class="field-evidence"><span>证据</span>${sources}</div>
      </section>`;
    }).join('');
    const gaps = result.gaps?.length
      ? `<aside class="callout warning"><strong>仍待确认</strong><ul>${result.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></aside>`
      : `<aside class="callout verified"><strong>证据覆盖完整</strong><p>当前范围内未记录未解决缺口。</p></aside>`;
    const sources = result.sources.map((source) => `<li id="source-${escapeHtml(item.id)}-${escapeHtml(source.id)}"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml([source.publisher, source.publishedAt, source.accessedAt ? `访问 ${source.accessedAt}` : ''].filter(Boolean).join(' · '))}</span></li>`).join('');
    return `<section class="report-section" id="${escapeHtml(item.id)}" data-section-number="${index + 2}">
      <header class="section-heading"><span>${String(index + 2).padStart(2, '0')}</span><div><p>${escapeHtml(result.status === 'complete' ? '研究项 · 已完成' : '研究项 · 部分完成')}</p><h2>${escapeHtml(item.name)}</h2></div></header>
      <p class="section-summary">${escapeHtml(result.summary)}</p>
      ${fields}
      ${gaps}
      <section class="sources"><h3>来源</h3><ol>${sources}</ol></section>
    </section>`;
  }).join('');
  const overviewRows = project.items.map((item, index) => `<tr><td><a href="#${escapeHtml(item.id)}">${escapeHtml(item.name)}</a></td><td><span class="status ${results[index].status === 'complete' ? 'complete' : 'partial'}">${escapeHtml(results[index].status)}</span></td><td>${escapeHtml(results[index].summary)}</td></tr>`).join('');
  const toc = [
    `<a href="#overview"><span>01</span>研究概览</a>`,
    ...project.items.map((item, index) => `<a href="#${escapeHtml(item.id)}"><span>${String(index + 2).padStart(2, '0')}</span>${escapeHtml(item.name)}</a>`),
    `<a href="#limitations"><span>${String(project.items.length + 2).padStart(2, '0')}</span>限制与缺口</a>`,
  ].join('');
  const limitations = gapCount
    ? results.flatMap((result, index) => (result.gaps || []).map((gap) => `<li><strong>${escapeHtml(project.items[index].name)}：</strong>${escapeHtml(gap)}</li>`)).join('')
    : '<li>当前结构化结果未记录未解决缺口；结论仍受研究范围与资料时效约束。</li>';
  const language = project.language || 'zh-CN';
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(project.topic)}</title>
  <style>
    :root{--ink:#192033;--paper:#f7f4ed;--surface:#fff;--navy:#1e3557;--gold:#b28b35;--teal:#28706f;--muted:#6d7480;--line:#ddd7ca;--soft:#efebe2;--ok:#18704b;--warn:#9b6511;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--paper)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.72}a{color:var(--navy);text-decoration-color:rgba(30,53,87,.28);text-underline-offset:3px}a:hover{color:var(--teal);text-decoration-color:currentColor}.progress{position:fixed;z-index:50;top:0;left:0;height:3px;width:0;background:var(--gold)}.hero{position:relative;overflow:hidden;background:#172b49;color:#fff;padding:5.5rem 1.5rem 6.25rem}.hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:40px 40px}.hero-inner{position:relative;width:min(100%,58rem);margin:0 auto;text-align:center}.hero-kicker{display:inline-flex;align-items:center;gap:.5rem;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.35rem .8rem;color:#d4dbe6;font-size:.78rem}.hero-kicker i{width:.45rem;height:.45rem;border-radius:50%;background:#5fd2a1}.hero h1{max-width:52rem;margin:1.25rem auto .75rem;font-family:Georgia,"Songti SC",serif;font-size:clamp(2.35rem,7vw,4.7rem);line-height:1.12;letter-spacing:0;color:#fff}.hero .lede{max-width:46rem;margin:0 auto;color:#c8d0dc;font-family:Georgia,"Songti SC",serif;font-size:clamp(1rem,2.4vw,1.35rem);font-style:italic}.hero-meta{display:flex;justify-content:center;gap:.75rem 1.25rem;flex-wrap:wrap;margin-top:1.5rem;color:#9faec2;font-size:.78rem}.layout{width:min(100%,87rem);margin:0 auto;display:grid;grid-template-columns:15rem minmax(0,1fr);gap:3rem;padding:3rem 1.5rem 5rem}.toc{align-self:start;position:sticky;top:1.5rem;max-height:calc(100dvh - 3rem);overflow:auto}.toc h2{margin:0 0 .65rem;border-bottom:1px solid var(--line);padding:0 0 .55rem;color:var(--muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em}.toc nav{display:grid}.toc a{display:grid;grid-template-columns:1.65rem minmax(0,1fr);gap:.35rem;border-left:2px solid transparent;padding:.45rem .55rem;color:var(--muted);font-size:.78rem;line-height:1.35;text-decoration:none}.toc a span{color:var(--gold);font-variant-numeric:tabular-nums}.toc a:hover,.toc a.active{border-left-color:var(--gold);background:rgba(255,255,255,.55);color:var(--ink)}article{min-width:0;width:min(100%,62rem)}.report-section{scroll-margin-top:1.5rem;border-bottom:1px solid var(--line);padding:0 0 3.5rem;margin:0 0 3.5rem}.section-heading{display:flex;align-items:flex-start;gap:.85rem;margin-bottom:1rem}.section-heading>span{width:2rem;height:2rem;flex:0 0 2rem;border-radius:6px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:.72rem;font-weight:800}.section-heading div{min-width:0}.section-heading p{margin:0;color:var(--teal);font-size:.7rem;font-weight:750;text-transform:uppercase;letter-spacing:.07em}.section-heading h2{margin:.15rem 0 0;font-family:Georgia,"Songti SC",serif;color:var(--navy);font-size:clamp(1.7rem,4vw,2.45rem);line-height:1.22;letter-spacing:0}.section-summary{font-size:1.08rem;color:#394252}.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin:1.5rem 0}.kpi{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:1rem}.kpi strong{display:block;font-family:Georgia,serif;color:var(--teal);font-size:1.8rem;line-height:1}.kpi span{display:block;margin-top:.4rem;color:var(--muted);font-size:.78rem}.question-list{margin:1rem 0 1.5rem;padding-left:1.4rem}.question-list li::marker{color:var(--gold);font-weight:750}.table-wrap{overflow-x:auto;margin:1.4rem 0}table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:.86rem}th{background:var(--navy);color:#fff;text-align:left;padding:.7rem .85rem}td{border-bottom:1px solid var(--line);padding:.7rem .85rem;vertical-align:top}tr:last-child td{border-bottom:0}tr:nth-child(even) td{background:#fbfaf7}.status,.confidence{display:inline-flex;border-radius:999px;padding:.12rem .48rem;font-size:.68rem;font-weight:750;text-transform:uppercase}.status.complete,.confidence.high{background:#e1f3e9;color:var(--ok)}.status.partial,.confidence.medium{background:#f7edcf;color:var(--warn)}.confidence.low{background:#f6dfdc;color:#964537}.field-block{margin-top:1rem;border-top:1px solid var(--line);padding:1.25rem 0 .3rem}.field-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.field-heading h3,.sources h3{margin:0;font-family:Georgia,"Songti SC",serif;color:var(--navy);font-size:1.15rem;letter-spacing:0}.field-block p{margin:.55rem 0;color:#3d4552}.field-block ul,.value-list{margin:.6rem 0;padding-left:1.25rem}.value-list{display:grid;gap:.45rem;padding:0}.value-list>div{display:grid;grid-template-columns:minmax(8rem,.35fr) minmax(0,1fr);gap:.75rem;border-bottom:1px dashed var(--line);padding:.4rem 0}.value-list dt{font-weight:700}.value-list dd{min-width:0;margin:0}.value-list dd p{margin:0}.field-evidence{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-top:.75rem}.field-evidence>span{color:var(--muted);font-size:.7rem}.field-evidence a,.field-evidence span:not(:first-child){border:1px solid var(--line);border-radius:999px;padding:.08rem .42rem;background:var(--surface);font-size:.68rem;text-decoration:none}.callout{margin:1.4rem 0;border-left:4px solid;padding:.85rem 1rem;border-radius:0 8px 8px 0}.callout strong{font-size:.82rem}.callout p,.callout ul{margin:.25rem 0 0;font-size:.86rem}.callout.warning{border-color:#d99b22;background:#fff4d9}.callout.verified{border-color:#2b9b70;background:#eaf8f1}.sources{margin-top:1.5rem}.sources ol{display:grid;gap:.55rem;padding-left:1.2rem}.sources li{padding-left:.25rem}.sources li::marker{color:var(--gold);font-weight:750}.sources li a{font-weight:650}.sources li span{display:block;color:var(--muted);font-size:.73rem}.limitations{border-left:4px solid var(--gold);background:#fff9e9;padding:1rem 1.15rem}.footer{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;color:var(--muted);font-size:.72rem}.print-note{display:none}@media(max-width:960px){.layout{grid-template-columns:1fr}.toc{display:none}article{margin:0 auto}.hero{padding-top:4rem}}@media(max-width:640px){.hero{padding:3.5rem 1rem 4.25rem}.layout{padding:2rem 1rem 3rem}.kpis{grid-template-columns:1fr}.value-list>div{grid-template-columns:1fr;gap:.1rem}.report-section{margin-bottom:2.5rem;padding-bottom:2.5rem}.hero-meta{display:grid;gap:.25rem}}@media print{.progress,.toc{display:none}.hero{padding:2rem;background:#172b49!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.layout{display:block;padding:2rem 0}.report-section{break-inside:auto}.field-block,.callout,table{break-inside:avoid}.print-note{display:block}}
  </style>
</head>
<body>
  <div class="progress" data-progress></div>
  <header class="hero"><div class="hero-inner"><div class="hero-kicker"><i></i>Deep Research · 已验证结构化结果</div><h1>${escapeHtml(project.topic)}</h1><p class="lede">${escapeHtml(questions[0] || '用可追溯证据回答问题，并明确结论的适用边界。')}</p><div class="hero-meta"><span>${escapeHtml(project.createdAt?.slice(0, 10) || generatedAt.slice(0, 10))}</span><span>${project.items.length} 个研究对象</span><span>${sourceCount} 个来源</span><span>${escapeHtml(language)}</span></div></div></header>
  <main class="layout"><aside class="toc"><h2>目录导航</h2><nav>${toc}</nav></aside><article>
    <section class="report-section" id="overview"><header class="section-heading"><span>01</span><div><p>Research brief</p><h2>研究概览</h2></div></header>
      <div class="kpis"><div class="kpi"><strong>${project.items.length}</strong><span>研究对象</span></div><div class="kpi"><strong>${project.fields.length}</strong><span>比较维度</span></div><div class="kpi"><strong>${sourceCount}</strong><span>证据来源</span></div></div>
      ${questions.length ? `<h3>核心问题</h3><ol class="question-list">${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>` : ''}
      <div class="table-wrap"><table><thead><tr><th>研究对象</th><th>状态</th><th>核心结论</th></tr></thead><tbody>${overviewRows}</tbody></table></div>
    </section>
    ${itemSections}
    <section class="report-section" id="limitations"><header class="section-heading"><span>${String(project.items.length + 2).padStart(2, '0')}</span><div><p>Research boundaries</p><h2>限制与缺口</h2></div></header><div class="limitations"><ul>${limitations}</ul></div></section>
    <footer class="footer"><span>Deep Research · evidence-backed report</span><span>Generated ${escapeHtml(generatedAt.slice(0, 10))}</span></footer>
  </article></main>
  <script>const bar=document.querySelector('[data-progress]');const links=[...document.querySelectorAll('.toc a')];const sections=links.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);function sync(){const root=document.documentElement;const max=root.scrollHeight-root.clientHeight;bar.style.width=(max?root.scrollTop/max*100:0)+'%';let active=sections[0];for(const section of sections){if(section.getBoundingClientRect().top<=120)active=section}links.forEach(link=>link.classList.toggle('active',active&&link.getAttribute('href')==='#'+active.id))}addEventListener('scroll',sync,{passive:true});sync();</script>
</body>
</html>`;
}

function reportResearch(options) {
  const validation = validateResearchProject(options.project);
  if (validation.errors.length) throw new Error(`Research validation failed:\n- ${validation.errors.join('\n- ')}`);
  const { project, projectDir, resultsDir } = validation;
  const results = project.items.map((item) => readJson(path.join(resultsDir, `${item.id}.json`)));
  const lines = [
    `# ${project.topic}`,
    '',
    `> Generated from ${results.length} validated research result(s).`,
    '',
    '## Overview',
    '',
    '| Item | Status | Summary |',
    '|---|---|---|',
    ...project.items.map((item, index) => `| [${item.name}](#${item.id}) | ${results[index].status} | ${String(results[index].summary).replaceAll('|', '\\|')} |`),
    '',
  ];

  for (const [index, item] of project.items.entries()) {
    const result = results[index];
    lines.push(`## ${item.name}`, '', result.summary, '');
    for (const field of project.fields) {
      const entry = result.fields[field.id];
      if (!entry) continue;
      lines.push(`### ${field.label}`, '', formatValue(entry.value), '', `Confidence: ${entry.confidence}. Sources: ${entry.sourceIds.map((id) => `\`${id}\``).join(', ')}.`, '');
    }
    if (result.gaps?.length) lines.push('### Gaps', '', ...result.gaps.map((gap) => `- ${gap}`), '');
    lines.push('### Sources', '', ...result.sources.map((source) => `- \`${source.id}\` [${source.title}](${source.url})${source.publisher ? `, ${source.publisher}` : ''}`), '');
  }

  const requestedOutput = options.out || path.join(projectDir, 'report.html');
  const outputFile = resolveFromCwd(requestedOutput);
  const format = String(options.format || (outputFile.endsWith('.md') ? 'markdown' : 'html')).toLowerCase();
  if (!['html', 'markdown', 'md'].includes(format)) throw new Error('report format must be html or markdown');
  const content = format === 'html' ? renderResearchHtml(project, results) : `${lines.join('\n').trim()}\n`;
  writeText(outputFile, content, { force: Boolean(options.force) });
  return { report: relativeToRoot(outputFile), items: results.length, warnings: validation.warnings };
}

export function runResearch(action, argv) {
  const { options } = argv;
  let result;
  if (action === 'init') result = initResearch(options);
  else if (action === 'validate') result = validateResearch(options);
  else if (action === 'report') result = reportResearch(options);
  else throw new Error('Usage: skill-tree research <init|validate|report> [options]');
  emit(result, options);
}
