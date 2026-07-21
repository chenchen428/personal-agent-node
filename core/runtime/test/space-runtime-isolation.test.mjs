import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceEnvironment, initializeSite, resolveNodeConfig, writeWorkerConfig } from "../src/config.ts";
import { resolveSpaceInitializationDomain } from "../src/installation-supervisor.ts";
import { createSpace, getSpace } from "../src/space-registry.ts";
import { componentSpecs, systemCaNodeOptions } from "../src/supervisor.ts";
import { BridgeStore } from "../../agent/src/store/store.js";

test("each Space receives a complete process group with isolated ports, secrets, databases, cookies, and workspace", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-space-runtime-"));
  try {
    const codexExecutable = path.join(dataRoot, process.platform === "win32" ? "codex.exe" : "codex");
    fs.writeFileSync(codexExecutable, "fixture\n");
    const personal = initializeSite({ dataRoot, domain: "personal-agent.local" }).config;
    const customRecord = createSpace({ dataRoot, slug: "work", displayName: "工作" });
    const custom = initializeSite({ dataRoot, spaceId: customRecord.id, domain: "personal-agent.local" }).config;
    personal.env.PRIVATE_SITE_CODEX_EXECUTABLE = codexExecutable;
    custom.env.PRIVATE_SITE_CODEX_EXECUTABLE = codexExecutable;
    const personalEnvironment = buildServiceEnvironment(personal);
    const customEnvironment = buildServiceEnvironment(custom);
    const personalComponents = componentSpecs(personal, writeWorkerConfig(personal));
    const customComponents = componentSpecs(custom, writeWorkerConfig(custom));

    assert.deepEqual(personalComponents.map((component) => component.name), customComponents.map((component) => component.name));
    assert.ok(personalComponents.some((component) => component.name === "open-agent-bridge-worker"));
    assert.ok(personalComponents.some((component) => component.name === "personal-agent-app"));
    assert.ok(personalComponents.some((component) => component.name === "private-site-gateway"));
    assert.match(personalComponents.find((component) => component.name === "personal-agent-tunnel").env.NODE_OPTIONS, /(^|\s)--use-system-ca(?=\s|$)/);
    assert.equal(systemCaNodeOptions("--trace-warnings"), "--trace-warnings --use-system-ca");
    assert.equal(systemCaNodeOptions("--use-system-ca"), "--use-system-ca");
    assert.notEqual(personal.gateway.port, custom.gateway.port);
    assert.notEqual(personal.ports.bridge, custom.ports.bridge);
    assert.notEqual(personal.ports.control, custom.ports.control);
    assert.notEqual(personalEnvironment.OPEN_AGENT_BRIDGE_DATA_DIR, customEnvironment.OPEN_AGENT_BRIDGE_DATA_DIR);
    assert.notEqual(personalEnvironment.OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE, customEnvironment.OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE);
    assert.notEqual(personalEnvironment.OPEN_AGENT_BRIDGE_AUTOMATION_DATA_DIR, customEnvironment.OPEN_AGENT_BRIDGE_AUTOMATION_DATA_DIR);
    assert.notEqual(personalEnvironment.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR, customEnvironment.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR);
    assert.notEqual(personalEnvironment.PERSONAL_AGENT_AUTH_VERIFIER_FILE, customEnvironment.PERSONAL_AGENT_AUTH_VERIFIER_FILE);
    assert.notEqual(personalEnvironment.PERSONAL_AGENT_AUTH_COOKIE_NAME, customEnvironment.PERSONAL_AGENT_AUTH_COOKIE_NAME);
    assert.notEqual(personalEnvironment.OPEN_AGENT_BRIDGE_WORKSPACE_ROOT, customEnvironment.OPEN_AGENT_BRIDGE_WORKSPACE_ROOT);
    assert.equal(personalEnvironment.PERSONAL_AGENT_DATA_ROOT, dataRoot);
    assert.equal(customEnvironment.PERSONAL_AGENT_DATA_ROOT, dataRoot);
    assert.equal(personalEnvironment.PRIVATE_SITE_DATA_ROOT, personal.dataRoot);
    assert.equal(customEnvironment.PRIVATE_SITE_DATA_ROOT, custom.dataRoot);

    const selected = resolveNodeConfig({ PERSONAL_AGENT_DATA_ROOT: dataRoot, PERSONAL_AGENT_SPACE_ID: custom.space.id });
    assert.equal(selected.space.id, custom.space.id);
    assert.equal(selected.dataRoot, custom.dataRoot);

    const personalStore = new BridgeStore({ dataDir: personalEnvironment.OPEN_AGENT_BRIDGE_DATA_DIR, consoleBaseUrl: "http://127.0.0.1" });
    const customStore = new BridgeStore({ dataDir: customEnvironment.OPEN_AGENT_BRIDGE_DATA_DIR, consoleBaseUrl: "http://127.0.0.1" });
    try {
      const personalSession = personalStore.createSession({ id: "session-personal", title: "个人上下文", workspaceRoot: personal.agentWorkspaceRoot });
      personalStore.appendEvent(personalSession.id, "session.token_usage", {
        threadId: "thread-personal",
        tokenUsage: { last: { totalTokens: 120 }, total: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } },
        createdAt: "2026-07-18T10:00:00.000Z",
      });
      assert.equal(personalStore.getTokenUsageSummary({ range: "all" }).totalTokens, 120);
      assert.equal(customStore.getTokenUsageSummary({ range: "all" }).totalTokens, 0);
      assert.equal(customStore.getSession(personalSession.id), null);
    } finally {
      personalStore.close();
      customStore.close();
    }
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("installation supervisor preserves an initialized Space domain before registry enrollment", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-space-domain-"));
  try {
    const initialized = initializeSite({ dataRoot, domain: "alice.personal-agent.cn" }).config;
    const space = getSpace(dataRoot, initialized.space.id);
    assert.ok(space);
    assert.equal(space.managedHost, "");
    assert.equal(resolveSpaceInitializationDomain(space), "alice.personal-agent.cn");
    assert.equal(resolveSpaceInitializationDomain({ ...space, managedHost: "legacy.personal-agent.cn" }), "alice.personal-agent.cn");
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
