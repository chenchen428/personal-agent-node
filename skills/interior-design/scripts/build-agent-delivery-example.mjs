#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProfessionalPage, renderProjectCoverSvg } from './generate-page-v2.mjs';
import { advanceProjectDemandWorkflow } from './demand-workflow-project.mjs';
import { compileProjectScene } from './scene-v2.mjs';
import {
  canonicalJson,
  initializeProject,
  readProject,
  selectedConcept,
  sha256,
  writeProjectRevision,
} from './project-v2.mjs';
import { loadInteriorDeliveryContract } from './page-assets.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(skillRoot, '..', '..');
const exampleRoot = path.join(skillRoot, 'examples', 'professional-agent-example');
const targetRoot = path.join(repositoryRoot, 'core', 'app', 'public', 'assets', 'agents', 'interior-designer', 'featured');
const fixedTime = '2026-07-27T00:00:00.000Z';
const generatedImageRoot = path.join('evidence', 'renders');
const DELIVERY_QUALITY_FLOOR = Object.freeze({
  rooms: 12,
  furniture: 30,
  openings: 14,
  doors: 8,
  windows: 6,
  walls: 20,
  slabs: 1,
  ceilings: 1,
});

export async function buildAgentDeliveryExample({ check = false } = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-interior-delivery-v3-'));
  try {
    const spaceRoot = path.join(temporaryRoot, 'space');
    const projectDir = path.join(spaceRoot, 'projects', 'home-renovation-agent-example');
    const output = path.join(projectDir, 'derived', 'page');
    const context = {
      spaceRoot,
      spaceId: 'built-in-agent-example',
      ownerId: 'owner:built-in-agent-example',
    };
    fs.mkdirSync(path.dirname(projectDir), { recursive: true, mode: 0o700 });
    const seedBytes = fs.readFileSync(path.join(exampleRoot, 'seed.json'));
    const sourceBytes = fs.readFileSync(path.join(exampleRoot, 'source-plan.png'));
    const annotationBytes = fs.readFileSync(path.join(exampleRoot, 'agent-annotation.png'));
    const seed = JSON.parse(seedBytes.toString('utf8'));
    const promptSetBytes = fs.readFileSync(path.join(exampleRoot, 'render-prompts.json'));
    const promptSet = JSON.parse(promptSetBytes.toString('utf8'));
    const workflowEventsBytes = fs.readFileSync(path.join(exampleRoot, 'workflow-events.json'));
    const workflowEvents = JSON.parse(workflowEventsBytes.toString('utf8'));
    const renderEvidenceById = new Map(seed.evidence.filter((entry) => entry.classification === 'concept-render').map((entry) => [entry.evidenceId, entry]));
    seed.evidence = seed.evidence.filter((entry) => entry.classification !== 'concept-render');
    seed.demandWorkflow = {
      ...seed.demandWorkflow,
      renderSet: [],
    };
    if (renderEvidenceById.size !== promptSet.renders.length) throw new Error('representative render evidence and prompt set differ');
    for (const render of promptSet.renders) {
      const evidence = [...renderEvidenceById.values()].find((entry) => entry.contentHash === render.imageSha256);
      const bytes = fs.readFileSync(path.join(exampleRoot, render.file));
      if (!evidence || sha256(bytes) !== render.imageSha256 || evidence.generation?.promptSha256 !== render.promptSha256) {
        throw new Error(`representative render does not match governed prompt set: ${render.renderId}`);
      }
    }
    const initialized = initializeProject(projectDir, seed, context, { now: () => fixedTime });
    fs.copyFileSync(path.join(exampleRoot, 'source-plan.png'), path.join(projectDir, 'evidence', 'source-plan.png'));
    fs.copyFileSync(path.join(exampleRoot, 'agent-annotation.png'), path.join(projectDir, 'evidence', 'agent-annotation.png'));
    let workflowProject = initialized.project;
    for (const rawEvent of workflowEvents) {
      const event = structuredClone(rawEvent);
      if (event.targetStage === 'brief-frozen') {
        const imported = [];
        for (const render of event.patch.renderSet) {
          const source = renderEvidenceById.get(render.evidenceId);
          const relativePath = path.join(generatedImageRoot, `${render.renderId}.webp`).replaceAll('\\', '/');
          const target = path.join(projectDir, relativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
          await writeDeliveryRender(path.join(exampleRoot, promptSet.renders.find((entry) => entry.renderId === render.renderId).file), target);
          imported.push({ ...source, relativePath, contentHash: sha256(fs.readFileSync(target)) });
        }
        const current = readProject(projectDir, context).project;
        const importedProject = writeProjectRevision(projectDir, current, {
          ...structuredClone(current),
          baseRevision: current.revision,
          evidence: [...current.evidence, ...imported],
        }, { now: () => fixedTime });
        workflowProject = importedProject;
      }
      const result = advanceProjectDemandWorkflow(projectDir, context, event, {
        baseRevision: workflowProject.revision,
        now: () => fixedTime,
        allowLegacyRepresentative: true,
      });
      workflowProject = result.project;
    }
    const compiled = await compileProjectScene(projectDir, context, {
      baseRevision: workflowProject.revision,
      now: () => fixedTime,
    });
    const delivery = loadInteriorDeliveryContract(skillRoot);
    generateProfessionalPage({
      projectDir,
      context,
      output,
      skillRoot,
      delivery,
    });
    normalizeGeneratedHtml(path.join(output, 'index.html'));
    normalizeGeneratedHtml(path.join(output, '3d', 'index.html'));
    fs.writeFileSync(path.join(output, 'cover.svg'), renderProjectCoverSvg(selectedConcept(compiled.project)), { mode: 0o600 });
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.source = {
      kind: 'native-governed-pascal-v2-project',
      pipeline: [
        'project-v2-seed',
        'demand-workflow-v1',
        'style-calibration',
        'render-storyboard',
        'pascal-scene-compile',
        'professional-quality-audit',
        'page-v3-generate',
        'artifact-hash-verify',
      ],
      seedSha256: sha256(seedBytes),
      workflowEventsSha256: sha256(workflowEventsBytes),
      renderPromptSetSha256: sha256(promptSetBytes),
      evidenceSha256: sha256(sourceBytes),
      modelBasisSha256: compiled.scene.modelBasis.sha256,
      annotationSha256: sha256(annotationBytes),
      demandWorkflow: {
        version: compiled.project.demandWorkflow.version,
        stage: compiled.project.demandWorkflow.stage,
        transitionCount: compiled.project.demandWorkflow.transitions.length,
        confirmationCount: compiled.project.demandWorkflow.confirmations.length,
      },
      renderSet: promptSet.renders.map((render) => ({
        renderId: render.renderId,
        generator: promptSet.generator,
        sourceImageSha256: render.imageSha256,
        deliveryImageSha256: compiled.project.evidence.find((entry) => entry.evidenceId === `evidence-${render.renderId}`)?.contentHash,
        referenceSetSha256: promptSet.referenceSetSha256,
        promptSha256: render.promptSha256,
      })),
      projectSha256: sha256(canonicalJson(readProject(projectDir, context).project)),
      sceneSha256: compiled.scene.sceneHash,
      auditSha256: compiled.project.quality.sha256,
      renderProfile: 'professional-mesh-ink',
      layoutProfile: 'renovation-booklet',
      specialistPages: {
        threeD: { path: '3d/index.html', layoutProfile: 'su-design-classic', engine: 'pascal-v2' },
      },
      qualityFloor: DELIVERY_QUALITY_FLOOR,
    };
    manifest.files['index.html'] = fileRecord(path.join(output, 'index.html'));
    manifest.files['3d/index.html'] = fileRecord(path.join(output, '3d', 'index.html'));
    manifest.files['cover.svg'] = fileRecord(path.join(output, 'cover.svg'));
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const verification = verifyAgentDeliveryExample(output);
    if (check) {
      compareDirectories(output, targetRoot);
    } else {
      replaceDirectory(output, targetRoot);
      verifyAgentDeliveryExample(targetRoot);
    }
    return {
      ok: true,
      mode: check ? 'check' : 'write',
      target: path.relative(repositoryRoot, targetRoot),
      pageSha256: verification.manifest.files['index.html'].sha256,
      threeDPageSha256: verification.manifest.files['3d/index.html'].sha256,
      sceneSha256: compiled.scene.sceneHash,
      auditSha256: compiled.project.quality.sha256,
      files: verification.files,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function verifyAgentDeliveryExample(directory = targetRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.agent?.id !== 'interior-designer'
    || manifest.agent?.version !== 1
    || manifest.agent?.exampleId !== 'interior-c-layout-delivery'
    || manifest.delivery?.version !== 3
    || manifest.delivery?.engine !== 'pascal-v2'
    || manifest.source?.kind !== 'native-governed-pascal-v2-project') {
    throw new Error('representative interior-designer delivery manifest is not a native Pascal v2 artifact');
  }
  if ('templateId' in manifest || 'templateVersion' in manifest || 'artifactMarker' in manifest) {
    throw new Error('representative interior-designer delivery still carries retired template provenance');
  }
  if (!Array.isArray(manifest.source.pipeline)
    || manifest.source.pipeline.join('>') !== 'project-v2-seed>demand-workflow-v1>style-calibration>render-storyboard>pascal-scene-compile>professional-quality-audit>page-v3-generate>artifact-hash-verify') {
    throw new Error('representative interior-designer delivery pipeline is incomplete');
  }
  if (manifest.source.renderProfile !== 'professional-mesh-ink') {
    throw new Error('representative interior-designer delivery professional render profile is missing');
  }
  if (manifest.source.layoutProfile !== 'renovation-booklet'
    || manifest.source.specialistPages?.threeD?.path !== '3d/index.html'
    || manifest.source.specialistPages?.threeD?.layoutProfile !== 'su-design-classic') {
    throw new Error('representative interior-designer booklet or specialist 3D Page profile is missing');
  }
  const renders = manifest.source.renderSet;
  if (!Array.isArray(renders) || renders.length < 4 || renders.some((render) => render?.generator !== 'imagegen'
    || !/^[a-f0-9]{64}$/.test(render.sourceImageSha256 || '')
    || !/^[a-f0-9]{64}$/.test(render.deliveryImageSha256 || '')
    || !/^[a-f0-9]{64}$/.test(render.referenceSetSha256 || '')
    || !/^[a-f0-9]{64}$/.test(render.promptSha256 || ''))) {
    throw new Error('representative interior-designer delivery render-set provenance is missing');
  }
  if (manifest.source.demandWorkflow?.stage !== 'delivered'
    || manifest.source.demandWorkflow?.transitionCount !== 7
    || manifest.source.demandWorkflow?.confirmationCount !== 7) throw new Error('representative demand workflow is incomplete');
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const target = path.join(directory, name);
    if (!fs.existsSync(target)) throw new Error(`representative interior-designer delivery is missing ${name}`);
    const actual = fileRecord(target);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`representative interior-designer delivery hash mismatch: ${name}`);
    }
  }
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const threeDHtml = fs.readFileSync(path.join(directory, '3d', 'index.html'), 'utf8');
  if (!html.includes('data-layout-profile="renovation-booklet"')
    || !threeDHtml.includes('data-engine="pascal-v2"')
    || /data-engine="(?!pascal-v2)[^"]+"|<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\/|127\.0\.0\.1|localhost/i.test(`${html}\n${threeDHtml}`)) {
    throw new Error('representative interior-designer delivery is not a governed booklet plus Pascal v2 specialist Page');
  }
  for (const marker of [
    'data-primary-delivery="true"',
    'href="3d/index.html"',
    '项目摘要与需求',
    '户型分析',
    '完整设计说明',
    '平面设计方案',
    '各空间效果图',
    '材料清单与预算范围',
    '设计一致性检查',
    '设计过程与确认点',
    '排除项、落地顺序与复尺清单',
    '概念效果不替代施工图或材料实样',
  ]) {
    if (!html.includes(marker)) throw new Error(`representative interior-designer delivery is missing ${marker}`);
  }
  if (/<iframe\b/i.test(html)) throw new Error('representative booklet embeds a specialist Page instead of linking it');
  const expectedReferencedImages = [
    ...renders.map((render, index) => [[
      '公共区全景概念效果图',
      '客厅媒体墙概念效果图',
      '餐厨衔接概念效果图',
      '主卧氛围概念效果图',
    ][index], render.deliveryImageSha256]),
    ['用户上传并脱敏的原始户型图', manifest.files['media/source-plan.png']?.sha256],
    ['Agent 上传的户型分析标注图', manifest.files['media/agent-annotation.png']?.sha256],
  ];
  for (const [alt, expectedHash] of expectedReferencedImages) {
    if (referencedImageHash(html, alt, directory) !== expectedHash) throw new Error(`representative interior-designer delivery image reference hash mismatch: ${alt}`);
  }
  const scene = JSON.parse(fs.readFileSync(path.join(directory, 'scene.json'), 'utf8'));
  const nodes = Object.values(scene.scene?.nodes || {});
  const actual = {
    rooms: nodes.filter((node) => node.type === 'zone').length,
    furniture: Array.isArray(scene.furniture) ? scene.furniture.length : 0,
    openings: nodes.filter((node) => ['door', 'window'].includes(node.type)).length,
    doors: nodes.filter((node) => node.type === 'door').length,
    windows: nodes.filter((node) => node.type === 'window').length,
    walls: nodes.filter((node) => node.type === 'wall').length,
    slabs: nodes.filter((node) => node.type === 'slab').length,
    ceilings: nodes.filter((node) => node.type === 'ceiling').length,
  };
  const floor = manifest.source.qualityFloor || {};
  for (const [key, minimum] of Object.entries(DELIVERY_QUALITY_FLOOR)) {
    if (floor[key] !== minimum || actual[key] < minimum) {
      throw new Error(`representative interior-designer delivery quality floor failed: ${key} ${actual[key]} < ${minimum}`);
    }
  }
  const cover = fs.readFileSync(path.join(directory, 'cover.svg'), 'utf8');
  if (!cover.includes('模型派生轴测封面')
    || !cover.includes('data-cover-item=')
    || !threeDHtml.includes('pascal-room-label')
    || !threeDHtml.includes('pascal-highlight')
    || !threeDHtml.includes('personal-agent-architecture-envelope')
    || !threeDHtml.includes('pascal-room-surface')
    || !threeDHtml.includes('pascal-wall-cap')
    || !threeDHtml.includes('professional-mesh-ink')
    || !threeDHtml.includes('data-layout-profile="su-design-classic"')
    || !threeDHtml.includes('pascal-viewer-warmup')
    || !threeDHtml.includes('CameraControls')
    || !threeDHtml.includes('setLookAt')) {
    throw new Error('representative interior-designer delivery lost its model-derived cover, labels, highlighting, or automatic camera framing');
  }
  return { files: Object.keys(manifest.files).sort(), manifest };
}

function normalizeGeneratedHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const normalized = html
    .replace(/[ \t]+$/gm, '')
    .replace(/^ +\t/gm, '\t');
  if (normalized !== html) fs.writeFileSync(file, normalized, { mode: 0o600 });
}

function fileRecord(file) {
  const value = fs.readFileSync(file);
  return {
    bytes: value.length,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  };
}

async function writeDeliveryRender(source, target) {
  const { default: sharp } = await import('sharp');
  await sharp(source).resize({ width: 1440, height: 810, fit: 'cover' }).webp({ quality: 78, effort: 6 }).toFile(target);
}

function referencedImageHash(html, alt, directory) {
  const tag = [...html.matchAll(/<img\b[^>]*>/g)].map(([value]) => value).find((value) => value.includes(`alt="${alt}"`));
  const src = tag?.match(/src="([^"]+)"/)?.[1] || '';
  if (src.startsWith('data:image/')) return '';
  const target = src && !src.includes('..') ? path.join(directory, src) : '';
  return target && fs.existsSync(target) ? sha256(fs.readFileSync(target)) : '';
}

function compareDirectories(actualRoot, expectedRoot) {
  if (!fs.existsSync(expectedRoot)) throw new Error('representative interior-designer delivery is missing; run the build command');
  const actualFiles = listFiles(actualRoot);
  const expectedFiles = listFiles(expectedRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`representative interior-designer delivery file set drifted: expected ${expectedFiles.join(', ')}, generated ${actualFiles.join(', ')}`);
  }
  for (const name of actualFiles) {
    const actual = fs.readFileSync(path.join(actualRoot, name));
    const expected = fs.readFileSync(path.join(expectedRoot, name));
    if (!actual.equals(expected)) throw new Error(`representative interior-designer delivery drifted: ${name}`);
  }
}

function listFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return listFiles(path.join(root, entry.name)).map((name) => path.join(entry.name, name));
    return [entry.name];
  }).sort();
}

function replaceDirectory(source, target) {
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${path.basename(target)}.next-${process.pid}`);
  const previous = path.join(parent, `.${path.basename(target)}.previous-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(source, staging, { recursive: true });
  if (fs.existsSync(target)) fs.renameSync(target, previous);
  try {
    fs.renameSync(staging, target);
    fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(previous) && !fs.existsSync(target)) fs.renameSync(previous, target);
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowed = new Set(['--check']);
  const invalid = process.argv.slice(2).find((argument) => !allowed.has(argument));
  if (invalid) {
    console.error(`unsupported argument: ${invalid}`);
    process.exitCode = 2;
  } else {
    buildAgentDeliveryExample({ check: process.argv.includes('--check') })
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(`[interior-agent-delivery] ${error.message}`);
        process.exitCode = 1;
      });
  }
}
