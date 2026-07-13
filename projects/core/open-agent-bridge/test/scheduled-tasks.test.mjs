import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentBridgeBroker } from "../src/broker/agent-bridge-broker.js";
import { assertMinimumCronInterval, ScheduledTaskRunner, nextRunAt, normalizeTimezone, parseCronExpression } from "../src/scheduler/scheduled-tasks.js";
import { BridgeStore } from "../src/store/store.js";

test("parses cron aliases and computes the next run", () => {
  const parsed = parseCronExpression("@hourly");
  assert.deepEqual(parsed.minute, [0]);
  assert.equal(nextRunAt("@hourly", new Date("2026-07-10T08:12:30.000Z")).toISOString(), "2026-07-10T09:00:00.000Z");
});

test("computes schedules in an explicit IANA timezone", () => {
  assert.equal(
    nextRunAt("0 9 * * *", new Date("2026-07-10T00:30:00.000Z"), "Asia/Shanghai").toISOString(),
    "2026-07-10T01:00:00.000Z",
  );
  assert.equal(normalizeTimezone("UTC"), "UTC");
  assert.throws(() => normalizeTimezone("Mars/Olympus"), /invalid IANA timezone/);
});

test("uses standard cron OR semantics when day-of-month and weekday are both restricted", () => {
  assert.equal(
    nextRunAt("0 9 15 * 1", new Date("2026-07-12T00:00:00.000Z"), "UTC").toISOString(),
    "2026-07-13T09:00:00.000Z",
  );
});

test("enforces a minimum scheduled interval of fifteen minutes", () => {
  assert.doesNotThrow(() => assertMinimumCronInterval("*/15 * * * *"));
  assert.doesNotThrow(() => assertMinimumCronInterval("5,55 0,2 * * *"));
  assert.throws(() => assertMinimumCronInterval("*/10 * * * *"), /at least 15 minutes/);
  assert.throws(() => assertMinimumCronInterval("0,10 9 * * *"), /at least 15 minutes/);
});

test("stores and updates scheduled tasks", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-cron-store-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });

  try {
    const task = store.createScheduledTask({
      name: "Daily report",
      cron: "0 9 * * *",
      prompt: "Summarize yesterday.",
      workspaceName: "default",
      workspaceRoot: dataDir,
    });
    assert.equal(task.name, "Daily report");
    assert.equal(task.enabled, true);

    const updated = store.updateScheduledTask(task.id, { enabled: false, lastError: "stopped" });
    assert.equal(updated.enabled, false);
    assert.equal(updated.lastError, "stopped");
    assert.equal(store.listScheduledTasks({ enabled: false }).length, 1);
    assert.equal(store.deleteScheduledTask(task.id), true);
    assert.equal(store.getScheduledTask(task.id), null);
  } finally {
    store.close();
  }
});

test("scheduled task trigger creates a local broker session and notifies WeChat", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-cron-trigger-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const notifications = [];
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: () => {} },
    logger: { error: () => {} },
  });
  const runner = new ScheduledTaskRunner({
    store,
    broker,
    channels: { wechat: { sendText: async (recipientId, message) => notifications.push({ recipientId, message }) } },
    logger: { error: () => {} },
  });

  try {
    store.upsertWorkspace({ name: "default", workspaceRoot: dataDir, appServer: { status: "online" } });
    const task = store.createScheduledTask({
      name: "Smoke task",
      cron: "*/15 * * * *",
      prompt: "Reply with smoke.",
      workspaceName: "default",
      workspaceRoot: dataDir,
      recipientId: "wx-user",
      timezone: "Asia/Shanghai",
    });

    const result = await runner.trigger(task.id, { manual: true, now: new Date("2026-07-10T08:10:00.000Z") });
    assert.equal(result.delivered, false);
    assert.equal(result.command.status, "queued");
    assert.match(result.session.title, /Smoke task/);
    assert.equal(result.task.runCount, 1);
    assert.equal(result.task.lastSessionId, result.session.id);
    assert.equal(result.task.lastError, "");
    assert.equal(result.notification.attempted, true);
    assert.equal(result.notification.sent, true);
    assert.equal(result.notification.error, "");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipientId, "wx-user");
    assert.match(notifications[0].message, /Smoke task/);
    assert.match(result.session.taskDescription, /时区：Asia\/Shanghai/);
  } finally {
    runner.stop();
    broker.close();
    store.close();
  }
});

test("scheduled task migrates the recipient from the existing WeChat context cache", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-cron-migrated-recipient-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const notifications = [];
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: () => {} },
    logger: { error: () => {} },
  });
  const runner = new ScheduledTaskRunner({
    store,
    broker,
    channels: {
      wechat: {
        getDefaultRecipientId: () => "cached-wechat-user",
        sendText: async (recipientId) => notifications.push(recipientId),
      },
    },
    logger: { error: () => {} },
  });

  try {
    store.upsertWorkspace({ name: "default", workspaceRoot: dataDir });
    const task = store.createScheduledTask({
      name: "Migrated recipient",
      cron: "*/15 * * * *",
      prompt: "Reply with smoke.",
      workspaceName: "default",
      workspaceRoot: dataDir,
    });

    const result = await runner.trigger(task.id, { manual: true });
    assert.equal(result.notification.sent, true);
    assert.deepEqual(notifications, ["cached-wechat-user"]);
    assert.equal(store.getLastWechatRecipient(), "cached-wechat-user");
  } finally {
    runner.stop();
    broker.close();
    store.close();
  }
});

test("scheduled task records a missing WeChat recipient without skipping the Codex session", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-cron-no-recipient-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: () => {} },
    logger: { error: () => {} },
  });
  const runner = new ScheduledTaskRunner({
    store,
    broker,
    channels: { wechat: { sendText: async () => assert.fail("sendText should not be called") } },
    logger: { error: () => {} },
  });

  try {
    store.upsertWorkspace({ name: "default", workspaceRoot: dataDir });
    const task = store.createScheduledTask({
      name: "No recipient task",
      cron: "0 9 * * *",
      prompt: "Reply with smoke.",
      workspaceName: "default",
      workspaceRoot: dataDir,
    });

    const result = await runner.trigger(task.id, { manual: true });
    assert.equal(result.delivered, false);
    assert.equal(result.notification.attempted, false);
    assert.equal(result.notification.sent, false);
    assert.match(result.notification.error, /No WeChat recipient/);
    assert.equal(result.task.lastError, result.notification.error);
    assert.equal(result.task.lastSessionId, result.session.id);
  } finally {
    runner.stop();
    broker.close();
    store.close();
  }
});

test("scheduled task does not report a notification when the WeChat channel is unavailable", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-cron-no-channel-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const broker = new AgentBridgeBroker({
    store,
    hub: { broadcast: () => {} },
    logger: { error: () => {} },
  });
  const runner = new ScheduledTaskRunner({ store, broker, channels: {}, logger: { error: () => {} } });

  try {
    store.upsertWorkspace({ name: "default", workspaceRoot: dataDir });
    const task = store.createScheduledTask({
      name: "No channel task",
      cron: "0 9 * * *",
      prompt: "Reply with smoke.",
      workspaceName: "default",
      workspaceRoot: dataDir,
      recipientId: "wx-user",
    });

    const result = await runner.trigger(task.id, { manual: true });
    assert.equal(result.notification.attempted, true);
    assert.equal(result.notification.sent, false);
    assert.match(result.notification.error, /channel is unavailable/);
    assert.equal(result.task.lastError, result.notification.error);
  } finally {
    runner.stop();
    broker.close();
    store.close();
  }
});
