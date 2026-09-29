import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CalendarStore } from "../src/calendar/store.js";
import { executeCalendarCommand } from "../src/calendar/control.js";
import { legacyTaskFromPlan, legacyTaskInput, listLegacyTasks } from "../src/calendar/plan-http.js";
import { TaskPlanRunner } from "../src/scheduler/task-plans.js";

const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "../bin/pa-cli.mjs");
test("plan CLI persists a recurring schedule, updates one occurrence, and reads both series and calendar views", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-cli-"));
  const session = { id: "main", role: "main" };
  const store = new CalendarStore({ dataDir: root, spaceId: "fixture", sessionResolver: id => id === session.id ? session : null });
  const captured = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks).toString());
    captured.push(command);
    try {
      assert.equal(req.headers["x-cove-calendar-capability"], "scoped-value");
      const result = executeCalendarCommand({ calendarStore: store, session, command, workspaceRoot: root });
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result }));
    } catch (error) { res.writeHead(error.statusCode || 400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` };
  const run = async (domain, ...argv) => JSON.parse((await exec(process.execPath, [cli, domain, ...argv, "--capability", "scoped-value", "--json"], { env })).stdout).data;
  const plan = await run("plan", "create", "--title", "每周复盘", "--start-at", "2026-09-14T09:00:00+08:00", "--time-zone", "Asia/Shanghai",
    "--execution-mode", "execute", "--execution-prompt", "整理本周待办", "--recurrence-json", JSON.stringify({ frequency: "weekly", interval: 1, weekdays: [1], count: 4 }), "--missed-run-policy", "latest");
  assert.equal(plan.executionMode, "execute");
  assert.equal(plan.recurrence.count, 4);
  assert.equal((await run("plan", "list")).total, 1);
  const before = await run("calendar", "list", "--plan-id", plan.id, "--from", "2026-09-01T00:00:00Z", "--to", "2026-10-31T00:00:00Z");
  assert.equal(before.total, 4);
  await run("plan", "update", "--id", plan.id, "--expected-revision", "1", "--scope", "occurrence", "--occurrence-at", before.items[1].occurrenceAt, "--status", "cancelled");
  const after = await run("calendar", "list", "--plan-id", plan.id, "--from", "2026-09-01T00:00:00Z", "--to", "2026-10-31T00:00:00Z");
  assert.equal(after.items[1].status, "cancelled");
  assert.equal(after.items[2].status, "planned");
  assert.equal((await run("plan", "show", "--id", plan.id)).status, "planned");
  assert.equal((await run("plan", "runs", "--id", plan.id, "--occurrence-at", before.items[0].occurrenceAt)).total, 0);
  assert.equal((await run("plan", "history", "--id", plan.id)).total, 2);
  assert.ok(captured.some(command => command.view === "plans" && command.action === "create"));
  assert.ok(captured.some(command => command.view === undefined && command.action === "list"));
  await assert.rejects(run("plan", "update", "--id", plan.id, "--expected-revision", "2", "--enabled", "--disabled"));
});

test("legacy cron writes and reads operate on one plan and preserve identifiers through migration", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-cron-plan-"));
  const store = new CalendarStore({ dataDir: root, spaceId: "fixture", sessionResolver: id => ({ id, role: "main" }) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const legacy = { id: "cron-preserved", name: "旧提醒", cron: "0 9 * * *", timezone: "Asia/Shanghai", prompt: "提醒本人", enabled: true,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-13T01:01:00Z", nextRunAt: "2026-09-14T01:00:00Z", runCount: 20,
    lastRunAt: "2026-09-13T01:00:15Z", lastSessionId: "legacy-session" };
  store.importLegacySchedules([legacy]); store.importLegacySchedules([legacy]);
  assert.equal(store.listPlans().total, 1);
  assert.equal(listLegacyTasks(store)[0].id, legacy.id);
  assert.equal(listLegacyTasks(store)[0].runCount, 20);
  assert.equal(listLegacyTasks(store)[0].lastRunAt, new Date(legacy.lastRunAt).toISOString());
  assert.equal(legacyTaskFromPlan(store.requirePlan(legacy.id), store).cron, legacy.cron);
  store.update({ sessionId: "main" }, legacy.id, legacyTaskInput({ name: "改到十点", cron: "0 10 * * *" }, store.requirePlan(legacy.id)));
  store.importLegacySchedules([legacy]);
  assert.equal(store.requirePlan(legacy.id).title, "改到十点");
  assert.equal(listLegacyTasks(store)[0].cron, "0 10 * * *");
  store.update({ sessionId: "main" }, legacy.id, { expectedRevision: 2, enabled: false, status: "cancelled" });
  assert.equal(listLegacyTasks(store).length, 0);
  assert.equal(store.listPlans().total, 1);
  assert.equal(legacy.name, "旧提醒");
});

test("CLI-created reminders and weekly plans reach the scheduler with durable runs", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-cli-dispatch-"));
  const clock = { now: Date.parse("2026-10-01T00:59:00.000Z") };
  const main = { id: "main", role: "main", spaceId: "fixture" };
  const sessions = new Map([[main.id, main]]);
  let calendarStore = new CalendarStore({ dataDir: root, spaceId: "fixture", now: () => clock.now, sessionResolver: id => sessions.get(id) });
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    try {
      if (request.headers["x-cove-calendar-capability"] !== "scoped-value") throw Object.assign(new Error("invalid capability"), { statusCode: 403 });
      const command = JSON.parse(Buffer.concat(chunks).toString());
      const result = executeCalendarCommand({ calendarStore, session: main, command, workspaceRoot: root });
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true, result }));
    } catch (error) { response.writeHead(error.statusCode || 400, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` };
  const run = async (domain, ...argv) => JSON.parse((await exec(process.execPath, [cli, domain, ...argv, "--capability", "scoped-value", "--json"], { env })).stdout).data;
  const tasks = [];
  const store = {
    getSessionRecord: id => sessions.get(id),
    updateSession(id, patch) { sessions.set(id, { ...sessions.get(id), ...patch }); return sessions.get(id); },
  };
  const broker = { createBrokerSession(input) { const task = { ...input, id: `task-${tasks.length + 1}`, metadata: {}, status: "idle" }; tasks.push(task); sessions.set(task.id, task); return task; } };
  let runner = new TaskPlanRunner({ calendarStore, store, broker, orchestrator: { runTurn: async () => ({ success: true }) }, workspaceRoot: root, now: () => clock.now });
  t.after(() => { runner.stop(); server.close(); calendarStore.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const reminder = await run("plan", "create", "--title", "提醒交资料", "--start-at", "2026-10-01T09:00:00+08:00", "--time-zone", "Asia/Shanghai",
    "--execution-mode", "remind", "--execution-prompt", "提醒我交资料");
  const weekly = await run("plan", "create", "--title", "每周复盘", "--start-at", "2026-10-01T09:00:00+08:00", "--time-zone", "Asia/Shanghai",
    "--execution-mode", "execute", "--execution-prompt", "整理一周记录", "--recurrence-json", JSON.stringify({ frequency: "weekly", weekdays: [4] }));
  assert.equal((await run("calendar", "list", "--view", "upcoming", "--from", "2026-10-01T08:59:00+08:00")).nextEntry.startAt, "2026-10-01T01:00:00.000Z");
  await runner.tick(new Date("2026-10-01T01:00:01.000Z"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tasks.length, 2);
  assert.equal(calendarStore.listRuns({ planId: reminder.id }).items[0].status, "completed");
  assert.equal(calendarStore.listRuns({ planId: weekly.id }).items[0].status, "completed");
  assert.equal((await run("plan", "runs", "--id", weekly.id)).total, 1);

  runner.stop(); calendarStore.close();
  calendarStore = new CalendarStore({ dataDir: root, spaceId: "fixture", now: () => clock.now, sessionResolver: id => sessions.get(id) });
  runner = new TaskPlanRunner({ calendarStore, store, broker, orchestrator: { runTurn: async () => ({ success: true }) }, workspaceRoot: root, now: () => clock.now });
  await runner.tick(new Date("2026-10-01T01:00:02.000Z"));
  clock.now = Date.parse("2026-10-01T01:00:02.000Z");
  assert.equal(tasks.length, 2);
  assert.equal((await run("plan", "show", "--id", reminder.id)).id, reminder.id);
  assert.equal((await run("plan", "list")).items.find(item => item.id === weekly.id).nextOccurrenceAt, "2026-10-08T01:00:00.000Z");
  assert.equal((await run("calendar", "list", "--view", "upcoming", "--from", "2026-10-02T00:00:00Z")).nextEntry.startAt, "2026-10-08T01:00:00.000Z");
  clock.now = Date.parse("2026-10-08T01:00:01.000Z");
  await runner.tick(new Date(clock.now));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tasks.length, 3);
  assert.equal((await run("plan", "runs", "--id", weekly.id)).total, 2);
  assert.equal((await run("plan", "list")).items.find(item => item.id === weekly.id).nextOccurrenceAt, "2026-10-15T01:00:00.000Z");

  const dst = await run("plan", "create", "--title", "纽约周会", "--start-at", "2026-10-29T09:00:00-04:00", "--time-zone", "America/New_York",
    "--recurrence-json", JSON.stringify({ frequency: "weekly", weekdays: [4], count: 2 }));
  assert.deepEqual((await run("calendar", "list", "--plan-id", dst.id, "--from", "2026-10-29T00:00:00Z", "--to", "2026-11-07T00:00:00Z")).items.map(item => item.startAt),
    ["2026-10-29T13:00:00.000Z", "2026-11-05T14:00:00.000Z"]);
  const otherSpace = new CalendarStore({ databasePath: calendarStore.databasePath, spaceId: "other", sessionResolver: () => null });
  try { assert.equal(otherSpace.listPlans().total, 0); }
  finally { otherSpace.close(); }
  await assert.rejects(run("plan", "create", "--title", "无效时间", "--start-at", "2026-10-01", "--time-zone", "Asia/Shanghai"),
    error => /startAt必须为带时区的ISO时间/.test(error.stderr));
  await assert.rejects(run("plan", "create", "--title", "没有提醒内容", "--start-at", "2026-10-16T09:00:00+08:00", "--time-zone", "Asia/Shanghai", "--execution-mode", "remind"),
    error => /提醒和执行计划必须保留完整要求/.test(error.stderr));
});
