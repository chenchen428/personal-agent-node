export function initializePlans(db) {
  if (!db.prepare("PRAGMA table_info(cove_calendar_entries)").all().some(row => row.name === "plan_json")) {
    db.exec("ALTER TABLE cove_calendar_entries ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cove_plan_exceptions (
      plan_id TEXT NOT NULL REFERENCES cove_calendar_entries(id), space_id TEXT NOT NULL,
      occurrence_at TEXT NOT NULL, patch_json TEXT NOT NULL,
      PRIMARY KEY(plan_id, occurrence_at)
    );
    CREATE TABLE IF NOT EXISTS cove_plan_runs (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES cove_calendar_entries(id),
      occurrence_at TEXT NOT NULL, trigger_kind TEXT NOT NULL DEFAULT 'scheduled', status TEXT NOT NULL, session_id TEXT, snapshot_json TEXT NOT NULL,
      error TEXT, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
      UNIQUE(plan_id, occurrence_at, trigger_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_runs_space_time ON cove_plan_runs(space_id, occurrence_at DESC);
    CREATE TABLE IF NOT EXISTS cove_plan_imports (
      space_id TEXT NOT NULL, source_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES cove_calendar_entries(id),
      PRIMARY KEY(space_id, source_id)
    );
  `);
}

const FIELDS = ["recurrence", "executionMode", "executionPrompt", "missedRunPolicy", "enabled", "executionContext", "mainSessionId", "legacy", "splitFrom", "seriesEndAt"];
export function planMetadata(entry) { return Object.fromEntries(FIELDS.filter(key => entry[key] !== undefined).map(key => [key, entry[key]])); }
export function hydratePlan(row) {
  return { recurrence: null, executionMode: "record", executionPrompt: "", missedRunPolicy: "skip", enabled: true, executionContext: {}, ...JSON.parse(row.plan_json || "{}") };
}
