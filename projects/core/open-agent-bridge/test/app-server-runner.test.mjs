import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAppServerCommand,
  threadResumeParams,
  threadStartParams,
  turnOverrides,
} from "../src/agent/app-server-runner.mjs";

test("normalizes Codex app-server command forms", () => {
  assert.deepEqual(normalizeAppServerCommand("codex"), {
    command: "codex",
    args: undefined,
  });
  assert.deepEqual(normalizeAppServerCommand("codex app-server"), {
    command: "codex",
    args: ["app-server"],
  });
});

test("sets main-agent instructions once at thread start and resume", () => {
  const config = {
    workspace: "/workspace",
    appServerApprovalPolicy: "on-request",
    appServerSandbox: "workspace-write",
    appServerDeveloperInstructions: "main agent rules",
  };
  assert.deepEqual(threadStartParams(config), {
    cwd: "/workspace",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    developerInstructions: "main agent rules",
  });
  assert.deepEqual(threadResumeParams("thread-1", config), {
    threadId: "thread-1",
    cwd: "/workspace",
    developerInstructions: "main agent rules",
  });
});

test("sends unrestricted production controls on thread and turn start", () => {
  const config = {
    workspace: "/home/owner/personal-agent.local",
    appServerApprovalPolicy: "never",
    appServerSandbox: "danger-full-access",
  };

  assert.deepEqual(threadStartParams(config), {
    cwd: "/home/owner/personal-agent.local",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  assert.deepEqual(turnOverrides(config), {
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
});
