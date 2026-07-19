import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MailTaskDispatcher } from "../src/connections/mail/task-dispatcher.js";
import { BridgeStore } from "../src/store/store.js";

function mail(number = 1, sender = "bank@example.com") {
  return {
    sourceId: "connection_local_mail",
    eventType: "mail.received",
    title: `电子账单 ${number}`,
    sender: { address: sender },
    dedupeKey: `sha256:mail-${number}`,
    receivedAt: `2026-07-12T0${number}:00:00.000Z`,
    payload: { textPreview: "本月账单", recipients: ["bills@personal-agent.local"] },
    risk: { authenticationResults: "dmarc=pass; spf=pass; dkim=pass" },
  };
}

test("built-in mail processing creates one idempotent ordinary task", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-mail-task-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const sessions = [];
  const broker = {
    createBrokerSession(body) { const session = { id: `session-${sessions.length + 1}`, ...body }; sessions.push(session); return session; },
    async dispatchSessionAction(sessionId, body) { return { delivered: false, command: { id: `command-${sessionId}`, payload: body.payload } }; },
  };
  try {
    const dispatcher = new MailTaskDispatcher({ store, broker, workspaceRoot: dataDir });
    const first = await dispatcher.ingest(mail());
    const second = await dispatcher.ingest(mail());
    assert.equal(first.event.id, second.event.id);
    assert.equal(second.deduplicated, true);
    assert.equal(store.listMailEvents().length, 1);
    assert.equal(sessions.length, 1);
    assert.equal(first.task.status, "queued");
    assert.equal(first.task.sessionId, "session-1");
    assert.equal(first.event.payload.task.sessionId, "session-1");
    assert.equal(sessions[0].role, "worker");
    assert.match(sessions[0].title, /邮件任务/);
    assert.match(sessions[0].taskDescription, /普通任务/);
    assert.doesNotMatch(sessions[0].taskDescription, /automation rule|自动化规则/i);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("domain verification mail is archived without creating a task", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-domain-mail-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const dispatcher = new MailTaskDispatcher({ store, broker: { createBrokerSession() { assert.fail("verification mail created a task"); } }, workspaceRoot: dataDir });
  try {
    const result = await dispatcher.ingest(mail(), { dispatch: false });
    assert.equal(result.systemOnly, true);
    assert.equal(store.listMailEvents().length, 1);
    assert.equal(store.getAutomationMailUsageSummary().receivedCount, 0);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("mail protection suppresses excess messages before task creation", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-mail-protection-"));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: "https://agent.example.test" });
  const dispatched = [];
  const broker = {
    createBrokerSession(body) { return { id: `session-${dispatched.length + 1}`, ...body }; },
    async dispatchSessionAction(sessionId) { dispatched.push(sessionId); return { delivered: false, command: { id: `command-${sessionId}` } }; },
  };
  try {
    const dispatcher = new MailTaskDispatcher({
      store,
      broker,
      workspaceRoot: dataDir,
      mailProtection: { senderDailyLimit: 1, trustedSenderDailyLimit: 2, domainDailyLimit: 20, globalDailyLimit: 50, autoTrustSafeCount: 3, autoBlockViolationCount: 2 },
    });
    const accepted = await dispatcher.ingest(mail(1, "flood@example.com"));
    const limited = await dispatcher.ingest(mail(2, "flood@example.com"));
    const blocked = await dispatcher.ingest(mail(3, "flood@example.com"));
    assert.equal(accepted.protection.dispatch, true);
    assert.equal(limited.protection.dispatch, false);
    assert.match(limited.task.reason, /sender daily limit/);
    assert.equal(blocked.protection.policy.policy, "blocked");
    assert.equal(dispatched.length, 1);
    assert.equal(store.listMailEvents().length, 3);
    assert.equal(store.getAutomationMailUsageSummary("2026-07-12").suppressedCount, 2);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
