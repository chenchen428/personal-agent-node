import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentBridgeBroker } from "../src/broker/agent-bridge-broker.js";
import { BridgeStore } from "../src/store/store.js";

test("stores single-machine sessions, commands, and runner deltas in sqlite", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-broker-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const broadcasts = [];
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: (event) => broadcasts.push(event) },
    logger: { error: () => {} },
  });

  try {
    const workspace = store.upsertWorkspace({
      name: "checkout",
      workspaceRoot: dataDir,
      appServer: { status: "online" },
      agentCommandAliases: [{ key: "codex", transport: "app-server" }],
    });
    assert.equal(workspace.name, "checkout");

    const session = broker.createBrokerSession({
      action: "new",
      role: "worker",
      workspaceName: "checkout",
      taskDescription: "inspect billing diff",
    });
    assert.deepEqual(session.metadata, {
      workspaceName: "checkout",
      agentAlias: "codex",
      source: "agent-bridge-broker",
    });

    const dispatched = await broker.dispatchSessionAction(session.id, { action: "send", content: "start" });
    assert.equal(dispatched.delivered, false);
    assert.equal(dispatched.command.status, "queued");
    assert.equal(dispatched.command.commandType, "session.start");

    broker.handleRunnerMessage({
      type: "session.delta",
      sessionId: session.id,
      kind: "session.user_message",
      payload: { content: "start", source: "agent-bridge-appserver" },
    });
    broker.handleRunnerMessage({
      type: "session.delta",
      sessionId: session.id,
      kind: "session.assistant_message",
      payload: { content: "done", cliSessionId: "thread-1" },
    });

    const hydrated = store.getSession(session.id);
    assert.equal(hydrated.cliSessionId, "thread-1");
    const userMessages = hydrated.messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].content, "start");
    assert.equal(userMessages[0].source, "agent-bridge-ui");
    assert.equal(hydrated.messages.some((message) => message.content === "done"), true);
    assert.equal(broadcasts.some((event) => event.type === "session.delta"), true);
    assert.deepEqual(store.listTaskDisplayEvents(session.id, { limit: 20 }).items.map((item) => item.content), ["inspect billing diff", "done"]);
    assert.equal(broadcasts.some((event) => event.type === "task.display.delta" && event.taskId === session.id), true);
  } finally {
    broker.close();
    store.close();
  }
});

test("delivers queued commands to the single local runner", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-broker-local-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sent = [];
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: () => {} },
    logger: { error: () => {} },
  });

  try {
    store.upsertWorkspace({
      name: "checkout",
      workspaceRoot: dataDir,
      appServer: { status: "online" },
    });
    broker.runnerSocket = {
      socket: {
        readyState: 1,
        send: (message) => sent.push(JSON.parse(message)),
        close: () => {},
      },
    };

    const session = broker.createBrokerSession({
      action: "new",
      workspaceName: "checkout",
      taskDescription: "local model smoke",
    });

    assert.deepEqual(session.metadata, {
      workspaceName: "checkout",
      agentAlias: "codex",
      source: "agent-bridge-broker",
    });

    const dispatched = await broker.dispatchSessionAction(session.id, { action: "send", content: "start" });
    assert.equal(dispatched.delivered, true);
    assert.equal(dispatched.command.status, "delivered");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].commandType, "session.start");
    assert.equal(sent[0].payload.workspaceName, "checkout");
  } finally {
    broker.close();
    store.close();
  }
});
