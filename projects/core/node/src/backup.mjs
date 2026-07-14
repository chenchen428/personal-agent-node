import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

const magic = Buffer.from("PRIVATE-SITE-BACKUP\n", "ascii");

export async function createEncryptedBackup(config, { outputPath, keyFile, fullRecovery = false, online = false }) {
  const archivePath = path.resolve(outputPath || path.join(config.dataRoot, "backups", `private-site-${timestamp()}.psb`));
  const recoveryKeyPath = path.resolve(keyFile || path.join(os.homedir(), ".private-site-recovery", `${config.site.siteId}.key`));
  const recoveryKey = ensureRecoveryKey(recoveryKeyPath);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-backup-"));
  const payloadRoot = path.join(staging, "payload");
  const tarPath = path.join(staging, "payload.tar");
  try {
    fs.mkdirSync(payloadRoot, { recursive: true });
    const roots = ["config", "databases", "files", "mail", "publications"];
    if (fullRecovery) roots.push("secrets", "channels", "extensions");
    for (const name of roots) {
      const source = path.join(config.dataRoot, name);
      if (fs.existsSync(source)) await snapshotTree(source, path.join(payloadRoot, name));
    }
    const files = fileManifest(payloadRoot);
    const manifest = {
      schemaVersion: 1,
      siteId: config.site.siteId,
      nodeId: config.site.nodeId,
      domain: config.domain,
      distributionVersion: config.site.distributionVersion,
      createdAt: new Date().toISOString(),
      fullRecovery,
      online,
      includedRoots: roots,
      excludedRoots: ["backups", "logs", "runtime", "snapshots", ...(!fullRecovery ? ["secrets", "channels", "extensions"] : [])],
      files,
    };
    fs.writeFileSync(path.join(payloadRoot, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    runTar(["-cf", tarPath, "-C", payloadRoot, "."]);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    await encryptFile(tarPath, archivePath, recoveryKey, {
      schemaVersion: 1,
      siteId: config.site.siteId,
      createdAt: manifest.createdAt,
      fullRecovery,
    });
    return {
      ok: true,
      archivePath,
      keyFile: recoveryKeyPath,
      fullRecovery,
      online,
      files: files.length,
      bytes: fs.statSync(archivePath).size,
      sha256: sha256File(archivePath),
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function verifyEncryptedBackup(config, { archivePath, keyFile, targetDir }) {
  const archive = path.resolve(archivePath);
  const target = path.resolve(targetDir || path.join(config.dataRoot, "snapshots", `restore-drill-${timestamp()}`));
  const result = await extractValidatedBackup({
    archive,
    keyFile,
    target,
    expectedSiteId: config.site.siteId,
    expectedDistributionVersion: config.site.distributionVersion,
  });
  fs.writeFileSync(path.join(target, "restore-verification.json"), `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  return result.report;
}

export async function restoreEncryptedBackup({ archivePath, keyFile, targetDataRoot, replacement = false, expectedDistributionVersion }) {
  const archive = path.resolve(archivePath);
  const target = path.resolve(targetDataRoot);
  assertEmptyTarget(target);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-restore-apply-"));
  const payload = path.join(staging, "payload");
  const activation = `${target}.${process.pid}.restoring`;
  if (fs.existsSync(activation)) throw new Error("Restore activation path already exists");
  try {
    const result = await extractValidatedBackup({
      archive,
      keyFile,
      target: payload,
      expectedDistributionVersion,
      requireFullRecovery: replacement,
    });
    const sitePath = path.join(payload, "config", "site.json");
    if (!fs.existsSync(sitePath)) throw new Error("Backup does not contain Site configuration");
    const site = JSON.parse(fs.readFileSync(sitePath, "utf8"));
    if (site.siteId !== result.manifest.siteId || site.asciiDomain !== result.manifest.domain) {
      throw new Error("Backup Site configuration does not match its manifest");
    }
    let replacementState = null;
    if (replacement) {
      const previousNodeId = String(site.nodeId || result.manifest.nodeId || "");
      if (!previousNodeId) throw new Error("Replacement backup is missing its previous Node identity");
      site.nodeId = `node_${crypto.randomBytes(12).toString("base64url")}`;
      site.replacedAt = new Date().toISOString();
      fs.writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`, { mode: 0o600 });
      fs.rmSync(path.join(payload, "secrets", "node-identity"), { recursive: true, force: true });
      replacementState = {
        schemaVersion: 1,
        status: "pending-edge-replacement",
        siteId: site.siteId,
        domain: site.asciiDomain,
        previousNodeId,
        nodeId: site.nodeId,
        restoredAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(payload, "config", "replacement.json"), `${JSON.stringify(replacementState, null, 2)}\n`, { mode: 0o600 });
    }
    fs.rmSync(path.join(payload, "backup-manifest.json"), { force: true });
    fs.mkdirSync(activation, { recursive: true, mode: 0o700 });
    fs.cpSync(payload, activation, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    const report = {
      ...result.report,
      target,
      replacement,
      siteId: site.siteId,
      domain: site.asciiDomain,
      previousNodeId: replacementState?.previousNodeId || null,
      nodeId: site.nodeId,
    };
    const reportName = `restore-apply-${timestamp()}.json`;
    const activationReportPath = path.join(activation, "snapshots", reportName);
    fs.mkdirSync(path.dirname(activationReportPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(activationReportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(activation, target);
    return { ...report, reportPath: path.join(target, "snapshots", reportName) };
  } catch (error) {
    fs.rmSync(activation, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function extractValidatedBackup({ archive, keyFile, target, expectedSiteId, expectedDistributionVersion, requireFullRecovery = false }) {
  assertEmptyTarget(target);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const recoveryKey = fs.readFileSync(path.resolve(keyFile), "utf8").trim();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-restore-"));
  const tarPath = path.join(staging, "payload.tar");
  try {
    const header = await decryptFile(archive, tarPath, recoveryKey);
    if (header.schemaVersion !== 1 || header.algorithm !== "aes-256-gcm" || header.kdf !== "scrypt") throw new Error("Unsupported backup envelope");
    validateTarEntries(tarPath);
    runTar(["-xf", tarPath, "-C", target]);
    const manifestPath = path.join(target, "backup-manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("Backup manifest is missing");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error("Unsupported backup manifest");
    if (header.siteId !== manifest.siteId) throw new Error("Backup envelope and manifest Site identities differ");
    if (expectedSiteId && manifest.siteId !== expectedSiteId) throw new Error("Backup belongs to a different Site");
    if (expectedDistributionVersion && manifest.distributionVersion !== expectedDistributionVersion) throw new Error("Backup distribution version is incompatible");
    if (requireFullRecovery && manifest.fullRecovery !== true) throw new Error("Replacement restore requires a full-recovery backup");
    const failures = [];
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== "string" || !Number.isInteger(entry.size) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new Error("Backup manifest contains an invalid file entry");
      }
      const filePath = safeJoin(target, entry.path);
      if (!fs.existsSync(filePath)) failures.push({ path: entry.path, error: "missing" });
      else if (fs.statSync(filePath).size !== entry.size) failures.push({ path: entry.path, error: "size" });
      else if (sha256File(filePath) !== entry.sha256) failures.push({ path: entry.path, error: "sha256" });
    }
    if (failures.length) throw new Error(`Restore validation failed for ${failures.length} file(s)`);
    const sqlite = [];
    for (const entry of manifest.files.filter((candidate) => /\.(?:sqlite|db)$/i.test(candidate.path))) {
      const filePath = safeJoin(target, entry.path);
      try {
        const database = new DatabaseSync(filePath, { readOnly: true });
        const value = String(database.prepare("PRAGMA integrity_check").get().integrity_check || "");
        database.close();
        sqlite.push({ path: entry.path, ok: value === "ok" });
      } catch {
        // Non-SQLite browser databases with a .db suffix remain hash-verified.
      }
    }
    if (sqlite.some((entry) => !entry.ok)) throw new Error("Restored SQLite integrity check failed");
    return {
      manifest,
      report: {
        ok: true,
        verifiedAt: new Date().toISOString(),
        archivePath: archive,
        archiveSha256: sha256File(archive),
        target,
        files: manifest.files.length,
        sqliteChecked: sqlite.length,
        fullRecovery: manifest.fullRecovery === true,
        distributionVersion: manifest.distributionVersion,
      },
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function snapshotTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await snapshotTree(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || /-(?:wal|shm)$/.test(entry.name)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (isSqlite(sourcePath)) {
      const database = new DatabaseSync(sourcePath, { readOnly: true });
      try { await sqliteBackup(database, targetPath); } finally { database.close(); }
    } else fs.copyFileSync(sourcePath, targetPath);
  }
}

function fileManifest(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) files.push({
        path: path.relative(root, filePath).replaceAll("\\", "/"),
        size: fs.statSync(filePath).size,
        sha256: sha256File(filePath),
      });
    }
  };
  walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function encryptFile(source, target, recoveryKey, metadata) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(recoveryKey, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const header = Buffer.from(JSON.stringify({
    ...metadata,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
  }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.rmSync(temporary, { force: true });
  const output = fs.createWriteStream(temporary, { mode: 0o600 });
  try {
    output.write(magic);
    output.write(length);
    output.write(header);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    for await (const chunk of fs.createReadStream(source)) await writeChunk(output, cipher.update(chunk));
    await writeChunk(output, cipher.final());
    await writeChunk(output, cipher.getAuthTag());
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    fs.renameSync(temporary, target);
  } catch (error) {
    output.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function decryptFile(source, target, recoveryKey) {
  const handle = fs.openSync(source, "r");
  try {
    const prefix = Buffer.alloc(magic.length + 4);
    fs.readSync(handle, prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, magic.length).equals(magic)) throw new Error("Not a Private Site backup");
    const headerLength = prefix.readUInt32BE(magic.length);
    const headerBuffer = Buffer.alloc(headerLength);
    fs.readSync(handle, headerBuffer, 0, headerLength, prefix.length);
    const header = JSON.parse(headerBuffer.toString("utf8"));
    const stat = fs.fstatSync(handle);
    const tag = Buffer.alloc(16);
    fs.readSync(handle, tag, 0, 16, stat.size - 16);
    const key = crypto.scryptSync(recoveryKey, Buffer.from(header.salt, "base64"), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAuthTag(tag);
    const output = fs.createWriteStream(target, { mode: 0o600 });
    const start = prefix.length + headerLength;
    for await (const chunk of fs.createReadStream(source, { start, end: stat.size - 17 })) await writeChunk(output, decipher.update(chunk));
    await writeChunk(output, decipher.final());
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    return header;
  } finally {
    fs.closeSync(handle);
  }
}

function ensureRecoveryKey(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `${crypto.randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  const value = fs.readFileSync(filePath, "utf8").trim();
  if (value.length < 32) throw new Error("Backup recovery key is too short");
  return value;
}

function runTar(args) {
  const command = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`tar failed with status ${result.status}`);
}

function validateTarEntries(tarPath) {
  const command = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const result = spawnSync(command, ["-tf", tarPath], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`tar listing failed with status ${result.status}`);
  for (const raw of String(result.stdout || "").split(/\r?\n/)) {
    const entry = raw.replace(/^\.\//, "");
    if (!entry) continue;
    const normalized = entry.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
      throw new Error("Backup archive contains an unsafe path");
    }
  }
}

function assertEmptyTarget(target) {
  if (!fs.existsSync(target)) return;
  if (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length) throw new Error("Restore target must be an empty directory");
}

function isSqlite(filePath) {
  const handle = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    return fs.readSync(handle, header, 0, 16, 0) === 16 && header.toString("binary") === "SQLite format 3\u0000";
  } finally {
    fs.closeSync(handle);
  }
}

function safeJoin(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Backup manifest path escapes restore root");
  return target;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeChunk(stream, chunk) {
  if (!chunk.length || stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => stream.once("drain", resolve));
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
