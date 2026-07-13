import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./config.mjs";

export function backupPolicy(config) {
  return {
    enabled: config.env.PRIVATE_SITE_BACKUP_ENABLED !== "0",
    intervalHours: boundedInteger(config.env.PRIVATE_SITE_BACKUP_INTERVAL_HOURS, 24, 1, 168),
    retentionCount: boundedInteger(config.env.PRIVATE_SITE_BACKUP_RETENTION_COUNT, 7, 1, 90),
    fullRecovery: config.env.PRIVATE_SITE_BACKUP_FULL_RECOVERY === "1",
  };
}

export function readBackupState(config) {
  const policy = backupPolicy(config);
  const statePath = path.join(config.runtimeDir, "backup-state.json");
  try { return { ...policy, ...JSON.parse(fs.readFileSync(statePath, "utf8")) }; }
  catch { return { ...policy, status: policy.enabled ? "pending" : "disabled" }; }
}

export function isBackupDue(config, now = new Date()) {
  const policy = backupPolicy(config);
  if (!policy.enabled) return false;
  const state = readBackupState(config);
  const lastSuccess = Date.parse(state.lastSuccessAt || "");
  return !Number.isFinite(lastSuccess) || now.getTime() - lastSuccess >= policy.intervalHours * 60 * 60 * 1000;
}

export async function runScheduledBackup(config, options = {}) {
  const policy = backupPolicy(config);
  if (!policy.enabled) return { ok: true, skipped: "disabled", ...policy };
  const now = options.now || new Date();
  const statePath = path.join(config.runtimeDir, "backup-state.json");
  const lockPath = path.join(config.runtimeDir, "backup.lock");
  fs.mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
  const lock = acquireBackupLock(lockPath);
  if (lock === null) return { ok: true, skipped: "already-running", ...policy };

  const previous = readBackupState(config);
  const startedAt = now.toISOString();
  writeJsonAtomic(statePath, { ...policy, status: "running", lastAttemptAt: startedAt, lastSuccessAt: previous.lastSuccessAt || null });
  try {
    const archivePath = path.join(config.dataRoot, "backups", `private-site-auto-${fileTimestamp(now)}.psb`);
    const createBackup = options.createBackup || (await import("./backup.mjs")).createEncryptedBackup;
    const backup = await createBackup(config, { outputPath: archivePath, fullRecovery: policy.fullRecovery, online: true });
    const retained = pruneScheduledBackups(config, policy.retentionCount);
    const state = {
      ...policy,
      status: "ok",
      lastAttemptAt: startedAt,
      lastSuccessAt: new Date().toISOString(),
      archiveName: path.basename(backup.archivePath || archivePath),
      bytes: Number(backup.bytes || 0),
      sha256: String(backup.sha256 || ""),
      retained,
    };
    writeJsonAtomic(statePath, state);
    return { ok: true, ...state };
  } catch (error) {
    writeJsonAtomic(statePath, {
      ...policy,
      status: "failed",
      lastAttemptAt: startedAt,
      lastSuccessAt: previous.lastSuccessAt || null,
      error: String(error?.message || error).slice(0, 500),
    });
    throw error;
  } finally {
    try { fs.closeSync(lock); } catch {}
    fs.rmSync(lockPath, { force: true });
  }
}

export function startBackupScheduler(config, { logger = console, initialDelayMs = 60_000 } = {}) {
  const policy = backupPolicy(config);
  if (!policy.enabled) return { enabled: false, stop() {} };
  let timer = null;
  let stopped = false;
  const intervalMs = policy.intervalHours * 60 * 60 * 1000;
  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        if (isBackupDue(config)) {
          const result = await runScheduledBackup(config);
          logger.log(`[private-site-node] scheduled backup completed archive=${result.archiveName || "none"}`);
        }
      } catch (error) {
        logger.error(`[private-site-node] scheduled backup failed: ${error.message}`);
      } finally {
        schedule(intervalMs);
      }
    }, delay);
    timer.unref?.();
  };
  const state = readBackupState(config);
  const lastSuccess = Date.parse(state.lastSuccessAt || "");
  const nextDelay = isBackupDue(config)
    ? initialDelayMs
    : Math.max(1_000, lastSuccess + intervalMs - Date.now());
  schedule(nextDelay);
  return {
    enabled: true,
    intervalHours: policy.intervalHours,
    retentionCount: policy.retentionCount,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

function pruneScheduledBackups(config, retentionCount) {
  const directory = path.join(config.dataRoot, "backups");
  if (!fs.existsSync(directory)) return 0;
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^private-site-auto-\d{8}T\d{6}Z\.psb$/.test(entry.name))
    .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name), mtime: fs.statSync(path.join(directory, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  for (const entry of files.slice(retentionCount)) fs.rmSync(entry.path, { force: true });
  return Math.min(files.length, retentionCount);
}

function acquireBackupLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(handle, `${process.pid}\n`, "utf8");
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = Number(readText(lockPath));
      if (processExists(owner)) return null;
      fs.rmSync(lockPath, { force: true });
    }
  }
  return null;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, "utf8").trim(); }
  catch { return ""; }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value || fallback);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function fileTimestamp(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
