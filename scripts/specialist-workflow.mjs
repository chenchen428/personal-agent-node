#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceSpecialistWorkflow,
  createSpecialistWorkflowDraftState,
  createSpecialistWorkflowState,
  reopenSpecialistWorkflow,
  specialistWorkflowPageFolder,
  syncSpecialistWorkflowProgress,
  validateSpecialistWorkflow,
  validateSpecialistWorkflowState,
} from "../core/agent/src/agents/workflow.js";
import { renderSpecialistWorkflowPage } from "../core/agent/src/agents/workflow-page.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command = "validate", ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === "validate") {
    const ids = args.agent ? [String(args.agent)] : registeredAgentIds();
    const results = ids.map((agentId) => ({ agentId, ...validateSpecialistWorkflow(readDefinition(agentId), { agentId }) }));
    if (results.some((result) => !result.ok)) throw new Error(results.flatMap((result) => result.errors.map((error) => `${result.agentId}: ${error}`)).join("; "));
    print({ ok: true, workflows: results.map((result) => result.agentId) });
  } else if (command === "accept") {
    requireArgs(args, ["agent"]);
    const definition = readDefinition(args.agent);
    print(runAcceptance(definition));
  } else if (command === "init") {
    requireArgs(args, ["agent", "project-key", "progress-publication", "out"]);
    const definition = readDefinition(args.agent);
    const state = createSpecialistWorkflowState(definition, {
      projectKey: args["project-key"],
      mode: args.mode || "standard",
      progressPage: readJson(args["progress-publication"]),
    });
    writeJson(args.out, state, { mustNotExist: true });
    print({ ok: true, state });
  } else if (command === "advance") {
    requireArgs(args, ["agent", "state", "event"]);
    const definition = readDefinition(args.agent);
    const state = readJson(args.state);
    const event = readJson(args.event);
    const next = advanceSpecialistWorkflow(definition, state, event);
    writeJson(args.state, next);
    print({ ok: true, state: next });
  } else if (command === "reopen") {
    requireArgs(args, ["agent", "state", "event"]);
    const definition = readDefinition(args.agent);
    const state = readJson(args.state);
    const next = reopenSpecialistWorkflow(definition, state, readJson(args.event));
    writeJson(args.state, next);
    print({ ok: true, state: next });
  } else if (command === "sync") {
    requireArgs(args, ["agent", "state", "progress-publication"]);
    const definition = readDefinition(args.agent);
    const state = readJson(args.state);
    const next = syncSpecialistWorkflowProgress(definition, state, readJson(args["progress-publication"]));
    writeJson(args.state, next);
    print({ ok: true, state: next });
  } else if (command === "page") {
    requireArgs(args, ["agent", "out-dir"]);
    const definition = readDefinition(args.agent);
    const state = args.state
      ? readJson(args.state)
      : createSpecialistWorkflowDraftState(definition, {
        projectKey: requiredArg(args, "project-key"),
        mode: args.mode || "standard",
      });
    const stateValidation = validateSpecialistWorkflowState(definition, state);
    if (!stateValidation.ok) throw new Error(`invalid workflow state: ${stateValidation.errors.join("; ")}`);
    const directory = path.resolve(args["out-dir"]);
    fs.mkdirSync(directory, { recursive: true });
    const index = path.join(directory, "index.html");
    fs.writeFileSync(index, renderSpecialistWorkflowPage(definition, state, { title: args.title }), "utf8");
    print({
      ok: true,
      index,
      folder: specialistWorkflowPageFolder(definition, state.projectKey),
      revision: state.revision,
      publish: `pa-cli pages publish --private --overwrite --file <index.html> --folder ${specialistWorkflowPageFolder(definition, state.projectKey)} --json`,
    });
  } else if (command === "status") {
    requireArgs(args, ["agent", "state"]);
    const definition = readDefinition(args.agent);
    const state = readJson(args.state);
    const validation = validateSpecialistWorkflow(definition, { agentId: args.agent });
    const stateValidation = validateSpecialistWorkflowState(definition, state);
    if (!validation.ok || !stateValidation.ok) throw new Error(`state does not match Agent workflow: ${stateValidation.errors.join("; ")}`);
    print({
      ok: true,
      stage: state.stage,
      revision: state.revision,
      progressPageRevision: state.progressPage?.publishedRevision,
      progressPageCurrent: state.progressPage?.publishedRevision === state.revision,
      terminal: state.stage === "delivered" && state.progressPage?.publishedRevision === state.revision,
    });
  } else {
    throw new Error("usage: specialist-workflow <validate|accept|page|init|advance|reopen|sync|status> [--agent <id>] [--project-key <key>] [--mode <standard|recommended>] [--progress-publication <json>] [--out-dir <dir>] [--out <file>] [--state <file>] [--event <file>]");
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "WORKFLOW_COMMAND_FAILED", error: error.message })}\n`);
  process.exitCode = 1;
}

function registeredAgentIds() {
  return readJson(path.join(root, "registry", "agents.json")).agents.map((entry) => entry.id);
}

function readDefinition(agentId) {
  const id = String(agentId || "");
  if (!/^[a-z][a-z0-9-]{2,47}$/.test(id) || !registeredAgentIds().includes(id)) throw new Error(`unknown Agent: ${id}`);
  return readJson(path.join(root, "agents", id, "workflow.json"));
}

function runAcceptance(definition) {
  const validation = validateSpecialistWorkflow(definition, { agentId: definition.agentId });
  invariant(validation.ok, `workflow validation failed: ${validation.errors.join("; ")}`);

  const standard = traverseWorkflow(definition, { mode: "standard" });
  const result = {
    ok: true,
    agentId: definition.agentId,
    workflowId: definition.id,
    workflowVersion: definition.version,
    stageOrder: definition.stages.map((stage) => stage.id),
    standard,
  };
  if (definition.agentId === "interior-designer") result.interior = acceptInteriorWorkflow(definition);
  return result;
}

function traverseWorkflow(definition, { mode }) {
  const projectKey = `project_accept_${definition.agentId.replaceAll("-", "_")}_${mode}`;
  const progress = progressPublication(definition, projectKey);
  const negativeGates = [];
  const draft = createSpecialistWorkflowDraftState(definition, { projectKey, mode });
  expectWorkflowCode(
    () => advanceSpecialistWorkflow(definition, draft, { baseRevision: 0 }),
    "WORKFLOW_PROGRESS_PAGE_REQUIRED",
  );
  negativeGates.push("unpublished-progress-page");

  let state = createSpecialistWorkflowState(definition, { projectKey, mode, progressPage: progress });
  let testedMissingConfirmation = false;
  let testedWrongPage = false;
  let testedStageSkip = false;
  while (state.stage !== "delivered") {
    const stage = definition.stages.find((candidate) => candidate.id === state.stage);
    const facts = factsForStage(stage, { recommendedAuthorized: mode === "recommended" });
    const artifacts = stage.requiredArtifacts.map((kind, index) => pageArtifact(kind, `${state.revision}-${index}`));
    const reviewedArtifact = artifacts.find((artifact) => artifact.kind === stage.review.artifactKind);
    const confirmation = stage.review.surface === "page"
      ? { confirmed: true, summary: `accepted ${stage.id}`, surface: "page", pageId: reviewedArtifact.pageId }
      : { confirmed: true, summary: `accepted ${stage.id}`, surface: "text" };

    if (!testedMissingConfirmation) {
      expectWorkflowCode(
        () => advanceSpecialistWorkflow(definition, state, { baseRevision: state.revision, facts, artifacts }),
        "WORKFLOW_CONFIRMATION_REQUIRED",
      );
      negativeGates.push("explicit-confirmation-required");
      testedMissingConfirmation = true;
    }
    if (!testedStageSkip && definition.stages.length > 2) {
      expectWorkflowCode(
        () => advanceSpecialistWorkflow(definition, state, { baseRevision: state.revision, nextStage: definition.stages[2].id }),
        "WORKFLOW_STAGE_SKIP",
      );
      negativeGates.push("stage-skip-rejected");
      testedStageSkip = true;
    }
    if (!testedWrongPage && stage.review.surface === "page") {
      expectWorkflowCode(
        () => advanceSpecialistWorkflow(definition, state, {
          baseRevision: state.revision,
          facts,
          artifacts,
          confirmation: { ...confirmation, pageId: "private-review-wrong-page" },
        }),
        "WORKFLOW_CONFIRMATION_PAGE_INVALID",
      );
      negativeGates.push("wrong-review-page-rejected");
      testedWrongPage = true;
    }
    for (const rule of stage.factRules) {
      const invalidFacts = { ...facts, [rule.key]: invalidRuleValue(rule) };
      expectWorkflowCode(
        () => advanceSpecialistWorkflow(definition, state, {
          baseRevision: state.revision,
          facts: invalidFacts,
          artifacts,
          confirmation,
        }),
        "WORKFLOW_FACT_RULE_FAILED",
      );
      negativeGates.push(`fact-rule:${rule.key}`);
    }

    state = advanceSpecialistWorkflow(definition, state, {
      baseRevision: state.revision,
      facts,
      artifacts,
      confirmation,
    });
    invariant(state.progressPage.publishedRevision !== state.revision, "transition must make the progress Page stale");
    if (state.stage !== "delivered") {
      expectWorkflowCode(
        () => advanceSpecialistWorkflow(definition, state, { baseRevision: state.revision }),
        "WORKFLOW_PROGRESS_PAGE_STALE",
      );
      if (!negativeGates.includes("stale-progress-page")) negativeGates.push("stale-progress-page");
    }
    state = syncSpecialistWorkflowProgress(definition, state, progress);
  }

  const html = renderSpecialistWorkflowPage(definition, state);
  invariant(/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/.test(html), "progress Page must declare a mobile viewport");
  invariant(/Content-Security-Policy/.test(html), "progress Page must declare a Content Security Policy");
  invariant(!/(?:file:\/\/|[A-Za-z]:\\)/.test(html), "progress Page must not expose local file paths");
  invariant(state.progressPage.publishedRevision === state.revision, "terminal progress Page must be synced");
  invariant(state.confirmations.length === definition.stages.length - 1, "every non-terminal stage must be explicitly confirmed");

  return {
    mode,
    finalStage: state.stage,
    revision: state.revision,
    progressPageId: state.progressPage.pageId,
    progressPageSynced: true,
    confirmationCount: state.confirmations.length,
    textGateCount: definition.stages.filter((stage) => stage.review.surface === "text").length,
    pageGateCount: definition.stages.filter((stage) => stage.review.surface === "page").length,
    negativeGates,
    renderer: { mobileViewport: true, contentSecurityPolicy: true, localPathsAbsent: true },
  };
}

function acceptInteriorWorkflow(definition) {
  const expectedOrder = [
    "project-intake",
    "design-development",
    "drawing-review",
    "spatial-sketch-review",
    "panorama-production",
    "tour-review",
    "shareable-delivery",
    "delivered",
  ];
  invariant(JSON.stringify(definition.stages.map((stage) => stage.id)) === JSON.stringify(expectedOrder), "interior stage order is not exact");
  invariant(!definition.interaction.recommendedCheckpoint, "interior workflow must not define a second or recommended mode");
  const development = definition.stages.find((stage) => stage.id === "design-development");
  const drawings = definition.stages.find((stage) => stage.id === "drawing-review");
  const sketch = definition.stages.find((stage) => stage.id === "spatial-sketch-review");
  const panorama = definition.stages.find((stage) => stage.id === "panorama-production");
  const tour = definition.stages.find((stage) => stage.id === "tour-review");
  const delivery = definition.stages.find((stage) => stage.id === "shareable-delivery");
  invariant(development.requiredArtifacts.includes("design-review-page"), "interior design development requires a review Page");
  invariant(drawings.requiredFacts.includes("six-drawings-generated") && drawings.requiredArtifacts.includes("drawing-cabinet"), "interior drawing review must require six independent drawings");
  invariant(sketch.requiredArtifacts.includes("spatial-sketch-3d"), "interior sketch review must require semantic Web 3D");
  invariant(panorama.requiredFacts.includes("one-image-per-generation") && panorama.requiredFacts.includes("all-panorama-nodes-confirmed"), "interior panorama production must be one view at a time");
  invariant(tour.requiredArtifacts.includes("krpano-tour") && tour.requiredFacts.includes("tour-walkthrough-passed"), "interior tour review must require krpano walkthrough");
  invariant(delivery.requiredFacts.includes("page-bundle-verified") && delivery.requiredFacts.includes("artifact-workflow-complete"), "interior delivery must verify the Page bundle and artifact workflow");
  return {
    exactStageOrder: true,
    singlePipeline: true,
    compatibilityModes: 0,
    shareableOutputs: ["Owner-Page", "Online-SVG", "Semantic-Web3D", "Krpano-Tour"],
    geometryAuthority: "geometry.json",
  };
}

function progressPublication(definition, projectKey) {
  const folder = specialistWorkflowPageFolder(definition, projectKey);
  return {
    pageId: `private-${folder}`,
    internalUrl: `/publications/${folder}/index.html`,
    url: "",
    linkNotice: "Remote access is not configured for this in-memory acceptance run.",
  };
}

function pageArtifact(kind, suffix) {
  const safeSuffix = String(suffix).replace(/[^a-zA-Z0-9_-]/g, "-");
  return {
    kind,
    type: "page",
    pageId: `private-review-${safeSuffix}-${kind}`,
    title: `${kind} review`,
    url: "",
    internalUrl: `/publications/review-${safeSuffix}-${kind}/index.html`,
  };
}

function factsForStage(stage, { recommendedAuthorized }) {
  const rules = new Map(stage.factRules.map((rule) => [rule.key, rule]));
  return Object.fromEntries(stage.requiredFacts.map((key) => {
    const rule = rules.get(key);
    if (rule?.operator === "equals") return [key, rule.value];
    if (rule?.operator === "min-number") return [key, rule.value];
    if (rule?.operator === "min-items") return [key, Array.from({ length: rule.value }, (_, index) => `${key}-${index + 1}`)];
    if (key === "recommended-mode-authorized") return [key, Boolean(recommendedAuthorized)];
    return [key, `${key}-accepted`];
  }));
}

function invalidRuleValue(rule) {
  if (rule.operator === "equals") return typeof rule.value === "boolean" ? !rule.value : `${rule.value}-invalid`;
  if (rule.operator === "min-number") return rule.value - 1;
  if (rule.operator === "min-items") return Array.from({ length: Math.max(0, rule.value - 1) }, (_, index) => `invalid-${index + 1}`);
  throw new Error(`unsupported fact rule: ${rule.operator}`);
}

function expectWorkflowCode(action, expectedCode) {
  try {
    action();
  } catch (error) {
    invariant(error.code === expectedCode, `expected ${expectedCode}, received ${error.code || error.message}`);
    return;
  }
  throw new Error(`expected ${expectedCode}`);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") || !values[index + 1] || values[index + 1].startsWith("--")) throw new Error(`invalid argument: ${value}`);
    output[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return output;
}

function requireArgs(argsValue, names) {
  for (const name of names) if (!argsValue[name]) throw new Error(`missing --${name}`);
}

function requiredArg(argsValue, name) {
  requireArgs(argsValue, [name]);
  return argsValue[name];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeJson(file, value, { mustNotExist = false } = {}) {
  const target = path.resolve(file);
  if (mustNotExist && fs.existsSync(target)) throw new Error(`state already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
