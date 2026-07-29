import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACTIVE = "active";
const FORGOTTEN = "forgotten";
const STATUSES = new Set([ACTIVE, FORGOTTEN]);
const MAX_CONTENT_CHARACTERS = 8_000;
const MAX_RECALL = 12;
const FORGET_AFTER_MS = 365 * 24 * 60 * 60 * 1_000;
const DEFAULT_SPACE_ID = "personal";

export class MemoryStore {
  constructor({ dataDir, databasePath, spaceId, sessionResolver, now = Date.now } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.databasePath = path.resolve(databasePath || path.join(this.dataDir, "state.sqlite"));
    this.spaceId = cleanInline(spaceId || DEFAULT_SPACE_ID, 120) || DEFAULT_SPACE_ID;
    this.sessionResolver = typeof sessionResolver === "function" ? sessionResolver : () => null;
    this.now = typeof now === "function" ? now : Date.now;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.init();
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_memories (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        main_session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        hit_count INTEGER NOT NULL,
        heat INTEGER NOT NULL,
        last_hit_at TEXT NOT NULL,
        forget_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_memories_space_active
        ON personal_memories(space_id, status, heat DESC, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_personal_memories_space_forgotten
        ON personal_memories(space_id, status, forget_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS personal_memory_hits (
        space_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        hit_at TEXT NOT NULL,
        PRIMARY KEY(space_id, session_id, turn_id, memory_id),
        FOREIGN KEY(memory_id) REFERENCES personal_memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS personal_memory_audit (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        main_session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_memory_audit_space_time
        ON personal_memory_audit(space_id, created_at DESC, id DESC);
    `);
  }

  close() {
    this.db.close();
  }

  create(actor, input = {}) {
    const principal = this.requireMainAgent(actor);
    const content = normalizeContent(input.content);
    const now = this.nowIso();
    const record = {
      id: `mem_${crypto.randomBytes(12).toString("hex")}`,
      spaceId: principal.spaceId,
      mainSessionId: principal.sessionId,
      content,
      status: ACTIVE,
      hitCount: 0,
      heat: calculateMemoryHeat({ createdAt: now, hitCount: 0 }, Date.parse(now)),
      lastHitAt: "",
      forgetAt: new Date(Date.parse(now) + FORGET_AFTER_MS).toISOString(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO personal_memories (
        id, space_id, main_session_id, content, status, hit_count, heat,
        last_hit_at, forget_at, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.spaceId, record.mainSessionId, record.content, record.status,
      record.hitCount, record.heat, record.lastHitAt, record.forgetAt, record.revision,
      record.createdAt, record.updatedAt,
    );
    const result = this.getForSpace(record.id);
    this.audit(principal, "create", result);
    return result;
  }

  update(actor, memoryId, input = {}) {
    const principal = this.requireMainAgent(actor);
    this.forgetDue();
    const current = this.getForSpace(memoryId, { includeForgotten: true });
    if (!current) throw memoryError(404, "MEMORY_NOT_FOUND", "Memory was not found in the current Space");
    const expectedRevision = requiredRevision(input.expectedRevision);
    if (current.revision !== expectedRevision) throw memoryError(409, "REVISION_CONFLICT", "Memory revision has changed");
    const now = this.nowIso();
    const content = input.content === undefined ? current.content : normalizeContent(input.content);
    const nextRevision = current.revision + 1;
    const forgetBase = Math.max(Date.parse(current.createdAt), Date.parse(now), parseTime(current.lastHitAt));
    const heat = calculateMemoryHeat({ createdAt: current.createdAt, lastHitAt: current.lastHitAt, hitCount: current.hitCount }, Date.parse(now));
    const changes = this.db.prepare(`
      UPDATE personal_memories SET
        main_session_id = ?, content = ?, status = 'active', heat = ?,
        forget_at = ?, revision = ?, updated_at = ?
      WHERE id = ? AND space_id = ? AND revision = ?
    `).run(
      principal.sessionId, content, heat, new Date(forgetBase + FORGET_AFTER_MS).toISOString(),
      nextRevision, now, current.id, principal.spaceId, current.revision,
    ).changes;
    if (changes !== 1) throw memoryError(409, "REVISION_CONFLICT", "Memory revision has changed");
    const result = this.getForSpace(current.id, { includeForgotten: true });
    this.audit(principal, "update", result);
    return result;
  }

  delete(actor, memoryId, input = {}) {
    const principal = this.requireMainAgent(actor);
    const current = this.getForSpace(memoryId, { includeForgotten: true });
    if (!current) throw memoryError(404, "MEMORY_NOT_FOUND", "Memory was not found in the current Space");
    const expectedRevision = requiredRevision(input.expectedRevision);
    if (current.revision !== expectedRevision) throw memoryError(409, "REVISION_CONFLICT", "Memory revision has changed");
    const changes = this.db.prepare(`
      DELETE FROM personal_memories WHERE id = ? AND space_id = ? AND revision = ?
    `).run(current.id, principal.spaceId, current.revision).changes;
    if (changes !== 1) throw memoryError(409, "REVISION_CONFLICT", "Memory revision has changed");
    this.audit(principal, "delete", current);
    return { id: current.id, deleted: true };
  }

  listForMainAgent(actor, options = {}) {
    const principal = this.requireMainAgent(actor);
    const result = this.listForReader(options);
    this.audit(principal, "search", null, `returned:${result.items.length}`);
    return result;
  }

  getForMainAgent(actor, memoryId) {
    const principal = this.requireMainAgent(actor);
    this.forgetDue();
    this.refreshActiveHeat();
    const result = this.getForSpace(memoryId, { includeForgotten: true });
    this.audit(principal, "get", result, result ? "succeeded" : "not-found");
    return result;
  }

  listForReader({ query = "", status = ACTIVE, limit = 100 } = {}) {
    this.forgetDue();
    this.refreshActiveHeat();
    const normalizedStatus = String(status || ACTIVE).trim().toLowerCase();
    if (!STATUSES.has(normalizedStatus)) throw memoryError(400, "INVALID_MEMORY_STATUS", "Memory status must be active or forgotten");
    const normalizedQuery = normalizeSearch(query, 300);
    const pageSize = boundedInteger(limit, 1, 500, 100);
    const where = ["space_id = ?", "status = ?"];
    const params = [this.spaceId, normalizedStatus];
    if (normalizedQuery) {
      where.push("LOWER(content) LIKE ? ESCAPE '\\'");
      params.push(`%${escapeSqlLike(normalizedQuery)}%`);
    }
    const rows = this.db.prepare(`
      SELECT * FROM personal_memories
      WHERE ${where.join(" AND ")}
      ORDER BY ${normalizedStatus === ACTIVE ? "heat DESC, updated_at DESC" : "forget_at DESC"}, id DESC
      LIMIT ?
    `).all(...params, pageSize);
    const counts = this.counts();
    return {
      items: rows.map(hydrateMemory),
      total: normalizedStatus === ACTIVE ? counts.active : counts.forgotten,
      counts,
      query: String(query || "").trim().slice(0, 300),
      status: normalizedStatus,
    };
  }

  getForReader(memoryId) {
    this.forgetDue();
    this.refreshActiveHeat();
    return this.getForSpace(memoryId, { includeForgotten: true });
  }

  statsForMainAgent(actor) {
    const principal = this.requireMainAgent(actor);
    this.forgetDue();
    this.refreshActiveHeat();
    const counts = this.counts();
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(hit_count), 0) AS hits, COALESCE(MAX(heat), 0) AS hottest
      FROM personal_memories WHERE space_id = ?
    `).get(this.spaceId);
    const result = { ...counts, hits: Number(row?.hits || 0), hottest: Number(row?.hottest || 0) };
    this.audit(principal, "stats", null);
    return result;
  }

  recall(actor, { query = "", sessionId, turnId, limit = MAX_RECALL } = {}) {
    const principal = this.requireMainAgent(actor);
    if (sessionId && String(sessionId) !== principal.sessionId) {
      throw memoryError(403, "MAIN_AGENT_REQUIRED", "Memory recall must use the current main session");
    }
    const normalizedTurnId = cleanInline(turnId, 160);
    if (!normalizedTurnId) throw memoryError(400, "TURN_ID_REQUIRED", "Memory recall requires a turn id");
    this.forgetDue();
    this.refreshActiveHeat();
    const nowMs = this.nowMs();
    const pageSize = boundedInteger(limit, 1, MAX_RECALL, MAX_RECALL);
    const rows = this.db.prepare(`
      SELECT * FROM personal_memories
      WHERE space_id = ? AND status = 'active'
      ORDER BY heat DESC, updated_at DESC, id DESC
      LIMIT 500
    `).all(this.spaceId);
    const terms = searchTerms(query);
    const selected = rows
      .map((row) => ({ memory: hydrateMemory(row), relevance: memoryRelevance(row.content, terms) }))
      .sort((left, right) => right.relevance - left.relevance || right.memory.heat - left.memory.heat || right.memory.updatedAt.localeCompare(left.memory.updatedAt))
      .slice(0, pageSize);

    const touched = [];
    this.transaction(() => {
      const insertHit = this.db.prepare(`
        INSERT OR IGNORE INTO personal_memory_hits (space_id, session_id, turn_id, memory_id, hit_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const updateMemory = this.db.prepare(`
        UPDATE personal_memories SET hit_count = ?, heat = ?, last_hit_at = ?, forget_at = ?
        WHERE id = ? AND space_id = ? AND status = 'active'
      `);
      const now = new Date(nowMs).toISOString();
      const forgetAt = new Date(nowMs + FORGET_AFTER_MS).toISOString();
      for (const entry of selected) {
        const inserted = insertHit.run(this.spaceId, principal.sessionId, normalizedTurnId, entry.memory.id, now).changes;
        if (inserted !== 1) continue;
        const hitCount = entry.memory.hitCount + 1;
        const heat = calculateMemoryHeat({ ...entry.memory, hitCount, lastHitAt: now }, nowMs);
        updateMemory.run(hitCount, heat, now, forgetAt, entry.memory.id, this.spaceId);
        touched.push(entry.memory.id);
      }
    });
    const items = selected.map((entry) => this.getForSpace(entry.memory.id)).filter(Boolean);
    this.audit(principal, "recall", null, `returned:${items.length};new-hits:${touched.length}`);
    return { items, hitCount: touched.length, turnId: normalizedTurnId };
  }

  forgetDue() {
    const now = this.nowIso();
    return this.db.prepare(`
      UPDATE personal_memories
      SET status = 'forgotten', heat = 0, revision = revision + 1
      WHERE space_id = ? AND status = 'active' AND forget_at <= ?
    `).run(this.spaceId, now).changes;
  }

  refreshActiveHeat() {
    const now = this.nowMs();
    const rows = this.db.prepare(`
      SELECT id, created_at, last_hit_at, hit_count, heat
      FROM personal_memories WHERE space_id = ? AND status = 'active'
    `).all(this.spaceId);
    const update = this.db.prepare("UPDATE personal_memories SET heat = ? WHERE id = ? AND space_id = ? AND heat <> ?");
    let changed = 0;
    for (const row of rows) {
      const heat = calculateMemoryHeat({ createdAt: row.created_at, lastHitAt: row.last_hit_at, hitCount: row.hit_count }, now);
      changed += update.run(heat, row.id, this.spaceId, heat).changes;
    }
    return changed;
  }

  requireMainAgent(actor = {}) {
    const sessionId = String(actor.sessionId || "").trim();
    if (!sessionId) throw memoryError(403, "MAIN_AGENT_REQUIRED", "A verified main Agent session is required");
    const session = this.sessionResolver(sessionId);
    if (!session || session.id !== sessionId || session.role !== "main") {
      throw memoryError(403, "MAIN_AGENT_REQUIRED", "Only the verified main Agent may operate Memory");
    }
    return { sessionId, spaceId: this.spaceId };
  }

  getForSpace(memoryId, { includeForgotten = false } = {}) {
    const row = this.db.prepare(`
      SELECT * FROM personal_memories
      WHERE id = ? AND space_id = ? ${includeForgotten ? "" : "AND status = 'active'"}
    `).get(String(memoryId || ""), this.spaceId);
    return row ? hydrateMemory(row) : null;
  }

  counts() {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM personal_memories
      WHERE space_id = ? GROUP BY status
    `).all(this.spaceId);
    const result = { active: 0, forgotten: 0 };
    for (const row of rows) if (STATUSES.has(row.status)) result[row.status] = Number(row.count || 0);
    return result;
  }

  audit(principal, action, memory = null, outcome = "succeeded") {
    this.db.prepare(`
      INSERT INTO personal_memory_audit (
        id, space_id, main_session_id, action, memory_id, revision, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `memaud_${crypto.randomBytes(12).toString("hex")}`,
      principal.spaceId,
      principal.sessionId,
      cleanInline(action, 40),
      cleanInline(memory?.id, 120),
      boundedInteger(memory?.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      cleanInline(outcome, 160),
      this.nowIso(),
    );
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  nowMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value);
  }

  nowIso() {
    return new Date(this.nowMs()).toISOString();
  }
}

export function calculateMemoryHeat(memory, now = Date.now()) {
  const basis = parseTime(memory.lastHitAt) || parseTime(memory.createdAt) || Number(now);
  const ageDays = Math.max(0, (Number(now) - basis) / 86_400_000);
  const recency = 2 ** (-ageDays / 90);
  const frequency = Math.min(1, Math.log2(Math.max(0, Number(memory.hitCount || 0)) + 1) / 8);
  return Math.round(100 * (0.55 * recency + 0.45 * frequency));
}

function hydrateMemory(row) {
  return {
    id: row.id,
    content: row.content,
    status: row.status,
    hitCount: Number(row.hit_count || 0),
    heat: Number(row.heat || 0),
    lastHitAt: row.last_hit_at,
    forgetAt: row.forget_at,
    revision: Number(row.revision || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeContent(value) {
  const content = String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!content) throw memoryError(400, "MEMORY_CONTENT_REQUIRED", "Memory content is required");
  if ([...content].length > MAX_CONTENT_CHARACTERS) {
    throw memoryError(400, "MEMORY_CONTENT_TOO_LONG", `Memory content exceeds ${MAX_CONTENT_CHARACTERS} characters`);
  }
  return content;
}

function requiredRevision(value) {
  const revision = boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!revision) throw memoryError(400, "REVISION_REQUIRED", "expectedRevision is required");
  return revision;
}

function searchTerms(query) {
  const normalized = normalizeSearch(query, 2_000);
  if (!normalized) return [];
  const chunks = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = new Set(chunks);
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk) && chunk.length > 1) {
      for (let index = 0; index < chunk.length - 1; index += 1) terms.add(chunk.slice(index, index + 2));
    }
  }
  return [...terms].slice(0, 80);
}

function memoryRelevance(content, terms) {
  if (!terms.length) return 0;
  const normalized = normalizeSearch(content, MAX_CONTENT_CHARACTERS * 2);
  let score = 0;
  for (const term of terms) if (normalized.includes(term)) score += term.length > 1 ? 2 : 1;
  return score;
}

function normalizeSearch(value, maximum) {
  return cleanInline(value, maximum).toLocaleLowerCase("zh-CN");
}

function cleanInline(value, maximum) {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function parseTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function escapeSqlLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), minimum), maximum);
}

function memoryError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export const memoryPolicy = Object.freeze({
  statuses: [ACTIVE, FORGOTTEN],
  maxContentCharacters: MAX_CONTENT_CHARACTERS,
  maxRecall: MAX_RECALL,
  forgetAfterDays: 365,
});
