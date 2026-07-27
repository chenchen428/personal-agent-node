#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatePage,
  loadInteriorTemplateContract,
  loadLegacyInteriorTemplateContract,
  loadSourcePlanAsset,
  verifyGeneratedPageHtml,
} from './generate-page.mjs';
import { generateProfessionalPage } from './generate-page-v2.mjs';
import { loadInteriorEnginePolicy, requireV2ProjectCreation } from './engine-policy.mjs';
import { auditModel, normalizeModel, validateModel } from './model.mjs';
import {
  canonicalJson,
  importV1Seed,
  initializeProject,
  projectError,
  readProject,
  recordProjectAuditEvent,
  recoverProjectRevision,
  resolveProjectDirectory,
  resolveTrustedContext,
  sha256,
  withProjectLock,
} from './project-v2.mjs';
import { auditProfessionalProject } from './quality/index.mjs';
import {
  applySceneOperations,
  compileProjectScene,
  redoProjectRevision,
  undoProjectRevision,
} from './scene-v2.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginePolicy = loadInteriorEnginePolicy();
const commandStartedAt = Date.now();
const [command = 'help', maybeSubcommand, ...rest] = process.argv.slice(2);
const hasSubcommand = command === 'project' || command === 'scene';
const subcommand = hasSubcommand ? maybeSubcommand : null;
const argv = hasSubcommand ? rest : [maybeSubcommand, ...rest].filter((value) => value !== undefined);
const options = parse(argv);

try {
  if (command === 'validate') await legacyValidate();
  else if (command === 'normalize') await legacyNormalize();
  else if (command === 'audit') await legacyAudit();
  else if (command === 'project') await projectCommand();
  else if (command === 'scene') await sceneCommand();
  else if (command === 'page') await pageCommand();
  else emitHelp();
} catch (error) {
  tryRecordFailure(error);
  const result = {
    ok: false,
    error: {
      code: error.code || 'INTERIOR_DESIGN_FAILED',
      message: error.message,
      ...(error.detail && Object.keys(error.detail).length ? { detail: error.detail } : {}),
    },
  };
  if (options.json || hasSubcommand || command === 'page') emit(result);
  else console.error(`[interior-design] ${error.message}`);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
}

async function legacyValidate() {
  const model = readJson(required(options.input, '--input'));
  const errors = validateModel(model);
  emit({ ok: errors.length === 0, schemaVersion: 1, errors });
  if (errors.length) process.exitCode = 1;
}

async function legacyNormalize() {
  const input = readJson(required(options.input, '--input'));
  const errors = validateModel(input);
  if (errors.length) throw projectError('V1_MODEL_INVALID', errors.join('\n'), 2, { errors });
  const model = normalizeModel(input);
  const nextErrors = validateModel(model);
  if (nextErrors.length) throw projectError('V1_MODEL_INVALID', nextErrors.join('\n'), 2, { errors: nextErrors });
  writeJson(required(options.output, '--output'), model);
  emit({ ok: true, schemaVersion: 1, outputHash: sha256(canonicalJson(model)), areaM2: model.project.areaM2, rooms: model.rooms.length });
}

async function legacyAudit() {
  const model = readJson(required(options.input, '--input'));
  const report = auditModel(model);
  emit({ schemaVersion: 1, ...report });
  if (!report.ok) process.exitCode = 5;
}

async function projectCommand() {
  const context = resolveTrustedContext();
  const projectDirInput = required(options['project-dir'], '--project-dir');
  if (subcommand === 'init') {
    requireV2ProjectCreation(enginePolicy);
    const seed = readJson(required(options.input, '--input'));
    const inputHash = sha256(canonicalJson(seed));
    const result = initializeProject(projectDirInput, seed, context);
    recordEvent(result.projectDir, context, result.project, 'ok', { inputHash });
    emitProjectResult(result.project, { inputHash, state: result.project.status });
    return;
  }
  if (subcommand === 'import-v1') {
    requireV2ProjectCreation(enginePolicy);
    const modelPath = required(options.input, '--input');
    const model = readJson(modelPath);
    const sourceBytes = fs.readFileSync(path.resolve(modelPath));
    const errors = validateModel(model);
    if (errors.length) throw projectError('V1_MODEL_INVALID', errors.join('\n'), 2, { errors });
    const seed = importV1Seed(model);
    let sourcePlan = null;
    if (options['source-plan']) {
      const sourcePath = path.resolve(options['source-plan']);
      loadSourcePlanAsset(sourcePath);
      const extension = path.extname(sourcePath).toLowerCase();
      sourcePlan = {
        sourcePath,
        relativePath: `evidence/source-plan${extension}`,
        bytes: fs.readFileSync(sourcePath),
      };
      seed.evidence.push({
        evidenceId: 'evidence-source-plan-redacted',
        relativePath: sourcePlan.relativePath,
        classification: 'structure-reference',
        orientation: model.project?.sourceOrientation || 'unknown',
        calibration: model.project?.scale || { basis: 'unknown' },
        confidence: model.project?.scale?.basis === 'known-length' ? 'specified' : 'estimated',
        allowedUses: ['structure', 'delivery'],
        observations: ['Redacted source plan supplied during v1 migration.'],
        inferences: [],
        redactionStatus: 'redacted',
        contentHash: sha256(sourcePlan.bytes),
      });
    }
    const result = initializeProject(projectDirInput, seed, context);
    const evidencePath = path.join(result.projectDir, 'evidence', 'legacy-v1-model.json');
    fs.writeFileSync(evidencePath, sourceBytes, { mode: 0o600, flag: 'wx' });
    if (sourcePlan) fs.writeFileSync(path.join(result.projectDir, sourcePlan.relativePath), sourcePlan.bytes, { mode: 0o600, flag: 'wx' });
    const projectHash = sha256(canonicalJson(result.project));
    recordEvent(result.projectDir, context, result.project, 'ok', { inputHash: sha256(sourceBytes), projectHash });
    emitProjectResult(result.project, {
      inputHash: sha256(sourceBytes),
      projectHash,
      migration: 'v1-to-v2-non-destructive',
    });
    return;
  }
  if (subcommand === 'recover') {
    const resolved = resolveProjectDirectory(projectDirInput, context);
    const revision = integerOption(options.revision, '--revision');
    const result = await withProjectLock(resolved.projectDir, () => recoverProjectRevision(resolved.projectDir, context, revision));
    recordEvent(result.projectDir, context, result.project, 'recovered', {
      ...(result.scene?.sceneHash ? { sceneHash: result.scene.sceneHash } : {}),
      ...(result.audit?.sha256 ? { auditHash: result.audit.sha256 } : {}),
    });
    emitProjectResult(result.project, {
      recoveredRevision: result.recoveredRevision,
      sceneHash: result.scene?.sceneHash || null,
      auditHash: result.audit?.sha256 || null,
    });
    return;
  }
  const { projectDir, project } = readProject(projectDirInput, context);
  if (subcommand === 'validate') {
    const scene = readOptionalJson(path.join(projectDir, 'scene.json'));
    const audit = readOptionalJson(path.join(projectDir, 'derived', 'audit.json'));
    const projectHash = sha256(canonicalJson(project));
    recordEvent(projectDir, context, project, 'ok', {
      projectHash,
      ...(scene?.sceneHash ? { sceneHash: scene.sceneHash } : {}),
      ...(audit?.sha256 ? { auditHash: audit.sha256 } : {}),
    });
    emitProjectResult(project, {
      projectHash,
      sceneHash: scene?.sceneHash || null,
      auditHash: audit?.sha256 || null,
      state: project.status,
    });
    return;
  }
  if (subcommand === 'audit') {
    const scene = readOptionalJson(path.join(projectDir, 'scene.json'));
    if (!scene) throw projectError('SCENE_REQUIRED', 'compile the Pascal scene before running the professional audit', 3);
    const audit = auditProfessionalProject(project, scene);
    recordEvent(projectDir, context, project, audit.ok ? 'ok' : 'blocked', { auditHash: audit.sha256, sceneHash: scene.sceneHash });
    emitProjectResult(project, {
      audit,
      auditHash: audit.sha256,
      sceneHash: scene.sceneHash,
    });
    if (!audit.ok) process.exitCode = 5;
    return;
  }
  throw projectError('INVALID_COMMAND', 'project requires init, import-v1, validate, audit, or recover', 2);
}

async function sceneCommand() {
  const context = resolveTrustedContext();
  const resolved = resolveProjectDirectory(required(options['project-dir'], '--project-dir'), context);
  const baseRevision = integerOption(options['base-revision'], '--base-revision');
  const result = await withProjectLock(resolved.projectDir, async () => {
    if (subcommand === 'compile') return compileProjectScene(resolved.projectDir, context, { baseRevision });
    if (subcommand === 'apply') {
      const operations = readJson(required(options.operations, '--operations'));
      return applySceneOperations(resolved.projectDir, context, operations, { baseRevision });
    }
    if (subcommand === 'undo') return undoProjectRevision(resolved.projectDir, context, { baseRevision });
    if (subcommand === 'redo') return redoProjectRevision(resolved.projectDir, context, { baseRevision });
    throw projectError('INVALID_COMMAND', 'scene requires compile, apply, undo, or redo', 2);
  });
  recordEvent(result.projectDir, context, result.project, result.project.quality.blockingCount > 0 ? 'blocked' : 'ok', {
    sceneHash: result.scene.sceneHash,
    ...(result.project.quality.sha256 ? { auditHash: result.project.quality.sha256 } : {}),
  });
  emitProjectResult(result.project, {
    sceneHash: result.scene.sceneHash,
    adapterVersion: result.scene.adapterVersion,
    pascal: result.scene.pascal,
    changes: result.changes,
    restoredRevision: result.restoredRevision,
    quality: result.project.quality,
  });
  if (result.project.quality.blockingCount > 0) process.exitCode = 5;
}

async function pageCommand() {
  const currentTemplate = loadInteriorTemplateContract(skillRoot);
  const requestedTemplate = options.template || currentTemplate.id;
  if (requestedTemplate !== currentTemplate.id) throw projectError('INVALID_TEMPLATE', `--template must be ${currentTemplate.id}`, 2);
  if (options['project-dir']) {
    const context = resolveTrustedContext();
    const { projectDir, project } = readProject(options['project-dir'], context);
    const output = path.resolve(required(options.output, '--output'));
    const derivedRoot = path.resolve(projectDir, 'derived');
    if (!isInside(derivedRoot, output)) throw projectError('PROJECT_OUTPUT_VIOLATION', 'v2 Page output must stay inside the project derived directory', 4);
    const result = generateProfessionalPage({ projectDir, context, output, skillRoot, template: currentTemplate });
    recordEvent(projectDir, context, project, 'ok', { outputHash: result.manifest.files['index.html'].sha256 });
    emitProjectResult(project, {
      output: path.relative(projectDir, output),
      outputHash: result.manifest.files['index.html'].sha256,
      totalBytes: result.totalBytes,
      template: result.verification,
      adapterVersion: project.scene.adapterVersion,
      pascal: {
        coreVersion: project.provenance.pascalCoreVersion,
        mcpVersion: project.provenance.pascalMcpVersion,
      },
    });
    return;
  }
  const legacyTemplate = loadLegacyInteriorTemplateContract(skillRoot);
  const model = readJson(required(options.input, '--input'));
  const errors = validateModel(model);
  if (errors.length) throw projectError('V1_MODEL_INVALID', errors.join('\n'), 2, { errors });
  const report = auditModel(model);
  if (!report.ok) throw projectError('QUALITY_GATE_BLOCKED', report.findings.map((item) => `${item.code}: ${item.message}`).join('\n'), 5);
  const output = path.resolve(required(options.output, '--output'));
  const sourcePlan = loadSourcePlanAsset(required(options['source-plan'], '--source-plan'));
  const index = generatePage({ model, output, skillRoot, sourcePlan, template: legacyTemplate });
  const templateVerification = verifyGeneratedPageHtml(fs.readFileSync(index, 'utf8'), legacyTemplate);
  emit({ ok: true, schemaVersion: 1, outputHash: sha256(fs.readFileSync(index)), template: templateVerification });
}

function emitProjectResult(project, extra = {}) {
  emit({
    ok: true,
    schemaVersion: 2,
    enginePolicy: enginePolicy.configuredEngine,
    projectEngine: project.provenance.interiorDesignEngine,
    projectId: project.projectId,
    revision: project.revision,
    ...extra,
  });
}

function recordEvent(projectDir, context, project, result, hashes = {}) {
  recordProjectAuditEvent(projectDir, context, {
    projectId: project.projectId,
    revision: project.revision,
    command: `${command}${subcommand ? ` ${subcommand}` : ''}`,
    result,
    durationMs: Date.now() - commandStartedAt,
    hashes,
  });
}

function tryRecordFailure(error) {
  if (!options['project-dir']) return;
  try {
    const context = resolveTrustedContext();
    const { projectDir, project } = readProject(options['project-dir'], context);
    recordProjectAuditEvent(projectDir, context, {
      projectId: project.projectId,
      revision: project.revision,
      command: `${command}${subcommand ? ` ${subcommand}` : ''}`,
      result: error.code === 'REVISION_CONFLICT' || error.code === 'QUALITY_GATE_BLOCKED' ? 'blocked' : 'error',
      errorCode: error.code || 'INTERIOR_DESIGN_FAILED',
      durationMs: Date.now() - commandStartedAt,
    });
  } catch {
    // Preserve the original structured error when the project itself is unreadable.
  }
}

function emitHelp() {
  process.stdout.write([
    'Usage:',
    '  interior <validate|normalize|audit> --input <v1-model.json>',
    '  interior page --input <v1-model.json> --source-plan <redacted-image> --output <page-dir>',
    '  interior project <init|import-v1|validate|audit|recover> --project-dir <space-project-dir>',
    '  interior scene <compile|apply|undo|redo> --project-dir <space-project-dir> --base-revision <n>',
    '  interior page --project-dir <space-project-dir> --output <project-derived-page-dir>',
    '',
  ].join('\n'));
}

function parse(args) {
  const output = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--json') output.json = true;
    else if (key.startsWith('--')) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw projectError('INVALID_ARGUMENT', `${key} requires a value`, 2);
      output[key.slice(2)] = value;
      index += 1;
    } else {
      throw projectError('INVALID_ARGUMENT', `unexpected argument: ${key}`, 2);
    }
  }
  return output;
}

function required(value, flag) {
  if (!value) throw projectError('INVALID_ARGUMENT', `${flag} is required`, 2);
  return value;
}

function integerOption(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw projectError('INVALID_ARGUMENT', `${flag} must be an integer`, 2);
  return parsed;
}

function readJson(file) {
  const target = path.resolve(file);
  const stat = fs.statSync(target);
  if (stat.size > 10 * 1024 * 1024) throw projectError('INPUT_TOO_LARGE', 'JSON input exceeds 10 MiB', 2);
  const value = JSON.parse(fs.readFileSync(target, 'utf8'), rejectPrototypeKeys);
  assertJsonComplexity(value);
  return value;
}

function readOptionalJson(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function rejectPrototypeKeys(key, value) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw projectError('UNTRUSTED_JSON', 'prototype-polluting JSON key rejected', 2);
  }
  return value;
}

function writeJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function assertJsonComplexity(value) {
  const queue = [{ value, depth: 0 }];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (cursor > 200_000) throw projectError('INPUT_TOO_COMPLEX', 'JSON input contains too many values', 2);
    if (current.depth > 100) throw projectError('INPUT_TOO_DEEP', 'JSON input exceeds 100 nested levels', 2);
    if (current.value && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) queue.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
