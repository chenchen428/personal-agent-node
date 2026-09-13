import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalendarStore } from "../src/calendar/store.js";
import { TaskPlanRunner, takeLegacyScheduleOwnership } from "../src/scheduler/task-plans.js";
import { executeCalendarCommand } from "../src/calendar/control.js";
import { BridgeStore } from "../src/store/store.js";

const start = "2026-09-14T01:00:00.000Z";
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-runner-"));
  const sessions = new Map([["main", { id: "main", role: "main", spaceId: "test-space" }]]);
  const calendarStore = new CalendarStore({ dataDir: root, spaceId: "test-space", now: () => Date.parse(start), sessionResolver: id => sessions.get(id) });
  const tasks = [], commands = new Map();
  const store = {
    getSessionRecord: id => sessions.get(id), listMainSessions: () => [sessions.get("main")],
    updateSession(id, patch) { sessions.set(id, { ...sessions.get(id), ...patch }); return sessions.get(id); },
    getCommand: id => commands.get(id),
  };
  const broker = {
    createBrokerSession(input) { const session = { ...input, id: `task-${tasks.length}`, status: "idle", metadata: {} }; tasks.push(session); sessions.set(session.id, session); return session; },
    async dispatchSessionAction(id, input) { const command = { id: `cmd-${id}`, status: "queued", input }; commands.set(command.id, command); return { command, delivered: false }; },
  };
  const runner = new TaskPlanRunner({ calendarStore, store, broker, workspaceRoot: root, now: () => Date.parse(start), ...options });
  const cleanup = [];
  t.after(() => { runner.stop(); cleanup.forEach(dispose => dispose()); calendarStore.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const create = (input = {}) => calendarStore.create({ sessionId: "main" }, {
    title: "定期整理", startAt: start, timeZone: "Asia/Shanghai", executionMode: "execute", executionPrompt: "整理本周记录",
    recurrence: { frequency: "daily", interval: 1 }, ...input,
  });
  return { root, runner, calendarStore, store, broker, sessions, commands, tasks, create, cleanup };
}

test("record never executes; remind and execute create ordinary parent-linked tasks with durable occurrence identity", async t => {
  const f = fixture(t);
  f.create({ executionMode: "record", executionPrompt: "" });
  const reminder = f.create({ executionMode: "remind", executionPrompt: "提醒我开会" });
  const execution = f.create();
  await f.runner.tick(new Date(start));
  assert.equal(f.tasks.length, 2);
  for (const plan of [reminder, execution]) {
    const run = f.calendarStore.listRuns({ planId: plan.id }).items[0];
    const task = f.sessions.get(run.sessionId);
    assert.equal(run.status, "dispatched");
    assert.equal(task.parentSessionId, "main");
    assert.equal(task.metadata.planId, plan.id);
    assert.equal(task.metadata.occurrenceAt, start);
    assert.equal(f.commands.get(run.result.commandId).input.payload.planId, plan.id);
  }
  assert.match(f.tasks.find(task => task.title.startsWith("提醒")).taskDescription, /仅提醒本人/);
  await f.runner.tick(new Date(start));
  assert.equal(f.tasks.length, 2);
});

test("two scheduler instances claim one occurrence only; reboot leaves unknown work interrupted and never dispatches it again", async t => {
  const f = fixture(t);
  const plan = f.create({ missedRunPolicy: "latest" });
  const secondConnection = new CalendarStore({ dataDir: f.root, spaceId: "test-space" });
  const second = new TaskPlanRunner({ calendarStore: secondConnection, store: f.store, broker: f.broker, workspaceRoot: f.root, now: () => Date.parse(start) });
  f.cleanup.push(() => { second.stop(); secondConnection.close(); });
  await Promise.all([f.runner.tick(new Date(start)), second.tick(new Date(start))]);
  assert.equal(f.tasks.length, 1);
  const run = f.calendarStore.listRuns({ planId: plan.id }).items[0];
  f.commands.get(run.result.commandId).status = "running";
  f.store.updateSession(run.sessionId, { status: "running" });
  second.recoverInterruptedRuns();
  assert.equal(f.calendarStore.listRuns({ planId: plan.id }).items[0].status, "interrupted");
  assert.equal(f.sessions.get(run.sessionId).status, "paused");
  await second.tick(new Date("2026-09-14T02:00:00Z"));
  assert.equal(f.tasks.length, 1);
});

test("missed skip waits for future while latest dispatches only the newest occurrence", async t => {
  const f = fixture(t);
  f.create({ startAt: "2026-09-10T01:00:00Z", missedRunPolicy: "skip" });
  const latest = f.create({ startAt: "2026-09-10T01:00:00Z", missedRunPolicy: "latest" });
  f.runner.cursor = "2026-09-14T02:00:00Z";
  await f.runner.tick(new Date("2026-09-14T03:00:00Z"));
  assert.equal(f.tasks.length, 1);
  assert.equal(f.calendarStore.listRuns({ planId: latest.id }).items[0].occurrenceAt, start);
  await f.runner.tick(new Date("2026-09-14T04:00:00Z"));
  assert.equal(f.tasks.length, 1);
});

test("cancelled occurrences do not execute and a changed occurrence executes its own prompt", async t => {
  const f = fixture(t);
  const cancel = f.create(), change = f.create();
  f.calendarStore.update({ sessionId: "main" }, cancel.id, { expectedRevision: 1, scope: "occurrence", occurrenceAt: start, status: "cancelled" });
  f.calendarStore.update({ sessionId: "main" }, change.id, { expectedRevision: 1, scope: "occurrence", occurrenceAt: start, executionPrompt: "仅本次整理会议纪要" });
  await f.runner.tick(new Date(start));
  assert.equal(f.tasks.length, 1);
  assert.match(f.tasks[0].taskDescription, /仅本次整理会议纪要/);
  assert.equal(f.calendarStore.listRuns({ planId: cancel.id }).total, 0);
});

test("native execution updates a durable run and relies on the existing main hook for notification", async t => {
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const turns = [];
  const f = fixture(t, { orchestrator: { runTurn(...args) { turns.push(args); return completion; } } });
  const plan = f.create({ recurrence: null });
  await f.runner.tick(new Date(start));
  assert.equal(turns.length, 1);
  assert.equal(f.calendarStore.listRuns({ planId: plan.id }).items[0].status, "running");
  finish({ success: true });
  await completion; await Promise.resolve();
  assert.equal(f.calendarStore.listRuns({ planId: plan.id }).items[0].status, "completed");
  await f.runner.tick(new Date("2026-09-15T01:00:00Z"));
  assert.equal(turns.length, 1);
  assert.equal(f.calendarStore.requirePlan(plan.id).status, "planned");
});

test("main plan commands reject workspaces outside the Space and imported paths cannot escape at execution", async t => {
  const f = fixture(t);
  assert.throws(() => executeCalendarCommand({ calendarStore: f.calendarStore, session: f.sessions.get("main"), workspaceRoot: f.root,
    command: { action: "create", view: "plans", input: { title: "跨空间", startAt: start, timeZone: "Asia/Shanghai", executionContext: { workspaceRoot: path.dirname(f.root) } } },
  }), error => error.code === "PLAN_WORKSPACE_OUTSIDE_SPACE");
  f.create({ executionContext: { workspaceRoot: path.dirname(f.root), recipientId: "untrusted-recipient" } });
  await f.runner.tick(new Date(start));
  assert.equal(f.tasks[0].workspaceRoot, fs.realpathSync(f.root));
  assert.equal(f.tasks[0].parentSessionId, "main");
});

test("desktop and mobile task summaries preserve the plan link without exposing execution paths", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-task-link-"));
  const store = new BridgeStore({ dataDir: root });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const task = store.createSession({ role: "worker", title: "计划执行", metadata: {
    planId: "cal-fixture", occurrenceAt: start, planRunId: "run-fixture", workspaceRoot: "/private/path", recipientId: "private-recipient",
  } });
  assert.equal(store.getSessionRecord(task.id).metadata.planId, "cal-fixture");
  assert.deepEqual(store.getMobileTaskSummary(task.id).metadata, { planId: "cal-fixture", occurrenceAt: start, planRunId: "run-fixture" });
});

test("a late completion after a terminal state change does not reject outside the scheduler", async t => {
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const errors = [];
  const f = fixture(t, { orchestrator: { runTurn: () => completion }, logger: { error: value => errors.push(value) } });
  const plan = f.create();
  await f.runner.tick(new Date(start));
  const run = f.calendarStore.listRuns({ planId: plan.id }).items[0];
  f.calendarStore.updateRun(run.id, { status: "interrupted" });
  finish({ success: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calendarStore.listRuns({ planId: plan.id }).items[0].status, "interrupted");
  assert.equal(errors.length, 1);
  assert.equal(f.runner.active.size, 0);
});

test("new scheduler ownership preserves original rules and pauses the legacy consumer across rollback", t => {
  const f = fixture(t);
  const legacy = new BridgeStore({ dataDir: path.join(f.root, "bridge") });
  f.cleanup.push(() => legacy.close());
  const old = legacy.createScheduledTask({ name: "原有每日计划", cron: "0 9 * * *", timezone: "Asia/Shanghai", prompt: "整理安排", enabled: true });
  takeLegacyScheduleOwnership(f.calendarStore, legacy);
  const plan = f.calendarStore.requirePlan(old.id);
  assert.equal(plan.enabled, true);
  assert.equal(plan.legacy.enabled, true);
  assert.equal(plan.legacy.cron, old.cron);
  assert.equal(legacy.getScheduledTask(old.id).enabled, false);
  assert.equal(legacy.getScheduledTask(old.id).cron, old.cron);
  f.calendarStore.update({ sessionId: "main" }, plan.id, { expectedRevision: 1, status: "cancelled", enabled: false });
  takeLegacyScheduleOwnership(f.calendarStore, legacy);
  assert.equal(f.calendarStore.listPlans().total, 1);
  assert.equal(f.calendarStore.requirePlan(plan.id).status, "cancelled");
  assert.equal(legacy.getScheduledTask(old.id).enabled, false);
});
