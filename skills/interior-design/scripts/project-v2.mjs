import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeProjectIndex,
  recordProjectIndexRevision,
  verifyProjectIndex,
} from './project-index.mjs';

export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_STATUSES = new Set([
  'intake',
  'evidence_classified',
  'calibrated',
  'brief_frozen',
  'concept_options',
  'selected_concept',
  'scene_compiled',
  'quality_gated',
  'page_generated',
  'published',
  'user_visual_acceptance_pending',
  'accepted',
  'revised',
  'blocked_missing_evidence',
  'blocked_professional_verification',
  'superseded',
  'archived',
]);

const EVIDENCE_CLASSES = new Set(['structure-reference', 'style-reference', 'edit-target', 'site-photo', 'measurement']);
const CONFIDENCE = new Set(['verified', 'specified', 'estimated', 'unknown']);
const PRIORITIES = new Set(['must', 'should', 'prefer', 'avoid']);
const REQUIREMENT_STATUSES = new Set(['unresolved', 'satisfied', 'partially-satisfied', 'blocked', 'rejected-with-reason']);
const PROJECT_LIMIT = 10 * 1024 * 1024;

export function resolveTrustedContext(env = process.env) {
  const spaceRoot = String(env.PERSONAL_AGENT_SPACE_ROOT || '').trim();
  const spaceId = String(env.PERSONAL_AGENT_SPACE_ID || '').trim();
  if (!spaceRoot || !path.isAbsolute(spaceRoot)) throw projectError('TRUSTED_CONTEXT_REQUIRED', 'PERSONAL_AGENT_SPACE_ROOT must be an absolute trusted Space root', 4);
  if (!spaceId) throw projectError('TRUSTED_CONTEXT_REQUIRED', 'PERSONAL_AGENT_SPACE_ID is required', 4);
  const ownerId = String(env.PERSONAL_AGENT_OWNER_ID || `owner:${spaceId}`).trim();
  return { spaceRoot: path.resolve(spaceRoot), spaceId, ownerId };
}

export function recordProjectAuditEvent(projectDirInput, context, {
  projectId,
  revision,
  command,
  result,
  durationMs = 0,
  hashes = {},
  errorCode = null,
  timestamp = new Date().toISOString(),
}) {
  const { projectDir } = resolveProjectDirectory(projectDirInput, context);
  const runtimeDirectory = path.join(projectDir, '.runtime');
  if (!fs.existsSync(runtimeDirectory) || fs.lstatSync(runtimeDirectory).isSymbolicLink()) {
    throw projectError('AUDIT_LOG_UNAVAILABLE', 'project audit directory is unavailable', 6);
  }
  if (!/^[a-z][a-z0-9 -]{0,79}$/.test(command || '')) throw projectError('AUDIT_EVENT_INVALID', 'audit command is invalid', 6);
  if (!['ok', 'blocked', 'error', 'recovered'].includes(result)) throw projectError('AUDIT_EVENT_INVALID', 'audit result is invalid', 6);
  const safeHashes = Object.fromEntries(Object.entries(hashes)
    .filter(([key, value]) => /^[a-z][a-zA-Z0-9]{0,39}$/.test(key) && /^[a-f0-9]{64}$/.test(value || ''))
    .sort(([a], [b]) => a.localeCompare(b)));
  const record = {
    schemaVersion: 1,
    timestamp,
    actorId: context.ownerId,
    spaceId: context.spaceId,
    projectId,
    revision,
    command,
    result,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    hashes: safeHashes,
    ...(errorCode ? { errorCode: String(errorCode).slice(0, 120) } : {}),
  };
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line) > 16 * 1024) throw projectError('AUDIT_EVENT_INVALID', 'audit event is too large', 6);
  const auditPath = path.join(runtimeDirectory, 'audit.ndjson');
  if (fs.existsSync(auditPath) && fs.lstatSync(auditPath).isSymbolicLink()) {
    throw projectError('SYMLINK_ESCAPE', 'project audit log must not be a symbolic link', 4);
  }
  const descriptor = fs.openSync(auditPath, 'a', 0o600);
  try {
    fs.writeFileSync(descriptor, line);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(auditPath, 0o600);
  return record;
}

export function resolveProjectDirectory(input, context, { create = false } = {}) {
  if (!input) throw projectError('INVALID_ARGUMENT', '--project-dir is required', 2);
  const projectsRoot = path.resolve(context.spaceRoot, 'projects');
  const projectDir = path.resolve(input);
  if (!isInside(projectsRoot, projectDir)) throw projectError('SPACE_BOUNDARY_VIOLATION', 'project directory must stay inside the current Space projects directory', 4);
  if (!/^home-renovation-[a-z0-9][a-z0-9-]{0,79}$/.test(path.basename(projectDir))) {
    throw projectError('INVALID_PROJECT_DIRECTORY', 'project directory name must use home-renovation-<lowercase-slug>', 2);
  }
  assertNoSymlinkEscape(projectsRoot, projectDir);
  if (create) fs.mkdirSync(projectsRoot, { recursive: true, mode: 0o700 });
  return { projectsRoot, projectDir };
}

export function validateProjectV2(project, { context } = {}) {
  const errors = [];
  if (!plainObject(project)) return ['project must be an object'];
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) errors.push('schemaVersion must equal 2');
  text(project.projectId, 'projectId', errors, 120);
  if (project.projectId && !/^renovation_[a-z0-9][a-z0-9_-]{5,119}$/.test(project.projectId)) errors.push('projectId must use the renovation_ namespace');
  text(project.spaceId, 'spaceId', errors, 120);
  text(project.ownerId, 'ownerId', errors, 120);
  text(project.title, 'title', errors, 160);
  if (!PROJECT_STATUSES.has(project.status)) errors.push('status is invalid');
  if (project.designStage !== 'concept') errors.push('designStage must equal concept');
  integer(project.revision, 'revision', errors, 1);
  integer(project.baseRevision, 'baseRevision', errors, 0);
  iso(project.createdAt, 'createdAt', errors);
  iso(project.updatedAt, 'updatedAt', errors);
  if (context && project.spaceId !== context.spaceId) errors.push('spaceId does not match the trusted Space');
  if (context && project.ownerId !== context.ownerId) errors.push('ownerId does not match the trusted owner');

  array(project.evidence, 'evidence', errors);
  if (project.evidence?.length > 100) errors.push('evidence must contain at most 100 items');
  const evidenceIds = uniqueIds(project.evidence, 'evidenceId', 'evidence', errors);
  for (const evidence of list(project.evidence)) {
    if (!plainObject(evidence)) continue;
    if (!EVIDENCE_CLASSES.has(evidence.classification)) errors.push(`evidence ${evidence.evidenceId}: classification is invalid`);
    if (!CONFIDENCE.has(evidence.confidence)) errors.push(`evidence ${evidence.evidenceId}: confidence is invalid`);
    if (!evidence.managedObjectId && !safeRelative(evidence.relativePath)) errors.push(`evidence ${evidence.evidenceId}: governed managedObjectId or safe relativePath is required`);
    if (evidence.managedObjectId && !/^obj_[a-f0-9]{24}$/.test(evidence.managedObjectId)) errors.push(`evidence ${evidence.evidenceId}: managedObjectId is invalid`);
    if (!Array.isArray(evidence.allowedUses) || !evidence.allowedUses.length) errors.push(`evidence ${evidence.evidenceId}: allowedUses is required`);
    if (typeof evidence.orientation !== 'string' || !evidence.orientation.trim()) errors.push(`evidence ${evidence.evidenceId}: orientation is required`);
    if (!plainObject(evidence.calibration)) errors.push(`evidence ${evidence.evidenceId}: calibration must be an object`);
    if (!Array.isArray(evidence.observations) || !Array.isArray(evidence.inferences)) errors.push(`evidence ${evidence.evidenceId}: observations and inferences must be arrays`);
    if (typeof evidence.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.contentHash)) errors.push(`evidence ${evidence.evidenceId}: contentHash must be sha256`);
    if (evidence.redactionStatus !== 'not-required' && evidence.redactionStatus !== 'redacted' && evidence.redactionStatus !== 'private-only') {
      errors.push(`evidence ${evidence.evidenceId}: redactionStatus is invalid`);
    }
  }

  if (!plainObject(project.brief)) errors.push('brief must be an object');
  for (const name of ['household', 'scope', 'requirements']) array(project.brief?.[name], `brief.${name}`, errors);
  if (!plainObject(project.brief?.budget)) errors.push('brief.budget must be an object');
  if (!plainObject(project.brief?.schedule)) errors.push('brief.schedule must be an object');
  if (!/^[A-Z]{3}$/.test(project.brief?.budget?.currency || '')) errors.push('brief.budget.currency must be an ISO-style uppercase code');
  integer(project.brief?.budget?.totalMinor, 'brief.budget.totalMinor', errors, 0);
  if (!CONFIDENCE.has(project.brief?.budget?.confidence)) errors.push('brief.budget.confidence is invalid');
  if (!CONFIDENCE.has(project.brief?.schedule?.confidence)) errors.push('brief.schedule.confidence is invalid');
  const passageThreshold = project.brief?.qualityThresholds?.minimumPassageWidthMetres;
  if (passageThreshold !== undefined) {
    if (!plainObject(passageThreshold) || !Number.isFinite(passageThreshold.value) || passageThreshold.value <= 0) {
      errors.push('brief.qualityThresholds.minimumPassageWidthMetres must have a positive value');
    }
    if (!['user-requirement', 'jurisdiction-rule', 'product-concept-default', 'comfort-guidance'].includes(passageThreshold?.source)) {
      errors.push('brief.qualityThresholds.minimumPassageWidthMetres source is invalid');
    }
  }
  array(project.brief?.schedule?.phases, 'brief.schedule.phases', errors);
  const phaseIds = uniqueIds(project.brief?.schedule?.phases, 'phaseId', 'schedule phases', errors);
  for (const phase of list(project.brief?.schedule?.phases)) {
    if (!plainObject(phase)) continue;
    text(phase.name, `schedule phase ${phase.phaseId}: name`, errors, 160);
    if (phase.status && !['planned', 'in-progress', 'completed', 'blocked'].includes(phase.status)) errors.push(`schedule phase ${phase.phaseId}: status is invalid`);
  }
  const requirementIds = uniqueIds(project.brief?.requirements, 'requirementId', 'requirements', errors);
  if (project.brief?.requirements?.length > 500) errors.push('brief.requirements must contain at most 500 items');
  for (const requirement of list(project.brief?.requirements)) {
    if (!plainObject(requirement)) continue;
    if (!PRIORITIES.has(requirement.priority)) errors.push(`requirement ${requirement.requirementId}: priority is invalid`);
    if (!REQUIREMENT_STATUSES.has(requirement.status)) errors.push(`requirement ${requirement.requirementId}: status is invalid`);
    if (!Array.isArray(requirement.sceneNodeIds)) errors.push(`requirement ${requirement.requirementId}: sceneNodeIds must be an array`);
    if (!requirement.source) errors.push(`requirement ${requirement.requirementId}: source is required`);
    if (!plainObject(requirement.verification)) errors.push(`requirement ${requirement.requirementId}: verification must be an object`);
  }

  for (const name of ['assumptions', 'unknowns', 'professionalVerifications', 'concepts', 'decisions']) array(project[name], name, errors);
  uniqueIds(project.assumptions, 'assumptionId', 'assumptions', errors);
  uniqueIds(project.unknowns, 'unknownId', 'unknowns', errors);
  uniqueIds(project.professionalVerifications, 'verificationId', 'professionalVerifications', errors);
  uniqueIds(project.decisions, 'decisionId', 'decisions', errors);
  for (const verification of list(project.professionalVerifications)) {
    if (!plainObject(verification)) continue;
    text(verification.category, `professional verification ${verification.verificationId}: category`, errors, 120);
    text(verification.summary, `professional verification ${verification.verificationId}: summary`, errors, 2000);
    if (!['required', 'pending', 'verified', 'not-applicable'].includes(verification.status)) errors.push(`professional verification ${verification.verificationId}: status is invalid`);
  }
  const conceptIds = uniqueIds(project.concepts, 'conceptId', 'concepts', errors);
  if (project.concepts?.length > 10) errors.push('concepts must contain at most 10 items');
  if (!conceptIds.has(project.selectedConceptId)) errors.push('selectedConceptId does not resolve');
  if (list(project.concepts).length < 2 && !list(project.concepts)[0]?.singleOptionReason) {
    errors.push('at least two concepts are required unless singleOptionReason is recorded');
  }

  for (const concept of list(project.concepts)) {
    if (!plainObject(concept)) continue;
    text(concept.name, `concept ${concept.conceptId}: name`, errors, 120);
    text(concept.summary, `concept ${concept.conceptId}: summary`, errors, 1000);
    array(concept.tradeoffs, `concept ${concept.conceptId}: tradeoffs`, errors);
    array(concept.budgetItems, `concept ${concept.conceptId}: budgetItems`, errors);
    uniqueIds(concept.budgetItems, 'budgetItemId', `concept ${concept.conceptId} budget items`, errors);
    for (const budgetItem of list(concept.budgetItems)) {
      if (!plainObject(budgetItem)) continue;
      text(budgetItem.category, `budget item ${budgetItem.budgetItemId}: category`, errors, 160);
      integer(budgetItem.amountMinor, `budget item ${budgetItem.budgetItemId}: amountMinor`, errors, 0);
      if (!['verified', 'specified', 'estimated'].includes(budgetItem.confidence)) errors.push(`budget item ${budgetItem.budgetItemId}: confidence is invalid`);
      if (budgetItem.phaseIds?.some((id) => !phaseIds.has(id))) errors.push(`budget item ${budgetItem.budgetItemId}: phaseIds do not resolve`);
    }
    array(concept.levels, `concept ${concept.conceptId}: levels`, errors);
    if (!concept.levels?.length) errors.push(`concept ${concept.conceptId}: at least one level is required`);
    const conceptLevels = list(concept.levels);
    if (conceptLevels.length > 2) errors.push(`concept ${concept.conceptId}: at most 2 levels are supported`);
    const conceptRoomCount = conceptLevels.reduce((sum, level) => sum + (level?.rooms?.length || 0), 0);
    const conceptElementCount = conceptLevels.reduce((sum, level) => sum
      + (level?.walls?.length || 0)
      + (level?.openings?.length || 0)
      + (level?.items?.length || 0)
      + (level?.stairs?.length || 0)
      + (level?.guardrails?.length || 0)
      + (level?.voids?.length || 0), 0);
    if (conceptRoomCount > 30) errors.push(`concept ${concept.conceptId}: at most 30 rooms are supported`);
    if (conceptElementCount > 500) errors.push(`concept ${concept.conceptId}: at most 500 modeled elements are supported`);
    validateLevels(concept, { errors, evidenceIds, requirementIds });
  }
  const sceneSourceIds = new Set(list(project.concepts).flatMap((concept) => list(concept?.levels).flatMap((level) => [
    level?.levelId,
    ...list(level?.rooms).map((entry) => entry?.roomId),
    ...list(level?.walls).map((entry) => entry?.wallId),
    ...list(level?.openings).map((entry) => entry?.openingId),
    ...list(level?.items).map((entry) => entry?.itemId),
    ...list(level?.stairs).map((entry) => entry?.stairId),
    ...list(level?.guardrails).map((entry) => entry?.guardrailId),
    ...list(level?.voids).map((entry) => entry?.voidId),
  ])));
  for (const requirement of list(project.brief?.requirements)) {
    if (!plainObject(requirement)) continue;
    if (requirement.sceneNodeIds?.some((id) => !sceneSourceIds.has(id))) errors.push(`requirement ${requirement.requirementId}: sceneNodeIds do not resolve`);
    if (requirement.phaseIds?.some((id) => !phaseIds.has(id))) errors.push(`requirement ${requirement.requirementId}: phaseIds do not resolve`);
    const budgetIds = new Set(list(project.concepts).flatMap((concept) => list(concept?.budgetItems).map((entry) => entry?.budgetItemId)));
    if (requirement.budgetItemIds?.some((id) => !budgetIds.has(id))) errors.push(`requirement ${requirement.requirementId}: budgetItemIds do not resolve`);
  }

  if (!plainObject(project.designIntent)) errors.push('designIntent must be an object');
  for (const name of ['style', 'materials', 'lighting', 'maintenance']) array(project.designIntent?.[name], `designIntent.${name}`, errors);
  if (!plainObject(project.scene)) errors.push('scene must be an object');
  if (!plainObject(project.quality)) errors.push('quality must be an object');
  if (!plainObject(project.publication)) errors.push('publication must be an object');
  if (!plainObject(project.provenance)) errors.push('provenance must be an object');
  if (project.scene?.format !== 'pascal' || project.scene?.path !== 'scene.json') errors.push('scene must use the governed Pascal scene.json contract');
  if (project.scene?.sha256 !== null && !/^[a-f0-9]{64}$/.test(project.scene?.sha256 || '')) errors.push('scene.sha256 must be null or sha256');
  if (project.quality?.auditPath !== 'derived/audit.json') errors.push('quality.auditPath is invalid');
  if (project.quality?.sha256 !== null && !/^[a-f0-9]{64}$/.test(project.quality?.sha256 || '')) errors.push('quality.sha256 must be null or sha256');
  if (project.provenance?.adapter !== 'personal-agent-pascal' || project.provenance?.adapterVersion !== 1) errors.push('provenance adapter contract is invalid');
  if (project.provenance?.interiorDesignEngine !== 'pascal-v2') errors.push('provenance interior-design engine is unsupported');
  if (project.provenance?.pascalCoreVersion !== '0.9.2' || project.provenance?.pascalMcpVersion !== '0.3.2') errors.push('provenance Pascal versions are unsupported');
  return errors;
}

export function createProjectFromSeed(seed, context, { now = () => new Date().toISOString(), slug = 'project' } = {}) {
  const timestamp = now();
  const projectId = seed.projectId || `renovation_${cleanToken(slug)}_${sha256(`${context.spaceId}:${slug}`).slice(0, 10)}`;
  const project = normalizeProjectV2({
    ...structuredClone(seed),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    spaceId: context.spaceId,
    ownerId: context.ownerId,
    status: seed.status || 'brief_frozen',
    designStage: 'concept',
    revision: 1,
    baseRevision: 0,
    createdAt: seed.createdAt || timestamp,
    updatedAt: timestamp,
    evidence: seed.evidence || [],
    brief: {
      household: [],
      scope: [],
      budget: { currency: 'CNY', totalMinor: 0, confidence: 'unknown' },
      schedule: { confidence: 'unknown', phases: [] },
      requirements: [],
      ...(seed.brief || {}),
    },
    assumptions: seed.assumptions || [],
    unknowns: seed.unknowns || [],
    professionalVerifications: seed.professionalVerifications || [],
    concepts: seed.concepts || [],
    selectedConceptId: seed.selectedConceptId || seed.concepts?.[0]?.conceptId || '',
    designIntent: { style: [], materials: [], lighting: [], maintenance: [], ...(seed.designIntent || {}) },
    decisions: seed.decisions || [],
    scene: seed.scene || { format: 'pascal', formatVersion: '0.9.2', path: 'scene.json', sha256: null },
    quality: seed.quality || { auditPath: 'derived/audit.json', sha256: null, blockingCount: null, warningCount: null },
    publication: seed.publication || {},
    provenance: {
      interiorDesignEngine: 'pascal-v2',
      adapter: 'personal-agent-pascal',
      adapterVersion: 1,
      pascalCoreVersion: '0.9.2',
      pascalMcpVersion: '0.3.2',
      ...(seed.provenance || {}),
    },
  });
  const errors = validateProjectV2(project, { context });
  if (errors.length) throw projectError('PROJECT_VALIDATION_FAILED', errors.join('\n'), 2, { errors });
  return project;
}

export function initializeProject(projectDirInput, seed, context, options = {}) {
  const { projectDir } = resolveProjectDirectory(projectDirInput, context, { create: true });
  if (fs.existsSync(path.join(projectDir, 'project.json'))) throw projectError('PROJECT_EXISTS', 'project already exists', 6);
  if (fs.existsSync(projectDir)) throw projectError('PROJECT_DIRECTORY_NOT_EMPTY', 'project directory already exists without a governed project', 6);
  const project = createProjectFromSeed(seed, context, { ...options, slug: path.basename(projectDir).slice('home-renovation-'.length) });
  fs.mkdirSync(projectDir, { recursive: false, mode: 0o700 });
  for (const directory of ['evidence', 'decisions', 'derived', 'derived/page', 'history', 'history/archive', '.runtime']) {
    fs.mkdirSync(path.join(projectDir, directory), { recursive: true, mode: 0o700 });
  }
  atomicWriteJson(path.join(projectDir, 'project.json'), project);
  writeManifest(projectDir, project, null, null);
  initializeProjectIndex(projectDir, project);
  return { projectDir, project };
}

export function readProject(projectDirInput, context) {
  const { projectDir } = resolveProjectDirectory(projectDirInput, context);
  const project = readJsonBounded(path.join(projectDir, 'project.json'), PROJECT_LIMIT);
  const errors = validateProjectV2(project, { context });
  if (errors.length) throw projectError('PROJECT_VALIDATION_FAILED', errors.join('\n'), 2, { errors });
  verifyProjectManifest(projectDir, project);
  verifyProjectIndex(projectDir, project);
  return { projectDir, project };
}

export function writeProjectRevision(projectDir, current, nextInput, { scene = null, audit = null, now = () => new Date().toISOString() } = {}) {
  if (nextInput.baseRevision !== current.revision) {
    throw projectError('REVISION_CONFLICT', `base revision ${nextInput.baseRevision} does not match current revision ${current.revision}`, 6, {
      currentRevision: current.revision,
      requestedBaseRevision: nextInput.baseRevision,
    });
  }
  const next = normalizeProjectV2({
    ...structuredClone(nextInput),
    revision: current.revision + 1,
    baseRevision: current.revision,
    createdAt: current.createdAt,
    updatedAt: now(),
  });
  const context = { spaceId: current.spaceId, ownerId: current.ownerId };
  const errors = validateProjectV2(next, { context });
  if (errors.length) throw projectError('PROJECT_VALIDATION_FAILED', errors.join('\n'), 2, { errors });
  fs.mkdirSync(path.join(projectDir, 'history'), { recursive: true, mode: 0o700 });
  atomicWriteJson(path.join(projectDir, 'history', `${String(current.revision).padStart(6, '0')}.project.json`), current);
  const currentScenePath = path.join(projectDir, 'scene.json');
  if (fs.existsSync(currentScenePath)) {
    const historicalScene = path.join(projectDir, 'history', `${String(current.revision).padStart(6, '0')}.scene.json`);
    atomicWrite(historicalScene, fs.readFileSync(currentScenePath));
  }
  const currentAuditPath = path.join(projectDir, 'derived', 'audit.json');
  if (fs.existsSync(currentAuditPath)) {
    atomicWrite(path.join(projectDir, 'history', `${String(current.revision).padStart(6, '0')}.audit.json`), fs.readFileSync(currentAuditPath));
  }
  if (scene && Buffer.byteLength(`${JSON.stringify(scene, null, 2)}\n`) > PROJECT_LIMIT) {
    throw projectError('SCENE_TOO_LARGE', 'scene.json exceeds 10 MiB', 2);
  }
  if (scene) atomicWriteJson(currentScenePath, scene);
  if (audit) atomicWriteJson(path.join(projectDir, 'derived', 'audit.json'), audit);
  atomicWriteJson(path.join(projectDir, 'project.json'), next);
  writeManifest(projectDir, next, scene, audit);
  recordProjectIndexRevision(projectDir, next, scene, audit);
  archiveOldHistory(projectDir);
  return next;
}

export function loadHistoricalProject(projectDir, revision) {
  if (!Number.isInteger(revision) || revision < 1) throw projectError('INVALID_ARGUMENT', 'revision must be a positive integer', 2);
  const target = path.join(projectDir, 'history', `${String(revision).padStart(6, '0')}.project.json`);
  if (!fs.existsSync(target)) throw projectError('REVISION_NOT_FOUND', `revision ${revision} is not available`, 3);
  return readJsonBounded(target, PROJECT_LIMIT);
}

export function recoverProjectRevision(projectDirInput, context, revision) {
  const { projectDir } = resolveProjectDirectory(projectDirInput, context);
  if (!Number.isInteger(revision) || revision < 1) throw projectError('INVALID_ARGUMENT', '--revision must be a positive integer', 2);
  const target = loadHistoricalProject(projectDir, revision);
  const errors = validateProjectV2(target, { context });
  if (errors.length) throw projectError('RECOVERY_REVISION_INVALID', errors.join('\n'), 6, { errors });
  const prefix = String(revision).padStart(6, '0');
  const historicalScene = path.join(projectDir, 'history', `${prefix}.scene.json`);
  const historicalAudit = path.join(projectDir, 'history', `${prefix}.audit.json`);
  const scene = fs.existsSync(historicalScene) ? readJsonBounded(historicalScene, PROJECT_LIMIT) : null;
  const audit = fs.existsSync(historicalAudit) ? readJsonBounded(historicalAudit, 4 * 1024 * 1024) : null;
  if (target.scene?.sha256 && (!scene || scene.sceneHash !== target.scene.sha256)) {
    throw projectError('RECOVERY_REVISION_INCOMPLETE', `revision ${revision} does not have its matching scene snapshot`, 6);
  }
  if (target.quality?.sha256 && (!audit || audit.sha256 !== target.quality.sha256)) {
    throw projectError('RECOVERY_REVISION_INCOMPLETE', `revision ${revision} does not have its matching audit snapshot`, 6);
  }
  const recoveryRoot = path.join(projectDir, '.runtime', 'recovery');
  fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const currentRevision = (() => {
    try {
      return readJsonBounded(path.join(projectDir, 'project.json'), PROJECT_LIMIT).revision;
    } catch {
      return 'unknown';
    }
  })();
  for (const [name, source] of [
    ['project.json', path.join(projectDir, 'project.json')],
    ['scene.json', path.join(projectDir, 'scene.json')],
    ['audit.json', path.join(projectDir, 'derived', 'audit.json')],
  ]) {
    if (fs.existsSync(source)) atomicWrite(path.join(recoveryRoot, `before-${currentRevision}-${name}`), fs.readFileSync(source));
  }
  atomicWriteJson(path.join(projectDir, 'project.json'), target);
  if (scene) atomicWriteJson(path.join(projectDir, 'scene.json'), scene);
  else if (fs.existsSync(path.join(projectDir, 'scene.json'))) fs.renameSync(path.join(projectDir, 'scene.json'), path.join(recoveryRoot, `removed-${currentRevision}-scene.json`));
  if (audit) atomicWriteJson(path.join(projectDir, 'derived', 'audit.json'), audit);
  else if (fs.existsSync(path.join(projectDir, 'derived', 'audit.json'))) fs.renameSync(path.join(projectDir, 'derived', 'audit.json'), path.join(recoveryRoot, `removed-${currentRevision}-audit.json`));
  writeManifest(projectDir, target, scene, audit);
  recordProjectIndexRevision(projectDir, target, scene, audit);
  return { projectDir, project: target, scene, audit, recoveredRevision: revision };
}

export function selectedConcept(project) {
  return project.concepts.find((concept) => concept.conceptId === project.selectedConceptId);
}

export async function withProjectLock(projectDir, callback) {
  const runtimeDir = path.join(projectDir, '.runtime');
  const lockPath = path.join(runtimeDir, 'project.lock');
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      // A malformed recent lock still fails closed.
    }
    const active = Number.isInteger(lock?.pid) && processExists(lock.pid);
    if (!active && Date.now() - stat.mtimeMs > 10 * 60 * 1000) fs.unlinkSync(lockPath);
    else throw projectError('PROJECT_LOCKED', 'another project mutation is in progress', 6);
  }
  const descriptor = fs.openSync(lockPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    fs.fsyncSync(descriptor);
    return await callback();
  } finally {
    fs.closeSync(descriptor);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function normalizeProjectV2(value) {
  return normalizeValue(value);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeValue(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function projectError(code, message, exitCode = 1, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  error.detail = detail;
  return error;
}

function validateLevels(concept, { errors, evidenceIds, requirementIds }) {
  const levelIds = uniqueIds(concept.levels, 'levelId', `concept ${concept.conceptId} levels`, errors);
  const globalElementIds = new Set(levelIds);
  for (const level of list(concept.levels)) {
    if (!plainObject(level)) continue;
    if (!Array.isArray(level.footprint) || level.footprint.length < 3 || level.footprint.some((point) => !point2(point))) errors.push(`level ${level.levelId}: footprint is invalid`);
    positive(level.height, `level ${level.levelId}: height`, errors);
    finite(level.elevation, `level ${level.levelId}: elevation`, errors);
    for (const name of ['rooms', 'walls', 'openings', 'items', 'stairs', 'guardrails', 'voids']) array(level[name], `level ${level.levelId}: ${name}`, errors);
    const roomIds = uniqueIds(level.rooms, 'roomId', `level ${level.levelId} rooms`, errors);
    const wallIds = uniqueIds(level.walls, 'wallId', `level ${level.levelId} walls`, errors);
    uniqueIds(level.openings, 'openingId', `level ${level.levelId} openings`, errors);
    uniqueIds(level.items, 'itemId', `level ${level.levelId} items`, errors);
    uniqueIds(level.stairs, 'stairId', `level ${level.levelId} stairs`, errors);
    uniqueIds(level.guardrails, 'guardrailId', `level ${level.levelId} guardrails`, errors);
    const voidIds = uniqueIds(level.voids, 'voidId', `level ${level.levelId} voids`, errors);
    for (const [label, values] of [
      ['room', [...roomIds]],
      ['wall', [...wallIds]],
      ['opening', list(level.openings).map((entry) => entry?.openingId).filter(Boolean)],
      ['item', list(level.items).map((entry) => entry?.itemId).filter(Boolean)],
      ['stair', list(level.stairs).map((entry) => entry?.stairId).filter(Boolean)],
      ['guardrail', list(level.guardrails).map((entry) => entry?.guardrailId).filter(Boolean)],
      ['void', [...voidIds]],
    ]) {
      for (const id of values) {
        if (globalElementIds.has(id)) errors.push(`concept ${concept.conceptId}: ${label} id ${id} is duplicated across levels or element types`);
        globalElementIds.add(id);
      }
    }
    for (const room of list(level.rooms)) {
      if (!plainObject(room)) continue;
      if (!Array.isArray(room.polygon) || room.polygon.length < 3 || room.polygon.some((point) => !point2(point))) errors.push(`room ${room.roomId}: polygon is invalid`);
      if (room.evidenceIds?.some((id) => !evidenceIds.has(id))) errors.push(`room ${room.roomId}: evidenceIds do not resolve`);
      if (room.requirementIds?.some((id) => !requirementIds.has(id))) errors.push(`room ${room.roomId}: requirementIds do not resolve`);
    }
    for (const wall of list(level.walls)) {
      if (!plainObject(wall)) continue;
      if (!point2(wall.start) || !point2(wall.end)) errors.push(`wall ${wall.wallId}: endpoints are invalid`);
      positive(wall.height, `wall ${wall.wallId}: height`, errors);
      positive(wall.thickness, `wall ${wall.wallId}: thickness`, errors);
    }
    for (const opening of list(level.openings)) {
      if (!plainObject(opening)) continue;
      if (!wallIds.has(opening.wallId)) errors.push(`opening ${opening.openingId}: wallId does not resolve`);
      if (!['door', 'window'].includes(opening.type)) errors.push(`opening ${opening.openingId}: type is invalid`);
      range(opening.position, 0, 1, `opening ${opening.openingId}: position`, errors);
      positive(opening.width, `opening ${opening.openingId}: width`, errors);
      positive(opening.height, `opening ${opening.openingId}: height`, errors);
      if (opening.connectsRoomIds?.some((id) => !roomIds.has(id))) errors.push(`opening ${opening.openingId}: connectsRoomIds do not resolve`);
    }
    for (const item of list(level.items)) {
      if (!plainObject(item)) continue;
      if (!roomIds.has(item.roomId)) errors.push(`item ${item.itemId}: roomId does not resolve`);
      if (!point2(item.position)) errors.push(`item ${item.itemId}: position is invalid`);
      if (!Array.isArray(item.size) || item.size.length !== 3 || item.size.some((entry) => !Number.isFinite(entry) || entry <= 0)) errors.push(`item ${item.itemId}: size is invalid`);
      finite(item.rotation, `item ${item.itemId}: rotation`, errors);
    }
    for (const stair of list(level.stairs)) {
      if (!plainObject(stair)) continue;
      if (!levelIds.has(stair.toLevelId)) errors.push(`stair ${stair.stairId}: toLevelId does not resolve`);
      if (!point2(stair.position)) errors.push(`stair ${stair.stairId}: position is invalid`);
      positive(stair.width, `stair ${stair.stairId}: width`, errors);
      positive(stair.runLength, `stair ${stair.stairId}: runLength`, errors);
      positive(stair.totalRise, `stair ${stair.stairId}: totalRise`, errors);
    }
    for (const guardrail of list(level.guardrails)) {
      if (!plainObject(guardrail)) continue;
      if (!point2(guardrail.start) || !point2(guardrail.end)) errors.push(`guardrail ${guardrail.guardrailId}: endpoints are invalid`);
      if (guardrail.voidId && !voidIds.has(guardrail.voidId)) errors.push(`guardrail ${guardrail.guardrailId}: voidId does not resolve`);
    }
    for (const voidArea of list(level.voids)) {
      if (!plainObject(voidArea)) continue;
      if (!Array.isArray(voidArea.polygon) || voidArea.polygon.length < 3 || voidArea.polygon.some((point) => !point2(point))) errors.push(`void ${voidArea.voidId}: polygon is invalid`);
    }
  }
}

function writeManifest(projectDir, project, scene, audit) {
  const projectBuffer = Buffer.from(`${JSON.stringify(project, null, 2)}\n`);
  const sceneBuffer = scene ? Buffer.from(`${JSON.stringify(scene, null, 2)}\n`) : null;
  const auditBuffer = audit ? Buffer.from(`${JSON.stringify(audit, null, 2)}\n`) : null;
  const manifest = {
    schemaVersion: 1,
    projectId: project.projectId,
    revision: project.revision,
    files: {
      'project.json': { bytes: projectBuffer.length, sha256: sha256(projectBuffer) },
      ...(sceneBuffer ? { 'scene.json': { bytes: sceneBuffer.length, sha256: sha256(sceneBuffer) } } : {}),
      ...(auditBuffer ? { 'derived/audit.json': { bytes: auditBuffer.length, sha256: sha256(auditBuffer) } } : {}),
    },
  };
  fs.mkdirSync(path.join(projectDir, 'derived'), { recursive: true, mode: 0o700 });
  atomicWriteJson(path.join(projectDir, 'derived', 'manifest.json'), manifest);
}

function verifyProjectManifest(projectDir, project) {
  const manifestPath = path.join(projectDir, 'derived', 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw projectError('PROJECT_MANIFEST_MISSING', 'project manifest is missing', 6);
  const manifest = readJsonBounded(manifestPath, 1024 * 1024);
  if (manifest.projectId !== project.projectId || manifest.revision !== project.revision) {
    throw projectError('PROJECT_MANIFEST_MISMATCH', 'project manifest identity does not match project.json', 6, { recovery: 'restore the last complete history snapshot' });
  }
  for (const [relativePath, expected] of Object.entries(manifest.files || {})) {
    if (!safeRelative(relativePath)) throw projectError('PROJECT_MANIFEST_INVALID', 'project manifest contains an unsafe path', 4);
    const target = path.join(projectDir, relativePath);
    if (!fs.existsSync(target)) throw projectError('PROJECT_MANIFEST_MISMATCH', `${relativePath} is missing from the complete project revision`, 6, { recovery: 'restore the last complete history snapshot' });
    const value = fs.readFileSync(target);
    if (value.length !== expected.bytes || sha256(value) !== expected.sha256) {
      throw projectError('PROJECT_MANIFEST_MISMATCH', `${relativePath} does not match the complete project revision`, 6, { recovery: 'restore the last complete history snapshot' });
    }
  }
}

function atomicWriteJson(file, value) {
  atomicWrite(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function atomicWrite(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, buffer);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

function archiveOldHistory(projectDir) {
  const historyRoot = path.join(projectDir, 'history');
  const archiveRoot = path.join(historyRoot, 'archive');
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const revisions = fs.readdirSync(historyRoot)
    .filter((name) => /^\d{6}\.project\.json$/.test(name))
    .sort();
  for (const projectName of revisions.slice(0, Math.max(0, revisions.length - 50))) {
    const prefix = projectName.slice(0, 6);
    for (const suffix of ['project.json', 'scene.json', 'audit.json']) {
      const source = path.join(historyRoot, `${prefix}.${suffix}`);
      if (fs.existsSync(source)) fs.renameSync(source, path.join(archiveRoot, `${prefix}.${suffix}`));
    }
  }
}

function readJsonBounded(file, limit) {
  const stat = fs.statSync(file);
  if (stat.size > limit) throw projectError('INPUT_TOO_LARGE', `${path.basename(file)} exceeds ${limit} bytes`, 2);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'), rejectPrototypeKeys);
  assertJsonComplexity(value);
  return value;
}

function rejectPrototypeKeys(key, value) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw projectError('UNTRUSTED_JSON', 'prototype-polluting JSON key rejected', 2);
  return value;
}

function assertJsonComplexity(value) {
  const queue = [{ value, depth: 0 }];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (cursor > 200_000) throw projectError('INPUT_TOO_COMPLEX', 'project JSON contains too many values', 2);
    if (current.depth > 100) throw projectError('INPUT_TOO_DEEP', 'project JSON exceeds 100 nested levels', 2);
    if (current.value && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) queue.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function assertNoSymlinkEscape(root, target) {
  let current = root;
  const relative = path.relative(root, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw projectError('SYMLINK_ESCAPE', 'symbolic links are not allowed in project paths', 4);
  }
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 10000) / 10000;
  return value;
}

function uniqueIds(items, key, label, errors) {
  const ids = new Set();
  if (!Array.isArray(items)) return ids;
  for (const item of items) {
    if (!plainObject(item) || !item[key]) errors.push(`${label}: every item needs ${key}`);
    else if (ids.has(item[key])) errors.push(`${label}: duplicate ${key} ${item[key]}`);
    else ids.add(item[key]);
  }
  return ids;
}

function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function list(value) { return Array.isArray(value) ? value : []; }
function array(value, label, errors) { if (!Array.isArray(value)) errors.push(`${label} must be an array`); }
function text(value, label, errors, limit) { if (typeof value !== 'string' || !value.trim() || value.length > limit) errors.push(`${label} must be a non-empty string of at most ${limit} characters`); }
function integer(value, label, errors, minimum) { if (!Number.isInteger(value) || value < minimum) errors.push(`${label} must be an integer >= ${minimum}`); }
function finite(value, label, errors) { if (!Number.isFinite(value)) errors.push(`${label} must be finite`); }
function positive(value, label, errors) { if (!Number.isFinite(value) || value <= 0) errors.push(`${label} must be positive`); }
function range(value, min, max, label, errors) { if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max}`); }
function point2(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite); }
function iso(value, label, errors) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) errors.push(`${label} must be an ISO timestamp`); }
function safeRelative(value) { return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'); }
function isInside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function cleanToken(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'; }
