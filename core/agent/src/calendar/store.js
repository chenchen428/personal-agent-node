import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { calendarError, ENTRY_FIELDS, entryFields, integerField, isoTime, objectFields, pagination, statusField, textField } from "./validation.js";

export class CalendarStore {
  constructor({ dataDir, databasePath, spaceId, sessionResolver, now = Date.now } = {}) {
    this.spaceId = textField(spaceId, "spaceId", 120);
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.databasePath = path.resolve(databasePath || path.join(this.dataDir, "calendar.sqlite"));
    this.sessionResolver = typeof sessionResolver === "function" ? sessionResolver : () => null;
    this.now = now;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS cove_calendar_entries (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL,
        participants_json TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT,
        time_zone TEXT NOT NULL, location TEXT NOT NULL, notes TEXT NOT NULL,
        next_follow_up_at TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cove_calendar_space_start ON cove_calendar_entries(space_id, start_at, id);
      CREATE INDEX IF NOT EXISTS idx_cove_calendar_space_due ON cove_calendar_entries(space_id, status, next_follow_up_at);
      CREATE TABLE IF NOT EXISTS cove_calendar_history (
        id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES cove_calendar_entries(id),
        space_id TEXT NOT NULL, main_session_id TEXT NOT NULL, action TEXT NOT NULL,
        content TEXT NOT NULL, changes_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(entry_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_cove_calendar_history ON cove_calendar_history(space_id, entry_id, revision DESC);
    `);
  }

  close() { this.db.close(); }

  requireMainAgent(actor = {}) {
    objectFields(actor, ["sessionId"]);
    const sessionId = typeof actor.sessionId === "string" ? actor.sessionId : "";
    const session = sessionId ? this.sessionResolver(sessionId) : null;
    if (!session || session.id !== sessionId || session.role !== "main" || session.parentSessionId
      || (session.spaceId !== undefined && session.spaceId !== this.spaceId)) {
      throw calendarError(403, "MAIN_AGENT_REQUIRED", "只有当前空间已验证的主 Agent 可以操作日程");
    }
    return { sessionId, spaceId: this.spaceId };
  }

  list(input = {}) {
    objectFields(input, ["from", "to", "status", "query", "limit", "offset"]);
    const from = isoTime(input.from, "from", { optional: true });
    const to = isoTime(input.to, "to", { optional: true });
    if (from && to && from >= to) throw calendarError(400, "INVALID_CALENDAR_RANGE", "筛选结束时间必须晚于开始时间");
    const where = ["space_id = ?"], params = [this.spaceId];
    // A zero-duration event is included at its start; other intervals overlap [from, to).
    if (from) { where.push("(end_at > ? OR ((end_at IS NULL OR end_at = start_at) AND start_at >= ?))"); params.push(from, from); }
    if (to) { where.push("start_at < ?"); params.push(to); }
    if (input.status !== undefined) { where.push("status = ?"); params.push(statusField(input.status)); }
    if (input.query !== undefined) {
      const query = textField(input.query, "query", 300, { optional: true });
      if (query) {
        where.push("(title LIKE ? ESCAPE '\\' OR participants_json LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
        params.push(...Array(4).fill(`%${query.replace(/[\\%_]/g, "\\$&")}%`));
      }
    }
    return this.queryEntries(where, params, input, "start_at ASC, id ASC");
  }

  due(input = {}) {
    objectFields(input, ["before", "limit", "offset"]);
    const before = input.before === undefined ? this.nowIso() : isoTime(input.before, "before");
    return this.queryEntries(["space_id = ?", "status IN ('planned', 'in_progress')", "next_follow_up_at IS NOT NULL", "next_follow_up_at <= ?"],
      [this.spaceId, before], input, "next_follow_up_at ASC, id ASC");
  }

  queryEntries(where, params, input, order) {
    const { limit, offset } = pagination(input);
    const filter = where.join(" AND ");
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM cove_calendar_entries WHERE ${filter}`).get(...params).count);
    const items = this.db.prepare(`SELECT * FROM cove_calendar_entries WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(hydrateEntry);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM cove_calendar_entries WHERE id = ? AND space_id = ?").get(entryId(id), this.spaceId);
    return row ? hydrateEntry(row) : null;
  }

  requireEntry(id) {
    const entry = this.get(id);
    if (!entry) throw calendarError(404, "CALENDAR_NOT_FOUND", "当前空间没有该日程");
    return entry;
  }

  history(id, input = {}) {
    this.requireEntry(id);
    objectFields(input, ["limit", "offset"]);
    const { limit, offset } = pagination(input);
    const total = Number(this.db.prepare("SELECT COUNT(*) AS count FROM cove_calendar_history WHERE entry_id = ? AND space_id = ?").get(id, this.spaceId).count);
    const items = this.db.prepare("SELECT * FROM cove_calendar_history WHERE entry_id = ? AND space_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?")
      .all(id, this.spaceId, limit, offset).map((row) => ({
        id: row.id, entryId: row.entry_id, action: row.action, actor: "Cove", content: row.content,
        changes: JSON.parse(row.changes_json), revision: row.revision, createdAt: row.created_at,
      }));
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

  create(actor, input = {}) {
    const principal = this.requireMainAgent(actor);
    objectFields(input, ENTRY_FIELDS);
    const fields = entryFields(input);
    const now = this.nowIso();
    const entry = { id: `cal_${crypto.randomBytes(12).toString("hex")}`, ...fields, revision: 1, createdAt: now, updatedAt: now };
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO cove_calendar_entries (id, space_id, title, participants_json, start_at, end_at,
        time_zone, location, notes, next_follow_up_at, status, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.id, this.spaceId, entry.title,
        JSON.stringify(entry.participants), entry.startAt, entry.endAt, entry.timeZone, entry.location, entry.notes,
        entry.nextFollowUpAt, entry.status, 1, now, now);
      this.appendHistory(principal, "create", entry, "", changedFields(null, entry));
      return entry;
    });
  }

  update(actor, id, input = {}) {
    objectFields(input, [...ENTRY_FIELDS, "expectedRevision"]);
    if (!ENTRY_FIELDS.some((field) => Object.hasOwn(input, field))) throw calendarError(400, "CALENDAR_UPDATE_EMPTY", "至少提供一个要更新的日程字段");
    return this.mutate(actor, id, input, "update", "");
  }

  followUp(actor, id, input = {}) {
    objectFields(input, ["expectedRevision", "content", "status", "nextFollowUpAt"]);
    const content = textField(input.content, "跟进记录", 8_000, { multiline: true });
    return this.mutate(actor, id, input, "follow-up", content);
  }

  mutate(actor, id, input, action, content) {
    const principal = this.requireMainAgent(actor);
    const expected = integerField(input.expectedRevision, "expectedRevision", { minimum: 1 });
    return this.transaction(() => {
      const current = this.requireEntry(id);
      if (current.revision !== expected) throw calendarError(409, "REVISION_CONFLICT", "日程已更新，请读取最新版本后重试");
      const fields = entryFields(input, current);
      const entry = { ...current, ...fields, revision: current.revision + 1, updatedAt: this.nowIso() };
      const changed = this.db.prepare(`UPDATE cove_calendar_entries SET title = ?, participants_json = ?, start_at = ?, end_at = ?,
        time_zone = ?, location = ?, notes = ?, next_follow_up_at = ?, status = ?, revision = ?, updated_at = ?
        WHERE id = ? AND space_id = ? AND revision = ?`).run(entry.title, JSON.stringify(entry.participants), entry.startAt,
        entry.endAt, entry.timeZone, entry.location, entry.notes, entry.nextFollowUpAt, entry.status, entry.revision,
        entry.updatedAt, entry.id, this.spaceId, expected).changes;
      if (changed !== 1) throw calendarError(409, "REVISION_CONFLICT", "日程已更新，请读取最新版本后重试");
      this.appendHistory(principal, action, entry, content, changedFields(current, entry));
      return entry;
    });
  }

  appendHistory(principal, action, entry, content, changes) {
    this.db.prepare(`INSERT INTO cove_calendar_history (id, entry_id, space_id, main_session_id, action, content, changes_json, revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`calhist_${crypto.randomBytes(12).toString("hex")}`, entry.id, this.spaceId,
      principal.sessionId, action, content, JSON.stringify(changes), entry.revision, entry.updatedAt);
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = callback(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  nowIso() { return new Date(this.now()).toISOString(); }
}

function entryId(value) { return textField(value, "日程ID", 120); }

function hydrateEntry(row) {
  return { id: row.id, title: row.title, participants: JSON.parse(row.participants_json), startAt: row.start_at, endAt: row.end_at,
    timeZone: row.time_zone, location: row.location, notes: row.notes, nextFollowUpAt: row.next_follow_up_at,
    status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function changedFields(current, next) {
  return Object.fromEntries(ENTRY_FIELDS.filter((field) => !current || JSON.stringify(current[field]) !== JSON.stringify(next[field]))
    .map((field) => [field, { before: current ? current[field] : null, after: next[field] }]));
}
