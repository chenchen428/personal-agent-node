import crypto from "node:crypto";
import { calendarError, isoTime, objectFields, pagination, textField } from "./validation.js";
import { latestOccurrence, occurrences } from "./recurrence.js";
import { importLegacySchedules } from "./plan-migration.js";

const RUN_STATUSES = new Set(["claimed", "dispatched", "running", "completed", "failed", "interrupted", "skipped"]);
const terminal = new Set(["completed", "failed", "interrupted", "skipped"]);
const active = plan => plan.enabled && ["planned", "in_progress"].includes(plan.status) && plan.executionMode !== "record";
function runRow(row) {
  return row ? { id: row.id, planId: row.plan_id, occurrenceAt: row.occurrence_at, triggerKind: row.trigger_kind, status: row.status,
    sessionId: row.session_id, taskSessionId: row.session_id, snapshot: JSON.parse(row.snapshot_json), error: row.error,
    result: row.result_json ? JSON.parse(row.result_json) : null, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at } : null;
}
function planRows(store) { return store.db.prepare("SELECT id FROM cove_calendar_entries WHERE space_id=?").all(store.spaceId).map(row => store.getPlan(row.id)); }
function exceptionTimes(store, plan) { return store.db.prepare("SELECT occurrence_at FROM cove_plan_exceptions WHERE space_id=? AND plan_id=?").all(store.spaceId, plan.id).map(row => row.occurrence_at); }
function resolve(store, plan, at) {
  try { return store.requireOccurrence(plan, at); } catch (error) { if (error.code === "CALENDAR_NOT_FOUND") return null; throw error; }
}

export const planRuntimeMethods = {
  listRuns(planIdOrInput = {}, options = {}) {
    const input = typeof planIdOrInput === "string" ? { ...options, planId: planIdOrInput } : planIdOrInput;
    objectFields(input, ["planId", "occurrenceAt", "status", "limit", "offset"]);
    const { limit, offset } = pagination(input), where = ["space_id=?"], params = [this.spaceId];
    if (input.planId) { const plan = this.requirePlan(input.planId); where.push("plan_id=?"); params.push(plan.id); }
    if (input.occurrenceAt) { where.push("occurrence_at=?"); params.push(isoTime(input.occurrenceAt, "occurrenceAt")); }
    if (input.status !== undefined) {
      if (!RUN_STATUSES.has(input.status)) throw calendarError(400, "INVALID_RUN_STATUS", "无效的执行状态");
      where.push("status=?"); params.push(input.status);
    }
    const filter = where.join(" AND ");
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM cove_plan_runs WHERE ${filter}`).get(...params).count);
    const items = this.db.prepare(`SELECT * FROM cove_plan_runs WHERE ${filter} ORDER BY occurrence_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset).map(runRow);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  },

  claimRun(planId, value, options = {}) {
    objectFields(options, ["status", "manual", "manualOccurrence"]);
    const at = isoTime(value, "occurrenceAt"), status = options.status || "claimed";
    if (status !== "claimed") throw calendarError(400, "INVALID_RUN_STATUS", "领取执行必须从claimed状态开始");
    return this.transaction(() => {
      const plan = this.requirePlan(planId);
      planId = plan.id;
      if (plan.executionMode === "record" || (!plan.enabled && !options.manual) || !["planned", "in_progress"].includes(plan.status)) return null;
      const snapshot = options.manualOccurrence ? { ...plan, planId, occurrenceAt: at, manual: true } : this.requireOccurrence(plan, at);
      if (snapshot.executionMode === "record" || (!snapshot.enabled && !options.manual) || !["planned", "in_progress"].includes(snapshot.status)) return null;
      const id = `run_${crypto.randomBytes(12).toString("hex")}`, now = this.nowIso();
      const changed = this.db.prepare(`INSERT INTO cove_plan_runs(id,space_id,plan_id,occurrence_at,trigger_kind,status,snapshot_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(plan_id,occurrence_at,trigger_kind) DO NOTHING`).run(id, this.spaceId, planId, at, options.manualOccurrence ? "manual" : "scheduled", status, JSON.stringify(snapshot), now, now).changes;
      return changed ? runRow(this.db.prepare("SELECT * FROM cove_plan_runs WHERE id=? AND space_id=?").get(id, this.spaceId)) : null;
    });
  },

  updateRun(id, input = {}) {
    objectFields(input, ["status", "sessionId", "taskSessionId", "error", "result", "finishedAt"]);
    return this.transaction(() => {
      const current = runRow(this.db.prepare("SELECT * FROM cove_plan_runs WHERE id=? AND space_id=?").get(textField(id, "runId", 120), this.spaceId));
      if (!current) throw calendarError(404, "RUN_NOT_FOUND", "当前空间没有该执行记录");
      const status = input.status || current.status;
      if (!RUN_STATUSES.has(status)) throw calendarError(400, "INVALID_RUN_STATUS", "无效的执行状态");
      if (terminal.has(current.status) && status !== current.status) throw calendarError(409, "RUN_ALREADY_FINISHED", "执行已结束，不能重新领取");
      const sessionId = input.taskSessionId !== undefined ? input.taskSessionId : input.sessionId !== undefined ? input.sessionId : current.sessionId;
      if (sessionId !== null && sessionId !== undefined) textField(sessionId, "taskSessionId", 200);
      if (current.sessionId && sessionId !== current.sessionId) throw calendarError(409, "RUN_SESSION_CONFLICT", "执行已关联任务，不能替换");
      const now = this.nowIso(), finishedAt = input.finishedAt !== undefined ? isoTime(input.finishedAt, "finishedAt", { optional: true }) : terminal.has(status) ? current.finishedAt || now : current.finishedAt;
      const error = input.error !== undefined ? textField(input.error, "error", 8000, { optional: true, multiline: true }) : current.error;
      const result = input.result !== undefined ? input.result : current.result;
      this.db.prepare("UPDATE cove_plan_runs SET status=?,session_id=?,error=?,result_json=?,updated_at=?,finished_at=? WHERE id=? AND space_id=?").run(status, sessionId || null, error || null, result === null ? null : JSON.stringify(result), now, finishedAt, id, this.spaceId);
      return runRow(this.db.prepare("SELECT * FROM cove_plan_runs WHERE id=? AND space_id=?").get(id, this.spaceId));
    });
  },

  schedulerDue({ asOf = this.nowIso(), startedAt = asOf } = {}) {
    const now = isoTime(asOf, "asOf"), started = isoTime(startedAt, "startedAt"), result = [];
    for (const plan of planRows(this).filter(active)) {
      const from = plan.missedRunPolicy === "latest" ? plan.startAt : started;
      const candidateTimes = new Set(exceptionTimes(this, plan));
      let bound = plan.seriesEndAt && plan.seriesEndAt <= now ? new Date(Date.parse(plan.seriesEndAt) - 1).toISOString() : now;
      // A moved/cancelled latest instance may expose the preceding valid one.
      // The number of exceptions bounds the number of additional predecessors.
      for (let index = 0; index <= candidateTimes.size + 1; index++) {
        const at = latestOccurrence(plan, bound, from);
        if (!at) break;
        const entry = resolve(this, plan, at);
        candidateTimes.add(at);
        if (entry && active(entry) && entry.startAt <= now && entry.startAt >= from) break;
        bound = new Date(Date.parse(at) - 1).toISOString();
      }
      const candidates = [...candidateTimes].map(at => resolve(this, plan, at)).filter(entry => entry && active(entry) && entry.startAt <= now && entry.startAt >= from)
        .sort((a, b) => b.startAt.localeCompare(a.startAt));
      const next = candidates[0];
      if (next && !this.db.prepare("SELECT id FROM cove_plan_runs WHERE space_id=? AND plan_id=? AND occurrence_at=? AND trigger_kind='scheduled'").get(this.spaceId, plan.id, next.occurrenceAt)) result.push(next);
    }
    return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
  },

  dueOccurrences({ from, to = this.nowIso(), limit = 1000 } = {}) {
    const lower = isoTime(from, "from"), upper = isoTime(to, "to"), result = [];
    pagination({ limit });
    for (const plan of planRows(this).filter(active)) {
      const ats = new Set(exceptionTimes(this, plan));
      for (const at of occurrences(plan, { from: lower, to: new Date(Date.parse(upper) + 1).toISOString(), limit: limit + 1 })) ats.add(at);
      for (const at of ats) {
        const entry = resolve(this, plan, at);
        if (entry && active(entry) && entry.startAt >= lower && entry.startAt <= upper) result.push(entry);
      }
    }
    return result.sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, limit);
  },

  importLegacySchedules(rows) { return importLegacySchedules(this, rows); },
  importLegacyScheduledTasks(rows) { return importLegacySchedules(this, rows); },
};
