import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentCatalog } from "../src/agents/catalog.js";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";
import { SessionOrchestrator } from "../src/server/orchestrator.js";
import { BridgeStore } from "../src/store/store.js";

test("Agent catalog exposes public DTOs without private instructions or paths", () => {
  const root = createAgentFixture();
  try {
    const catalog = createAgentCatalog({ workspaceRoot: root, releaseRoot: root });
    const agents = catalog.listPublic();
    assert.deepEqual(agents.map((agent) => agent.id), ["interior-designer", "missing-agent"]);
    assert.equal(agents[0].status, "available");
    assert.equal(agents[0].displayName, "Interior Design Agent");
    assert.deepEqual(agents[0].profile.capabilities, ["layouts", "revisions"]);
    assert.equal(agents[1].status, "unavailable");
    assert.doesNotMatch(JSON.stringify(agents), /SPECIALIST_PRIVATE_MARKER|AGENT\.md|agent\.yaml|profile\.yaml/);

    const internal = catalog.inspectInternal("interior-designer");
    assert.equal(internal.version, 1);
    assert.match(internal.instructions, /SPECIALIST_PRIVATE_MARKER/);
    assert.deepEqual(internal.skills, ["personal-files"]);
    assert.throws(
      () => catalog.inspectInternal("unknown-agent"),
      (error) => error.code === "AGENT_NOT_FOUND" && error.statusCode === 400,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("specialist sessions persist locked identity, filter by project, and compose prompts in order", async () => {
  const root = createAgentFixture();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-specialist-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const privatePublications = new PrivatePublicationStore({ rootDir: path.join(dataDir, "private-publications") });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const calls = [];
  const catalog = createAgentCatalog({ workspaceRoot: root, releaseRoot: root });
  const orchestrator = new SessionOrchestrator({
    store,
    agentCatalog: catalog,
    privatePublications,
    hub: { broadcast: () => {} },
    channels: {},
    progressTimerEnabled: false,
    runner: {
      runAppServerCommand: async (input) => {
        calls.push(input);
        return { ok: true };
      },
      stopAppServerCommand: () => false,
    },
  });
  try {
    const first = await orchestrator.startWorkerSession({
      parentSessionId: main.id,
      title: "Design project",
      description: "Create a governed design",
      task: "Current specialist task",
      agentId: "interior-designer",
      projectKey: "project_design_001",
      createdBy: "test",
    });
    const second = orchestrator.createWorkerSession({
      parentSessionId: main.id,
      title: "Other project",
      description: "Keep projects isolated",
      task: "Other specialist task",
      agentId: "interior-designer",
      projectKey: "project_design_002",
      createdBy: "test",
    });
    await waitFor(() => calls.length >= 1 && !orchestrator.running.has(first.id));

    assert.equal(first.role, "worker");
    assert.equal(first.agentId, "interior-designer");
    assert.equal(first.agentProfileVersion, 1);
    assert.equal(first.projectKey, "project_design_001");
    assert.deepEqual({ ...first.metadata, specialistWorkflowState: undefined }, {
      createdBy: "test",
      agentId: "interior-designer",
      agentProfileVersion: 1,
      projectKey: "project_design_001",
      specialistWorkflowState: undefined,
    });
    assert.equal(first.metadata.specialistWorkflowState.stage, "intake");
    assert.equal(first.metadata.specialistWorkflowState.revision, 0);
    assert.equal(first.metadata.specialistWorkflowState.progressPage.pageId, "private-workflow-interior-designer-project_design_001");
    assert.equal(first.metadata.specialistWorkflowState.progressPage.internalUrl, "/publications/workflow-interior-designer-project_design_001/index.html");
    assert.equal(first.metadata.specialistWorkflowState.progressPage.publishedRevision, 0);
    const progressPublication = privatePublications.list().find((publication) => publication.page?.pageId === first.metadata.specialistWorkflowState.progressPage.pageId);
    assert.ok(progressPublication);
    assert.equal(progressPublication.page.visibility, "private");
    const progressHtml = fs.readFileSync(path.join(dataDir, "private-publications", progressPublication.id, "index.html"), "utf8");
    assert.match(progressHtml, /width=device-width, initial-scale=1, viewport-fit=cover/);
    assert.match(progressHtml, /REV 0/);
    const prompt = calls[0].appServerDeveloperInstructions;
    assert.ok(prompt.indexOf("你不是主 Agent") >= 0);
    assert.ok(prompt.indexOf("SPECIALIST_PRIVATE_MARKER") > prompt.indexOf("你不是主 Agent"));
    assert.ok(prompt.indexOf("test-workflow@2") > prompt.indexOf("SPECIALIST_PRIVATE_MARKER"));
    assert.match(prompt, /private-workflow-interior-designer-project_design_001/);
    assert.match(prompt, /不要另建第二个进度 Page/);
    assert.ok(prompt.indexOf("personal-files") > prompt.indexOf("test-workflow@2"));
    assert.equal(calls[0].stdin, "Current specialist task");

    const filtered = store.listSessionsPage({
      parentSessionId: main.id,
      agentId: "interior-designer",
      projectKey: "project_design_001",
    });
    assert.deepEqual(filtered.sessions.map((session) => session.id), [first.id]);
    assert.equal(store.countSessions({
      parentSessionId: main.id,
      agentId: "interior-designer",
      projectKey: "project_design_002",
    }), 1);
    assert.notEqual(first.id, second.id);
    assert.equal(second.metadata.specialistWorkflowState, undefined);
    const resumedSecond = await orchestrator.resumeSession(second.id, "Continue the second project");
    await waitFor(() => calls.length >= 2 && !orchestrator.running.has(second.id));
    assert.equal(resumedSecond.metadata.specialistWorkflowState.progressPage.pageId, "private-workflow-interior-designer-project_design_002");
    assert.equal(privatePublications.list().filter((publication) => publication.page?.visibility === "private").length, 2);

    writeAgentYaml(root, 2);
    await assert.rejects(
      orchestrator.resumeSession(first.id, "Continue the same project"),
      (error) => error.code === "AGENT_PROFILE_VERSION_MISMATCH" && error.statusCode === 409,
    );
    assert.throws(
      () => orchestrator.createWorkerSession({
        parentSessionId: main.id,
        title: "Unknown Agent",
        description: "Must fail closed",
        task: "No fallback",
        agentId: "unknown-agent",
        projectKey: "project_unknown_001",
      }),
      (error) => error.code === "AGENT_NOT_FOUND",
    );
  } finally {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generic Worker sessions remain compatible without specialist metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-generic-agent-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-generic-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const orchestrator = new SessionOrchestrator({
    store,
    agentCatalog: createAgentCatalog({ workspaceRoot: root, releaseRoot: root }),
    hub: { broadcast: () => {} },
    channels: {},
    progressTimerEnabled: false,
  });
  try {
    const worker = orchestrator.createWorkerSession({
      parentSessionId: main.id,
      title: "Generic task",
      description: "Keep the previous Worker contract",
      task: "Do generic work",
      createdBy: "test",
    });
    assert.equal(worker.agentId, null);
    assert.equal(worker.agentProfileVersion, null);
    assert.equal(worker.projectKey, null);
    assert.deepEqual(worker.metadata, { createdBy: "test" });
  } finally {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("specialist Worker execution fails closed when the progress Page cannot be published", async () => {
  const root = createAgentFixture();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-specialist-no-pages-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  let runCount = 0;
  const orchestrator = new SessionOrchestrator({
    store,
    agentCatalog: createAgentCatalog({ workspaceRoot: root, releaseRoot: root }),
    hub: { broadcast: () => {} },
    channels: {},
    progressTimerEnabled: false,
    runner: {
      runAppServerCommand: async () => { runCount += 1; },
      stopAppServerCommand: () => false,
    },
  });
  try {
    await assert.rejects(
      orchestrator.startWorkerSession({
        parentSessionId: main.id,
        title: "No Page publisher",
        description: "Must not execute without a progress Page",
        task: "Do not run",
        agentId: "interior-designer",
        projectKey: "project_design_no_pages",
      }),
      (error) => error.code === "WORKFLOW_PROGRESS_PAGE_UNAVAILABLE",
    );
    assert.equal(runCount, 0);
    const [worker] = store.listSessionsPage({
      parentSessionId: main.id,
      agentId: "interior-designer",
      projectKey: "project_design_no_pages",
    }).sessions;
    assert.equal(worker.status, "paused");
    assert.equal(worker.metadata.specialistWorkflowState, undefined);
  } finally {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createAgentFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-catalog-"));
  fs.mkdirSync(path.join(root, "registry"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "personal-files"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "personal-files", "SKILL.md"), "---\nname: personal-files\ndescription: Files.\n---\n");
  fs.mkdirSync(path.join(root, "agents", "interior-designer"), { recursive: true });
  fs.writeFileSync(path.join(root, "agents", "interior-designer", "AGENT.md"), [
    "# Interior specialist",
    "SPECIALIST_PRIVATE_MARKER",
    "Maintain project-scoped design evidence.",
  ].join("\n"));
  writeAgentYaml(root, 1);
  fs.writeFileSync(path.join(root, "agents", "interior-designer", "profile.yaml"), [
    "schemaVersion: 1",
    "overview:",
    "  role: Interior specialist",
    "  tagline: Evidence-led design",
    "capabilities:",
    "  - layouts",
    "  - revisions",
    "useWhen:",
    "  - renovating a home",
    "acceptance:",
    "  - sources remain traceable",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "agents", "interior-designer", "workflow.json"), JSON.stringify({
    schemaVersion: 2,
    id: "test-workflow",
    agentId: "interior-designer",
    version: 2,
    goal: "Collect facts, confirm direction, and deliver governed work.",
    progressPage: {
      required: true,
      visibility: "private",
      mobileFirst: true,
      refreshPolicy: "every-transition",
      folderPattern: "workflow-{agentId}-{projectKey}",
    },
    interaction: {
      maxQuestionsPerTurn: 3,
      confirmationPolicy: "surface-aware-required",
      revisionPolicy: "optimistic",
      feedbackPolicy: "reopen-earliest-affected-stage",
      recommendedCheckpoint: null,
    },
    stages: [
      {
        id: "intake",
        title: "Intake",
        purpose: "Collect the project scope and source evidence.",
        review: { surface: "text", artifactKind: null },
        requiredFacts: ["project-scope"],
        factRules: [],
        requiredArtifacts: [],
        confirmationPrompt: "Please confirm the project scope and evidence boundary.",
        next: "review",
      },
      {
        id: "review",
        title: "Review",
        purpose: "Review the proposed direction before final delivery.",
        review: { surface: "page", artifactKind: "review-page" },
        requiredFacts: ["selected-direction"],
        factRules: [],
        requiredArtifacts: ["review-page"],
        confirmationPrompt: "Please confirm the selected direction for delivery.",
        next: "delivered",
      },
      {
        id: "delivered",
        title: "Delivered",
        purpose: "Deliver the confirmed project artifacts and revision record.",
        review: { surface: "terminal", artifactKind: null },
        requiredFacts: [],
        factRules: [],
        requiredArtifacts: [],
        confirmationPrompt: null,
        next: null,
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(root, "registry", "agents.json"), JSON.stringify({
    schemaVersion: 1,
    agents: [
      { id: "interior-designer", directory: "agents/interior-designer" },
      { id: "missing-agent", directory: "agents/missing-agent", displayName: "Missing Agent" },
    ],
  }));
  return root;
}

function writeAgentYaml(root, version) {
  fs.writeFileSync(path.join(root, "agents", "interior-designer", "agent.yaml"), [
    "schemaVersion: 1",
    "id: interior-designer",
    `version: ${version}`,
    "displayName: Interior Design Agent",
    "description: Creates project-scoped interior design deliverables.",
    "workflow: workflow.json",
    "skills:",
    "  - personal-files",
    "routing:",
    "  summary: Layouts, revisions, and interior design delivery.",
  ].join("\n"));
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
