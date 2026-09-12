import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionOrchestrator } from "../src/server/orchestrator.js";
import { BridgeStore } from "../src/store/store.js";

test("generic Worker sessions remain compatible without specialist metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-generic-agent-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-generic-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  const orchestrator = new SessionOrchestrator({
    store,
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
    assert.equal(worker.agentId, undefined);
    assert.equal(worker.agentProfileVersion, undefined);
    assert.equal(worker.projectKey, undefined);
    assert.deepEqual(worker.metadata, { createdBy: "test" });
  } finally {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("historical specialist metadata stays readable and resumes as ordinary work", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-historical-worker-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
  const metadata = { createdBy: "test", agentId: "removed-profile", agentProfileVersion: 7,
    projectKey: "project_history_001", specialistWorkflowState: { stage: "confirmed", revision: 3 } };
  const historical = store.createSession({ role: "worker", parentSessionId: main.id,
    title: "已有任务", taskDescription: "继续已有成果", workspaceRoot: dataDir, metadata });
  const orchestrator = new SessionOrchestrator({ store, hub: { broadcast: () => {} }, channels: {},
    siteDataRoot: dataDir, progressTimerEnabled: false });
  const calls = [];
  orchestrator.runTurn = async (...args) => { calls.push(args); };
  try {
    await orchestrator.resumeSession(historical.id, "继续处理");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], historical.id);
    assert.equal(calls[0][1], "继续处理");
    assert.deepEqual(store.getSessionRecord(historical.id).metadata, metadata);
    await assert.rejects(orchestrator.resumeSession(historical.id, "继续处理", { agentId: "removed-profile" }),
      { code: "AGENT_TEAMS_RETIRED" });
    assert.equal(calls.length, 1);
  } finally {
    orchestrator.stop();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
