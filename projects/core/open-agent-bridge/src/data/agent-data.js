import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const SAFE_READ_PRAGMAS = new Set(["table_info", "table_xinfo", "foreign_key_list", "index_list", "index_info", "schema_version"]);
const BLOCKED_SQL = [
  /\bATTACH\s+(?:DATABASE\s+)?/i,
  /\bDETACH\s+(?:DATABASE\s+)?/i,
  /\bload_extension\s*\(/i,
  /\bVACUUM\s+INTO\b/i,
  /\bPRAGMA\s+(?:writable_schema|temp_store_directory|data_store_directory)\b/i,
];
const DESTRUCTIVE_SQL = /\b(?:DROP\s+(?:TABLE|VIEW|INDEX|TRIGGER)|ALTER\s+TABLE|DELETE\s+FROM|VACUUM)\b/i;
const TRANSACTION_SQL = /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const AGGREGATES = new Set(["count", "sum", "avg", "min", "max"]);

export class AgentDataStore {
  constructor({ dataDir, databasePath, audit, onSnapshot } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.databasePath = path.resolve(databasePath || path.join(this.dataDir, "agent-data.sqlite"));
    this.snapshotsDir = path.join(this.dataDir, "snapshots");
    this.audit = typeof audit === "function" ? audit : () => {};
    this.onSnapshot = typeof onSnapshot === "function" ? onSnapshot : async () => null;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.snapshotsDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(this.databasePath), 0o700);
    fs.chmodSync(this.snapshotsDir, 0o700);
    this.open();
  }

  open() {
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    fs.chmodSync(this.databasePath, 0o600);
  }

  close() {
    this.db?.close();
  }

  getStatus() {
    const stat = fs.existsSync(this.databasePath) ? fs.statSync(this.databasePath) : null;
    return {
      databasePath: this.databasePath,
      sizeBytes: stat?.size || 0,
      schemaVersion: Number(this.db.prepare("PRAGMA schema_version").get()?.schema_version || 0),
      objects: this.listObjects(),
      snapshotCount: this.listSnapshots().length,
    };
  }

  listObjects() {
    const rows = this.db.prepare(`
      SELECT name, type, sql
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view')
      ORDER BY type, name COLLATE NOCASE
    `).all();
    return rows.map((row) => {
      const columns = this.describeObject(row.name).columns;
      let rowCount = null;
      try {
        rowCount = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(row.name)}`).get()?.count || 0);
      } catch {
        rowCount = null;
      }
      return { name: row.name, type: row.type, sql: row.sql || "", columnCount: columns.length, rowCount };
    });
  }

  describeObject(name) {
    const object = this.requireObject(name);
    const columns = this.db.prepare(`PRAGMA table_xinfo(${quoteString(object.name)})`).all().map((column) => ({
      cid: Number(column.cid),
      name: column.name,
      type: column.type || "",
      notNull: Boolean(column.notnull),
      defaultValue: column.dflt_value,
      primaryKeyPosition: Number(column.pk || 0),
      hidden: Number(column.hidden || 0),
    }));
    const indexes = this.db.prepare(`PRAGMA index_list(${quoteString(object.name)})`).all().map((index) => ({
      name: index.name,
      unique: Boolean(index.unique),
      origin: index.origin,
      partial: Boolean(index.partial),
    }));
    const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${quoteString(object.name)})`).all().map((key) => ({
      from: key.from,
      table: key.table,
      to: key.to,
      onUpdate: key.on_update,
      onDelete: key.on_delete,
    }));
    return { ...object, columns, indexes, foreignKeys };
  }

  query(input = {}) {
    const object = this.requireObject(input.object || input.table);
    const description = this.describeObject(object.name);
    const columnMap = new Map(description.columns.filter((column) => !column.hidden).map((column) => [column.name, column]));
    const selected = normalizeIdentifiers(input.columns, columnMap, [...columnMap.keys()]);
    const groupBy = normalizeIdentifiers(input.groupBy, columnMap, []);
    const metrics = normalizeMetrics(input.metrics, columnMap);
    const params = [];
    const where = compileFilters(input.filters, columnMap, params);
    const search = String(input.search || "").trim();
    if (search) {
      const searchable = [...columnMap.keys()].slice(0, 24);
      if (searchable.length) {
        params.push(`%${escapeLike(search)}%`);
        where.push(`(${searchable.map((name) => `CAST(${quoteIdentifier(name)} AS TEXT) LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      }
    }
    const selectParts = groupBy.length || metrics.length
      ? [...groupBy.map(quoteIdentifier), ...metrics.map((metric) => metricSql(metric))]
      : selected.map(quoteIdentifier);
    const orderBy = compileSort(input.sort, columnMap, groupBy, metrics);
    const pageSize = clampInteger(input.page?.size || input.pageSize || input.limit, 1, 200, 50);
    const pageNumber = clampInteger(input.page?.number || input.page || 1, 1, 1_000_000, 1);
    const offset = (pageNumber - 1) * pageSize;
    const base = `FROM ${quoteIdentifier(object.name)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${groupBy.length ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(", ")}` : ""}`;
    const sql = `SELECT ${selectParts.length ? selectParts.join(", ") : "*"} ${base}${orderBy ? ` ORDER BY ${orderBy}` : ""} LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, pageSize, offset).map(normalizeSqliteRow);
    const countSql = groupBy.length
      ? `SELECT COUNT(*) AS count FROM (SELECT 1 ${base})`
      : `SELECT COUNT(*) AS count ${base}`;
    const totalRows = Number(this.db.prepare(countSql).get(...params)?.count || 0);
    return {
      object: description,
      columns: rows.length ? Object.keys(rows[0]) : selectParts.map(unquoteAlias),
      rows,
      query: { filters: input.filters || [], search, sort: input.sort || [], groupBy, metrics },
      page: { number: pageNumber, size: pageSize, totalRows, totalPages: Math.max(Math.ceil(totalRows / pageSize), 1) },
    };
  }

  distinct({ object, field, filters = [], search = "", limit = 50 } = {}) {
    const description = this.describeObject(object);
    const columnMap = new Map(description.columns.map((column) => [column.name, column]));
    requireColumn(field, columnMap);
    const params = [];
    const where = compileFilters(filters, columnMap, params);
    if (String(search).trim()) {
      params.push(`%${escapeLike(String(search).trim())}%`);
      where.push(`CAST(${quoteIdentifier(field)} AS TEXT) LIKE ? ESCAPE '\\'`);
    }
    const rows = this.db.prepare(`
      SELECT ${quoteIdentifier(field)} AS value, COUNT(*) AS count
      FROM ${quoteIdentifier(description.name)}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY ${quoteIdentifier(field)}
      ORDER BY count DESC, value
      LIMIT ?
    `).all(...params, clampInteger(limit, 1, 200, 50));
    return rows.map((row) => ({ value: normalizeSqliteValue(row.value), count: Number(row.count || 0) }));
  }

  async execute(sql, { actor = "agent", sessionId = "", runId = "" } = {}) {
    const statement = String(sql || "").trim();
    if (!statement) throw new Error("sql is required");
    assertScopedSql(statement);
    const readOnly = isReadOnlySql(statement);
    const operation = {
      id: `dop_${crypto.randomBytes(10).toString("hex")}`,
      actor: String(actor || "agent"),
      sessionId: String(sessionId || ""),
      runId: String(runId || ""),
      sqlHash: crypto.createHash("sha256").update(statement).digest("hex"),
      kind: readOnly ? "query" : DESTRUCTIVE_SQL.test(statement) ? "destructive" : "write",
      snapshotId: null,
      createdAt: new Date().toISOString(),
    };
    if (readOnly) {
      const result = this.executeRead(statement);
      this.audit({ ...operation, status: "succeeded", affectedRows: result.rows.length });
      return { operation, ...result };
    }
    if (TRANSACTION_SQL.test(statement)) throw new Error("transaction control is managed by the data service");
    if (DESTRUCTIVE_SQL.test(statement)) {
      const snapshot = await this.createSnapshot({ reason: operation.id });
      operation.snapshotId = snapshot.id;
      operation.snapshotManaged = snapshot.managed;
    }
    const beforeVersion = Number(this.db.prepare("PRAGMA schema_version").get()?.schema_version || 0);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.db.exec(statement);
      this.db.exec("COMMIT");
      const afterVersion = Number(this.db.prepare("PRAGMA schema_version").get()?.schema_version || 0);
      const result = { operation, schemaChanged: beforeVersion !== afterVersion, schemaVersion: afterVersion, objects: this.listObjects() };
      this.audit({ ...operation, status: "succeeded", schemaChanged: result.schemaChanged });
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      this.audit({ ...operation, status: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  executeRead(sql) {
    const pragmaMatch = /^PRAGMA\s+([a-z_]+)/i.exec(sql);
    if (pragmaMatch && !SAFE_READ_PRAGMAS.has(pragmaMatch[1].toLowerCase())) throw new Error("pragma is not available through the Agent data API");
    const rows = this.db.prepare(sql).all().map(normalizeSqliteRow);
    return { rows, columns: rows.length ? Object.keys(rows[0]) : [] };
  }

  async createSnapshot({ reason = "manual" } = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = `snapshot-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
    const filePath = path.join(this.snapshotsDir, `${id}.sqlite`);
    await backup(this.db, filePath);
    fs.chmodSync(filePath, 0o600);
    const stat = fs.statSync(filePath);
    const snapshot = { id, reason: String(reason), filePath, sizeBytes: stat.size, createdAt: new Date().toISOString() };
    const managed = await this.onSnapshot(snapshot);
    this.audit({ id: `dop_${crypto.randomBytes(10).toString("hex")}`, actor: "system", kind: "snapshot", status: "succeeded", snapshotId: id, createdAt: snapshot.createdAt });
    return { ...snapshot, managed };
  }

  listSnapshots() {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs.readdirSync(this.snapshotsDir)
      .filter((name) => name.endsWith(".sqlite"))
      .map((name) => {
        const filePath = path.join(this.snapshotsDir, name);
        const stat = fs.statSync(filePath);
        return { id: name.slice(0, -7), filePath, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restoreSnapshot(id) {
    const normalized = String(id || "").trim();
    if (!/^snapshot-[a-zA-Z0-9-]+$/.test(normalized)) throw new Error("invalid snapshot id");
    const source = path.join(this.snapshotsDir, `${normalized}.sqlite`);
    if (!fs.existsSync(source)) throw new Error("snapshot not found");
    const rollback = await this.createSnapshot({ reason: `before-restore:${normalized}` });
    this.close();
    try {
      fs.copyFileSync(source, this.databasePath);
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${this.databasePath}${suffix}`, { force: true });
      this.open();
      const integrity = this.db.prepare("PRAGMA integrity_check").get()?.integrity_check;
      if (integrity !== "ok") throw new Error(`restored database failed integrity check: ${integrity}`);
      return { restored: normalized, rollbackSnapshotId: rollback.id, schemaVersion: Number(this.db.prepare("PRAGMA schema_version").get()?.schema_version || 0) };
    } catch (error) {
      if (!this.db?.isOpen) this.open();
      throw error;
    }
  }

  requireObject(name) {
    const normalized = String(name || "").trim();
    if (!normalized) throw new Error("data object is required");
    const row = this.db.prepare(`SELECT name, type, sql FROM sqlite_schema WHERE name = ? AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'view')`).get(normalized);
    if (!row) throw new Error("data object not found");
    return { name: row.name, type: row.type, sql: row.sql || "" };
  }
}

function assertScopedSql(sql) {
  for (const pattern of BLOCKED_SQL) if (pattern.test(sql)) throw new Error("sql escapes the Agent data database boundary");
}

function isReadOnlySql(sql) {
  return /^(?:SELECT|WITH\b[\s\S]*?\bSELECT|EXPLAIN\s+(?:QUERY\s+PLAN\s+)?SELECT|PRAGMA\s+)/i.test(sql.trim());
}

function compileFilters(filters, columnMap, params) {
  if (!Array.isArray(filters)) return [];
  return filters.slice(0, 24).map((filter) => {
    const field = String(filter?.field || "");
    requireColumn(field, columnMap);
    const column = quoteIdentifier(field);
    const operator = String(filter?.operator || "eq");
    const value = filter?.value;
    if (operator === "isNull") return `${column} IS NULL`;
    if (operator === "notNull") return `${column} IS NOT NULL`;
    if (operator === "in" || operator === "notIn") {
      const values = Array.isArray(value) ? value.slice(0, 100) : [value];
      if (!values.length) return operator === "in" ? "0 = 1" : "1 = 1";
      params.push(...values);
      return `${column} ${operator === "notIn" ? "NOT " : ""}IN (${values.map(() => "?").join(", ")})`;
    }
    if (operator === "between") {
      const values = Array.isArray(value) ? value.slice(0, 2) : [];
      if (values.length !== 2) throw new Error("between filter requires two values");
      params.push(values[0], values[1]);
      return `${column} BETWEEN ? AND ?`;
    }
    const comparisons = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    if (comparisons[operator]) {
      params.push(value);
      return `${column} ${comparisons[operator]} ?`;
    }
    if (["contains", "startsWith", "endsWith"].includes(operator)) {
      const escaped = escapeLike(String(value ?? ""));
      params.push(operator === "startsWith" ? `${escaped}%` : operator === "endsWith" ? `%${escaped}` : `%${escaped}%`);
      return `CAST(${column} AS TEXT) LIKE ? ESCAPE '\\'`;
    }
    throw new Error(`unsupported filter operator: ${operator}`);
  });
}

function compileSort(sort, columnMap, groupBy, metrics) {
  if (!Array.isArray(sort)) return "";
  const allowedAliases = new Set([...groupBy, ...metrics.map((metric) => metric.alias)]);
  return sort.slice(0, 8).map((item) => {
    const field = String(item?.field || "");
    if (!columnMap.has(field) && !allowedAliases.has(field)) throw new Error(`unknown sort field: ${field}`);
    return `${quoteIdentifier(field)} ${String(item?.direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC"}`;
  }).join(", ");
}

function normalizeMetrics(metrics, columnMap) {
  if (!Array.isArray(metrics)) return [];
  return metrics.slice(0, 12).map((metric, index) => {
    const fn = String(metric?.function || "count").toLowerCase();
    if (!AGGREGATES.has(fn)) throw new Error(`unsupported aggregate: ${fn}`);
    const field = fn === "count" && !metric?.field ? "*" : String(metric?.field || "");
    if (field !== "*") requireColumn(field, columnMap);
    const alias = String(metric?.alias || `${fn}_${field === "*" ? "rows" : field}` || `metric_${index}`);
    return { function: fn, field, alias };
  });
}

function metricSql(metric) {
  return `${metric.function.toUpperCase()}(${metric.field === "*" ? "*" : quoteIdentifier(metric.field)}) AS ${quoteIdentifier(metric.alias)}`;
}

function normalizeIdentifiers(values, columnMap, fallback) {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values.map((value) => {
    const name = String(value || "");
    requireColumn(name, columnMap);
    return name;
  });
}

function requireColumn(name, columnMap) {
  if (!columnMap.has(name)) throw new Error(`unknown data field: ${name}`);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizeSqliteRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqliteValue(value)]));
}

function normalizeSqliteValue(value) {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return { type: "blob", size: value.byteLength };
  return value;
}

function unquoteAlias(value) {
  const match = /\s+AS\s+"([^"]+)"$/i.exec(String(value));
  return match?.[1] || String(value).replaceAll('"', "");
}
