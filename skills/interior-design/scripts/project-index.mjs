import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const INDEX_SCHEMA_VERSION = 1;

export function initializeProjectIndex(projectDir, project) {
  const databasePath = path.join(projectDir, '.runtime', 'pascal.db');
  if (fs.existsSync(databasePath)) throw projectError('PROJECT_INDEX_EXISTS', 'project runtime index already exists', 6);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  assertRuntimeDirectory(databasePath);
  const database = open(databasePath);
  try {
    createSchema(database);
    const insertMetadata = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries({
      schema_version: String(INDEX_SCHEMA_VERSION),
      project_id: project.projectId,
      space_id: project.spaceId,
      owner_id: project.ownerId,
    })) insertMetadata.run(key, value);
    record(database, project, null, null);
  } finally {
    database.close();
  }
  fs.chmodSync(databasePath, 0o600);
}

export function verifyProjectIndex(projectDir, project) {
  const databasePath = path.join(projectDir, '.runtime', 'pascal.db');
  assertRuntimeDirectory(databasePath);
  if (!fs.existsSync(databasePath)) throw projectError('PROJECT_INDEX_MISSING', 'project runtime index is missing', 6);
  if (fs.lstatSync(databasePath).isSymbolicLink()) throw projectError('SYMLINK_ESCAPE', 'project runtime index must not be a symbolic link', 4);
  const database = open(databasePath);
  try {
    const metadata = Object.fromEntries(database.prepare('SELECT key, value FROM metadata').all().map((entry) => [entry.key, entry.value]));
    if (Number(metadata.schema_version) !== INDEX_SCHEMA_VERSION) {
      throw projectError('PROJECT_INDEX_VERSION_MISMATCH', `project runtime index schema ${metadata.schema_version || 'unknown'} is unsupported`, 7);
    }
    if (metadata.project_id !== project.projectId || metadata.space_id !== project.spaceId || metadata.owner_id !== project.ownerId) {
      throw projectError('PROJECT_INDEX_OWNERSHIP_MISMATCH', 'project runtime index ownership does not match the governed project', 4);
    }
    const current = database.prepare('SELECT project_hash FROM revisions WHERE revision = ?').get(project.revision);
    if (!current || current.project_hash !== sha256(canonicalJson(project))) record(database, project, null, null);
  } finally {
    database.close();
  }
}

export function recordProjectIndexRevision(projectDir, project, scene = null, audit = null) {
  const databasePath = path.join(projectDir, '.runtime', 'pascal.db');
  assertRuntimeDirectory(databasePath);
  const database = open(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    record(database, project, scene, audit);
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original structured error is more useful than a secondary rollback error.
    }
    throw error;
  } finally {
    database.close();
  }
}

function open(databasePath, readOnly = false) {
  try {
    return new DatabaseSync(databasePath, { readOnly });
  } catch (error) {
    throw projectError('PROJECT_INDEX_OPEN_FAILED', `could not open the project runtime index: ${error.message}`, 7);
  }
}

function assertRuntimeDirectory(databasePath) {
  const runtimeDirectory = path.dirname(databasePath);
  if (!fs.existsSync(runtimeDirectory) || fs.lstatSync(runtimeDirectory).isSymbolicLink()) {
    throw projectError('SYMLINK_ESCAPE', 'project runtime directory must exist and must not be a symbolic link', 4);
  }
}

function createSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE revisions (
      revision INTEGER PRIMARY KEY,
      project_hash TEXT NOT NULL,
      scene_hash TEXT,
      audit_hash TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
}

function record(database, project, scene, audit) {
  database.prepare(`
    INSERT INTO revisions (revision, project_hash, scene_hash, audit_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(revision) DO UPDATE SET
      project_hash = excluded.project_hash,
      scene_hash = excluded.scene_hash,
      audit_hash = excluded.audit_hash,
      created_at = excluded.created_at
  `).run(
    project.revision,
    sha256(canonicalJson(project)),
    scene?.sceneHash || project.scene?.sha256 || null,
    audit?.sha256 || project.quality?.sha256 || null,
    project.updatedAt,
  );
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 10000) / 10000;
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function projectError(code, message, exitCode) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  error.detail = {};
  return error;
}
