import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import archiver from "archiver";

const jobs = new Map();

export function startDataExport(dataRoot) {
  const id = `export-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const job = { id, state: "running", progress: 1, createdAt: new Date().toISOString() };
  jobs.set(id, job);
  void createArchive(path.resolve(dataRoot), job);
  return publicJob(job);
}

export function getDataExport(id) {
  return jobs.has(id) ? publicJob(jobs.get(id)) : null;
}

async function createArchive(dataRoot, job) {
  const outputDir = path.join(dataRoot, "exports");
  const target = path.join(outputDir, `${job.id}.zip`);
  const temporary = `${target}.partial`;
  const databaseSnapshot = path.join(outputDir, `.${job.id}-databases`);
  try {
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const databaseFiles = await snapshotDatabases(dataRoot, databaseSnapshot, job);
    const output = fs.createWriteStream(temporary, { mode: 0o600 });
    const archive = archiver("zip", { zlib: { level: 6 } });
    const completed = new Promise((resolve, reject) => {
      output.once("close", resolve);
      output.once("error", reject);
      archive.once("error", reject);
    });
    archive.on("progress", ({ entries }) => {
      const total = Math.max(1, entries.total || 1);
      job.progress = Math.min(94, 10 + Math.round((entries.processed / total) * 84));
    });
    archive.pipe(output);
    appendDirectory(archive, path.join(dataRoot, "mail"), "邮件");
    appendDirectory(archive, path.join(dataRoot, "publications"), "发布页");
    appendDirectory(archive, databaseSnapshot, "数据库");
    archive.append(`${JSON.stringify(readPlanningHistory(path.join(databaseSnapshot, "bridge", "state.sqlite")), null, 2)}\n`, { name: "历史规划/规划记录.json" });
    archive.append(`${JSON.stringify({
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      includes: ["邮件", "发布页", "历史规划", "数据库"],
      databaseFiles,
      databaseConsistency: "SQLite 在线备份快照；WAL/SHM 已合并到对应数据库文件",
      excludes: ["密钥与访问令牌", "Cookie 与登录凭据", "运行日志", "临时文件"],
    }, null, 2)}\n`, { name: "导出说明.json" });
    await archive.finalize();
    await completed;
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch {}
    Object.assign(job, { state: "completed", progress: 100, completedAt: new Date().toISOString(), path: target, fileName: path.basename(target), bytes: fs.statSync(target).size });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    Object.assign(job, { state: "failed", progress: 100, error: error instanceof Error ? error.message : String(error) });
  } finally {
    fs.rmSync(databaseSnapshot, { recursive: true, force: true });
  }
}

function appendDirectory(archive, source, destination) {
  if (fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) archive.directory(source, destination, false);
  else archive.append("该类别暂无数据。\n", { name: `${destination}/README.txt` });
}

async function snapshotDatabases(dataRoot, targetRoot, job) {
  const sourceRoot = path.join(dataRoot, "databases");
  const sources = listSqliteFiles(sourceRoot);
  fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  const exported = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const relative = path.relative(sourceRoot, source);
    const target = path.join(targetRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(source, { readOnly: true });
    try { await sqliteBackup(database, target); } finally { database.close(); }
    const snapshot = new DatabaseSync(target);
    try {
      snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      snapshot.exec("PRAGMA journal_mode=DELETE");
      if (String(snapshot.prepare("PRAGMA integrity_check").get().integrity_check || "") !== "ok") throw new Error(`SQLite 快照校验失败：${relative}`);
    } finally { snapshot.close(); }
    fs.rmSync(`${target}-wal`, { force: true });
    fs.rmSync(`${target}-shm`, { force: true });
    exported.push(relative.replaceAll("\\", "/"));
    job.progress = Math.max(job.progress, 2 + Math.round(((index + 1) / Math.max(1, sources.length)) * 7));
  }
  if (!exported.length) fs.writeFileSync(path.join(targetRoot, "README.txt"), "当前工作区暂无 SQLite 用户数据库。\n", { mode: 0o600 });
  else fs.writeFileSync(path.join(targetRoot, "README.txt"), "这些文件是导出时创建的一致性 SQLite 快照；运行中的 WAL/SHM 内容已合并，无需单独携带。\n", { mode: 0o600 });
  return exported;
}

function listSqliteFiles(root) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && !/-(?:wal|shm)$/i.test(entry.name) && isSqlite(target)) files.push(target);
    }
  };
  visit(root);
  return files.sort();
}

function isSqlite(filePath) {
  const handle = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    return fs.readSync(handle, header, 0, 16, 0) === 16 && header.toString("binary") === "SQLite format 3\u0000";
  } finally { fs.closeSync(handle); }
}

function readPlanningHistory(databasePath) {
  if (!fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) return { schemaVersion: 1, exportedAt: new Date().toISOString(), plans: [] };
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const sessions = database.prepare("SELECT id, parent_session_id, role, status, title, task_description, summary, created_at, updated_at FROM sessions ORDER BY created_at").all();
    const events = database.prepare("SELECT session_id, payload_json, created_at FROM events ORDER BY session_id, seq").all();
    const updates = new Map();
    for (const event of events) {
      try {
        const payload = JSON.parse(String(event.payload_json || "{}"));
        if (payload?.metadata?.eventType !== "turn/plan/updated" || !Array.isArray(payload.metadata.plan)) continue;
        const list = updates.get(event.session_id) || [];
        list.push({ createdAt: event.created_at, steps: payload.metadata.plan });
        updates.set(event.session_id, list);
      } catch {}
    }
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      plans: sessions.filter((session) => updates.has(session.id)).map((session) => ({
        sessionId: session.id,
        parentSessionId: session.parent_session_id || null,
        role: session.role,
        status: session.status,
        title: session.title,
        taskDescription: session.task_description,
        summary: session.summary,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        updates: updates.get(session.id),
      })),
    };
  } finally {
    database.close();
  }
}

function publicJob(job) {
  return { ...job, revealUrl: job.state === "completed" ? `/__personal-agent/reveal-export?id=${encodeURIComponent(job.id)}` : undefined };
}
