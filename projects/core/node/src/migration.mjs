import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureNodeDirectories, writeJsonAtomic } from "./config.mjs";

export function importLegacyData({ config, sourceDir, phase = "preflight" }) {
  if (!["preflight", "final"].includes(phase)) throw new Error("Migration phase must be preflight or final");
  const source = path.resolve(sourceDir);
  if (!fs.statSync(source).isDirectory()) throw new Error("Legacy migration source is not a directory");
  ensureNodeDirectories(config);

  const mappings = [
    ["open-agent-bridge", path.join(config.dataRoot, "databases", "bridge")],
    [path.join("open-agent-bridge", "data"), path.join(config.dataRoot, "databases", "agent-data")],
    [path.join("open-agent-bridge", "automations"), path.join(config.dataRoot, "databases", "automations")],
    [path.join("open-agent-bridge", "pages"), path.join(config.dataRoot, "publications", "pages")],
    [path.join("open-agent-bridge", "uploads"), path.join(config.dataRoot, "files", "managed")],
    [path.join("open-agent-bridge", "materialized"), path.join(config.dataRoot, "files", "materialized")],
    [path.join("open-agent-bridge", "private-publications"), path.join(config.dataRoot, "publications", "private")],
    [path.join("open-agent-bridge", "mail-ingress"), config.mailDir],
    ["mail-ingress", config.mailDir],
    ["channels", path.join(config.dataRoot, "channels")],
    ["files", path.join(config.dataRoot, "files", "inbound")],
    ["wechat-bridge", path.join(config.dataRoot, "channels", "wechat")],
    ["workspace-admin", path.join(config.dataRoot, "databases", "workspace-admin")],
  ];
  for (const [relativeSource, target] of mappings) {
    const candidate = path.join(source, relativeSource);
    if (!fs.existsSync(candidate)) continue;
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(candidate, target, { recursive: true, force: true, errorOnExist: false });
  }
  const legacyToolsDatabase = path.join(source, "personal-agent.local.sqlite");
  if (fs.existsSync(legacyToolsDatabase)) {
    fs.copyFileSync(legacyToolsDatabase, path.join(config.dataRoot, "databases", "tools", "lmt-tools.sqlite"));
  }

  const databases = listFiles(config.dataRoot).filter((filePath) => /\.(?:sqlite|db)$/i.test(filePath));
  const integrity = databases.map((filePath) => sqliteIntegrity(filePath, config.dataRoot));
  const failed = integrity.filter((result) => !result.ok);
  if (failed.length) throw new Error(`SQLite integrity failed for: ${failed.map((item) => item.path).join(", ")}`);

  const manifest = {
    schemaVersion: 1,
    phase,
    importedAt: new Date().toISOString(),
    sourceLabel: path.basename(source),
    files: listFiles(config.dataRoot)
      .filter((filePath) => !isExcludedFromManifest(filePath, config))
      .map((filePath) => ({
        path: path.relative(config.dataRoot, filePath).replaceAll("\\", "/"),
        size: fs.statSync(filePath).size,
        sha256: sha256File(filePath),
      })),
    sqliteIntegrity: integrity,
  };
  const manifestPath = path.join(config.dataRoot, "snapshots", `migration-${phase}-manifest.json`);
  writeJsonAtomic(manifestPath, manifest, 0o600);
  return {
    ok: true,
    phase,
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, entry) => total + entry.size, 0),
    databases: integrity.length,
    manifestPath,
  };
}

function sqliteIntegrity(filePath, dataRoot) {
  try {
    const database = new DatabaseSync(filePath, { readOnly: true });
    const result = database.prepare("PRAGMA integrity_check").get();
    database.close();
    const value = String(result.integrity_check || "");
    return { path: path.relative(dataRoot, filePath).replaceAll("\\", "/"), ok: value === "ok", result: value };
  } catch (error) {
    return { path: path.relative(dataRoot, filePath).replaceAll("\\", "/"), ok: false, result: error.message };
  }
}

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) files.push(filePath);
    }
  };
  walk(root);
  return files.sort();
}

function isExcludedFromManifest(filePath, config) {
  const relative = path.relative(config.dataRoot, filePath);
  return relative.startsWith(`logs${path.sep}`)
    || relative.startsWith(`runtime${path.sep}`)
    || relative.startsWith(`backups${path.sep}`)
    || relative.startsWith(`snapshots${path.sep}`)
    || relative.startsWith(`secrets${path.sep}`)
    || relative.endsWith(".log");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
