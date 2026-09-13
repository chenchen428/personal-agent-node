import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalendarStore } from "../src/calendar/store.js";
import { executeCalendarCommand } from "../src/calendar/control.js";

const actor = { sessionId: "main-a" };
const input = () => ({ title: "方案确认", participants: ["小王", "小李"], startAt: "2026-09-12T09:30:00+08:00",
  endAt: "2026-09-12T10:00:00+08:00", timeZone: "Asia/Shanghai", location: "会议室", notes: "讨论下一步",
  nextFollowUpAt: "2026-09-13T09:00:00+08:00" });

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-calendar-"));
  const sessions = new Map([
    ["main-a", { id: "main-a", role: "main", spaceId: "space-a" }],
    ["worker-a", { id: "worker-a", role: "worker", spaceId: "space-a" }],
    ["main-b", { id: "main-b", role: "main", spaceId: "space-b" }],
    ["fake-main", { id: "fake-main", role: "main", parentSessionId: "main-a" }],
  ]);
  const config = { dataDir, spaceId: "space-a", sessionResolver: (id) => sessions.get(id), now: () => Date.parse("2026-09-13T02:00:00Z") };
  const store = new CalendarStore(config);
  const others = [];
  t.after(() => { for (const other of others) other.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, config, sessions, others };
}

test("calendar creation normalizes UTC and records verified authorship without side effects", (t) => {
  const { store } = fixture(t);
  const entry = store.create(actor, input());
  assert.equal(entry.startAt, "2026-09-12T01:30:00.000Z");
  assert.equal(entry.timeZone, "Asia/Shanghai");
  assert.equal(entry.revision, 1);
  assert.equal(entry.status, "planned");
  assert.deepEqual(entry.participants, ["小王", "小李"]);
  assert.deepEqual(store.get(entry.id), entry);
  const history = store.history(entry.id);
  assert.equal(history.total, 1);
  assert.equal(history.items[0].actor, "Cove");
  assert.equal(history.items[0].action, "create");
  assert.deepEqual(history.items[0].changes.title, { before: null, after: "方案确认" });
  assert.equal(store.db.prepare("SELECT main_session_id FROM cove_calendar_history").get().main_session_id, "main-a");
  assert.deepEqual(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name),
    ["cove_calendar_entries", "cove_calendar_history", "cove_plan_exceptions", "cove_plan_imports", "cove_plan_runs"]);
});

test("calendar operations enforce Space and resolver-owned main identity", (t) => {
  const { store, config, others } = fixture(t);
  for (const sessionId of ["missing", "worker-a", "main-b", "fake-main"]) {
    assert.throws(() => store.create({ sessionId }, input()), { code: "MAIN_AGENT_REQUIRED" });
  }
  assert.throws(() => store.create({ sessionId: "main-a", role: "main" }, input()), { code: "INVALID_CALENDAR_FIELD" });
  for (const forged of [{ spaceId: "space-b" }, { actor: "user" }, { mainSessionId: "other" }, { revision: 100 }, { createdAt: "2020-01-01T00:00:00Z" }]) {
    assert.throws(() => store.create(actor, { ...input(), ...forged }), { code: "INVALID_CALENDAR_FIELD" });
  }
  const entry = store.create(actor, input());
  const other = new CalendarStore({ ...config, spaceId: "space-b" }); others.push(other);
  assert.equal(other.get(entry.id), null);
  assert.equal(other.list().total, 0);
  assert.equal(other.due().total, 0);
  assert.throws(() => other.history(entry.id), { code: "CALENDAR_NOT_FOUND" });
  assert.throws(() => other.update({ sessionId: "main-b" }, entry.id, { expectedRevision: 1, title: "cross-space" }), { code: "CALENDAR_NOT_FOUND" });
  assert.throws(() => other.followUp({ sessionId: "main-b" }, entry.id, { expectedRevision: 1, content: "cross-space" }), { code: "CALENDAR_NOT_FOUND" });
  assert.throws(() => store.list({ spaceId: "space-b" }), { code: "INVALID_CALENDAR_FIELD" });
});

test("calendar rejects invalid civil times, missing offsets, invalid zones and excessive fields", (t) => {
  const { store } = fixture(t);
  for (const startAt of ["2026-09-12", "2026-09-12T09:30:00", "2026-02-30T09:00:00Z", "2026-13-01T09:00:00Z",
    "2026-09-12T24:00:00Z", "2026-09-12T09:60:00Z", "2026-09-12T09:00:60Z", "2026-09-12T09:00:00+14:01", "0000-01-01T00:00:00Z"]) {
    assert.throws(() => store.create(actor, { ...input(), startAt }), { code: "INVALID_CALENDAR_TIME" });
  }
  assert.throws(() => store.create(actor, { ...input(), timeZone: "Mars/Olympus" }), { code: "INVALID_CALENDAR_TIME_ZONE" });
  assert.throws(() => store.create(actor, { ...input(), endAt: "2026-09-12T09:00:00+08:00" }), { code: "INVALID_CALENDAR_RANGE" });
  for (const patch of [{ title: "x".repeat(201) }, { title: "x\nheading" }, { participants: "someone" }, { participants: Array(101).fill("x") },
    { participants: ["x".repeat(121)] }, { notes: "x".repeat(8001) }, { location: "x".repeat(501) }]) {
    assert.throws(() => store.create(actor, { ...input(), ...patch }));
  }
  const leap = store.create(actor, { ...input(), startAt: "2028-02-29T09:00:00+08:00", endAt: null });
  assert.equal(leap.startAt, "2028-02-29T01:00:00.000Z");
  assert.equal(store.list().total, 1);
});

test("calendar range queries include cross-day overlaps and return explicit pagination", (t) => {
  const { store } = fixture(t);
  const add = (title, startAt, endAt) => store.create(actor, { ...input(), title, startAt, endAt });
  add("cross-day", "2026-09-11T23:00:00+08:00", "2026-09-12T01:00:00+08:00");
  add("ends at boundary", "2026-09-11T23:00:00+08:00", "2026-09-12T00:00:00+08:00");
  add("instant", "2026-09-12T00:00:00+08:00", null);
  add("zero-duration", "2026-09-12T00:00:00+08:00", "2026-09-12T00:00:00+08:00");
  add("next day", "2026-09-13T00:00:00+08:00", null);
  const range = { from: "2026-09-12T00:00:00+08:00", to: "2026-09-13T00:00:00+08:00" };
  const first = store.list({ ...range, limit: 2 });
  assert.equal(first.total, 3); assert.equal(first.items.length, 2); assert.equal(first.hasMore, true);
  const second = store.list({ ...range, limit: 2, offset: 2 });
  assert.equal(second.items.length, 1); assert.equal(second.hasMore, false);
  assert.deepEqual([...first.items, ...second.items].map((entry) => entry.title).sort(), ["cross-day", "instant", "zero-duration"]);
  assert.throws(() => store.list({ ...range, to: range.from }), { code: "INVALID_CALENDAR_RANGE" });
  assert.throws(() => store.list({ limit: 1001 }), { code: "INVALID_CALENDAR_INTEGER" });
  assert.throws(() => store.list({ offset: -1 }), { code: "INVALID_CALENDAR_INTEGER" });
});

test("follow-up appends immutable progress, guards revisions, and updates due state", (t) => {
  const { store } = fixture(t);
  const initial = store.create(actor, input());
  assert.equal(store.due().items[0].id, initial.id);
  const updated = store.followUp(actor, initial.id, { expectedRevision: 1, content: "方案已经确认", status: "in_progress",
    nextFollowUpAt: "2026-09-14T09:00:00+08:00" });
  assert.equal(updated.revision, 2); assert.equal(store.due().total, 0);
  assert.equal(store.due({ before: "2026-09-14T01:00:00Z" }).total, 1);
  assert.throws(() => store.followUp(actor, initial.id, { expectedRevision: 1, content: "old" }), { code: "REVISION_CONFLICT" });
  assert.throws(() => store.update(actor, initial.id, { title: "missing revision" }), { code: "INVALID_CALENDAR_INTEGER" });
  assert.throws(() => store.followUp(actor, initial.id, { expectedRevision: 2, content: "", actor: "user" }), { code: "INVALID_CALENDAR_FIELD" });
  const done = store.update(actor, initial.id, { expectedRevision: 2, status: "done" });
  assert.equal(done.revision, 3); assert.equal(store.due({ before: "2027-01-01T00:00:00Z" }).total, 0);
  const history = store.history(initial.id);
  assert.deepEqual(history.items.map((item) => item.revision), [3, 2, 1]);
  assert.equal(history.items[1].content, "方案已经确认");
  assert.deepEqual(history.items[1].changes.status, { before: "planned", after: "in_progress" });
  assert.equal(store.history(initial.id, { limit: 1 }).hasMore, true);
  const cleared = store.update(actor, initial.id, { expectedRevision: 3, nextFollowUpAt: null, endAt: null });
  assert.equal(cleared.nextFollowUpAt, null); assert.equal(cleared.endAt, null);
});

test("upcoming calendar has no seven-day horizon and keeps nearest future and ongoing entries independent of pagination", (t) => {
  const { store, config, others } = fixture(t);
  const add = (title, startAt, endAt = null, status = "planned") => store.create(actor, { ...input(), title, startAt, endAt, status });
  add("past", "2026-09-12T01:00:00Z");
  add("ended at now", "2026-09-13T01:00:00Z", "2026-09-13T02:00:00Z", "in_progress");
  const ongoing = add("ongoing without end", "2026-09-13T00:00:00Z", null, "in_progress");
  add("overlapping now", "2026-09-13T01:00:00Z", "2026-09-13T03:00:00Z");
  add("cancelled earlier", "2026-09-14T01:00:00Z", null, "cancelled");
  add("done earlier", "2026-09-15T01:00:00Z", null, "done");
  const next = add("next after fifteen days", "2026-09-28T09:00:00+08:00");
  add("next year", "2027-02-01T01:00:00Z");
  const first = store.list({ view: "upcoming", limit: 1 });
  assert.equal(first.total, 4);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].id, ongoing.id);
  assert.equal(first.ongoingEntry.id, ongoing.id);
  assert.equal(first.nextEntry.id, next.id);
  assert.equal(first.asOf, "2026-09-13T02:00:00.000Z");
  const later = store.list({ view: "upcoming", limit: 1, offset: 3 });
  assert.equal(later.items[0].title, "next year");
  assert.equal(later.hasMore, false);
  assert.equal(later.nextEntry.id, next.id);
  assert.equal(later.ongoingEntry.id, ongoing.id);
  assert.equal(store.list({ view: "upcoming", query: "missing" }).nextEntry, null);
  assert.equal(store.list({ view: "upcoming", status: "cancelled" }).total, 0);
  const boundary = add("starts exactly now", first.asOf);
  assert.equal(store.list({ view: "upcoming" }).nextEntry.id, boundary.id);
  assert.equal(store.list({ view: "upcoming", from: "2027-03-01T00:00:00Z" }).nextEntry, null);
  for (const from of [null, ""]) assert.throws(() => store.list({ view: "upcoming", from }), { code: "INVALID_CALENDAR_TIME" });
  assert.throws(() => store.list({ view: "unknown" }), { code: "INVALID_CALENDAR_VIEW" });
  const other = new CalendarStore({ ...config, spaceId: "space-b" }); others.push(other);
  assert.equal(other.list({ view: "upcoming" }).nextEntry, null);
  assert.equal(other.list({ view: "upcoming" }).ongoingEntry, null);
});

test("calendar stale writes across SQLite handles fail without adding misleading history", (t) => {
  const { store, config, others } = fixture(t);
  const entry = store.create(actor, input());
  const second = new CalendarStore(config); others.push(second);
  store.update(actor, entry.id, { expectedRevision: 1, title: "first" });
  assert.throws(() => second.update(actor, entry.id, { expectedRevision: 1, title: "stale" }), { code: "REVISION_CONFLICT" });
  assert.equal(second.history(entry.id).total, 2);
  assert.equal(second.get(entry.id).title, "first");
});

test("entry changes and their operation history commit atomically", (t) => {
  const { store } = fixture(t);
  const entry = store.create(actor, input());
  store.appendHistory = () => { throw new Error("simulated log write failure"); };
  assert.throws(() => store.update(actor, entry.id, { expectedRevision: 1, title: "should roll back" }), /simulated/);
  assert.deepEqual(store.get(entry.id), entry);
  assert.equal(store.history(entry.id).total, 1);
  assert.throws(() => store.create(actor, input()), /simulated/);
  assert.equal(store.list().total, 1);
});

test("Calendar control resolves server-owned sessions and rejects identity fields in input", (t) => {
  const { store } = fixture(t);
  const execute = (command, session = { id: "main-a", role: "main" }) => executeCalendarCommand({ calendarStore: store, session, command });
  for (const id of ["worker-a", "missing", "main-b"]) assert.throws(() => execute({ action: "create", input: input() }, { id, role: "main" }), { code: "MAIN_AGENT_REQUIRED" });
  assert.throws(() => execute({ action: "list", actor: "main-a" }), { code: "INVALID_CALENDAR_FIELD" });
  assert.throws(() => execute({ action: "create", input: { ...input(), spaceId: "space-b" } }), { code: "INVALID_CALENDAR_FIELD" });
  const created = execute({ action: "create", input: input() });
  assert.equal(created.action, "create");
  assert.equal(execute({ action: "show", entryId: created.data.id }).data.id, created.data.id);
  assert.equal(execute({ action: "list" }).data.total, 1);
  assert.equal(execute({ action: "history", entryId: created.data.id }).data.total, 1);
  assert.throws(() => execute({ action: "delete", entryId: created.data.id }), { code: "INVALID_CALENDAR_ACTION" });
});
