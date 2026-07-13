import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureWorkspaceFiles(config) {
  const workspaceFiles = path.resolve(config.agentWorkspaceRoot, ".local", "files");
  const dataFiles = path.resolve(config.dataRoot, "files");
  if (workspaceFiles === dataFiles) {
    fs.mkdirSync(workspaceFiles, { recursive: true });
    ensureFileDirectories(workspaceFiles);
    return { dataFiles, workspaceFiles, linked: false, migrated: 0 };
  }

  fs.mkdirSync(workspaceFiles, { recursive: true });
  if (isPointer(dataFiles)) {
    const actual = fs.realpathSync.native(dataFiles);
    const expected = fs.realpathSync.native(workspaceFiles);
    if (!samePath(actual, expected)) {
      throw new Error(`Site file root points to an unexpected directory: ${dataFiles}`);
    }
    ensureFileDirectories(workspaceFiles);
    return { dataFiles, workspaceFiles, linked: true, migrated: 0 };
  }

  fs.mkdirSync(dataFiles, { recursive: true });
  assertMergeSafe(dataFiles, workspaceFiles);
  const migrated = mergeDirectory(dataFiles, workspaceFiles);
  fs.rmdirSync(dataFiles);
  fs.symlinkSync(
    process.platform === "win32" ? workspaceFiles : path.relative(path.dirname(dataFiles), workspaceFiles),
    dataFiles,
    process.platform === "win32" ? "junction" : "dir",
  );
  ensureFileDirectories(workspaceFiles);
  return { dataFiles, workspaceFiles, linked: true, migrated };
}

function ensureFileDirectories(root) {
  for (const name of ["inbound", "managed", "materialized"]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
}

function isPointer(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function assertMergeSafe(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Site file migration does not accept nested links: ${sourcePath}`);
    if (!fs.existsSync(targetPath)) continue;
    const targetEntry = fs.lstatSync(targetPath);
    if (entry.isDirectory() && targetEntry.isDirectory()) {
      assertMergeSafe(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && targetEntry.isFile() && sameFile(sourcePath, targetPath)) continue;
    throw new Error(`Site file migration conflict: ${targetPath}`);
  }
}

function mergeDirectory(source, target) {
  let migrated = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (!fs.existsSync(targetPath)) {
      moveEntry(sourcePath, targetPath);
      migrated += countFiles(targetPath);
      continue;
    }
    if (entry.isDirectory()) {
      migrated += mergeDirectory(sourcePath, targetPath);
      fs.rmdirSync(sourcePath);
    } else {
      fs.rmSync(sourcePath);
    }
  }
  return migrated;
}

function moveEntry(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function countFiles(root) {
  const stat = fs.lstatSync(root);
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(root).reduce((count, name) => count + countFiles(path.join(root, name)), 0);
}

function sameFile(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (leftStat.size !== rightStat.size) return false;
  return digest(left) === digest(right);
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
