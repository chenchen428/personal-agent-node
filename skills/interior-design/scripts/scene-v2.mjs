import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PascalInteriorAdapter } from './pascal-adapter.mjs';
import { auditProfessionalProject } from './quality/index.mjs';
import {
  loadHistoricalProject,
  normalizeProjectV2,
  projectError,
  readProject,
  selectedConcept,
  sha256,
  validateProjectV2,
  writeProjectRevision,
} from './project-v2.mjs';

export async function compileProjectScene(projectDirInput, context, { baseRevision, adapter = new PascalInteriorAdapter(), now } = {}) {
  const { projectDir, project } = readProject(projectDirInput, context);
  requireBaseRevision(project, baseRevision);
  const nextInput = structuredClone(project);
  nextInput.baseRevision = project.revision;
  nextInput.revision = project.revision + 1;
  nextInput.provenance.designStateRevision = project.revision + 1;
  nextInput.provenance.undoRevision = project.revision;
  nextInput.status = 'scene_compiled';
  const payload = await adapter.compileScene(nextInput);
  nextInput.scene = {
    format: 'pascal',
    formatVersion: payload.pascal.coreVersion,
    path: 'scene.json',
    sha256: payload.sceneHash,
    adapterVersion: payload.adapterVersion,
  };
  const audit = auditProfessionalProject(nextInput, payload);
  nextInput.status = audit.ok ? 'quality_gated' : 'scene_compiled';
  nextInput.quality = { auditPath: 'derived/audit.json', sha256: audit.sha256, blockingCount: audit.blockingCount, warningCount: audit.warningCount };
  const next = writeProjectRevision(projectDir, project, nextInput, { scene: payload, audit, ...(now ? { now } : {}) });
  payload.revision = next.revision;
  clearRedo(projectDir);
  return { projectDir, project: next, scene: payload };
}

export async function applySceneOperations(projectDirInput, context, operations, { baseRevision, adapter = new PascalInteriorAdapter() } = {}) {
  const { projectDir, project } = readProject(projectDirInput, context);
  requireBaseRevision(project, baseRevision);
  if (!Array.isArray(operations) || !operations.length) throw projectError('INVALID_OPERATIONS', 'operations must be a non-empty array', 2);
  if (operations.length > 100) throw projectError('INVALID_OPERATIONS', 'at most 100 operations are allowed', 2);
  const nextInput = structuredClone(project);
  const changes = [];
  for (const operation of operations) changes.push(applyOperation(nextInput, operation));
  nextInput.baseRevision = project.revision;
  nextInput.revision = project.revision + 1;
  nextInput.provenance.designStateRevision = project.revision + 1;
  nextInput.provenance.undoRevision = project.revision;
  nextInput.status = 'revised';
  nextInput.decisions.push({
    decisionId: `decision-revision-${project.revision + 1}`,
    summary: `Applied ${changes.length} structured design change${changes.length === 1 ? '' : 's'}.`,
    rationale: 'User-directed natural-language revision compiled into deterministic scene operations.',
    requirementIds: [...new Set(changes.flatMap((change) => change.requirementIds || []))],
    changes,
  });
  const payload = await adapter.compileScene(nextInput);
  nextInput.status = 'scene_compiled';
  nextInput.scene = {
    format: 'pascal',
    formatVersion: payload.pascal.coreVersion,
    path: 'scene.json',
    sha256: payload.sceneHash,
    adapterVersion: payload.adapterVersion,
  };
  const audit = auditProfessionalProject(nextInput, payload);
  nextInput.status = audit.ok ? 'quality_gated' : 'scene_compiled';
  nextInput.quality = { auditPath: 'derived/audit.json', sha256: audit.sha256, blockingCount: audit.blockingCount, warningCount: audit.warningCount };
  const next = writeProjectRevision(projectDir, project, nextInput, { scene: payload, audit });
  payload.revision = next.revision;
  clearRedo(projectDir);
  return { projectDir, project: next, scene: payload, changes };
}

export async function undoProjectRevision(projectDirInput, context, { baseRevision, adapter = new PascalInteriorAdapter() } = {}) {
  const { projectDir, project } = readProject(projectDirInput, context);
  requireBaseRevision(project, baseRevision);
  const targetRevision = project.provenance.undoRevision === null
    ? 0
    : Number(project.provenance.undoRevision ?? project.revision - 1);
  if (!Number.isInteger(targetRevision) || targetRevision < 1) throw projectError('UNDO_UNAVAILABLE', 'no earlier revision is available', 6);
  const target = loadHistoricalProject(projectDir, targetRevision);
  const nextInput = normalizeProjectV2({
    ...target,
    baseRevision: project.revision,
    revision: project.revision + 1,
    status: 'revised',
    provenance: {
      ...target.provenance,
      designStateRevision: target.provenance.designStateRevision ?? target.revision,
      ...(Number(target.provenance.undoRevision ?? target.revision - 1) >= 1
        ? { undoRevision: Number(target.provenance.undoRevision ?? target.revision - 1) }
        : { undoRevision: null }),
    },
    decisions: [...target.decisions, {
      decisionId: `decision-undo-${project.revision + 1}`,
      summary: `Restored the design state from revision ${target.revision}.`,
      rationale: 'Revision-safe undo requested by the owning Agent.',
      requirementIds: [],
    }],
  });
  const payload = await adapter.compileScene(nextInput);
  nextInput.scene = { format: 'pascal', formatVersion: payload.pascal.coreVersion, path: 'scene.json', sha256: payload.sceneHash, adapterVersion: payload.adapterVersion };
  const audit = auditProfessionalProject(nextInput, payload);
  nextInput.status = audit.ok ? 'quality_gated' : 'scene_compiled';
  nextInput.quality = { auditPath: 'derived/audit.json', sha256: audit.sha256, blockingCount: audit.blockingCount, warningCount: audit.warningCount };
  const next = writeProjectRevision(projectDir, project, nextInput, { scene: payload, audit });
  payload.revision = next.revision;
  pushRedo(projectDir, project);
  return { projectDir, project: next, scene: payload, restoredRevision: target.revision };
}

export async function redoProjectRevision(projectDirInput, context, { baseRevision, adapter = new PascalInteriorAdapter() } = {}) {
  const { projectDir, project } = readProject(projectDirInput, context);
  requireBaseRevision(project, baseRevision);
  const stack = readRedoStack(projectDir);
  if (!stack.length) throw projectError('REDO_UNAVAILABLE', 'no redo state is available', 6);
  const target = stack.pop();
  const errors = validateProjectV2(target, { context });
  if (errors.length || target.projectId !== project.projectId) throw projectError('REDO_STATE_INVALID', 'redo state is invalid for this project', 6, { errors });
  const nextInput = normalizeProjectV2({
    ...target,
    baseRevision: project.revision,
    revision: project.revision + 1,
    status: 'revised',
    provenance: {
      ...target.provenance,
      designStateRevision: target.provenance.designStateRevision ?? target.revision,
      undoRevision: project.revision,
    },
    decisions: [...target.decisions, {
      decisionId: `decision-redo-${project.revision + 1}`,
      summary: 'Restored the most recently undone design state.',
      rationale: 'Revision-safe redo requested by the owning Agent.',
      requirementIds: [],
    }],
  });
  const payload = await adapter.compileScene(nextInput);
  nextInput.scene = { format: 'pascal', formatVersion: payload.pascal.coreVersion, path: 'scene.json', sha256: payload.sceneHash, adapterVersion: payload.adapterVersion };
  const audit = auditProfessionalProject(nextInput, payload);
  nextInput.status = audit.ok ? 'quality_gated' : 'scene_compiled';
  nextInput.quality = { auditPath: 'derived/audit.json', sha256: audit.sha256, blockingCount: audit.blockingCount, warningCount: audit.warningCount };
  const next = writeProjectRevision(projectDir, project, nextInput, { scene: payload, audit });
  payload.revision = next.revision;
  writeRedoStack(projectDir, stack);
  return { projectDir, project: next, scene: payload };
}

function applyOperation(project, operation) {
  if (!operation || typeof operation !== 'object') throw projectError('INVALID_OPERATION', 'every operation must be an object', 2);
  const concept = selectedConcept(project);
  if (operation.op === 'select-concept') {
    if (!project.concepts.some((item) => item.conceptId === operation.conceptId)) throw projectError('TARGET_NOT_FOUND', `concept ${operation.conceptId} does not exist`, 3);
    const previous = project.selectedConceptId;
    project.selectedConceptId = operation.conceptId;
    return { op: operation.op, targetId: operation.conceptId, previous };
  }
  if (operation.op === 'update-requirement-status') {
    const requirement = project.brief.requirements.find((item) => item.requirementId === operation.requirementId);
    if (!requirement) throw projectError('TARGET_NOT_FOUND', `requirement ${operation.requirementId} does not exist`, 3);
    const allowed = new Set(['unresolved', 'satisfied', 'partially-satisfied', 'blocked', 'rejected-with-reason']);
    if (!allowed.has(operation.status)) throw projectError('INVALID_OPERATION', 'requirement status is invalid', 2);
    const previous = requirement.status;
    requirement.status = operation.status;
    if (operation.rationale) requirement.rationale = String(operation.rationale).slice(0, 1000);
    return { op: operation.op, targetId: requirement.requirementId, previous, next: requirement.status, requirementIds: [requirement.requirementId] };
  }
  if (operation.op === 'update-material-intent') {
    const material = project.designIntent.materials.find((item) => item.materialId === operation.materialId);
    if (!material) throw projectError('TARGET_NOT_FOUND', `material ${operation.materialId} does not exist`, 3);
    for (const key of ['name', 'color', 'maintenance', 'wetAreaSuitability']) {
      if (operation.patch?.[key] !== undefined) material[key] = operation.patch[key];
    }
    return { op: operation.op, targetId: material.materialId };
  }
  const level = concept.levels.find((item) => item.levelId === operation.levelId);
  if (!level) throw projectError('TARGET_NOT_FOUND', `level ${operation.levelId} does not exist`, 3);
  if (operation.op === 'update-item') {
    const item = level.items.find((entry) => entry.itemId === operation.itemId);
    if (!item) throw projectError('TARGET_NOT_FOUND', `item ${operation.itemId} does not exist`, 3);
    const allowed = new Set(['position', 'size', 'rotation', 'roomId', 'name', 'kind', 'materialId', 'color', 'clearanceExempt', 'requirementIds']);
    for (const [key, value] of Object.entries(operation.patch || {})) if (allowed.has(key)) item[key] = structuredClone(value);
    return { op: operation.op, targetId: item.itemId, requirementIds: item.requirementIds || [] };
  }
  if (operation.op === 'add-item') {
    if (level.items.some((entry) => entry.itemId === operation.item?.itemId)) throw projectError('STATE_CONFLICT', `item ${operation.item.itemId} already exists`, 6);
    level.items.push(structuredClone(operation.item));
    return { op: operation.op, targetId: operation.item.itemId, requirementIds: operation.item.requirementIds || [] };
  }
  if (operation.op === 'remove-item') {
    const index = level.items.findIndex((entry) => entry.itemId === operation.itemId);
    if (index < 0) throw projectError('TARGET_NOT_FOUND', `item ${operation.itemId} does not exist`, 3);
    const [removed] = level.items.splice(index, 1);
    return { op: operation.op, targetId: removed.itemId, requirementIds: removed.requirementIds || [] };
  }
  if (operation.op === 'update-opening') {
    const opening = level.openings.find((entry) => entry.openingId === operation.openingId);
    if (!opening) throw projectError('TARGET_NOT_FOUND', `opening ${operation.openingId} does not exist`, 3);
    const allowed = new Set(['position', 'width', 'height', 'sillHeight', 'hingesSide', 'swingDirection', 'connectsRoomIds']);
    for (const [key, value] of Object.entries(operation.patch || {})) if (allowed.has(key)) opening[key] = structuredClone(value);
    return { op: operation.op, targetId: opening.openingId, requirementIds: opening.requirementIds || [] };
  }
  throw projectError('INVALID_OPERATION', `unsupported scene operation: ${operation.op}`, 2);
}

function requireBaseRevision(project, value) {
  const revision = Number(value);
  if (!Number.isInteger(revision)) throw projectError('INVALID_ARGUMENT', '--base-revision must be an integer', 2);
  if (revision !== project.revision) throw projectError('REVISION_CONFLICT', `base revision ${revision} does not match current revision ${project.revision}`, 6, {
    currentRevision: project.revision,
    requestedBaseRevision: revision,
    replayable: true,
    summary: 'Reload the current project revision and replay the same structured operations against it.',
  });
}

function clearRedo(projectDir) {
  for (const name of ['redo-stack.json', 'redo.project.json']) {
    const redoPath = path.join(projectDir, '.runtime', name);
    if (fs.existsSync(redoPath)) fs.unlinkSync(redoPath);
  }
}

function pushRedo(projectDir, project) {
  const stack = readRedoStack(projectDir);
  stack.push(structuredClone(project));
  writeRedoStack(projectDir, stack.slice(-50));
}

function readRedoStack(projectDir) {
  const redoPath = path.join(projectDir, '.runtime', 'redo-stack.json');
  if (!fs.existsSync(redoPath)) return [];
  if (fs.lstatSync(redoPath).isSymbolicLink()) throw projectError('SYMLINK_ESCAPE', 'redo state must not be a symbolic link', 4);
  const stat = fs.statSync(redoPath);
  if (stat.size > 10 * 1024 * 1024) throw projectError('REDO_STATE_INVALID', 'redo state exceeds 10 MiB', 6);
  const stack = JSON.parse(fs.readFileSync(redoPath, 'utf8'), (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw projectError('REDO_STATE_INVALID', 'redo state contains a forbidden key', 6);
    return value;
  });
  if (!Array.isArray(stack) || stack.length > 50) throw projectError('REDO_STATE_INVALID', 'redo state must contain at most 50 revisions', 6);
  return stack;
}

function writeRedoStack(projectDir, stack) {
  const redoPath = path.join(projectDir, '.runtime', 'redo-stack.json');
  if (!stack.length) {
    if (fs.existsSync(redoPath)) fs.unlinkSync(redoPath);
    return;
  }
  const value = Buffer.from(`${JSON.stringify(stack, null, 2)}\n`);
  if (value.length > 10 * 1024 * 1024) throw projectError('REDO_STATE_INVALID', 'redo state exceeds 10 MiB', 6);
  const temporary = path.join(path.dirname(redoPath), `.redo-stack.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, redoPath);
}

export function scenePayloadHash(payload) {
  return sha256(JSON.stringify(payload));
}
