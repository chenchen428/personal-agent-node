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
