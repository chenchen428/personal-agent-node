import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentCatalog } from "../core/agent/src/agents/catalog.js";
import { renderSpecialistWorkflowPage } from "../core/agent/src/agents/workflow-page.js";
import {
  advanceSpecialistWorkflow,
  createSpecialistWorkflowDraftState,
  createSpecialistWorkflowState,
  reopenSpecialistWorkflow,
  specialistWorkflowGuide,
  syncSpecialistWorkflowProgress,
  validateSpecialistWorkflow,
} from "../core/agent/src/agents/workflow.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentIds = ["interior-designer", "poster-designer", "travel-planner", "finance-analyst", "video-creator"];
const readDefinition = (agentId) => JSON.parse(fs.readFileSync(path.join(root, "agents", agentId, "workflow.json"), "utf8"));

test("all specialist Agents ship valid Page-led, surface-aware workflows", () => {
  for (const agentId of agentIds) {
    const workflow = readDefinition(agentId);
    const validation = validateSpecialistWorkflow(workflow, { agentId });
    assert.equal(validation.ok, true, `${agentId}: ${validation.errors.join("; ")}`);
    assert.ok(workflow.stages.length >= 7 && workflow.stages.length <= 8);
    assert.equal(workflow.progressPage.visibility, "private");
    assert.equal(workflow.progressPage.mobileFirst, true);
    assert.equal(workflow.stages.at(-1).id, "delivered");
    assert.ok(workflow.stages.some((stage) => stage.review.surface === "text"));
    assert.ok(workflow.stages.some((stage) => stage.review.surface === "page"));
    assert.match(specialistWorkflowGuide(workflow), /私有、移动优先的稳定进度 Page/);
  }
});

test("workflow cannot start without a published private progress Page", () => {
  const workflow = readDefinition("poster-designer");
  assert.throws(() => createSpecialistWorkflowState(workflow, { projectKey: "project_poster_demo" }), { code: "WORKFLOW_PROGRESS_PAGE_REQUIRED" });
  assert.throws(() => createSpecialistWorkflowState(workflow, {
    projectKey: "project_poster_demo",
    progressPage: publication("public-not-private"),
  }), { code: "WORKFLOW_PROGRESS_PAGE_REQUIRED" });
  const draft = createSpecialistWorkflowDraftState(workflow, { projectKey: "project_poster_draft" });
  assert.throws(() => advanceSpecialistWorkflow(workflow, draft, { baseRevision: 0 }), { code: "WORKFLOW_PROGRESS_PAGE_REQUIRED" });
});

test("text gate rejects Page confirmation and progress Page must refresh after every transition", () => {
  const workflow = readDefinition("poster-designer");
  const progress = publication("private-workflow-poster-designer-project_poster_demo");
  const state = createSpecialistWorkflowState(workflow, { projectKey: "project_poster_demo", progressPage: progress });
  const stage = workflow.stages[0];
  const facts = stageFacts(stage);
  assert.throws(() => advanceSpecialistWorkflow(workflow, state, { baseRevision: 0, facts }), { code: "WORKFLOW_CONFIRMATION_REQUIRED" });
  assert.throws(() => advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 0,
    facts,
    confirmation: { confirmed: true, summary: "用户确认建档", surface: "page", pageId: "private-wrong" },
  }), { code: "WORKFLOW_CONFIRMATION_SURFACE_INVALID" });
  const next = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 0,
    facts,
    confirmation: { confirmed: true, summary: "用户确认建档", surface: "text" },
  });
  assert.equal(next.stage, "content-brief");
  assert.throws(() => advanceSpecialistWorkflow(workflow, next, { baseRevision: 1 }), { code: "WORKFLOW_PROGRESS_PAGE_STALE" });
  const synced = syncSpecialistWorkflowProgress(workflow, next, progress);
  assert.equal(synced.progressPage.publishedRevision, 1);
});

test("Page gate requires the exact private artifact Page the user reviewed", () => {
  const workflow = readDefinition("poster-designer");
  const progress = publication("private-workflow-poster-designer-project_poster_page");
  let state = createSpecialistWorkflowState(workflow, { projectKey: "project_poster_page", progressPage: progress });
  state = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 0,
    facts: stageFacts(workflow.stages[0]),
    confirmation: { confirmed: true, summary: "确认任务范围", surface: "text" },
  });
  state = syncSpecialistWorkflowProgress(workflow, state, progress);
  const stage = workflow.stages[1];
  const artifact = pageArtifact(stage.review.artifactKind, 1);
  assert.throws(() => advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 1,
    facts: stageFacts(stage), artifacts: [artifact],
    confirmation: { confirmed: true, summary: "确认内容简报", surface: "page", pageId: "private-other-page" },
  }), { code: "WORKFLOW_CONFIRMATION_PAGE_INVALID" });
  state = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 1,
    facts: stageFacts(stage), artifacts: [artifact],
    confirmation: { confirmed: true, summary: "确认内容简报", surface: "page", pageId: artifact.pageId },
  });
  assert.equal(state.stage, "asset-audit");
});

test("interior render gates enforce one style sample and at least fifteen entrance-first views", () => {
  const workflow = readDefinition("interior-designer");
  const sample = workflow.stages.find((stage) => stage.id === "render-style-sample");
  const full = workflow.stages.find((stage) => stage.id === "full-render-set");
  assert.deepEqual(sample.factRules, [{ key: "sample-render-count", operator: "equals", value: 1 }]);
  assert.ok(full.factRules.some((rule) => rule.key === "render-count" && rule.operator === "min-number" && rule.value === 15));
  assert.ok(full.factRules.some((rule) => rule.key === "view-sequence" && rule.operator === "min-items" && rule.value === 15));
  assert.ok(full.factRules.some((rule) => rule.key === "entrance-first" && rule.operator === "equals" && rule.value === true));
});

test("interior recommended mode only batches floorplan and 3D at the 3D Page checkpoint", () => {
  const workflow = readDefinition("interior-designer");
  const progress = publication("private-workflow-interior-designer-project_home_demo");
  let state = createSpecialistWorkflowState(workflow, {
    projectKey: "project_home_demo",
    mode: "recommended",
    progressPage: progress,
  });
  state = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 0,
    facts: { ...stageFacts(workflow.stages[0]), "recommended-mode-authorized": true },
    confirmation: { confirmed: true, summary: "确认初步需求并授权按推荐走", surface: "text" },
  });
  state = syncSpecialistWorkflowProgress(workflow, state, progress);
  const floorplan = workflow.stages[1];
  const threeD = workflow.stages[2];
  const threeDPage = pageArtifact("three-d-design-page", 2);
  state = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 1,
    nextStage: "render-style-sample",
    facts: { ...stageFacts(floorplan), ...stageFacts(threeD), "recommended-mode-authorized": true },
    artifacts: [threeDPage],
    confirmation: { confirmed: true, summary: "在三维 Page 同时确认户型与三维设计", surface: "page", pageId: threeDPage.pageId },
  });
  assert.equal(state.stage, "render-style-sample");
  assert.equal(state.confirmations.at(-1).stages.length, 2);
  assert.equal(state.history.filter((entry) => entry.revision === 2).length, 2);
  state = syncSpecialistWorkflowProgress(workflow, state, progress);
  assert.throws(() => advanceSpecialistWorkflow(workflow, state, {
    baseRevision: 2,
    nextStage: "final-delivery",
  }), { code: "WORKFLOW_STAGE_SKIP" });
});

test("every specialist workflow traverses all Page and text gates to a synced final Page", () => {
  for (const agentId of agentIds) {
    const workflow = readDefinition(agentId);
    const projectKey = `project_${agentId.replaceAll("-", "_")}_demo`;
    const progress = publication(`private-workflow-${agentId}-${projectKey}`);
    let state = createSpecialistWorkflowState(workflow, { projectKey, progressPage: progress });
    while (state.stage !== "delivered") {
      const stage = workflow.stages.find((item) => item.id === state.stage);
      const artifacts = stage.requiredArtifacts.map((kind, index) => pageArtifact(kind, state.revision * 10 + index));
      const reviewArtifact = artifacts.find((artifact) => artifact.kind === stage.review.artifactKind);
      state = advanceSpecialistWorkflow(workflow, state, {
        baseRevision: state.revision,
        facts: stageFacts(stage),
        artifacts,
        confirmation: stage.review.surface === "page"
          ? { confirmed: true, summary: `用户确认 ${stage.title}`, surface: "page", pageId: reviewArtifact.pageId }
          : { confirmed: true, summary: `用户确认 ${stage.title}`, surface: "text" },
      });
      assert.notEqual(state.progressPage.publishedRevision, state.revision);
      state = syncSpecialistWorkflowProgress(workflow, state, progress);
    }
    assert.equal(state.progressPage.publishedRevision, state.revision);
    assert.equal(state.confirmations.length, workflow.stages.length - 1);
  }
});

test("feedback reopens the earliest affected stage and marks downstream artifacts stale", () => {
  const workflow = readDefinition("travel-planner");
  const progress = publication("private-workflow-travel-planner-project_travel_reopen");
  let state = createSpecialistWorkflowState(workflow, { projectKey: "project_travel_reopen", progressPage: progress });
  for (let index = 0; index < 4; index += 1) {
    const stage = workflow.stages[index];
    const artifacts = stage.requiredArtifacts.map((kind, artifactIndex) => pageArtifact(kind, index * 10 + artifactIndex));
    state = advanceSpecialistWorkflow(workflow, state, {
      baseRevision: state.revision,
      facts: stageFacts(stage), artifacts,
      confirmation: stage.review.surface === "page"
        ? { confirmed: true, summary: `确认 ${stage.title}`, surface: "page", pageId: artifacts.find((item) => item.kind === stage.review.artifactKind).pageId }
        : { confirmed: true, summary: `确认 ${stage.title}`, surface: "text" },
    });
    state = syncSpecialistWorkflowProgress(workflow, state, progress);
  }
  const reopened = reopenSpecialistWorkflow(workflow, state, { baseRevision: state.revision, targetStage: "constraint-freeze", reason: "用户修改固定订单" });
  assert.equal(reopened.stage, "constraint-freeze");
  assert.ok(reopened.staleArtifacts.length >= 2);
  state = syncSpecialistWorkflowProgress(workflow, reopened, progress);
  state = advanceSpecialistWorkflow(workflow, state, {
    baseRevision: state.revision,
    facts: stageFacts(workflow.stages[1]),
    confirmation: { confirmed: true, summary: "确认修订后的硬约束", surface: "text" },
  });
  state = syncSpecialistWorkflowProgress(workflow, state, progress);
  const oldResearchPage = state.artifacts.find((artifact) => artifact.kind === "research-plan-page");
  assert.throws(() => advanceSpecialistWorkflow(workflow, state, {
    baseRevision: state.revision,
    facts: stageFacts(workflow.stages[2]),
    confirmation: { confirmed: true, summary: "错误复用旧调研 Page", surface: "page", pageId: oldResearchPage.pageId },
  }), { code: "WORKFLOW_ARTIFACTS_REQUIRED" });
});

test("progress Page renderer is mobile-first and exposes only real Page links", () => {
  const workflow = readDefinition("video-creator");
  const state = createSpecialistWorkflowDraftState(workflow, { projectKey: "project_video_page" });
  const html = renderSpecialistWorkflowPage(workflow, state);
  assert.match(html, /width=device-width/);
  assert.match(html, /当前还没有可审阅的中间产物 Page/);
  assert.match(html, /待首次发布的进度 Page/);
  assert.match(html, /Page 确认/);
  assert.doesNotMatch(html, /file:\/\/|[A-Za-z]:\\/);
});

test("runtime Agent catalog injects the registered Page-led workflow into specialist Worker context", () => {
  const catalog = createAgentCatalog({ workspaceRoot: root });
  for (const agentId of agentIds) {
    const specialist = catalog.inspectInternal(agentId);
    assert.equal(specialist.workflow.agentId, agentId);
    assert.equal(specialist.workflow.schemaVersion, 2);
    assert.equal(specialist.workflow.progressPage.required, true);
  }
});

test("specialist workflow acceptance CLI completes every workflow without ad hoc eval scripts", () => {
  for (const agentId of agentIds) {
    const result = spawnSync(process.execPath, ["scripts/specialist-workflow.mjs", "accept", "--agent", agentId], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${agentId}: ${result.stderr || result.stdout}`);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.agentId, agentId);
    assert.equal(evidence.standard.finalStage, "delivered");
    assert.equal(evidence.standard.progressPageSynced, true);
    assert.equal(evidence.standard.renderer.mobileViewport, true);
  }
});

function publication(pageId) {
  return { pageId, internalUrl: `/publications/${pageId.slice(8)}/index.html`, url: "", linkNotice: "当前未配置远程访问，页面链接暂不支持查看。" };
}

function pageArtifact(kind, suffix) {
  return { kind, type: "page", pageId: `private-review-${suffix}-${kind}`, title: `${kind} review`, url: "", internalUrl: `/publications/review-${suffix}-${kind}/index.html` };
}

function stageFacts(stage) {
  const rules = new Map(stage.factRules.map((rule) => [rule.key, rule]));
  return Object.fromEntries(stage.requiredFacts.map((key) => {
    const rule = rules.get(key);
    if (rule?.operator === "equals") return [key, rule.value];
    if (rule?.operator === "min-number") return [key, rule.value];
    if (rule?.operator === "min-items") return [key, Array.from({ length: rule.value }, (_, index) => `${key}-${index + 1}`)];
    if (key === "recommended-mode-authorized") return [key, false];
    return [key, `${key}-confirmed`];
  }));
}
