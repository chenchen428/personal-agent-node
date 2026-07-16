import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const APP_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ALLOWED_KINDS = new Set(["summary", "mail", "data", "page", "refresh"]);
const ALLOWED_SOURCES = new Set(["app", "mail", "data", "pages"]);
const MAX_ITEMS = 200;

export class AppHistoryStore {
  constructor({ appsDir } = {}) {
    this.appsDir = path.resolve(appsDir || process.cwd());
  }

  list(appId, { limit = 30 } = {}) {
    const app = this.requireApp(appId);
    const items = this.readItems(app);
    const boundedLimit = boundedInteger(limit, 1, 100, 30);
    return { appId: app.id, items: items.slice(0, boundedLimit), total: items.length };
  }

  append(appId, input = {}) {
    const app = this.requireApp(appId);
    const item = normalizeHistory(input);
    const items = this.readItems(app);
    items.unshift({
      id: `apphist_${crypto.randomBytes(10).toString("hex")}`,
      ...item,
      createdAt: new Date().toISOString(),
    });
    this.writeItems(app, items.slice(0, MAX_ITEMS));
    return items[0];
  }

  requireApp(appId) {
    const id = String(appId || "").trim();
    if (!APP_ID.test(id) || id.length > 96) throw appError(400, "INVALID_APP_ID", "Invalid App id");
    const root = path.resolve(this.appsDir, id);
    assertInside(this.appsDir, root);
    const stat = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw appError(404, "APP_NOT_FOUND", "App was not found");
    const manifestPath = path.join(root, "personal-agent.app.json");
    const manifestStat = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
    if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) throw appError(404, "APP_NOT_FOUND", "App manifest was not found");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw appError(409, "APP_INVALID", "App manifest is invalid");
    }
    if (manifest?.apiVersion !== "personal-agent/app-v1" || manifest?.id !== id) {
      throw appError(409, "APP_INVALID", "App manifest identity does not match");
    }
    return { id, root };
  }

  readItems(app) {
    const filePath = historyPath(app);
    migrateLegacyHistoryFile(app, filePath);
    const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (!stat) return [];
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw appError(409, "HISTORY_INVALID", "App history store is invalid");
    }
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (value?.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error("invalid");
      return value.items.filter(validStoredHistory).slice(0, MAX_ITEMS);
    } catch {
      throw appError(409, "HISTORY_INVALID", "App history store is invalid");
    }
  }

  writeItems(app, items) {
    const dataDir = path.join(app.root, "data");
    const existing = fs.lstatSync(dataDir, { throwIfNoEntry: false });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw appError(409, "HISTORY_INVALID", "App data directory is invalid");
    }
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dataDir, 0o700); } catch {}
    const filePath = historyPath(app);
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, items }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  }
}

function historyPath(app) {
  const target = path.resolve(app.root, "data", "history.json");
  assertInside(app.root, target);
  return target;
}

function migrateLegacyHistoryFile(app, target) {
  if (fs.existsSync(target)) return;
  const legacy = path.resolve(app.root, "data", "activity.json");
  assertInside(app.root, legacy);
  const stat = fs.lstatSync(legacy, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw appError(409, "HISTORY_INVALID", "Legacy App history store is invalid");
  }
  fs.renameSync(legacy, target);
}

function normalizeHistory(input) {
  const kind = String(input?.kind || "summary").trim().toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) throw appError(400, "INVALID_HISTORY", "Unsupported history kind");
  const title = cleanText(input?.title, 120);
  const summary = cleanText(input?.summary, 280, true);
  if (!title) throw appError(400, "INVALID_HISTORY", "History title is required");
  const sources = [...new Set((Array.isArray(input?.sources) ? input.sources : [])
    .slice(0, 8)
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => ALLOWED_SOURCES.has(value)))];
  return { kind, title, summary, sources };
}

function cleanText(value, maximum, optional = false) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text && optional) return "";
  if (text.length > maximum) throw appError(400, "INVALID_HISTORY", `History text exceeds ${maximum} characters`);
  return text;
}

function validStoredHistory(item) {
  return item
    && typeof item.id === "string"
    && typeof item.kind === "string"
    && typeof item.title === "string"
    && typeof item.summary === "string"
    && Array.isArray(item.sources)
    && typeof item.createdAt === "string";
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function assertInside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw appError(400, "INVALID_APP_ID", "App path escapes the Workspace boundary");
  }
}

function appError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
