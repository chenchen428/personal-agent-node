import { ENTRY_FIELDS, calendarError, entryFields, integerField, isoTime, objectFields, pagination, statusField, textField } from "./validation.js";
import { isOccurrence, latestOccurrence, occurrences } from "./recurrence.js";

const active = entry => entry.enabled && ["planned", "in_progress"].includes(entry.status);
const compare = (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id);
export function page(items, input) {
  const { limit, offset } = pagination(input);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset, hasMore: offset + limit < items.length };
}
function plans(store) {
  return store.db.prepare("SELECT id FROM cove_calendar_entries WHERE space_id = ? ORDER BY start_at, id").all(store.spaceId).map(row => store.getPlan(row.id));
}
function matches(entry, input) {
  if (input.status !== undefined && entry.status !== input.status) return false;
  if (input.enabled !== undefined && entry.enabled !== input.enabled) return false;
  if (input.executionMode !== undefined && entry.executionMode !== input.executionMode) return false;
  const query = (input.query || "").toLocaleLowerCase();
  return !query || [entry.title, ...entry.participants, entry.location, entry.notes].join(" ").toLocaleLowerCase().includes(query);
}
function exceptionRows(store, plan) {
  return store.db.prepare("SELECT occurrence_at FROM cove_plan_exceptions WHERE plan_id = ? AND space_id = ?").all(plan.id, store.spaceId);
}
export function projectOccurrence(store, plan, at) {
  const patch = store.db.prepare("SELECT patch_json FROM cove_plan_exceptions WHERE plan_id = ? AND occurrence_at = ? AND space_id = ?").get(plan.id, at, store.spaceId);
  const duration = plan.endAt ? Date.parse(plan.endAt) - Date.parse(plan.startAt) : null;
  return { ...plan, startAt: at, endAt: duration === null ? null : new Date(Date.parse(at) + duration).toISOString(),
    ...(patch ? JSON.parse(patch.patch_json) : {}), id: plan.recurrence ? `${plan.id}@${Date.parse(at)}` : plan.id, planId: plan.id, occurrenceAt: at, isOccurrence: Boolean(plan.recurrence) };
}
export function requireOccurrence(store, plan, value) {
  const at = isoTime(value, "occurrenceAt");
  if ((plan.seriesEndAt && at >= plan.seriesEndAt) || !isOccurrence(plan, at)) throw calendarError(404, "CALENDAR_NOT_FOUND", "该时间不属于当前计划");
  return projectOccurrence(store, plan, at);
}
function validAt(plan, at) { return !plan.seriesEndAt || at < plan.seriesEndAt; }
export function nextForPlan(store, plan, from, filter = active) {
  let best = null;
  for (const row of exceptionRows(store, plan)) {
    if (!validAt(plan, row.occurrence_at) || !isOccurrence(plan, row.occurrence_at)) continue;
    const entry = projectOccurrence(store, plan, row.occurrence_at);
    if (entry.startAt >= from && filter(entry) && (!best || compare(entry, best) < 0)) best = entry;
  }
  if (!filter(plan)) return best;
  for (const at of occurrences(plan, { from, to: plan.seriesEndAt })) {
    const entry = projectOccurrence(store, plan, at);
    if (best && at > best.startAt) break;
    if (entry.startAt >= from && filter(entry) && (!best || compare(entry, best) < 0)) best = entry;
    // Only exceptions move times. Once a normal matching instance is found,
    // no later ordinary instance can precede it; all exceptions were considered.
    if (entry.startAt === at && filter(entry)) break;
  }
  return best;
}
export function listPlans(store, input = {}) {
  objectFields(input, ["status", "query", "enabled", "executionMode", "limit", "offset", "asOf"]);
  validateFilters(input);
  const asOf = input.asOf === undefined ? store.nowIso() : isoTime(input.asOf, "asOf");
  const items = plans(store).filter(plan => matches(plan, input)).map(plan => ({ ...plan,
    nextOccurrenceAt: active(plan) ? nextForPlan(store, plan, asOf)?.startAt || null : null,
    latestRun: store.listRuns({ planId: plan.id, limit: 1 }).items[0] || null,
  }));
  return { ...page(items, input), asOf };
}
function validateFilters(input) {
  pagination(input);
  if (input.status !== undefined) statusField(input.status);
  if (input.query !== undefined) textField(input.query, "query", 300, { optional: true });
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw calendarError(400, "INVALID_PLAN_ENABLED", "enabled必须为布尔值");
  if (input.executionMode !== undefined && !["record", "remind", "execute"].includes(input.executionMode)) throw calendarError(400, "INVALID_EXECUTION_MODE", "不支持的执行方式");
}
export function listCalendar(store, input = {}) {
  objectFields(input, ["view", "from", "to", "status", "query", "limit", "offset", "planId"]);
  validateFilters(input);
  if (input.view !== undefined && input.view !== "upcoming") throw calendarError(400, "INVALID_CALENDAR_VIEW", "不支持的日程视图");
  const upcoming = input.view === "upcoming";
  const from = input.from === undefined && upcoming ? store.nowIso() : isoTime(input.from, "from", { optional: !upcoming });
  const to = isoTime(input.to, "to", { optional: true });
  if (from && to && from >= to) throw calendarError(400, "INVALID_CALENDAR_RANGE", "筛选结束时间必须晚于开始时间");
  const selected = input.planId ? [store.requirePlan(input.planId)] : plans(store), entries = new Map();
  const add = entry => {
    const overlap = !from || entry.startAt >= from || (entry.endAt && entry.endAt > from) || (upcoming && entry.status === "in_progress" && !entry.endAt);
    if (overlap && (!to || entry.startAt < to) && matches(entry, input) && (!upcoming || active(entry))) entries.set(entry.id, entry);
  };
  for (const plan of selected) {
    if (upcoming && !active(plan)) continue;
    if (!plan.recurrence) { add(projectOccurrence(store, plan, plan.startAt)); continue; }
    if (upcoming && !to) {
      const next = nextForPlan(store, plan, from, entry => active(entry) && matches(entry, input));
      if (next) add(next);
      const duration = plan.endAt ? Date.parse(plan.endAt) - Date.parse(plan.startAt) : 0;
      if (duration > 0) {
        const lower = new Date(Math.max(Date.parse(plan.startAt), Date.parse(from) - duration)).toISOString();
        for (const at of occurrences(plan, { from: lower, to: from })) if (validAt(plan, at)) add(projectOccurrence(store, plan, at));
      } else {
        const previous = latestOccurrence(plan, new Date(Date.parse(from) - 1).toISOString());
        if (previous && validAt(plan, previous)) add(projectOccurrence(store, plan, previous));
      }
    } else if (!to) {
      // An unbounded calendar request is a one-instance-per-plan projection too.
      const next = nextForPlan(store, plan, from || plan.startAt, entry => matches(entry, input));
      if (next) add(next);
    } else {
      const duration = plan.endAt ? Date.parse(plan.endAt) - Date.parse(plan.startAt) : 0;
      const lower = from ? new Date(Math.max(Date.parse(plan.startAt), Date.parse(from) - duration)).toISOString() : plan.startAt;
      let expanded = 0;
      for (const at of occurrences(plan, { from: lower, to: plan.seriesEndAt && plan.seriesEndAt < to ? plan.seriesEndAt : to })) {
        if (++expanded > 1_000_000) throw calendarError(400, "CALENDAR_RANGE_TOO_LARGE", "时间范围包含过多发生记录，请缩小范围");
        add(projectOccurrence(store, plan, at));
      }
    }
    for (const row of exceptionRows(store, plan)) if (validAt(plan, row.occurrence_at) && isOccurrence(plan, row.occurrence_at)) {
      const entry = projectOccurrence(store, plan, row.occurrence_at);
      if (to || entry.startAt < from) add(entry);
    }
  }
  const items = [...entries.values()].sort(compare);
  const result = { ...page(items, input), projection: to ? "range" : "next_per_plan" };
  return upcoming ? { ...result, asOf: from, nextEntry: items.find(entry => entry.startAt >= from) || null,
    ongoingEntry: items.find(entry => entry.startAt < from) || null } : result;
}

export function scopedUpdate(store, actor, id, input) {
  store.requireMainAgent(actor);
  if (!["occurrence", "future"].includes(input.scope)) throw calendarError(400, "INVALID_PLAN_SCOPE", "修改范围必须为series、occurrence或future");
  return store.transaction(() => {
    const resolved = store.requireEntry(id), plan = store.requirePlan(resolved.planId || resolved.id);
    const expected = integerField(input.expectedRevision, "expectedRevision", { minimum: 1 });
    if (plan.revision !== expected) throw calendarError(409, "REVISION_CONFLICT", "计划已更新，请读取最新版本后重试");
    const at = isoTime(input.occurrenceAt || resolved.occurrenceAt, "occurrenceAt");
    const instance = requireOccurrence(store, plan, at);
    const fields = Object.fromEntries(ENTRY_FIELDS.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
    if (fields.startAt && fields.endAt === undefined && instance.endAt) fields.endAt = new Date(Date.parse(fields.startAt) + Date.parse(instance.endAt) - Date.parse(instance.startAt)).toISOString();
    if (!plan.recurrence) return store.mutate(actor, plan.id, { ...fields, expectedRevision: expected }, "update", "");
    if (input.scope === "occurrence") {
      if (Object.hasOwn(fields, "recurrence")) throw calendarError(400, "INVALID_PLAN_SCOPE", "重复规则请修改整个系列或后续系列");
      const validated = entryFields({ ...fields, recurrence: null }, instance);
      const oldPatch = store.db.prepare("SELECT patch_json FROM cove_plan_exceptions WHERE plan_id = ? AND occurrence_at = ? AND space_id = ?").get(plan.id, at, store.spaceId);
      const patch = { ...(oldPatch ? JSON.parse(oldPatch.patch_json) : {}), ...Object.fromEntries(Object.keys(fields).map(key => [key, validated[key]])) };
      store.db.prepare("INSERT INTO cove_plan_exceptions(plan_id,space_id,occurrence_at,patch_json) VALUES(?,?,?,?) ON CONFLICT(plan_id,occurrence_at) DO UPDATE SET patch_json=excluded.patch_json").run(plan.id, store.spaceId, at, JSON.stringify(patch));
      const updated = store.mutate(actor, plan.id, { expectedRevision: expected }, "update-occurrence", "");
      const changes = { scope: { before: null, after: "occurrence" }, occurrenceAt: { before: null, after: at },
        ...Object.fromEntries(Object.keys(fields).map(key => [key, { before: instance[key], after: validated[key] }])) };
      store.db.prepare("UPDATE cove_calendar_history SET changes_json=? WHERE entry_id=? AND space_id=? AND revision=?").run(JSON.stringify(changes), plan.id, store.spaceId, updated.revision);
      return projectOccurrence(store, updated, at);
    }
    if (at === plan.startAt) return store.mutate(actor, plan.id, { ...fields, expectedRevision: expected }, "update", "");
    if (store.db.prepare("SELECT id FROM cove_plan_runs WHERE plan_id=? AND space_id=? AND occurrence_at>=? AND trigger_kind='scheduled' LIMIT 1").get(plan.id, store.spaceId, at)) {
      throw calendarError(409, "PLAN_FUTURE_ALREADY_STARTED", "所选实例或其后续已有执行记录，请从尚未开始执行的下一次修改后续计划");
    }
    const recurrence = fields.recurrence !== undefined ? fields.recurrence : { ...plan.recurrence };
    if (recurrence?.count && fields.recurrence === undefined) {
      let earlier = 0;
      for (const ignored of occurrences(plan, { to: at })) earlier++;
      recurrence.count -= earlier;
    }
    const nextFields = entryFields({ ...fields, recurrence }, instance);
    const updated = store.mutate(actor, plan.id, { expectedRevision: expected }, "split-future", "");
    updated.seriesEndAt = at; store.saveMetadata(updated);
    const next = store.create(actor, nextFields);
    next.splitFrom = plan.id; store.saveMetadata(next);
    return next;
  });
}
