import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const TIERS = new Set(["hot", "materialized", "pinned", "shadow"]);
const VISIBILITIES = new Set(["public", "private"]);
const STATUSES = new Set(["pending-upload", "ready", "remote-missing", "corrupt"]);

export class ManagedFileCatalog {
  constructor({ dataDir, databasePath } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.databasePath = path.resolve(databasePath || path.join(this.dataDir, "state.sqlite"));
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.init();
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_objects (
        id TEXT PRIMARY KEY,
        visibility TEXT NOT NULL,
        source TEXT NOT NULL,
        bucket TEXT NOT NULL,
        region TEXT NOT NULL,
        object_key TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        crc64 TEXT NOT NULL,
        version_id TEXT NOT NULL,
        status TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        remote_verified_at TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bucket, object_key)
      );
      CREATE INDEX IF NOT EXISTS idx_managed_objects_search
        ON managed_objects(source, visibility, status, uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_managed_objects_relative_path
        ON managed_objects(relative_path);

      CREATE TABLE IF NOT EXISTS managed_object_copies (
        object_id TEXT NOT NULL,
        local_path TEXT NOT NULL,
        tier TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        verified_at TEXT NOT NULL,
        last_materialized_at TEXT,
        expires_at TEXT,
        pinned_until TEXT,
        task_lease_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(object_id, local_path),
        FOREIGN KEY(object_id) REFERENCES managed_objects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_managed_copies_expiry
        ON managed_object_copies(expires_at, pinned_until, task_lease_until);

      CREATE TABLE IF NOT EXISTS managed_file_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_managed_file_events_object
        ON managed_file_events(object_id, created_at DESC);
    `);
  }

  close() {
    this.db.close();
  }

  upsertObject(input) {
    const now = validIso(input.updatedAt) || new Date().toISOString();
    const visibility = normalizeEnum(input.visibility, VISIBILITIES, "private", "visibility");
    const status = normalizeEnum(input.status, STATUSES, "pending-upload", "status");
    const bucket = requiredText(input.bucket, "bucket", 255);
    const objectKey = requiredText(input.objectKey, "objectKey", 1024).replace(/^\/+/, "");
    const id = String(input.id || objectId(bucket, objectKey));
    const uploadedAt = validIso(input.uploadedAt) || now;
    const createdAt = validIso(input.createdAt) || now;
    this.db.prepare(`
      INSERT INTO managed_objects (
        id, visibility, source, bucket, region, object_key, relative_path,
        original_name, content_type, size_bytes, sha256, crc64, version_id,
        status, uploaded_at, remote_verified_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket, object_key) DO UPDATE SET
        visibility = excluded.visibility,
        source = excluded.source,
        region = excluded.region,
        relative_path = excluded.relative_path,
        original_name = excluded.original_name,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        crc64 = excluded.crc64,
        version_id = excluded.version_id,
        status = excluded.status,
        uploaded_at = excluded.uploaded_at,
        remote_verified_at = excluded.remote_verified_at,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      visibility,
      cleanText(input.source || "managed", 120),
      bucket,
      cleanText(input.region, 120),
      objectKey,
      cleanText(input.relativePath || objectKey, 1024),
      cleanText(input.originalName || path.posix.basename(objectKey), 255),
      cleanText(input.contentType || "application/octet-stream", 255),
      nonNegativeInteger(input.sizeBytes),
      normalizeSha256(input.sha256),
      cleanText(input.crc64, 80),
      cleanText(input.versionId, 255),
      status,
      uploadedAt,
      validIso(input.remoteVerifiedAt),
      JSON.stringify(input.metadata || {}),
      createdAt,
      now,
    );
    return this.getByLocation(bucket, objectKey);
  }

  recordLocalCopy(objectIdValue, input) {
    const object = this.get(objectIdValue);
    if (!object) throw new Error("managed object not found");
    const localPath = path.resolve(requiredText(input.localPath, "localPath", 4096));
    const tier = normalizeEnum(input.tier, TIERS, "hot", "tier");
    const now = validIso(input.updatedAt) || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO managed_object_copies (
        object_id, local_path, tier, sha256, size_bytes, verified_at,
        last_materialized_at, expires_at, pinned_until, task_lease_until,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id, local_path) DO UPDATE SET
        tier = excluded.tier,
        sha256 = excluded.sha256,
        size_bytes = excluded.size_bytes,
        verified_at = excluded.verified_at,
        last_materialized_at = excluded.last_materialized_at,
        expires_at = excluded.expires_at,
        pinned_until = COALESCE(excluded.pinned_until, managed_object_copies.pinned_until),
        task_lease_until = COALESCE(excluded.task_lease_until, managed_object_copies.task_lease_until),
        updated_at = excluded.updated_at
    `).run(
      object.id,
      localPath,
      tier,
      normalizeSha256(input.sha256 || object.sha256),
      nonNegativeInteger(input.sizeBytes ?? object.sizeBytes),
      validIso(input.verifiedAt) || now,
      validIso(input.lastMaterializedAt),
      validIso(input.expiresAt),
      validIso(input.pinnedUntil),
      validIso(input.taskLeaseUntil),
      validIso(input.createdAt) || now,
      now,
    );
    this.addEvent(object.id, "local-copy-recorded", { localPath, tier });
    return this.get(object.id);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM managed_objects WHERE id = ?").get(String(id || ""));
    return row ? this.hydrate(row) : null;
  }

  getByLocation(bucket, objectKey) {
    const row = this.db.prepare("SELECT * FROM managed_objects WHERE bucket = ? AND object_key = ?")
      .get(String(bucket || ""), String(objectKey || "").replace(/^\/+/, ""));
    return row ? this.hydrate(row) : null;
  }

  getByRelativePath(visibility, relativePath) {
    const row = this.db.prepare("SELECT * FROM managed_objects WHERE visibility = ? AND relative_path = ? ORDER BY uploaded_at DESC LIMIT 1")
      .get(String(visibility || ""), String(relativePath || "").replace(/^\/+/, ""));
    return row ? this.hydrate(row) : null;
  }

  search({ query = "", visibility = "", source = "", tier = "all", limit = 50 } = {}) {
    const where = [];
    const params = [];
    const searchText = cleanText(query, 200);
    if (searchText) {
      const pattern = `%${escapeSqlLike(searchText)}%`;
      where.push("(original_name LIKE ? ESCAPE '\\' OR relative_path LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR metadata_json LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern, pattern, pattern);
    }
    if (VISIBILITIES.has(visibility)) {
      where.push("visibility = ?");
      params.push(visibility);
    }
    if (source) {
      where.push("source = ?");
      params.push(cleanText(source, 120));
    }
    const rows = this.db.prepare(`
      SELECT * FROM managed_objects
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY uploaded_at DESC, id DESC
      LIMIT ?
    `).all(...params, Math.min(Math.max(Number(limit) || 50, 1), 200));
    const results = rows.map((row) => this.hydrate(row));
    if (tier === "hot") return results.filter((item) => item.localCopies.some((copy) => copy.tier !== "shadow"));
    if (tier === "cold") return results.filter((item) => item.localCopies.every((copy) => copy.tier === "shadow"));
    return results;
  }

  setPin(id, pinnedUntil, reason = "") {
    const object = this.get(id);
    if (!object) throw new Error("managed object not found");
    if (!object.localCopies.some((copy) => copy.tier !== "shadow")) throw new Error("materialize the managed object before pinning it");
    const until = validIso(pinnedUntil);
    if (!until) throw new Error("pinnedUntil must be an ISO timestamp");
    this.db.prepare("UPDATE managed_object_copies SET pinned_until = ?, tier = 'pinned', updated_at = ? WHERE object_id = ? AND tier <> 'shadow'")
      .run(until, new Date().toISOString(), object.id);
    this.addEvent(object.id, "pinned", { pinnedUntil: until, reason: cleanText(reason, 300) });
    return this.get(object.id);
  }

  clearPin(id) {
    const object = this.get(id);
    if (!object) throw new Error("managed object not found");
    this.db.prepare(`
      UPDATE managed_object_copies
      SET pinned_until = NULL,
          tier = CASE WHEN last_materialized_at IS NOT NULL THEN 'materialized' ELSE 'hot' END,
          updated_at = ?
      WHERE object_id = ?
        AND tier <> 'shadow'
    `).run(new Date().toISOString(), object.id);
    this.addEvent(object.id, "unpinned", {});
    return this.get(object.id);
  }

  evictionCandidates({ now = new Date(), retentionDays = 30 } = {}) {
    const current = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const minimumAgeMs = Math.min(Math.max(Number(retentionDays) || 30, 1), 365) * 86400000;
    const rows = this.db.prepare(`
      SELECT o.*, c.local_path, c.tier, c.sha256 AS copy_sha256,
             c.size_bytes AS copy_size_bytes, c.verified_at,
             c.last_materialized_at, c.expires_at, c.pinned_until,
             c.task_lease_until, c.created_at AS copy_created_at,
             c.updated_at AS copy_updated_at
      FROM managed_objects o
      JOIN managed_object_copies c ON c.object_id = o.id
      WHERE o.status = 'ready' AND o.remote_verified_at IS NOT NULL
    `).all();
    return rows.filter((row) => {
      const mandatoryHotUntil = new Date(row.uploaded_at).getTime() + minimumAgeMs;
      const protectedUntil = Math.max(
        mandatoryHotUntil,
        isoTime(row.expires_at),
        isoTime(row.pinned_until),
        isoTime(row.task_lease_until),
      );
      return protectedUntil < current.getTime();
    }).map((row) => ({
      object: hydrateObjectRow(row),
      copy: hydrateCopyRow({
        object_id: row.id,
        local_path: row.local_path,
        tier: row.tier,
        sha256: row.copy_sha256,
        size_bytes: row.copy_size_bytes,
        verified_at: row.verified_at,
        last_materialized_at: row.last_materialized_at,
        expires_at: row.expires_at,
        pinned_until: row.pinned_until,
        task_lease_until: row.task_lease_until,
        created_at: row.copy_created_at,
        updated_at: row.copy_updated_at,
      }),
    }));
  }

  removeLocalCopy(objectIdValue, localPath, detail = {}) {
    const resolved = path.resolve(String(localPath || ""));
    const changes = this.db.prepare("DELETE FROM managed_object_copies WHERE object_id = ? AND local_path = ?")
      .run(String(objectIdValue || ""), resolved).changes;
    if (changes) this.addEvent(objectIdValue, "local-copy-removed", { localPath: resolved, ...detail });
    return changes > 0;
  }

  updateStatus(id, status, detail = {}) {
    const normalized = normalizeEnum(status, STATUSES, "corrupt", "status");
    this.db.prepare("UPDATE managed_objects SET status = ?, updated_at = ? WHERE id = ?")
      .run(normalized, new Date().toISOString(), String(id || ""));
    this.addEvent(id, "status-changed", { status: normalized, ...detail });
    return this.get(id);
  }

  addEvent(objectIdValue, eventType, detail = {}) {
    this.db.prepare("INSERT INTO managed_file_events (object_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?)")
      .run(String(objectIdValue || ""), cleanText(eventType, 120), JSON.stringify(detail || {}), new Date().toISOString());
  }

  hydrate(row) {
    const object = hydrateObjectRow(row);
    object.localCopies = this.db.prepare("SELECT * FROM managed_object_copies WHERE object_id = ? ORDER BY updated_at DESC")
      .all(object.id).map(hydrateCopyRow);
    return object;
  }
}

function hydrateObjectRow(row) {
  return {
    id: row.id,
    visibility: row.visibility,
    source: row.source,
    bucket: row.bucket,
    region: row.region,
    objectKey: row.object_key,
    relativePath: row.relative_path,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256,
    crc64: row.crc64,
    versionId: row.version_id,
    status: row.status,
    uploadedAt: row.uploaded_at,
    remoteVerifiedAt: row.remote_verified_at || "",
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    localCopies: [],
  };
}

function hydrateCopyRow(row) {
  return {
    objectId: row.object_id,
    localPath: row.local_path,
    tier: row.tier,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes || 0),
    verifiedAt: row.verified_at,
    lastMaterializedAt: row.last_materialized_at || "",
    expiresAt: row.expires_at || "",
    pinnedUntil: row.pinned_until || "",
    taskLeaseUntil: row.task_lease_until || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function objectId(bucket, objectKey) {
  return `obj_${crypto.createHash("sha256").update(`${bucket}\n${objectKey}`).digest("hex").slice(0, 24)}`;
}

function normalizeEnum(value, allowed, fallback, label) {
  const normalized = String(value || fallback);
  if (!allowed.has(normalized)) throw new Error(`${label} must be one of ${[...allowed].join(", ")}`);
  return normalized;
}

function requiredText(value, label, maximum) {
  const normalized = cleanText(value, maximum);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function cleanText(value, maximum = 1024) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function normalizeSha256(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized && !/^[a-f0-9]{64}$/.test(normalized)) throw new Error("sha256 must contain 64 hexadecimal characters");
  return normalized;
}

function nonNegativeInteger(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoTime(value) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function escapeSqlLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}
