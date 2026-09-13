import crypto from "node:crypto";
import { entryFields, isoTime, recurrenceField, textField } from "./validation.js";
import { latestOccurrence } from "./recurrence.js";

// This internal data migration does not manufacture a main-Agent principal.
// The HTTP/Agent command whitelists never expose it as a callable mutation.
export function importLegacySchedules(store, rows) {
  if (!Array.isArray(rows)) throw new TypeError("Legacy schedules must be an array");
  return store.transaction(() => rows.map(row => {
    const sourceId = textField(row.id, "legacy schedule id", 120);
    const imported = store.db.prepare("SELECT plan_id FROM cove_plan_imports WHERE space_id=? AND source_id=?").get(store.spaceId, sourceId);
    if (imported) return store.requirePlan(imported.plan_id);
    const collision = store.db.prepare("SELECT id FROM cove_calendar_entries WHERE id=?").get(sourceId);
    const id = collision ? `cal_${crypto.createHash("sha256").update(`${store.spaceId}:${sourceId}`).digest("hex").slice(0, 24)}` : sourceId;
    const now = store.nowIso();
    let recurrence, migrationWarning;
    try { recurrence = recurrenceField({ frequency: "cron", expression: row.cron }); }
    catch (error) {
      if (!["INVALID_RECURRENCE", "INVALID_CALENDAR_TEXT"].includes(error.code)) throw error;
      recurrence = null;
      migrationWarning = "旧重复规则无效或间隔小于15分钟，已保留原始记录并停用，修改时间计划后可重新启用。";
    }
    let fields, createdAt, updatedAt, actualRunAt;
    try {
      fields = entryFields({ title: row.name || "定期任务", startAt: row.createdAt || now,
        timeZone: !row.timezone || row.timezone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : row.timezone,
        recurrence, executionMode: "execute", executionPrompt: row.prompt,
        enabled: !migrationWarning && row.enabled !== false, executionContext: { workspaceName: row.workspaceName || "", workspaceRoot: row.workspaceRoot || "", recipientId: row.recipientId || "" } });
      createdAt = fields.startAt;
      updatedAt = isoTime(row.updatedAt || now, "legacy updatedAt");
      actualRunAt = isoTime(row.lastRunAt, "legacy lastRunAt", { optional: true });
    } catch (error) {
      if (error.statusCode !== 400) throw error;
      // Retired records were less constrained. Preserve their complete original
      // requirements, but never truncate them and then automatically execute.
      recurrence = null;
      migrationWarning = "旧计划字段不符合当前格式，完整原始记录已保留。此计划已停用并设为仅记录，请修正要求和时间后再启用。";
      fields = entryFields({ title: "旧计划（需要修正）", startAt: now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        executionMode: "record", enabled: false, notes: migrationWarning });
      createdAt = now; updatedAt = now; actualRunAt = null;
    }
    const entry = { ...fields, id, revision: 1, createdAt, updatedAt, legacy: { ...row, ...(migrationWarning ? { migrationWarning } : {}) }, mainSessionId: "" };
    // The retired runner persisted its actual wake time, often seconds after
    // the cron boundary. Use the nominal boundary for scheduled deduplication,
    // while keeping the actual timestamp and historical aggregate untouched.
    const nominalRunAt = recurrence && actualRunAt && row.lastSessionId ? latestOccurrence(entry, actualRunAt) : null;
    entry.legacy.importedRunCount = nominalRunAt ? 1 : 0;
    store.db.prepare(`INSERT INTO cove_calendar_entries(id,space_id,title,participants_json,start_at,end_at,time_zone,location,notes,next_follow_up_at,status,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, store.spaceId, entry.title, "[]", entry.startAt, null, entry.timeZone, "", "", null, "planned", 1, entry.createdAt, entry.updatedAt);
    store.saveMetadata(entry);
    store.db.prepare("INSERT INTO cove_plan_imports(space_id,source_id,plan_id) VALUES(?,?,?)").run(store.spaceId, sourceId, id);
    if (nominalRunAt) {
      store.db.prepare(`INSERT INTO cove_plan_runs(id,space_id,plan_id,occurrence_at,status,session_id,snapshot_json,created_at,updated_at,finished_at,error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(plan_id,occurrence_at,trigger_kind) DO NOTHING`).run(`run_${crypto.randomBytes(12).toString("hex")}`, store.spaceId, id,
        nominalRunAt, "dispatched", row.lastSessionId, JSON.stringify(store.projectOccurrence(entry, nominalRunAt)), actualRunAt,
        updatedAt, null, row.lastError || null);
    }
    return store.requirePlan(id);
  }));
}
