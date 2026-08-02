// Historical representative-delivery projection only. New customer work is
// governed by agents/interior-designer/workflow.json and specialist-workflow.mjs.
export const DEMAND_WORKFLOW_VERSION = 1;

export const DEMAND_WORKFLOW_STAGES = Object.freeze([
  'intake',
  'functional-discovery',
  'layout-review',
  'style-calibration',
  'render-storyboard',
  'render-review',
  'brief-frozen',
  'delivered',
]);

export const DEMAND_WORKFLOW_PROJECT_STATUS = Object.freeze({
  intake: 'intake',
  'functional-discovery': 'functional_discovery',
  'layout-review': 'layout_review',
  'style-calibration': 'style_calibration',
  'render-storyboard': 'render_storyboard',
  'render-review': 'render_review',
  'brief-frozen': 'brief_frozen',
  delivered: 'user_visual_acceptance_pending',
});

const WORKFLOW_STATUSES = new Set(['awaiting-user', 'in-progress', 'confirmed', 'user-visual-acceptance-pending']);
const QUESTION_STATUSES = new Set(['open', 'answered', 'deferred']);
const SHOT_ROLES = new Set(['room-context', 'supporting-view', 'private-space', 'detail']);
const SHOT_STATUSES = new Set(['planned', 'approved', 'rendered', 'stale']);
const RENDER_STATUSES = new Set(['candidate', 'selected', 'rejected', 'stale']);

export function createDemandWorkflow(seed = {}) {
  return {
    version: DEMAND_WORKFLOW_VERSION,
    purpose: 'requirements-discovery',
    stage: 'intake',
    status: 'awaiting-user',
    openQuestions: [],
    confirmations: [],
    transitions: [],
    styleProfile: null,
    renderStoryboard: [],
    renderSet: [],
    staleArtifacts: [],
    ...structuredClone(seed),
  };
}

export function validateDemandWorkflow(workflow, { requirementIds = new Set(), evidenceIds = new Set() } = {}) {
  const errors = [];
  if (!object(workflow)) return ['demandWorkflow must be an object'];
  if (workflow.version !== DEMAND_WORKFLOW_VERSION) errors.push('demandWorkflow.version is unsupported');
  if (workflow.purpose !== 'requirements-discovery') errors.push('demandWorkflow.purpose is invalid');
  const stageIndex = DEMAND_WORKFLOW_STAGES.indexOf(workflow.stage);
  if (stageIndex < 0) errors.push('demandWorkflow.stage is invalid');
  if (!WORKFLOW_STATUSES.has(workflow.status)) errors.push('demandWorkflow.status is invalid');

  const questions = array(workflow.openQuestions);
  unique(questions.map((entry) => entry?.questionId), 'demandWorkflow question IDs', errors);
  for (const question of questions) {
    if (!object(question)) {
      errors.push('demandWorkflow question must be an object');
      continue;
    }
    requiredText(question.questionId, 'demandWorkflow questionId', errors);
    requiredText(question.prompt, `demandWorkflow question ${question.questionId}: prompt`, errors);
    if (!DEMAND_WORKFLOW_STAGES.includes(question.stage)) errors.push(`demandWorkflow question ${question.questionId}: stage is invalid`);
    if (!QUESTION_STATUSES.has(question.status)) errors.push(`demandWorkflow question ${question.questionId}: status is invalid`);
    if (typeof question.required !== 'boolean') errors.push(`demandWorkflow question ${question.questionId}: required must be boolean`);
    if (question.status === 'answered' && !String(question.answer || '').trim()) errors.push(`demandWorkflow question ${question.questionId}: answered question needs an answer`);
  }

  const confirmations = array(workflow.confirmations);
  unique(confirmations.map((entry) => entry?.confirmationId), 'demandWorkflow confirmation IDs', errors);
  for (const confirmation of confirmations) {
    if (!object(confirmation)) {
      errors.push('demandWorkflow confirmation must be an object');
      continue;
    }
    requiredText(confirmation.confirmationId, 'demandWorkflow confirmationId', errors);
    if (!DEMAND_WORKFLOW_STAGES.includes(confirmation.stage)) errors.push(`demandWorkflow confirmation ${confirmation.confirmationId}: stage is invalid`);
    if (!Number.isInteger(confirmation.projectRevision) || confirmation.projectRevision < 1) errors.push(`demandWorkflow confirmation ${confirmation.confirmationId}: projectRevision is invalid`);
    if (confirmation.source !== 'user') errors.push(`demandWorkflow confirmation ${confirmation.confirmationId}: source must be user`);
    if (!Array.isArray(confirmation.scope) || !confirmation.scope.length || confirmation.scope.some((value) => !String(value).trim())) errors.push(`demandWorkflow confirmation ${confirmation.confirmationId}: scope is required`);
    if (!validDate(confirmation.confirmedAt)) errors.push(`demandWorkflow confirmation ${confirmation.confirmationId}: confirmedAt is invalid`);
  }

  const transitions = array(workflow.transitions);
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    if (!object(transition) || transition.from !== DEMAND_WORKFLOW_STAGES[index] || transition.to !== DEMAND_WORKFLOW_STAGES[index + 1]) errors.push(`demandWorkflow transition ${index + 1} is not contiguous`);
    if (!Number.isInteger(transition?.projectRevision) || transition.projectRevision < 2) errors.push(`demandWorkflow transition ${index + 1}: projectRevision is invalid`);
    if (!validDate(transition?.at)) errors.push(`demandWorkflow transition ${index + 1}: at is invalid`);
    if (!confirmations.some((entry) => entry.confirmationId === transition?.confirmationId && entry.stage === transition?.from)) errors.push(`demandWorkflow transition ${index + 1}: confirmation does not resolve`);
  }
  if (stageIndex >= 0 && transitions.length !== stageIndex) errors.push('demandWorkflow transition count does not match current stage');

  validateStyleProfile(workflow.styleProfile, errors);
  validateStoryboard(workflow.renderStoryboard, requirementIds, errors);
  validateRenderSet(workflow.renderSet, workflow.renderStoryboard, evidenceIds, workflow.styleProfile?.primary?.styleId, errors);
  if (stageIndex >= DEMAND_WORKFLOW_STAGES.indexOf('render-storyboard') && workflow.styleProfile?.status !== 'confirmed') errors.push('demandWorkflow requires a confirmed style profile before render-storyboard');
  if (stageIndex >= DEMAND_WORKFLOW_STAGES.indexOf('render-review')) {
    const activeShots = array(workflow.renderStoryboard).filter((entry) => entry.status !== 'stale');
    const roles = new Set(activeShots.map((entry) => entry.role));
    for (const role of ['room-context', 'supporting-view', 'private-space']) if (!roles.has(role)) errors.push(`demandWorkflow render storyboard must include ${role}`);
    if (activeShots.some((entry) => !['approved', 'rendered'].includes(entry.status))) errors.push('demandWorkflow render storyboard must be approved before render-review');
  }
  if (stageIndex >= DEMAND_WORKFLOW_STAGES.indexOf('brief-frozen') && array(workflow.renderSet).filter((entry) => entry.status === 'selected').length < 3) errors.push('demandWorkflow needs at least three selected renders before brief-frozen');
  if (workflow.stage === 'delivered' && questions.some((entry) => entry.required && entry.status === 'open')) errors.push('demandWorkflow cannot deliver with required open questions');
  return errors;
}

export function advanceDemandWorkflow(workflowInput, event, {
  currentRevision,
  requirementIds = new Set(),
  evidenceIds = new Set(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(currentRevision) || currentRevision < 1) throw workflowError('WORKFLOW_REVISION_REQUIRED', 'current project revision is required');
  if (!object(event)) throw workflowError('INVALID_WORKFLOW_EVENT', 'workflow event must be an object');
  const workflow = createDemandWorkflow(workflowInput);
  const fromIndex = DEMAND_WORKFLOW_STAGES.indexOf(workflow.stage);
  const targetStage = String(event.targetStage || '');
  if (targetStage !== DEMAND_WORKFLOW_STAGES[fromIndex + 1]) throw workflowError('WORKFLOW_STAGE_SKIP', `workflow can only advance from ${workflow.stage} to ${DEMAND_WORKFLOW_STAGES[fromIndex + 1] || 'no later stage'}`);
  const nextRevision = currentRevision + 1;
  const timestamp = now();
  const patch = object(event.patch) ? event.patch : {};
  for (const field of ['openQuestions', 'styleProfile', 'renderStoryboard', 'renderSet', 'staleArtifacts']) if (field in patch) workflow[field] = structuredClone(patch[field]);
  const unresolved = array(workflow.openQuestions).filter((entry) => entry.stage === workflow.stage && entry.required && entry.status === 'open');
  if (unresolved.length) throw workflowError('WORKFLOW_QUESTIONS_OPEN', `required questions remain open for ${workflow.stage}`, { questionIds: unresolved.map((entry) => entry.questionId) });
  const confirmation = event.confirmation;
  if (!object(confirmation) || !Array.isArray(confirmation.scope) || !confirmation.scope.length) throw workflowError('WORKFLOW_CONFIRMATION_REQUIRED', `user confirmation is required for ${workflow.stage}`);
  const confirmationId = String(confirmation.confirmationId || `confirm-${workflow.stage}-${nextRevision}`);
  workflow.confirmations.push({ confirmationId, stage: workflow.stage, projectRevision: nextRevision, source: 'user', scope: confirmation.scope.map(String), confirmedAt: timestamp });
  workflow.transitions.push({ from: workflow.stage, to: targetStage, projectRevision: nextRevision, confirmationId, at: timestamp, summary: String(event.summary || '') });
  workflow.stage = targetStage;
  workflow.status = targetStage === 'delivered' ? 'user-visual-acceptance-pending' : String(event.status || 'awaiting-user');
  const errors = validateDemandWorkflow(workflow, { requirementIds, evidenceIds });
  if (errors.length) throw workflowError('WORKFLOW_VALIDATION_FAILED', errors.join('\n'), { errors });
  return workflow;
}

function validateStyleProfile(profile, errors) {
  if (profile === null || profile === undefined) return;
  if (!object(profile)) return errors.push('demandWorkflow.styleProfile must be null or an object');
  if (!['candidate', 'confirmed'].includes(profile.status)) errors.push('demandWorkflow.styleProfile.status is invalid');
  if (!object(profile.primary)) errors.push('demandWorkflow.styleProfile.primary is required');
  for (const [label, direction] of [['primary', profile.primary], ['secondary', profile.secondary]]) {
    if (direction === undefined || direction === null) continue;
    if (!object(direction)) {
      errors.push(`demandWorkflow.styleProfile.${label} must be an object`);
      continue;
    }
    requiredText(direction.styleId, `demandWorkflow.styleProfile.${label}.styleId`, errors);
    requiredText(direction.label, `demandWorkflow.styleProfile.${label}.label`, errors);
    if (!object(direction.observable)) errors.push(`demandWorkflow.styleProfile.${label}.observable is required`);
    for (const field of ['contrast', 'woodTone', 'surface', 'lighting', 'visualDensity']) requiredText(direction.observable?.[field], `demandWorkflow.styleProfile.${label}.observable.${field}`, errors);
    if (!Array.isArray(direction.borrow) || !Array.isArray(direction.avoid)) errors.push(`demandWorkflow.styleProfile.${label} needs borrow and avoid arrays`);
  }
}

function validateStoryboard(storyboardInput, requirementIds, errors) {
  const storyboard = array(storyboardInput);
  unique(storyboard.map((entry) => entry?.shotId), 'demandWorkflow shot IDs', errors);
  unique(storyboard.map((entry) => entry?.sequence), 'demandWorkflow shot sequences', errors);
  for (const shot of storyboard) {
    if (!object(shot)) { errors.push('demandWorkflow storyboard shot must be an object'); continue; }
    requiredText(shot.shotId, 'demandWorkflow shotId', errors);
    requiredText(shot.space, `demandWorkflow shot ${shot.shotId}: space`, errors);
    requiredText(shot.purpose, `demandWorkflow shot ${shot.shotId}: purpose`, errors);
    if (!Number.isInteger(shot.sequence) || shot.sequence < 1) errors.push(`demandWorkflow shot ${shot.shotId}: sequence is invalid`);
    if (!SHOT_ROLES.has(shot.role)) errors.push(`demandWorkflow shot ${shot.shotId}: role is invalid`);
    if (!SHOT_STATUSES.has(shot.status)) errors.push(`demandWorkflow shot ${shot.shotId}: status is invalid`);
    if (!Array.isArray(shot.requirementIds)) errors.push(`demandWorkflow shot ${shot.shotId}: requirementIds is required`);
    if (requirementIds.size && shot.requirementIds?.some((id) => !requirementIds.has(id))) errors.push(`demandWorkflow shot ${shot.shotId}: requirementIds do not resolve`);
  }
}

function validateRenderSet(renderSetInput, storyboardInput, evidenceIds, selectedStyleId, errors) {
  const renderSet = array(renderSetInput);
  const shotIds = new Set(array(storyboardInput).map((entry) => entry?.shotId));
  unique(renderSet.map((entry) => entry?.renderId), 'demandWorkflow render IDs', errors);
  unique(renderSet.map((entry) => entry?.sequence), 'demandWorkflow render sequences', errors);
  for (const render of renderSet) {
    if (!object(render)) { errors.push('demandWorkflow render must be an object'); continue; }
    requiredText(render.renderId, 'demandWorkflow renderId', errors);
    requiredText(render.evidenceId, `demandWorkflow render ${render.renderId}: evidenceId`, errors);
    requiredText(render.styleId, `demandWorkflow render ${render.renderId}: styleId`, errors);
    if (selectedStyleId && render.styleId !== selectedStyleId) errors.push(`demandWorkflow render ${render.renderId}: styleId must match the confirmed style profile`);
    if (!shotIds.has(render.shotId)) errors.push(`demandWorkflow render ${render.renderId}: shotId does not resolve`);
    if (evidenceIds.size && !evidenceIds.has(render.evidenceId)) errors.push(`demandWorkflow render ${render.renderId}: evidenceId does not resolve`);
    if (!Number.isInteger(render.sequence) || render.sequence < 1) errors.push(`demandWorkflow render ${render.renderId}: sequence is invalid`);
    if (!RENDER_STATUSES.has(render.status)) errors.push(`demandWorkflow render ${render.renderId}: status is invalid`);
    for (const field of ['promptSha256', 'referenceSetSha256']) if (!sha(render[field])) errors.push(`demandWorkflow render ${render.renderId}: ${field} must be sha256`);
  }
}

function workflowError(code, message, detail = {}) { const error = new Error(message); error.code = code; error.exitCode = 6; error.detail = detail; return error; }
function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function array(value) { return Array.isArray(value) ? value : []; }
function sha(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function requiredText(value, label, errors) { if (!String(value || '').trim()) errors.push(`${label} is required`); }
function unique(values, label, errors) { const filtered = values.filter((value) => value !== undefined && value !== null); if (new Set(filtered).size !== filtered.length) errors.push(`${label} must be unique`); }
