import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationEngine } from "../src/automation/engine.js";
import { BridgeStore } from "../src/store/store.js";

test("built-in mail connection processing creates one idempotent Agent task", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-automation-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  let sequence = 0;
  const broker = {
    createBrokerSession(body) { return { id: `session-${++sequence}`, ...body }; },
    async dispatchSessionAction(sessionId) { return { delivered: false, command: { id: `command-${sessionId}` } }; },
  };
  try {
    const engine = new AutomationEngine({ store, broker, workspaceRoot: dataDir });
    engine.ensureDefaults();
    const input = {
      sourceId: "connection_local_mail",
      eventType: "mail.received",
      title: "电子账单",
      sender: { address: "bank@example.com" },
      dedupeKey: "sha256:mail-1",
      payload: { textPreview: "本月账单", recipients: ["bills@personal-agent.local"] },
    };
    const first = await engine.ingest(input);
    const second = await engine.ingest(input);
    assert.equal(first.event.id, second.event.id);
    assert.equal(store.listAutomationEvents().length, 1);
    assert.equal(store.listAutomationRuns().length, 1);
    assert.equal(second.deduplicated, true);
    assert.equal(first.runs.length, 1);
    assert.equal(first.runs[0].matched, true);
    assert.equal(first.runs[0].status, "queued");
    assert.equal(store.listAutomationSources()[0].accountRef.includes("agent@personal-agent.local"), true);
    assert.equal(store.listAutomationRules()[0].conditions.matchAll, true);
    const replay = await engine.replay(first.event.id);
    assert.equal(replay.replay, true);
    assert.equal(replay.runs.length, 1);
    assert.equal(replay.runs[0].result.replay, true);
    assert.equal(store.listAutomationRuns().length, 2);
  } finally {
    store.close();
  }
});

test("domain verification mail is archived for inspection without creating an Agent task", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-domain-mail-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const engine = new AutomationEngine({ store, broker: { createBrokerSession() { assert.fail("verification mail created a task"); } }, workspaceRoot: dataDir });
  try {
    engine.ensureDefaults();
    const result = await engine.ingest({
      sourceId: "connection_local_mail",
      eventType: "mail.received",
      title: "Personal Agent 绑定验证 · pa-domain-0123456789abcdef01234567",
      sender: { address: "verify@personal-agent.cn" },
      dedupeKey: "sha256:domain-verification",
      payload: { recipients: ["agent@owner.personal-agent.cn"], textPreview: "pa-domain-0123456789abcdef01234567" },
    }, { dispatch: false });
    assert.equal(result.systemOnly, true);
    assert.equal(store.listAutomationEvents().length, 1);
    assert.equal(store.listAutomationRuns().length, 0);
    assert.equal(store.getAutomationMailUsageSummary().receivedCount, 0);
  } finally { store.close(); }
});

test("mail protection enforces sender limits and automatically blocks repeated violations", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-mail-protection-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const dispatched = [];
  const broker = {
    createBrokerSession(body) { return { id: `session-${dispatched.length + 1}`, ...body }; },
    async dispatchSessionAction(sessionId) { dispatched.push(sessionId); return { delivered: false, command: { id: `command-${sessionId}` } }; },
  };
  try {
    const engine = new AutomationEngine({
      store,
      broker,
      workspaceRoot: dataDir,
      maxConcurrency: 3,
      mailProtection: { senderDailyLimit: 1, trustedSenderDailyLimit: 2, domainDailyLimit: 20, globalDailyLimit: 50, autoTrustSafeCount: 3, autoBlockViolationCount: 2 },
    });
    engine.ensureDefaults();
    const mail = (number) => ({
      sourceId: "connection_local_mail",
      eventType: "mail.received",
      title: `Message ${number}`,
      sender: { address: "flood@example.com" },
      dedupeKey: `sha256:flood-${number}`,
      receivedAt: `2026-07-12T0${number}:00:00.000Z`,
      payload: { textPreview: "bulk mail" },
      risk: { authenticationResults: "spf=pass" },
    });
    const accepted = await engine.ingest(mail(1));
    const limited = await engine.ingest(mail(2));
    const blocked = await engine.ingest(mail(3));
    assert.equal(accepted.protection.dispatch, true);
    assert.equal(limited.protection.dispatch, false);
    assert.match(limited.protection.reason, /sender daily limit/);
    assert.equal(blocked.protection.policy.policy, "blocked");
    assert.equal(dispatched.length, 1);
    assert.equal(store.listAutomationEvents().length, 3);
    assert.equal(store.getAutomationMailUsageSummary("2026-07-12").suppressedCount, 2);
  } finally {
    store.close();
  }
});

test("mail protection promotes authenticated senders without bypassing the bounded task queue", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-mail-queue-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const dispatched = [];
  const broker = {
    createBrokerSession(body) { return { id: `session-${dispatched.length + 1}`, ...body }; },
    async dispatchSessionAction(sessionId) { dispatched.push(sessionId); return { delivered: false, command: { id: `command-${sessionId}` } }; },
  };
  try {
    const engine = new AutomationEngine({
      store,
      broker,
      workspaceRoot: dataDir,
      maxConcurrency: 2,
      queueLimit: 10,
      mailProtection: { senderDailyLimit: 10, trustedSenderDailyLimit: 20, domainDailyLimit: 40, globalDailyLimit: 80, autoTrustSafeCount: 3, autoBlockViolationCount: 3 },
    });
    engine.ensureDefaults();
    for (let index = 1; index <= 5; index += 1) {
      await engine.ingest({
        sourceId: "connection_local_mail",
        eventType: "mail.received",
        title: `Bill ${index}`,
        sender: { address: "billing@example.com" },
        dedupeKey: `sha256:billing-${index}`,
        payload: { textPreview: "monthly bill" },
        risk: { authenticationResults: "dmarc=pass; spf=pass; dkim=pass" },
      });
    }
    assert.equal(store.getAutomationMailPolicy("billing@example.com").policy, "trusted");
    assert.equal(dispatched.length, 2);
    assert.equal(store.countAutomationRuns({ statuses: ["pending"] }), 3);
    assert.deepEqual(engine.protectionStatus().concurrency, { limit: 2, active: 2, queued: 3, queueLimit: 10 });
  } finally {
    store.close();
  }
});
