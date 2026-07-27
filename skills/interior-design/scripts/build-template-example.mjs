#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProfessionalPage, renderProjectCoverSvg } from './generate-page-v2.mjs';
import { compileProjectScene } from './scene-v2.mjs';
import {
  canonicalJson,
  initializeProject,
  readProject,
  selectedConcept,
  sha256,
} from './project-v2.mjs';
import { loadInteriorTemplateContract } from './page-assets.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(skillRoot, '..', '..');
const exampleRoot = path.join(skillRoot, 'examples', 'professional-template');
const targetRoot = path.join(repositoryRoot, 'core', 'app', 'public', 'assets', 'templates', 'interior-design-delivery-v2');
const fixedTime = '2026-07-27T00:00:00.000Z';
const TEMPLATE_QUALITY_FLOOR = Object.freeze({
  rooms: 12,
  furniture: 30,
  openings: 14,
  doors: 8,
  windows: 6,
});

export async function buildTemplateExample({ check = false } = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-template-v2-'));
  try {
    const spaceRoot = path.join(temporaryRoot, 'space');
    const projectDir = path.join(spaceRoot, 'projects', 'home-renovation-template-example');
    const output = path.join(projectDir, 'derived', 'page');
    const context = {
      spaceRoot,
      spaceId: 'built-in-template-example',
      ownerId: 'owner:built-in-template-example',
    };
    fs.mkdirSync(path.dirname(projectDir), { recursive: true, mode: 0o700 });
    const seedBytes = fs.readFileSync(path.join(exampleRoot, 'seed.json'));
    const sourceBytes = fs.readFileSync(path.join(exampleRoot, 'source-plan.svg'));
    const seed = JSON.parse(seedBytes.toString('utf8'));
    const initialized = initializeProject(projectDir, seed, context, { now: () => fixedTime });
    fs.copyFileSync(path.join(exampleRoot, 'source-plan.svg'), path.join(projectDir, 'evidence', 'source-plan.svg'));
    const compiled = await compileProjectScene(projectDir, context, {
      baseRevision: initialized.project.revision,
      now: () => fixedTime,
    });
    const template = loadInteriorTemplateContract(skillRoot);
    generateProfessionalPage({
      projectDir,
      context,
      output,
      skillRoot,
      template,
    });
    normalizeGeneratedHtml(path.join(output, 'index.html'));
    fs.writeFileSync(path.join(output, 'cover.svg'), renderProjectCoverSvg(selectedConcept(compiled.project)), { mode: 0o600 });
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.source = {
      kind: 'native-governed-pascal-v2-project',
      pipeline: [
        'project-v2-seed',
        'pascal-scene-compile',
        'professional-quality-audit',
        'page-v2-generate',
        'artifact-hash-verify',
      ],
      seedSha256: sha256(seedBytes),
      evidenceSha256: sha256(sourceBytes),
      projectSha256: sha256(canonicalJson(readProject(projectDir, context).project)),
      sceneSha256: compiled.scene.sceneHash,
      auditSha256: compiled.project.quality.sha256,
      qualityFloor: TEMPLATE_QUALITY_FLOOR,
    };
    manifest.files['index.html'] = fileRecord(path.join(output, 'index.html'));
    manifest.files['cover.svg'] = fileRecord(path.join(output, 'cover.svg'));
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const verification = verifyTemplateExample(output);
    if (check) {
      compareDirectories(output, targetRoot);
    } else {
      replaceDirectory(output, targetRoot);
      verifyTemplateExample(targetRoot);
    }
    return {
      ok: true,
      mode: check ? 'check' : 'write',
      target: path.relative(repositoryRoot, targetRoot),
      pageSha256: verification.manifest.files['index.html'].sha256,
      sceneSha256: compiled.scene.sceneHash,
      auditSha256: compiled.project.quality.sha256,
      files: verification.files,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function verifyTemplateExample(directory = targetRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.templateId !== 'interior-design-delivery'
    || manifest.templateVersion !== 2
    || manifest.source?.kind !== 'native-governed-pascal-v2-project') {
    throw new Error('built-in template manifest is not a native Pascal v2 artifact');
  }
  if (!Array.isArray(manifest.source.pipeline)
    || manifest.source.pipeline.join('>') !== 'project-v2-seed>pascal-scene-compile>professional-quality-audit>page-v2-generate>artifact-hash-verify') {
    throw new Error('built-in template manifest pipeline is incomplete');
  }
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const target = path.join(directory, name);
    if (!fs.existsSync(target)) throw new Error(`built-in template artifact is missing ${name}`);
    const actual = fileRecord(target);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`built-in template artifact hash mismatch: ${name}`);
    }
  }
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  if (!html.includes('data-engine="pascal-v2"')
    || /data-engine="(?!pascal-v2)[^"]+"|<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\/|127\.0\.0\.1|localhost/i.test(html)) {
    throw new Error('built-in template example is not exclusively Pascal v2');
  }
  const scene = JSON.parse(fs.readFileSync(path.join(directory, 'scene.json'), 'utf8'));
  const nodes = Object.values(scene.scene?.nodes || {});
  const actual = {
    rooms: nodes.filter((node) => node.type === 'zone').length,
    furniture: Array.isArray(scene.furniture) ? scene.furniture.length : 0,
    openings: nodes.filter((node) => ['door', 'window'].includes(node.type)).length,
    doors: nodes.filter((node) => node.type === 'door').length,
    windows: nodes.filter((node) => node.type === 'window').length,
  };
  const floor = manifest.source.qualityFloor || {};
  for (const [key, minimum] of Object.entries(TEMPLATE_QUALITY_FLOOR)) {
    if (floor[key] !== minimum || actual[key] < minimum) {
      throw new Error(`built-in template professional quality floor failed: ${key} ${actual[key]} < ${minimum}`);
    }
  }
  const cover = fs.readFileSync(path.join(directory, 'cover.svg'), 'utf8');
  if (!cover.includes('模型派生轴测封面')
    || !cover.includes('data-cover-item=')
    || !html.includes('pascal-room-label')
    || !html.includes('pascal-highlight')) {
    throw new Error('built-in template lost its model-derived isometric cover, labels, or requirement highlighting');
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

function compareDirectories(actualRoot, expectedRoot) {
  if (!fs.existsSync(expectedRoot)) throw new Error('built-in template artifact is missing; run the build command');
  const actualFiles = listFiles(actualRoot);
  const expectedFiles = listFiles(expectedRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`built-in template file set drifted: expected ${expectedFiles.join(', ')}, generated ${actualFiles.join(', ')}`);
  }
  for (const name of actualFiles) {
    const actual = fs.readFileSync(path.join(actualRoot, name));
    const expected = fs.readFileSync(path.join(expectedRoot, name));
    if (!actual.equals(expected)) throw new Error(`built-in template artifact drifted: ${name}`);
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
    buildTemplateExample({ check: process.argv.includes('--check') })
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(`[interior-template] ${error.message}`);
        process.exitCode = 1;
      });
  }
}
