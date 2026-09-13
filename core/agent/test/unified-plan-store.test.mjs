import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalendarStore } from "../src/calendar/store.js";
import { occurrences } from "../src/calendar/recurrence.js";

const actor = { sessionId: "main" };
function fixture(t, now = "2026-09-13T12:00:00Z") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-test-"));
  const config = { dataDir, spaceId: "alpha", now: () => Date.parse(now), sessionResolver: id => id === "main" ? { id, role: "main", spaceId: "alpha" } : null };
  const store = new CalendarStore(config), extra = [];
  t.after(() => { extra.forEach(s => s.close()); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const create = (patch = {}) => store.create(actor, { title: "计划", startAt: "2026-09-13T09:00:00Z", timeZone: "UTC", ...patch });
  return { store, create, config, extra };
}
const ats = plan => [...occurrences(plan)];

test("recurrence retains civil clock across DST, skips missing clocks, and chooses one repeated clock", () => {
  const base = { startAt: "2026-03-07T07:30:00.000Z", timeZone: "America/New_York", recurrence: { frequency: "daily", interval: 1, count: 3 } };
  assert.deepEqual(ats(base), ["2026-03-07T07:30:00.000Z", "2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
  assert.deepEqual(ats({ ...base, startAt: "2026-10-31T05:30:00.000Z" }), ["2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
  assert.deepEqual(ats({ ...base, startAt: "2026-03-07T14:00:00.000Z" }), ["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z"]);
});

test("month-end and leap-year skips do not consume count; until is inclusive and interval is civil", () => {
  const base = { startAt: "2026-01-31T09:00:00.000Z", timeZone: "UTC", recurrence: { frequency: "monthly", interval: 1, count: 3 } };
  assert.deepEqual(ats(base), ["2026-01-31T09:00:00.000Z", "2026-03-31T09:00:00.000Z", "2026-05-31T09:00:00.000Z"]);
  assert.deepEqual([...occurrences(base, { from: "2026-03-01T00:00:00Z" })], ["2026-03-31T09:00:00.000Z", "2026-05-31T09:00:00.000Z"]);
  assert.deepEqual(ats({ ...base, startAt: "2028-02-29T09:00:00.000Z", recurrence: { frequency: "yearly", interval: 1, count: 2 } }), ["2028-02-29T09:00:00.000Z", "2032-02-29T09:00:00.000Z"]);
  assert.deepEqual(ats({ ...base, startAt: "2026-12-30T09:00:00.000Z", recurrence: { frequency: "daily", interval: 2, until: "2027-01-03T09:00:00.000Z" } }), ["2026-12-30T09:00:00.000Z", "2027-01-01T09:00:00.000Z", "2027-01-03T09:00:00.000Z"]);
});

test("weekly weekdays and every-other-week anchor use Monday week boundary", () => {
  const plan = { startAt: "2026-09-16T01:00:00.000Z", timeZone: "Asia/Shanghai", recurrence: { frequency: "weekly", interval: 2, weekdays: [1, 3, 5], count: 5 } };
  assert.deepEqual(ats(plan), ["2026-09-16T01:00:00.000Z", "2026-09-18T01:00:00.000Z", "2026-09-28T01:00:00.000Z", "2026-09-30T01:00:00.000Z", "2026-10-02T01:00:00.000Z"]);
});

test("unbounded upcoming exposes each plan next occurrence even years away; bounded ranges expand and paginate", t => {
  const { store, create } = fixture(t);
  const leap = create({ title: "闰日", startAt: "2024-02-29T09:00:00Z", recurrence: { frequency: "yearly" } });
  const daily = create({ recurrence: { frequency: "daily", count: 4 } });
  const list = store.list({ view: "upcoming", limit: 1 });
  assert.equal(list.projection, "next_per_plan"); assert.equal(list.total, 2); assert.equal(list.hasMore, true);
  assert.equal(list.nextEntry.planId, daily.id); assert.equal(list.nextEntry.startAt, "2026-09-14T09:00:00.000Z");
  assert.equal(store.list({ view: "upcoming", offset: 1 }).items[0].startAt, "2028-02-29T09:00:00.000Z");
  assert.equal(store.listPlans().items.find(p => p.id === leap.id).nextOccurrenceAt, "2028-02-29T09:00:00.000Z");
  const range = { from: "2026-09-13T00:00:00Z", to: "2026-09-17T00:00:00Z", planId: daily.id, limit: 2 };
  assert.equal(store.list(range).total, 4); assert.equal(store.list(range).items.length, 2);
  assert.equal(store.list({ ...range, offset: 2 }).hasMore, false);
  const instance = store.list(range).items[0];
  assert.equal(store.requireEntry(instance.id).occurrenceAt, instance.occurrenceAt);
  assert.throws(() => store.requireEntry(`${daily.id}@${Date.parse(instance.occurrenceAt) + 1}`), { code: "CALENDAR_NOT_FOUND" });
});

test("single-occurrence edit keeps identity, moves range projection, and cancellation does not extend count", t => {
  const { store, create } = fixture(t);
  const plan = create({ recurrence: { frequency: "daily", count: 3 } });
  const second = "2026-09-14T09:00:00.000Z";
  const moved = store.update(actor, plan.id, { expectedRevision: 1, scope: "occurrence", occurrenceAt: second, startAt: "2026-09-20T09:00:00Z", title: "改期" });
  assert.equal(moved.id, `${plan.id}@${Date.parse(second)}`); assert.equal(moved.occurrenceAt, second);
  assert.equal(store.list({ from: "2026-09-14T00:00:00Z", to: "2026-09-15T00:00:00Z" }).total, 0);
  assert.equal(store.list({ from: "2026-09-20T00:00:00Z", to: "2026-09-21T00:00:00Z" }).items[0].title, "改期");
  assert.equal(store.list({ view: "upcoming" }).nextEntry.startAt, "2026-09-15T09:00:00.000Z");
  store.update(actor, plan.id, { expectedRevision: 2, scope: "occurrence", occurrenceAt: "2026-09-15T09:00:00Z", status: "cancelled" });
  assert.equal(store.list({ view: "upcoming" }).nextEntry.startAt, "2026-09-20T09:00:00.000Z");
  assert.equal(store.list({ view: "upcoming", from: "2026-09-21T00:00:00Z" }).total, 0);
  assert.throws(() => store.update(actor, plan.id, { expectedRevision: 3, scope: "occurrence", occurrenceAt: "2026-09-16T09:00:00Z", title: "不存在" }), { code: "CALENDAR_NOT_FOUND" });
});

test("future split preserves earlier exception and run snapshots and enforces remaining count", t => {
  const { store, create } = fixture(t);
  const plan = create({ recurrence: { frequency: "daily", count: 4 }, executionMode: "execute", executionPrompt: "生成报告" });
  store.update(actor, plan.id, { scope: "occurrence", occurrenceAt: plan.startAt, expectedRevision: 1, title: "首日例外" });
  const run = store.claimRun(plan.id, plan.startAt); assert.equal(run.snapshot.title, "首日例外");
  const future = store.update(actor, plan.id, { scope: "future", occurrenceAt: "2026-09-15T09:00:00Z", expectedRevision: 2, title: "后续" });
  assert.equal(future.recurrence.count, 2); assert.equal(future.splitFrom, plan.id);
  const range = store.list({ from: "2026-09-13T00:00:00Z", to: "2026-09-20T00:00:00Z" });
  assert.deepEqual(range.items.map(p => p.title), ["首日例外", "计划", "后续", "后续"]);
  assert.equal(store.listRuns(plan.id).items[0].snapshot.title, "首日例外");
  assert.throws(() => store.requireEntry(`${plan.id}@${Date.parse("2026-09-15T09:00:00Z")}`), { code: "CALENDAR_NOT_FOUND" });
});

test("run claim deduplicates across handles and restart, links one session, and rejects cross-Space access", t => {
  const { store, create, config, extra } = fixture(t);
  const record = create(); assert.equal(store.claimRun(record.id, record.startAt), null);
  const plan = create({ executionMode: "remind", executionPrompt: "提醒我喝水" });
  const second = new CalendarStore(config); extra.push(second);
  const run = store.claimRun(plan.id, plan.startAt); assert.equal(second.claimRun(plan.id, plan.startAt), null);
  store.updateRun(run.id, { status: "dispatched", taskSessionId: "task-1" });
  assert.equal(second.listRuns({ occurrenceAt: plan.startAt }).items[0].sessionId, "task-1");
  assert.throws(() => store.updateRun(run.id, { taskSessionId: "task-2" }), { code: "RUN_SESSION_CONFLICT" });
  store.updateRun(run.id, { status: "interrupted" });
  assert.equal(second.claimRun(plan.id, plan.startAt), null);
  assert.throws(() => store.updateRun(run.id, { status: "running" }), { code: "RUN_ALREADY_FINISHED" });
  const other = new CalendarStore({ ...config, spaceId: "beta" }); extra.push(other);
  assert.equal(other.listRuns().total, 0); assert.throws(() => other.updateRun(run.id, { status: "failed" }), { code: "RUN_NOT_FOUND" });
  assert.throws(() => other.claimRun(plan.id, plan.startAt), { code: "CALENDAR_NOT_FOUND" });
});

test("scheduler skips downtime by default and latest catch-up picks only the most recent effective occurrence", t => {
  const { store, create } = fixture(t);
  const base = { startAt: "2020-01-01T09:00:00Z", recurrence: { frequency: "daily" }, executionMode: "execute", executionPrompt: "总结" };
  const skip = create(base), latest = create({ ...base, missedRunPolicy: "latest" });
  const clock = { asOf: "2026-09-13T12:00:00Z", startedAt: "2026-09-13T11:00:00Z" };
  const due = store.schedulerDue(clock); assert.equal(due.length, 1); assert.equal(due[0].planId, latest.id); assert.equal(due[0].startAt, "2026-09-13T09:00:00.000Z");
  store.claimRun(latest.id, due[0].occurrenceAt); assert.equal(store.schedulerDue(clock).length, 0);
  store.update(actor, skip.id, { expectedRevision: 1, scope: "occurrence", occurrenceAt: "2026-09-13T09:00:00Z", startAt: "2026-09-13T11:30:00Z" });
  assert.equal(store.schedulerDue(clock)[0].startAt, "2026-09-13T11:30:00.000Z");
});

test("legacy import is atomic, idempotent and preserves historical association without forged main authority", t => {
  const { store, config, extra } = fixture(t);
  const legacy = { id: "legacy-1", name: "旧任务", cron: "0 9 * * 1", timezone: "Asia/Shanghai", prompt: "每周汇总", enabled: true, createdAt: "2025-01-01T00:00:00Z", lastRunAt: "2026-09-07T01:00:00Z", lastSessionId: "old-task", runCount: 20 };
  const imported = store.importLegacySchedules([legacy])[0];
  assert.equal(imported.id, legacy.id); assert.equal(imported.legacy.runCount, 20); assert.equal(imported.mainSessionId, "");
  assert.equal(store.history(imported.id).total, 0); assert.equal(store.listRuns(imported.id).items[0].sessionId, "old-task");
  store.importLegacySchedules([legacy]); assert.equal(store.listPlans().total, 1); assert.equal(store.listRuns().total, 1);
  assert.throws(() => store.importLegacySchedules([{ ...legacy, id: "rollback" }, { ...legacy, id: "" }]));
  assert.equal(store.getPlan("rollback"), null);
  const invalid = store.importLegacySchedules([{ ...legacy, id: "invalid-cron", cron: "* * * * *", lastRunAt: null, lastSessionId: null }])[0];
  assert.equal(invalid.enabled, false); assert.equal(invalid.recurrence, null); assert.match(invalid.legacy.migrationWarning, /15分钟/);
  assert.equal(invalid.legacy.cron, "* * * * *");
  const other = new CalendarStore({ ...config, spaceId: "beta" }); extra.push(other);
  const otherPlan = other.importLegacySchedules([legacy])[0];
  assert.notEqual(otherPlan.id, imported.id);
  assert.equal(other.getPlan(legacy.id).id, otherPlan.id);
  assert.equal(other.listRuns(legacy.id).total, 1);
});

test("manual run identity never consumes the scheduled occurrence at the same instant", t => {
  const { store, create } = fixture(t);
  const plan = create({ executionMode: "execute", executionPrompt: "汇总" });
  const manual = store.claimRun(plan.id, plan.startAt, { manual: true, manualOccurrence: true });
  const scheduled = store.claimRun(plan.id, plan.startAt);
  assert.equal(manual.triggerKind, "manual"); assert.equal(scheduled.triggerKind, "scheduled");
  assert.notEqual(manual.id, scheduled.id); assert.equal(store.listRuns(plan.id).total, 2);
});

test("recurrence validation rejects sub-15-minute cron and backwards cutoff, early Gregorian years remain exact", t => {
  const { create } = fixture(t);
  assert.throws(() => create({ recurrence: { frequency: "cron", expression: "* * * * *" } }), { code: "INVALID_RECURRENCE" });
  assert.throws(() => create({ recurrence: { frequency: "daily", until: "2020-01-01T00:00:00Z" } }), { code: "INVALID_RECURRENCE" });
  const early = create({ startAt: "0001-01-01T09:00:00Z", recurrence: { frequency: "yearly", count: 2 } });
  assert.deepEqual(ats(early), ["0001-01-01T09:00:00.000Z", "0002-01-01T09:00:00.000Z"]);
});

test("occurrence follow-up is isolated, whole-series cancellation suppresses previously active exceptions", t => {
  const { store, create } = fixture(t);
  const plan = create({ recurrence: { frequency: "daily", count: 3 }, executionMode: "execute", executionPrompt: "汇总" });
  const instanceId = `${plan.id}@${Date.parse(plan.startAt)}`;
  const followed = store.followUp(actor, instanceId, { expectedRevision: 1, content: "本次已完成", status: "done" });
  assert.equal(followed.status, "done"); assert.equal(store.requirePlan(plan.id).status, "planned");
  assert.equal(store.history(instanceId).items[0].content, "本次已完成");
  assert.deepEqual(store.history(instanceId).items[0].changes.status, { before: "planned", after: "done" });
  assert.equal(store.list({ view: "upcoming" }).nextEntry.startAt, "2026-09-14T09:00:00.000Z");
  store.update(actor, plan.id, { expectedRevision: 2, status: "cancelled" });
  assert.equal(store.list({ view: "upcoming" }).total, 0);
  assert.equal(store.schedulerDue({ asOf: "2026-09-15T12:00:00Z", startedAt: "2026-09-13T00:00:00Z" }).length, 0);
});

test("upcoming retains every ongoing overlap and picks the earliest, independently of pagination", t => {
  const { store, create } = fixture(t, "2026-09-16T12:00:00Z");
  const plan = create({ startAt: "2026-09-13T09:00:00Z", endAt: "2026-09-20T09:00:00Z", recurrence: { frequency: "daily" } });
  const result = store.list({ view: "upcoming", limit: 1 });
  assert.equal(result.total, 5); assert.equal(result.ongoingEntry.startAt, plan.startAt);
  assert.equal(result.nextEntry.startAt, "2026-09-17T09:00:00.000Z");
  assert.equal(store.list({ view: "upcoming", limit: 1, offset: 4 }).ongoingEntry.id, result.ongoingEntry.id);
});

test("series edits preserve addressable historical executed snapshots but never re-admit them for scheduling", t => {
  const { store, create } = fixture(t);
  const plan = create({ recurrence: { frequency: "daily", count: 4 }, executionMode: "execute", executionPrompt: "报告" });
  const at = "2026-09-15T09:00:00.000Z", run = store.claimRun(plan.id, at);
  store.updateRun(run.id, { status: "completed", taskSessionId: "task-1" });
  assert.throws(() => store.update(actor, plan.id, { scope: "future", occurrenceAt: "2026-09-14T09:00:00Z", expectedRevision: 1, title: "新系列" }), { code: "PLAN_FUTURE_ALREADY_STARTED" });
  assert.equal(store.requirePlan(plan.id).revision, 1);
  store.update(actor, plan.id, { expectedRevision: 1, startAt: "2026-09-16T09:00:00Z", title: "新系列" });
  const historical = store.requireEntry(`${plan.id}@${Date.parse(at)}`);
  assert.equal(historical.isHistorical, true); assert.equal(historical.title, "计划");
  assert.throws(() => store.claimRun(plan.id, at), { code: "CALENDAR_NOT_FOUND" });
});

test("legacy delayed wake timestamps deduplicate the nominal cron occurrence after enabling latest catch-up", t => {
  const { store } = fixture(t, "2026-09-13T21:00:10Z");
  const legacy = { id: "late-legacy", name: "旧任务", cron: "0 21 * * *", timezone: "UTC", prompt: "总结", enabled: true,
    createdAt: "2026-09-01T00:00:00Z", lastRunAt: "2026-09-13T21:00:05Z", lastSessionId: "old-task", runCount: 12, lastError: "No WeChat recipient is available" };
  const plan = store.importLegacySchedules([legacy])[0];
  const run = store.listRuns(plan.id).items[0];
  assert.equal(run.occurrenceAt, "2026-09-13T21:00:00.000Z");
  assert.equal(run.createdAt, "2026-09-13T21:00:05.000Z");
  assert.equal(run.snapshot.occurrenceAt, run.occurrenceAt);
  assert.equal(run.status, "dispatched"); assert.equal(run.finishedAt, null);
  assert.equal(plan.legacy.lastError, legacy.lastError);
  assert.equal(plan.legacy.runCount, 12); assert.equal(plan.legacy.importedRunCount, 1);
  assert.equal(store.listRuns(plan.id).total, 1);
  assert.equal(plan.missedRunPolicy, "skip");
  store.update(actor, plan.id, { expectedRevision: 1, missedRunPolicy: "latest" });
  assert.equal(store.requirePlan(plan.id).mainSessionId, actor.sessionId);
  assert.equal(store.schedulerDue({ asOf: "2026-09-13T21:00:10Z", startedAt: "2026-09-13T21:00:10Z" }).length, 0);
  assert.equal(store.claimRun(plan.id, run.occurrenceAt), null);
  const noOccurrence = store.importLegacySchedules([{ ...legacy, id: "before-first-occurrence", createdAt: "2026-09-13T21:00:06Z" }])[0];
  assert.equal(noOccurrence.legacy.importedRunCount, 0);
  assert.equal(noOccurrence.legacy.lastSessionId, "old-task");
  assert.equal(noOccurrence.legacy.runCount, 12);
  assert.equal(store.listRuns(noOccurrence.id).total, 0);
});

test("legacy oversized requirements and invalid clocks remain complete disabled records without blocking valid imports", t => {
  const { store } = fixture(t);
  const base = { name: "旧任务", cron: "0 9 * * *", timezone: "UTC", prompt: "总结", enabled: true, createdAt: "2025-01-01T00:00:00Z" };
  const originals = [
    { ...base, id: "long-prompt", prompt: "完整要求".repeat(9000) },
    { ...base, id: "bad-zone", timezone: "Mars/Olympus" },
    { ...base, id: "bad-name", name: "原始\n多行名称" },
    { ...base, id: "bad-date", createdAt: "not-a-date" },
    { ...base, id: "valid" },
  ];
  const imported = store.importLegacySchedules(originals);
  assert.equal(imported.length, 5);
  for (let index = 0; index < 4; index++) {
    assert.equal(imported[index].enabled, false);
    assert.equal(imported[index].executionMode, "record");
    assert.equal(imported[index].executionPrompt, "");
    assert.equal(imported[index].legacy.prompt, originals[index].prompt);
    assert.equal(imported[index].legacy.name, originals[index].name);
    assert.equal(imported[index].legacy.timezone, originals[index].timezone);
    assert.equal(imported[index].legacy.createdAt, originals[index].createdAt);
    assert.match(imported[index].legacy.migrationWarning, /完整原始记录/);
  }
  assert.equal(imported[4].enabled, true); assert.equal(imported[4].executionMode, "execute");
  assert.equal(store.listPlans().total, 5);
});
