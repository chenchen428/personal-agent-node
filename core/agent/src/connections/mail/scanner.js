import fs from "node:fs";
import path from "node:path";

const MINUTE_MS = 60_000;
const OVERLAP_MS = 5_000;

export class MailConnectionScanner {
  constructor({ dataDir, processMessage, logger = console, now = () => Date.now(), intervalMs = MINUTE_MS, overlapMs = OVERLAP_MS } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.processMessage = processMessage;
    this.logger = logger;
    this.now = now;
    this.intervalMs = Math.max(Number(intervalMs) || MINUTE_MS, 1_000);
    this.overlapMs = Math.max(Number(overlapMs) || OVERLAP_MS, 0);
    this.statePath = path.join(this.dataDir, "scanner", "state.json");
    this.timer = null;
    this.running = null;
    this.lastResult = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan().catch((error) => this.logger.error?.(`[mail-connection] interval scan failed: ${safeError(error)}`)), this.intervalMs);
    this.timer.unref?.();
    void this.scan();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  scan() {
    if (this.running) return this.running;
    this.running = this.runScan().finally(() => { this.running = null; });
    return this.running;
  }

  status() {
    const state = readJson(this.statePath) || {};
    return {
      state: "connected",
      statusLabel: "本地已连接",
      details: {
        intervalSeconds: Math.round(this.intervalMs / 1000),
        cursorAt: state.cursorAt || "",
        lastScan: this.lastResult,
      },
      runtime: [
        { label: "检查频率", value: `每 ${Math.round(this.intervalMs / 1000)} 秒` },
        { label: "扫描区间", value: state.cursorAt ? "上次成功游标至本次检查" : "首次启动至本次检查" },
      ],
    };
  }

  async runScan() {
    const endMs = this.now();
    const state = readJson(this.statePath) || {};
    const previousMs = Date.parse(String(state.cursorAt || ""));
    const startMs = Number.isFinite(previousMs) ? Math.max(0, previousMs - this.overlapMs) : endMs - this.intervalMs - this.overlapMs;
    const manifests = findManifests(path.join(this.dataDir, "archive"), startMs, endMs);
    let processed = 0;
    let deduplicated = 0;
    for (const manifest of manifests) {
      const result = await this.processMessage(readJson(manifest));
      if (result?.deduplicated) deduplicated += 1;
      else processed += 1;
    }
    const next = { schemaVersion: 1, cursorAt: new Date(endMs).toISOString(), updatedAt: new Date(endMs).toISOString() };
    writeJsonAtomic(this.statePath, next);
    this.lastResult = { startAt: new Date(startMs).toISOString(), endAt: next.cursorAt, found: manifests.length, processed, deduplicated };
    return this.lastResult;
  }
}

function findManifests(archiveRoot, startMs, endMs) {
  if (!fs.existsSync(archiveRoot)) return [];
  const results = [];
  for (const day of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    const dir = path.join(archiveRoot, day.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(dir, entry.name);
      const receivedMs = Date.parse(String(readJson(file)?.receivedAt || ""));
      if (Number.isFinite(receivedMs) && receivedMs > startMs && receivedMs <= endMs) results.push(file);
    }
  }
  return results.sort((left, right) => Date.parse(readJson(left)?.receivedAt || "") - Date.parse(readJson(right)?.receivedAt || ""));
}

function readJson(filePath) {
  if (!filePath) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 240);
}
