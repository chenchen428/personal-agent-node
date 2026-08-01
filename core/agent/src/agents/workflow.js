const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const PROJECT_KEY_PATTERN = /^project_[a-z0-9][a-z0-9_-]{5,95}$/;
const PAGE_ID_PATTERN = /^private-[a-zA-Z0-9_-]{3,160}$/;
const REVIEW_SURFACES = new Set(["text", "page", "terminal"]);
const FACT_OPERATORS = new Set(["equals", "min-number", "min-items"]);

export function validateSpecialistWorkflow(definition, { agentId } = {}) {
  const errors = [];
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return { ok: false, errors: ["workflow must be an object"] };
  exactKeys(definition, ["schemaVersion", "id", "agentId", "version", "goal", "progressPage", "interaction", "stages"], "workflow", errors);
  if (definition.schemaVersion !== 2) errors.push("workflow.schemaVersion must be 2");
  if (!ID_PATTERN.test(String(definition.id || ""))) errors.push("workflow.id must be kebab-case");
  if (!ID_PATTERN.test(String(definition.agentId || ""))) errors.push("workflow.agentId must be kebab-case");
  if (agentId && definition.agentId !== agentId) errors.push(`workflow.agentId must match ${agentId}`);
  if (!Number.isInteger(definition.version) || definition.version < 2) errors.push("workflow.version must be an integer of at least 2");
  if (!validText(definition.goal, 8, 240)) errors.push("workflow.goal must be concise non-empty text");
  validateProgressPage(definition.progressPage, errors);
  validateInteraction(definition.interaction, definition.stages, errors);
  validateStages(definition.stages, errors);
  return { ok: errors.length === 0, errors };
}

export function validateSpecialistWorkflowState(definition, state) {
  try {
    assertWorkflow(definition);
    assertState(definition, state);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export function createSpecialistWorkflowState(definition, { projectKey, mode = "standard", progressPage } = {}) {
  assertWorkflow(definition);
  if (!PROJECT_KEY_PATTERN.test(String(projectKey || ""))) throw workflowError("WORKFLOW_PROJECT_KEY_INVALID", "projectKey must use project_<stable-id> format");
  if (!['standard', 'recommended'].includes(mode)) throw workflowError("WORKFLOW_MODE_INVALID", "mode must be standard or recommended");
  if (mode === "recommended" && !definition.interaction.recommendedCheckpoint) throw workflowError("WORKFLOW_MODE_INVALID", "this workflow does not support recommended mode");
  return {
    schemaVersion: 2,
    workflowId: definition.id,
    workflowVersion: definition.version,
    agentId: definition.agentId,
    projectKey,
    mode,
    stage: definition.stages[0].id,
    revision: 0,
    progressPage: normalizeProgressPage(progressPage, 0),
    facts: {},
    artifacts: [],
    staleArtifacts: [],
    confirmations: [],
    history: [],
  };
}

export function createSpecialistWorkflowDraftState(definition, { projectKey, mode = "standard" } = {}) {
  assertWorkflow(definition);
  if (!PROJECT_KEY_PATTERN.test(String(projectKey || ""))) throw workflowError("WORKFLOW_PROJECT_KEY_INVALID", "projectKey must use project_<stable-id> format");
  if (!['standard', 'recommended'].includes(mode)) throw workflowError("WORKFLOW_MODE_INVALID", "mode must be standard or recommended");
  if (mode === "recommended" && !definition.interaction.recommendedCheckpoint) throw workflowError("WORKFLOW_MODE_INVALID", "this workflow does not support recommended mode");
  return {
    schemaVersion: 2,
    workflowId: definition.id,
    workflowVersion: definition.version,
    agentId: definition.agentId,
    projectKey,
    mode,
    stage: definition.stages[0].id,
    revision: 0,
    progressPage: {
      pageId: `private-${specialistWorkflowPageFolder(definition, projectKey)}`,
      url: "",
      internalUrl: "",
      linkNotice: "",
      publishedRevision: 0,
    },
    facts: {}, artifacts: [], staleArtifacts: [], confirmations: [], history: [],
  };
}

export function advanceSpecialistWorkflow(definition, state, event = {}) {
  assertWorkflow(definition);
  assertState(definition, state);
  requireCurrentProgressPage(state);
  if (event.baseRevision !== state.revision) throw workflowError("WORKFLOW_REVISION_CONFLICT", `expected base revision ${state.revision}`);
  const currentIndex = definition.stages.findIndex((stage) => stage.id === state.stage);
  const current = definition.stages[currentIndex];
  if (!current?.next) throw workflowError("WORKFLOW_ALREADY_DELIVERED", "workflow is already at its terminal stage");

  const targetStage = String(event.nextStage || current.next);
  const checkpoint = matchingRecommendedCheckpoint(definition, state, current, targetStage);
  if (targetStage !== current.next && !checkpoint) throw workflowError("WORKFLOW_STAGE_SKIP", `next stage must be ${current.next}`);
  const coveredStages = checkpoint
    ? checkpoint.stages.map((id) => definition.stages.find((stage) => stage.id === id))
    : [current];

  const facts = { ...state.facts, ...normalizeFacts(event.facts) };
  if (event.artifacts !== undefined && !Array.isArray(event.artifacts)) throw workflowError("WORKFLOW_EVENT_INVALID", "artifacts must be an array");
  const addedArtifacts = (event.artifacts || []).map(normalizeArtifact);
  const refreshedArtifactKeys = new Set(addedArtifacts.map(artifactKey));
  const staleArtifacts = state.staleArtifacts.filter((key) => !refreshedArtifactKeys.has(key));
  const artifacts = mergeArtifacts(state.artifacts, addedArtifacts);
  for (const stage of coveredStages) assertStageRequirements(stage, facts, artifacts, staleArtifacts, { skipArtifacts: Boolean(checkpoint) });
  if (checkpoint) assertRequiredArtifacts(checkpoint.requiredArtifacts, artifacts, staleArtifacts);
  if (checkpoint && !factPresent(facts[checkpoint.authorizationFact])) {
    throw workflowError("WORKFLOW_RECOMMENDED_AUTHORIZATION_REQUIRED", `recommended mode requires ${checkpoint.authorizationFact}`);
  }

  const review = checkpoint
    ? { surface: "page", artifactKind: checkpoint.reviewArtifactKind }
    : current.review;
  const confirmation = normalizeConfirmation(event.confirmation, review, artifacts, staleArtifacts);
  if (review.surface !== "terminal" && !confirmation) throw workflowError("WORKFLOW_CONFIRMATION_REQUIRED", `stage ${current.id} requires explicit user confirmation`);

  const revision = state.revision + 1;
  const history = checkpoint
    ? checkpoint.stages.map((from, index) => ({ from, to: definition.stages.find((stage) => stage.id === from).next, revision, checkpoint: true }))
    : [{ from: current.id, to: current.next, revision, checkpoint: false }];
  const confirmedStages = checkpoint ? [...checkpoint.stages] : [current.id];
  return {
    ...state,
    stage: targetStage,
    revision,
    facts,
    artifacts,
    staleArtifacts,
    confirmations: confirmation ? [...state.confirmations, { stages: confirmedStages, revision, ...confirmation }] : [...state.confirmations],
    history: [...state.history, ...history],
  };
}

export function reopenSpecialistWorkflow(definition, state, event = {}) {
  assertWorkflow(definition);
  assertState(definition, state);
  requireCurrentProgressPage(state);
  if (event.baseRevision !== state.revision) throw workflowError("WORKFLOW_REVISION_CONFLICT", `expected base revision ${state.revision}`);
  const currentIndex = definition.stages.findIndex((stage) => stage.id === state.stage);
  const targetIndex = definition.stages.findIndex((stage) => stage.id === event.targetStage);
  if (targetIndex < 0 || targetIndex >= currentIndex) throw workflowError("WORKFLOW_REOPEN_TARGET_INVALID", "feedback must reopen an earlier stage");
  if (!validText(event.reason, 4, 240)) throw workflowError("WORKFLOW_REOPEN_REASON_REQUIRED", "feedback reopening requires a concise reason");
  const affectedKinds = new Set(definition.stages.slice(targetIndex).flatMap((stage) => stage.requiredArtifacts));
  const newlyStale = state.artifacts.filter((artifact) => affectedKinds.has(artifact.kind)).map((artifact) => artifactKey(artifact));
  const revision = state.revision + 1;
  return {
    ...state,
    stage: event.targetStage,
    revision,
    staleArtifacts: [...new Set([...state.staleArtifacts, ...newlyStale])],
    history: [...state.history, { from: state.stage, to: event.targetStage, revision, reopened: true, reason: event.reason }],
  };
}

export function syncSpecialistWorkflowProgress(definition, state, publication) {
  assertWorkflow(definition);
  assertState(definition, state);
  const progressPage = normalizeProgressPage(publication, state.revision);
  if (progressPage.pageId !== state.progressPage.pageId) throw workflowError("WORKFLOW_PROGRESS_PAGE_CHANGED", "progress Page must keep its stable pageId");
  return { ...state, progressPage };
}

export function specialistWorkflowPageFolder(definition, projectKey) {
  assertWorkflow(definition);
  if (!PROJECT_KEY_PATTERN.test(String(projectKey || ""))) throw workflowError("WORKFLOW_PROJECT_KEY_INVALID", "projectKey must use project_<stable-id> format");
  return definition.progressPage.folderPattern
    .replace("{agentId}", definition.agentId)
    .replace("{projectKey}", projectKey)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function specialistWorkflowGuide(definition) {
  assertWorkflow(definition);
  const stages = definition.stages.map((stage, index) => {
    const gate = stage.review.surface === "page" ? `Page确认（${stage.review.artifactKind}）` : stage.review.surface === "text" ? "文字确认" : "终态";
    return `${index + 1}. ${stage.id}（${stage.title}，${gate}）：${stage.purpose}`;
  });
  const checkpoint = definition.interaction.recommendedCheckpoint;
  return [
    `本任务遵循 ${definition.id}@${definition.version}，目标：${definition.goal}`,
    `启动工作流前必须先发布一个私有、移动优先的稳定进度 Page，folder 使用 ${definition.progressPage.folderPattern}；每次状态变化后覆盖发布同一 Page 并同步到当前 revision，未同步时不得继续。`,
    `每轮最多返回 ${definition.interaction.maxQuestionsPerTurn} 个会实质影响结果的问题给主 Agent；不得直接联系用户。`,
    "短文本可在消息中确认；设计稿、图片、表格、长报告、分镜、账本和其他中间产物必须先发布为私有 Page，再让用户基于该 Page 明确确认。沉默和内部检查都不算确认。",
    "用户反馈影响已确认事实时，回到最早受影响阶段并创建新 revision；不得静默覆盖已确认版本。",
    ...(checkpoint ? [`只有用户明确授权“按推荐走”并写入 ${checkpoint.authorizationFact} 时，才允许把 ${checkpoint.stages.join(" + ")} 合并到一个 ${checkpoint.reviewArtifactKind} Page 做一次确认；其后的 Page 门禁仍不得合并或跳过。`] : []),
    ...stages,
  ].join("\n");
}

function validateProgressPage(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push("workflow.progressPage must be an object");
  exactKeys(value, ["required", "visibility", "mobileFirst", "refreshPolicy", "folderPattern"], "workflow.progressPage", errors);
  if (value.required !== true) errors.push("workflow.progressPage.required must be true");
  if (value.visibility !== "private") errors.push("workflow.progressPage.visibility must be private");
  if (value.mobileFirst !== true) errors.push("workflow.progressPage.mobileFirst must be true");
  if (value.refreshPolicy !== "every-transition") errors.push("workflow.progressPage.refreshPolicy must be every-transition");
  if (value.folderPattern !== "workflow-{agentId}-{projectKey}") errors.push("workflow.progressPage.folderPattern is unsupported");
}

function validateInteraction(value, stages, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push("workflow.interaction must be an object");
  exactKeys(value, ["maxQuestionsPerTurn", "confirmationPolicy", "revisionPolicy", "feedbackPolicy", "recommendedCheckpoint"], "workflow.interaction", errors);
  if (!Number.isInteger(value.maxQuestionsPerTurn) || value.maxQuestionsPerTurn < 1 || value.maxQuestionsPerTurn > 3) errors.push("workflow.interaction.maxQuestionsPerTurn must be between 1 and 3");
  if (value.confirmationPolicy !== "surface-aware-required") errors.push("workflow.interaction.confirmationPolicy must be surface-aware-required");
  if (value.revisionPolicy !== "optimistic") errors.push("workflow.interaction.revisionPolicy must be optimistic");
  if (value.feedbackPolicy !== "reopen-earliest-affected-stage") errors.push("workflow.interaction.feedbackPolicy must reopen the earliest affected stage");
  validateRecommendedCheckpoint(value.recommendedCheckpoint, stages, errors);
}

function validateRecommendedCheckpoint(value, stages, errors) {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push("workflow.interaction.recommendedCheckpoint must be null or an object");
  exactKeys(value, ["authorizationFact", "stages", "next", "requiredArtifacts", "reviewArtifactKind", "confirmationPrompt"], "workflow.interaction.recommendedCheckpoint", errors);
  if (!ID_PATTERN.test(String(value.authorizationFact || ""))) errors.push("recommendedCheckpoint.authorizationFact must be kebab-case");
  validateIdList(value.stages, "recommendedCheckpoint.stages", errors);
  validateIdList(value.requiredArtifacts, "recommendedCheckpoint.requiredArtifacts", errors);
  if (!ID_PATTERN.test(String(value.next || ""))) errors.push("recommendedCheckpoint.next must be kebab-case");
  if (!ID_PATTERN.test(String(value.reviewArtifactKind || ""))) errors.push("recommendedCheckpoint.reviewArtifactKind must be kebab-case");
  if (!validText(value.confirmationPrompt, 8, 200)) errors.push("recommendedCheckpoint.confirmationPrompt is invalid");
  if (!Array.isArray(value.stages) || value.stages.length < 2) return;
  const indexes = value.stages.map((id) => stages?.findIndex((stage) => stage.id === id));
  if (indexes.some((index) => index < 0) || indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) errors.push("recommendedCheckpoint.stages must be contiguous workflow stages");
  const finalStage = stages?.[indexes.at(-1)];
  if (finalStage?.next !== value.next) errors.push("recommendedCheckpoint.next must follow the final checkpoint stage");
  if (!value.requiredArtifacts?.includes(value.reviewArtifactKind)) errors.push("recommendedCheckpoint.reviewArtifactKind must be required");
}

function validateStages(stages, errors) {
  if (!Array.isArray(stages) || stages.length < 3 || stages.length > 8) return errors.push("workflow.stages must contain between 3 and 8 stages");
  const ids = new Set();
  for (const [index, stage] of stages.entries()) {
    const label = `workflow.stages[${index}]`;
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) { errors.push(`${label} must be an object`); continue; }
    exactKeys(stage, ["id", "title", "purpose", "review", "requiredFacts", "factRules", "requiredArtifacts", "confirmationPrompt", "next"], label, errors);
    if (!ID_PATTERN.test(String(stage.id || ""))) errors.push(`${label}.id must be kebab-case`);
    if (ids.has(stage.id)) errors.push(`${label}.id is duplicated`);
    ids.add(stage.id);
    if (!validText(stage.title, 2, 60)) errors.push(`${label}.title is invalid`);
    if (!validText(stage.purpose, 8, 200)) errors.push(`${label}.purpose is invalid`);
    validateReview(stage.review, stage.requiredArtifacts, label, errors);
    validateIdList(stage.requiredFacts, `${label}.requiredFacts`, errors);
    validateFactRules(stage.factRules, stage.requiredFacts, label, errors);
    validateIdList(stage.requiredArtifacts, `${label}.requiredArtifacts`, errors);
    const terminal = index === stages.length - 1;
    if (terminal) {
      if (stage.next !== null || stage.confirmationPrompt !== null || stage.review?.surface !== "terminal") errors.push(`${label} terminal stage must use terminal review and null next/confirmationPrompt`);
    } else {
      if (stage.next !== stages[index + 1]?.id) errors.push(`${label}.next must be the following stage`);
      if (!validText(stage.confirmationPrompt, 8, 200)) errors.push(`${label}.confirmationPrompt is invalid`);
      if (stage.review?.surface === "terminal") errors.push(`${label} non-terminal stage cannot use terminal review`);
    }
  }
  if (stages.at(-1)?.id !== "delivered") errors.push("workflow terminal stage must be delivered");
}

function validateReview(value, requiredArtifacts, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push(`${label}.review must be an object`);
  exactKeys(value, ["surface", "artifactKind"], `${label}.review`, errors);
  if (!REVIEW_SURFACES.has(value.surface)) errors.push(`${label}.review.surface is invalid`);
  if (value.surface === "page") {
    if (!ID_PATTERN.test(String(value.artifactKind || ""))) errors.push(`${label}.review.artifactKind must be kebab-case for Page review`);
    if (!requiredArtifacts?.includes(value.artifactKind)) errors.push(`${label}.review.artifactKind must be a required artifact`);
  } else if (value.artifactKind !== null) errors.push(`${label}.review.artifactKind must be null for text or terminal review`);
}

function validateFactRules(value, requiredFacts, label, errors) {
  if (!Array.isArray(value)) return errors.push(`${label}.factRules must be an array`);
  for (const [index, rule] of value.entries()) {
    const ruleLabel = `${label}.factRules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) { errors.push(`${ruleLabel} must be an object`); continue; }
    exactKeys(rule, ["key", "operator", "value"], ruleLabel, errors);
    if (!requiredFacts?.includes(rule.key)) errors.push(`${ruleLabel}.key must be listed in requiredFacts`);
    if (!FACT_OPERATORS.has(rule.operator)) errors.push(`${ruleLabel}.operator is invalid`);
    if (rule.operator === "min-number" && typeof rule.value !== "number") errors.push(`${ruleLabel}.value must be a number`);
    if (rule.operator === "min-items" && (!Number.isInteger(rule.value) || rule.value < 1)) errors.push(`${ruleLabel}.value must be a positive integer`);
    if (rule.operator === "equals" && !["string", "number", "boolean"].includes(typeof rule.value)) errors.push(`${ruleLabel}.value must be scalar`);
  }
}

function assertStageRequirements(stage, facts, artifacts, staleArtifacts = [], { skipArtifacts = false } = {}) {
  const missingFacts = stage.requiredFacts.filter((key) => !factPresent(facts[key]));
  if (missingFacts.length) throw workflowError("WORKFLOW_FACTS_REQUIRED", `missing required facts: ${missingFacts.join(", ")}`);
  if (!skipArtifacts) assertRequiredArtifacts(stage.requiredArtifacts, artifacts, staleArtifacts);
  for (const rule of stage.factRules) if (!factRuleSatisfied(facts[rule.key], rule)) throw workflowError("WORKFLOW_FACT_RULE_FAILED", `${rule.key} must satisfy ${rule.operator} ${rule.value}`);
}

function assertRequiredArtifacts(requiredArtifacts, artifacts, staleArtifacts = []) {
  const stale = new Set(staleArtifacts);
  const artifactKinds = new Set(artifacts.filter((artifact) => !stale.has(artifactKey(artifact))).map((artifact) => artifact.kind));
  const missingArtifacts = requiredArtifacts.filter((kind) => !artifactKinds.has(kind));
  if (missingArtifacts.length) throw workflowError("WORKFLOW_ARTIFACTS_REQUIRED", `missing required artifacts: ${missingArtifacts.join(", ")}`);
}

function factRuleSatisfied(value, rule) {
  if (rule.operator === "equals") return value === rule.value;
  if (rule.operator === "min-number") return typeof value === "number" && value >= rule.value;
  if (rule.operator === "min-items") return Array.isArray(value) && value.length >= rule.value;
  return false;
}

function matchingRecommendedCheckpoint(definition, state, current, targetStage) {
  const checkpoint = definition.interaction.recommendedCheckpoint;
  if (!checkpoint || state.mode !== "recommended" || checkpoint.stages[0] !== current.id || checkpoint.next !== targetStage) return null;
  return checkpoint;
}

function normalizeProgressPage(value, revision) {
  const publication = value?.publication || value?.asset || value;
  const pageId = String(publication?.pageId || publication?.page?.pageId || "");
  if (!PAGE_ID_PATTERN.test(pageId)) throw workflowError("WORKFLOW_PROGRESS_PAGE_REQUIRED", "a published private progress Page is required");
  const url = safePageUrl(publication?.url);
  const internalUrl = safePageUrl(publication?.internalUrl || publication?.page?.url);
  const linkNotice = String(publication?.linkNotice || "").slice(0, 240);
  if (!url && !internalUrl && !linkNotice) throw workflowError("WORKFLOW_PROGRESS_PAGE_REQUIRED", "progress Page publication evidence is incomplete");
  return { pageId, url, internalUrl, linkNotice, publishedRevision: revision };
}

function requireCurrentProgressPage(state) {
  if (!state.progressPage.url && !state.progressPage.internalUrl && !state.progressPage.linkNotice) {
    throw workflowError("WORKFLOW_PROGRESS_PAGE_REQUIRED", "progress Page must be privately published before the workflow can advance");
  }
  if (state.progressPage.publishedRevision !== state.revision) throw workflowError("WORKFLOW_PROGRESS_PAGE_STALE", `progress Page must be refreshed to revision ${state.revision}`);
}

function normalizeConfirmation(value, review, artifacts, staleArtifacts = []) {
  if (value === undefined || value === null) return null;
  if (value.confirmed !== true || !validText(value.summary, 4, 240)) throw workflowError("WORKFLOW_CONFIRMATION_REQUIRED", "confirmation must be explicit and include a summary");
  if (value.surface !== review.surface) throw workflowError("WORKFLOW_CONFIRMATION_SURFACE_INVALID", `confirmation must use ${review.surface}`);
  if (review.surface === "page") {
    const stale = new Set(staleArtifacts);
    const artifact = [...artifacts].reverse().find((entry) => entry.kind === review.artifactKind && entry.type === "page" && !stale.has(artifactKey(entry)));
    if (!artifact || value.pageId !== artifact.pageId) throw workflowError("WORKFLOW_CONFIRMATION_PAGE_INVALID", `confirmation must reference the ${review.artifactKind} Page`);
    return { summary: value.summary, surface: "page", pageId: value.pageId };
  }
  if (value.pageId !== undefined) throw workflowError("WORKFLOW_CONFIRMATION_SURFACE_INVALID", "text confirmation must not claim a Page");
  return { summary: value.summary, surface: "text" };
}

function mergeArtifacts(existing, added = []) {
  if (!Array.isArray(existing) || !Array.isArray(added)) throw workflowError("WORKFLOW_EVENT_INVALID", "artifacts must be arrays");
  const byKey = new Map(existing.map((artifact) => [artifactKey(artifact), artifact]));
  for (const value of added) {
    const artifact = normalizeArtifact(value);
    byKey.set(artifactKey(artifact), artifact);
  }
  return [...byKey.values()];
}

function normalizeArtifact(value) {
  const kind = String(value?.kind || "");
  const type = String(value?.type || "");
  if (!ID_PATTERN.test(kind) || !["page", "evidence"].includes(type)) throw workflowError("WORKFLOW_EVENT_INVALID", "artifact kind and type are invalid");
  if (type === "page") {
    const pageId = String(value?.pageId || "");
    const title = String(value?.title || "");
    if (!PAGE_ID_PATTERN.test(pageId) || !validText(title, 2, 120)) throw workflowError("WORKFLOW_EVENT_INVALID", "Page artifact requires a private pageId and title");
    const url = safePageUrl(value?.url);
    const internalUrl = safePageUrl(value?.internalUrl);
    if (!url && !internalUrl) throw workflowError("WORKFLOW_EVENT_INVALID", "Page artifact requires a governed URL");
    return { kind, type, pageId, title, url, internalUrl };
  }
  const ref = String(value?.ref || "");
  if (!validText(ref, 3, 160) || /(?:file:\/\/|[A-Za-z]:[\\/]|(?:^|\/)\.\.(?:\/|$))/.test(ref)) throw workflowError("WORKFLOW_EVENT_INVALID", "evidence artifact must use a governed reference");
  return { kind, type, ref };
}

function artifactKey(artifact) { return `${artifact.kind}:${artifact.type}:${artifact.pageId || artifact.ref}`; }

function normalizeFacts(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw workflowError("WORKFLOW_EVENT_INVALID", "facts must be an object");
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!ID_PATTERN.test(key)) throw workflowError("WORKFLOW_EVENT_INVALID", `invalid fact key: ${key}`);
    if (!factValue(item)) throw workflowError("WORKFLOW_EVENT_INVALID", `invalid fact value: ${key}`);
    output[key] = item;
  }
  return output;
}

function validateIdList(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => !ID_PATTERN.test(String(item || "")))) errors.push(`${label} must contain kebab-case identifiers`);
  else if (new Set(value).size !== value.length) errors.push(`${label} must not contain duplicates`);
}

function assertWorkflow(definition) {
  const validation = validateSpecialistWorkflow(definition);
  if (!validation.ok) throw workflowError("WORKFLOW_DEFINITION_INVALID", validation.errors.join("; "));
}

function assertState(definition, state) {
  if (!state || state.schemaVersion !== 2 || state.workflowId !== definition.id || state.workflowVersion !== definition.version || state.agentId !== definition.agentId) throw workflowError("WORKFLOW_STATE_INVALID", "state does not match workflow definition");
  if (!PROJECT_KEY_PATTERN.test(String(state.projectKey || "")) || !definition.stages.some((stage) => stage.id === state.stage) || !Number.isInteger(state.revision) || state.revision < 0) throw workflowError("WORKFLOW_STATE_INVALID", "state identity or revision is invalid");
  if (!['standard', 'recommended'].includes(state.mode)) throw workflowError("WORKFLOW_STATE_INVALID", "state mode is invalid");
  if (!PAGE_ID_PATTERN.test(String(state.progressPage?.pageId || "")) || !Number.isInteger(state.progressPage?.publishedRevision) || state.progressPage.publishedRevision < 0 || state.progressPage.publishedRevision > state.revision) throw workflowError("WORKFLOW_STATE_INVALID", "state progress Page is invalid");
  try {
    safePageUrl(state.progressPage.url);
    safePageUrl(state.progressPage.internalUrl);
    if (String(state.progressPage.linkNotice || "").length > 240) throw new Error("progress link notice is too long");
    normalizeFacts(state.facts);
    if (!Array.isArray(state.artifacts)) throw new Error("artifacts must be an array");
    state.artifacts.forEach(normalizeArtifact);
    for (const key of ["staleArtifacts", "confirmations", "history"]) if (!Array.isArray(state[key])) throw new Error(`${key} must be an array`);
    if (state.staleArtifacts.some((key) => typeof key !== "string" || key.length > 320)) throw new Error("stale artifact key is invalid");
  } catch (error) {
    throw workflowError("WORKFLOW_STATE_INVALID", `state payload is invalid: ${error.message}`);
  }
}

function safePageUrl(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/.test(text) || /^\/(?:public|publications)\/[^\s]+$/.test(text)) return text;
  throw workflowError("WORKFLOW_PAGE_URL_INVALID", "Page URL must be managed HTTPS or same-origin");
}

function factPresent(value) { return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0); }
function factValue(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return typeof value !== "string" || value.length <= 1000;
  return Array.isArray(value) && value.length <= 100 && value.every((item) => ["string", "number", "boolean"].includes(typeof item));
}
function validText(value, minimum, maximum) { return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum; }
function exactKeys(value, expected, label, errors) {
  const allowed = new Set(expected);
  for (const key of expected) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label} contains unsupported field ${key}`);
}
function workflowError(code, message) { return Object.assign(new Error(message), { code }); }
