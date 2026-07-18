import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACTIVITY_TYPES = new Set(["work", "page", "mail", "data", "automation", "note"]);
const ACTIVITY_STATES = new Set(["visible", "hidden"]);
const TARGET_TYPES = new Set(["work", "page", "mail", "data", "automation", "app"]);
const OBJECT_ID = /^obj_[a-f0-9]{24}$/;
const MAX_TITLE_CHARACTERS = 30;
const MAX_DETAIL_CHARACTERS = 2000;
const MAX_ATTACHMENTS = 10;
const DEFAULT_OWNER_ID = "local-owner";
const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

export class ActivityStore {
  constructor({
    dataDir,
    databasePath,
    sessionResolver,
    attachmentResolver,
    ownerResolver,
  } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.databasePath = path.resolve(databasePath || path.join(this.dataDir, "state.sqlite"));
    this.sessionResolver = typeof sessionResolver === "function" ? sessionResolver : () => null;
    this.attachmentResolver = typeof attachmentResolver === "function" ? attachmentResolver : () => null;
    this.ownerResolver = typeof ownerResolver === "function" ? ownerResolver : () => DEFAULT_OWNER_ID;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.init();
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        main_session_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        correlation_key TEXT NOT NULL,
        state TEXT NOT NULL,
        hidden_reason TEXT NOT NULL,
        revision INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        search_text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_activities_owner_time
        ON activities(owner_id, state, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_activities_owner_correlation
        ON activities(owner_id, correlation_key, updated_at DESC);

      CREATE TABLE IF NOT EXISTS activity_attachments (
        activity_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        object_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        visibility TEXT NOT NULL,
        PRIMARY KEY(activity_id, position),
        FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_activity_attachments_object
        ON activity_attachments(object_id, activity_id);

      CREATE TABLE IF NOT EXISTS activity_audit (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        main_session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_audit_owner_time
        ON activity_audit(owner_id, created_at DESC, id DESC);
    `);
  }

  close() {
    this.db.close();
  }

  create(actor, input = {}) {
    const principal = this.requireMainAgent(actor);
    const normalized = this.normalizeInput(input);
    const requestHash = activityRequestHash(normalized);
    const replay = this.findByIdempotencyKey(principal.ownerId, normalized.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw activityError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with different activity content");
      }
      const result = { ...this.getForOwner(principal.ownerId, replay.id), idempotentReplay: true };
      this.audit(principal, "create", result, normalized.idempotencyKey, "replayed");
      return result;
    }

    const now = new Date().toISOString();
    const id = `act_${crypto.randomBytes(12).toString("hex")}`;
    const record = {
      id,
      ownerId: principal.ownerId,
      mainSessionId: principal.sessionId,
      ...normalized,
      state: "visible",
      hiddenReason: "",
      revision: 1,
      requestHash,
      createdAt: now,
      updatedAt: now,
    };
    this.transaction(() => {
      this.insertRecord(record);
      this.replaceAttachments(id, normalized.attachments);
    });
    const result = this.getForOwner(principal.ownerId, id);
    this.audit(principal, "create", result, normalized.idempotencyKey);
    return result;
  }

  upsert(actor, input = {}) {
    const principal = this.requireMainAgent(actor);
    const correlationKey = cleanInlineText(input.correlationKey, 160);
    if (correlationKey) {
      const current = this.db.prepare(`
        SELECT id, revision FROM activities
        WHERE owner_id = ? AND correlation_key = ? AND state = 'visible'
        ORDER BY updated_at DESC, id DESC LIMIT 1
      `).get(principal.ownerId, correlationKey);
      if (current) {
        const result = this.update(actor, current.id, { ...input, expectedRevision: current.revision });
        this.audit(principal, "upsert", result, result ? `correlation:${correlationKey}` : "");
        return result;
      }
    }
    const result = this.create(actor, input);
    this.audit(principal, "upsert", result, input.idempotencyKey);
    return result;
  }

  update(actor, activityId, input = {}) {
    const principal = this.requireMainAgent(actor);
    const current = this.getForOwner(principal.ownerId, activityId, { includeHidden: true });
    if (!current) throw activityError(404, "ACTIVITY_NOT_FOUND", "Activity was not found");
    if (current.state !== "visible") throw activityError(409, "ACTIVITY_HIDDEN", "Restore the activity before updating it");
    const expectedRevision = boundedInteger(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER, 0);
    if (!expectedRevision) throw activityError(400, "REVISION_REQUIRED", "expectedRevision is required");
    if (expectedRevision !== current.revision) throw activityError(409, "REVISION_CONFLICT", "Activity revision has changed");

    const normalized = this.normalizeInput({
      type: input.type ?? current.type,
      title: input.title ?? current.title,
      detail: input.detail ?? current.detail,
      attachments: input.attachments ?? current.attachments.map((item) => item.objectId),
      target: input.target ?? current.target,
      correlationKey: input.correlationKey ?? current.correlationKey,
      idempotencyKey: input.idempotencyKey || `update:${current.id}:${current.revision + 1}`,
      occurredAt: input.occurredAt ?? current.occurredAt,
    });
    const now = new Date().toISOString();
    const nextRevision = current.revision + 1;
    const requestHash = activityRequestHash(normalized);
    this.transaction(() => {
      const changes = this.db.prepare(`
        UPDATE activities SET
          main_session_id = ?, activity_type = ?, title = ?, detail = ?,
          target_type = ?, target_id = ?, correlation_key = ?,
          revision = ?, idempotency_key = ?, request_hash = ?, search_text = ?,
          occurred_at = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND revision = ? AND state = 'visible'
      `).run(
        principal.sessionId,
        normalized.type,
        normalized.title,
        normalized.detail,
        normalized.target?.type || "",
        normalized.target?.id || "",
        normalized.correlationKey,
        nextRevision,
        normalized.idempotencyKey,
        requestHash,
        buildSearchText(normalized),
        normalized.occurredAt,
        now,
        current.id,
        principal.ownerId,
        current.revision,
      ).changes;
      if (changes !== 1) throw activityError(409, "REVISION_CONFLICT", "Activity revision has changed");
      this.replaceAttachments(current.id, normalized.attachments);
    });
    const result = this.getForOwner(principal.ownerId, current.id);
    this.audit(principal, "update", result, normalized.idempotencyKey);
    return result;
  }

  hide(actor, activityId, { reason = "", expectedRevision } = {}) {
    return this.changeVisibility(actor, activityId, {
      from: "visible",
      to: "hidden",
      reason: requiredInlineText(reason, "reason", 300),
      expectedRevision,
    });
  }

  restore(actor, activityId, { expectedRevision } = {}) {
    return this.changeVisibility(actor, activityId, {
      from: "hidden",
      to: "visible",
      reason: "",
      expectedRevision,
    });
  }

  changeVisibility(actor, activityId, { from, to, reason, expectedRevision }) {
    const principal = this.requireMainAgent(actor);
    if (!ACTIVITY_STATES.has(from) || !ACTIVITY_STATES.has(to)) throw activityError(400, "INVALID_STATE", "Invalid activity state");
    const current = this.getForOwner(principal.ownerId, activityId, { includeHidden: true });
    if (!current) throw activityError(404, "ACTIVITY_NOT_FOUND", "Activity was not found");
    const revision = boundedInteger(expectedRevision, 1, Number.MAX_SAFE_INTEGER, 0);
    if (!revision) throw activityError(400, "REVISION_REQUIRED", "expectedRevision is required");
    if (current.state !== from || current.revision !== revision) {
      throw activityError(409, "REVISION_CONFLICT", "Activity state or revision has changed");
    }
    const now = new Date().toISOString();
    const changes = this.db.prepare(`
      UPDATE activities SET state = ?, hidden_reason = ?, main_session_id = ?,
        revision = revision + 1, updated_at = ?
      WHERE id = ? AND owner_id = ? AND state = ? AND revision = ?
    `).run(to, reason, principal.sessionId, now, current.id, principal.ownerId, from, revision).changes;
    if (changes !== 1) throw activityError(409, "REVISION_CONFLICT", "Activity state or revision has changed");
    const result = this.getForOwner(principal.ownerId, current.id, { includeHidden: true });
    this.audit(principal, to === "hidden" ? "hide" : "restore", result);
    return result;
  }

  listForMainAgent(actor, options = {}) {
    const principal = this.requireMainAgent(actor);
    const result = this.listForOwner(principal.ownerId, options);
    this.audit(principal, "search", null, "", `returned:${result.items.length}`);
    return result;
  }

  listForReader(options = {}) {
    return this.listForOwner(DEFAULT_OWNER_ID, options);
  }

  listForOwner(ownerId, {
    query = "",
    type = "",
    cursor = "",
    limit = 20,
    includeHidden = false,
  } = {}) {
    const normalizedOwner = cleanInlineText(ownerId || DEFAULT_OWNER_ID, 120);
    const normalizedQuery = normalizeSearchText(query, 160);
    const normalizedType = String(type || "").trim().toLowerCase();
    if (normalizedType && !ACTIVITY_TYPES.has(normalizedType)) throw activityError(400, "INVALID_ACTIVITY_TYPE", "Unsupported activity type");
    const pageSize = boundedInteger(limit, 1, 100, 20);
    const decodedCursor = decodeCursor(cursor);
    const where = ["owner_id = ?"];
    const params = [normalizedOwner];
    if (!includeHidden) where.push("state = 'visible'");
    if (normalizedType) {
      where.push("activity_type = ?");
      params.push(normalizedType);
    }
    if (normalizedQuery) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeSqlLike(normalizedQuery)}%`);
    }
    const countWhere = [...where];
    const countParams = [...params];
    if (decodedCursor) {
      where.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
      params.push(decodedCursor.occurredAt, decodedCursor.occurredAt, decodedCursor.id);
    }
    const total = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM activities WHERE ${countWhere.join(" AND ")}
    `).get(...countParams)?.count || 0);
    const rows = this.db.prepare(`
      SELECT * FROM activities
      WHERE ${where.join(" AND ")}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `).all(...params, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize).map((row) => this.hydrate(row));
    const last = page.at(-1);
    return {
      items: page,
      total,
      nextCursor: hasMore && last ? encodeCursor(last) : "",
      query: String(query || "").trim().slice(0, 160),
    };
  }

  getForMainAgent(actor, activityId, options = {}) {
    const principal = this.requireMainAgent(actor);
    const result = this.getForOwner(principal.ownerId, activityId, options);
    this.audit(principal, "get", result, "", result ? "succeeded" : "not-found");
    return result;
  }

  getForOwner(ownerId, activityId, { includeHidden = false } = {}) {
    const row = this.db.prepare(`
      SELECT * FROM activities
      WHERE owner_id = ? AND id = ? ${includeHidden ? "" : "AND state = 'visible'"}
    `).get(cleanInlineText(ownerId || DEFAULT_OWNER_ID, 120), String(activityId || ""));
    return row ? this.hydrate(row) : null;
  }

  getAttachmentForReader(activityId, position) {
    const activity = this.getForOwner(DEFAULT_OWNER_ID, activityId);
    const index = boundedInteger(position, 0, MAX_ATTACHMENTS - 1, -1);
    if (!activity || index < 0 || !activity.attachments[index]) return null;
    let current;
    try {
      current = this.attachmentResolver(activity.attachments[index].objectId);
    } catch {
      current = null;
    }
    if (!current || current.status !== "ready" || current.objectId !== activity.attachments[index].objectId) return null;
    return { activity, attachment: activity.attachments[index], position: index };
  }

  requireMainAgent(actor = {}) {
    const sessionId = String(actor.sessionId || "").trim();
    if (!sessionId) throw activityError(403, "MAIN_AGENT_REQUIRED", "A verified main Agent session is required");
    const session = this.sessionResolver(sessionId);
    if (!session || session.id !== sessionId || session.role !== "main") {
      throw activityError(403, "MAIN_AGENT_REQUIRED", "Only the verified main Agent may operate Activity");
    }
    const ownerId = cleanInlineText(this.ownerResolver(session) || DEFAULT_OWNER_ID, 120);
    if (!ownerId) throw activityError(403, "OWNER_REQUIRED", "Activity owner could not be resolved");
    return { sessionId, ownerId };
  }

  normalizeInput(input) {
    const type = String(input.type || "note").trim().toLowerCase();
    if (!ACTIVITY_TYPES.has(type)) throw activityError(400, "INVALID_ACTIVITY_TYPE", "Unsupported activity type");
    const title = normalizedText(input.title, "title", MAX_TITLE_CHARACTERS, { inline: true });
    const detail = normalizedText(input.detail, "detail", MAX_DETAIL_CHARACTERS);
    const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      throw activityError(400, "TOO_MANY_ATTACHMENTS", `Activity supports at most ${MAX_ATTACHMENTS} attachments`);
    }
    const attachments = rawAttachments.map((value, position) => this.resolveAttachment(value, position));
    if (new Set(attachments.map((item) => item.objectId)).size !== attachments.length) {
      throw activityError(400, "DUPLICATE_ATTACHMENT", "Activity attachments must be unique");
    }
    const target = normalizeTarget(input.target);
    if (type === "page" && (target?.type !== "page" || !target.id)) {
      throw activityError(400, "PAGE_TARGET_REQUIRED", "Page Activity must reference the published Page id");
    }
    const correlationKey = cleanInlineText(input.correlationKey, 160);
    const idempotencyKey = requiredInlineText(input.idempotencyKey, "idempotencyKey", 200);
    const occurredAt = normalizeIso(input.occurredAt) || new Date().toISOString();
    return { type, title, detail, attachments, target, correlationKey, idempotencyKey, occurredAt };
  }

  resolveAttachment(value, position) {
    const objectId = String(typeof value === "string" ? value : value?.objectId || "").trim();
    if (!OBJECT_ID.test(objectId)) {
      throw activityError(400, "INVALID_ATTACHMENT", `Attachment ${position + 1} must reference a managed object`);
    }
    let object;
    try {
      object = this.attachmentResolver(objectId);
    } catch {
      object = null;
    }
    if (!object || object.objectId !== objectId || object.status !== "ready") {
      throw activityError(404, "ATTACHMENT_NOT_FOUND", `Attachment ${position + 1} was not found or is unavailable`);
    }
    const contentType = cleanInlineText(object.contentType || "application/octet-stream", 255);
    return {
      objectId,
      kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
      name: cleanInlineText(object.originalName || "附件", 255) || "附件",
      contentType,
      sizeBytes: boundedInteger(object.sizeBytes, 0, Number.MAX_SAFE_INTEGER, 0),
      visibility: object.visibility === "public" ? "public" : "private",
    };
  }

  insertRecord(record) {
    this.db.prepare(`
      INSERT INTO activities (
        id, owner_id, main_session_id, activity_type, title, detail,
        target_type, target_id, correlation_key, state, hidden_reason,
        revision, idempotency_key, request_hash, search_text,
        occurred_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.ownerId,
      record.mainSessionId,
      record.type,
      record.title,
      record.detail,
      record.target?.type || "",
      record.target?.id || "",
      record.correlationKey,
      record.state,
      record.hiddenReason,
      record.revision,
      record.idempotencyKey,
      record.requestHash,
      buildSearchText(record),
      record.occurredAt,
      record.createdAt,
      record.updatedAt,
    );
  }

  replaceAttachments(activityId, attachments) {
    this.db.prepare("DELETE FROM activity_attachments WHERE activity_id = ?").run(activityId);
    const insert = this.db.prepare(`
      INSERT INTO activity_attachments (
        activity_id, position, object_id, kind, name, content_type, size_bytes, visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    attachments.forEach((item, position) => {
      insert.run(activityId, position, item.objectId, item.kind, item.name, item.contentType, item.sizeBytes, item.visibility);
    });
  }

  findByIdempotencyKey(ownerId, idempotencyKey) {
    const row = this.db.prepare(`
      SELECT id, request_hash FROM activities WHERE owner_id = ? AND idempotency_key = ?
    `).get(ownerId, idempotencyKey);
    return row ? { id: row.id, requestHash: row.request_hash } : null;
  }

  audit(principal, action, activity = null, idempotencyKey = "", outcome = "succeeded") {
    this.db.prepare(`
      INSERT INTO activity_audit (
        id, owner_id, main_session_id, action, activity_id,
        revision, idempotency_key, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `actaud_${crypto.randomBytes(12).toString("hex")}`,
      principal.ownerId,
      principal.sessionId,
      cleanInlineText(action, 40),
      cleanInlineText(activity?.id, 120),
      boundedInteger(activity?.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      cleanInlineText(idempotencyKey, 200),
      cleanInlineText(outcome, 120),
      new Date().toISOString(),
    );
  }

  hydrate(row) {
    const attachments = this.db.prepare(`
      SELECT object_id, kind, name, content_type, size_bytes, visibility
      FROM activity_attachments WHERE activity_id = ? ORDER BY position ASC
    `).all(row.id).map((item) => ({
      objectId: item.object_id,
      kind: item.kind,
      name: item.name,
      contentType: item.content_type,
      sizeBytes: Number(item.size_bytes || 0),
      visibility: item.visibility,
    }));
    return {
      id: row.id,
      ownerId: row.owner_id,
      mainSessionId: row.main_session_id,
      type: row.activity_type,
      title: row.title,
      detail: row.detail,
      attachments,
      target: row.target_type && row.target_id ? { type: row.target_type, id: row.target_id } : null,
      correlationKey: row.correlation_key,
      state: row.state,
      hiddenReason: row.hidden_reason,
      revision: Number(row.revision || 0),
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
}

function normalizeTarget(value) {
  if (!value) return null;
  const type = String(value.type || "").trim().toLowerCase();
  const id = cleanInlineText(value.id, 200);
  if (!TARGET_TYPES.has(type) || !id) throw activityError(400, "INVALID_TARGET", "Activity target is invalid");
  return { type, id };
}

function normalizedText(value, label, maximum, { inline = false } = {}) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(inline ? /[\u0000-\u001f\u007f]+/g : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, inline ? " " : "")
    .replace(inline ? /\s+/g : /[ \t]+/g, " ")
    .trim();
  if (!normalized) throw activityError(400, `INVALID_${label.toUpperCase()}`, `Activity ${label} is required`);
  if (graphemeLength(normalized) > maximum) {
    throw activityError(400, `${label.toUpperCase()}_TOO_LONG`, `Activity ${label} exceeds ${maximum} characters`);
  }
  return normalized;
}

function cleanInlineText(value, maximum) {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function requiredInlineText(value, label, maximum) {
  const normalized = cleanInlineText(value, maximum);
  if (!normalized) throw activityError(400, `INVALID_${label.toUpperCase()}`, `${label} is required`);
  return normalized;
}

function normalizeSearchText(value, maximum) {
  return cleanInlineText(value, maximum).toLocaleLowerCase("zh-CN");
}

function buildSearchText(record) {
  return normalizeSearchText([
    record.type,
    record.title,
    record.detail,
    record.target?.type,
    record.target?.id,
    ...record.attachments.map((item) => `${item.kind} ${item.name} ${item.contentType}`),
  ].filter(Boolean).join(" "), 10000);
}

function activityRequestHash(record) {
  return crypto.createHash("sha256").update(JSON.stringify({
    type: record.type,
    title: record.title,
    detail: record.detail,
    attachments: record.attachments.map((item) => item.objectId),
    target: record.target,
    correlationKey: record.correlationKey,
    occurredAt: record.occurredAt,
  })).digest("hex");
}

function graphemeLength(value) {
  return [...graphemeSegmenter.segment(String(value || ""))].length;
}

function normalizeIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw activityError(400, "INVALID_OCCURRED_AT", "occurredAt must be an ISO timestamp");
  return date.toISOString();
}

function encodeCursor(item) {
  return Buffer.from(JSON.stringify({ occurredAt: item.occurredAt, id: item.id }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed?.occurredAt || !parsed?.id || !normalizeIso(parsed.occurredAt)) throw new Error("invalid");
    return { occurredAt: normalizeIso(parsed.occurredAt), id: String(parsed.id) };
  } catch {
    throw activityError(400, "INVALID_CURSOR", "Activity cursor is invalid");
  }
}

function escapeSqlLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

function activityError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export const activityLimits = Object.freeze({
  titleCharacters: MAX_TITLE_CHARACTERS,
  detailCharacters: MAX_DETAIL_CHARACTERS,
  attachments: MAX_ATTACHMENTS,
});
