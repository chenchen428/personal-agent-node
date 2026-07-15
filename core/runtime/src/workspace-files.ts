import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type WorkspaceFileConfig = { dataRoot: string; agentWorkspaceRoot: string };

export function ensureWorkspaceFiles(config: WorkspaceFileConfig) {
  const workspaceFiles = path.resolve(config.dataRoot, "files");
  const legacyFiles = path.resolve(config.agentWorkspaceRoot, ".local", "files");
  fs.mkdirSync(workspaceFiles, { recursive: true, mode: 0o700 });
  let migrated = 0;
  if (legacyFiles !== workspaceFiles && fs.statSync(legacyFiles, { throwIfNoEntry: false })?.isDirectory()) {
    assertMergeSafe(legacyFiles, workspaceFiles);
    migrated = mergeDirectory(legacyFiles, workspaceFiles);
    fs.rmSync(path.resolve(config.agentWorkspaceRoot, ".local"), { recursive: true, force: true });
  }
  for (const name of ["inbound", "managed", "materialized"]) fs.mkdirSync(path.join(workspaceFiles, name), { recursive: true, mode: 0o700 });
  return { dataFiles: workspaceFiles, workspaceFiles, linked: false, migrated };
}

function assertMergeSafe(source: string, target: string) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Workspace migration does not accept nested links: ${sourcePath}`);
    if (!fs.existsSync(targetPath)) continue;
    const targetEntry = fs.lstatSync(targetPath);
    if (entry.isDirectory() && targetEntry.isDirectory()) assertMergeSafe(sourcePath, targetPath);
    else if (!(entry.isFile() && targetEntry.isFile() && sameFile(sourcePath, targetPath))) throw new Error(`Workspace migration conflict: ${targetPath}`);
  }
}

function mergeDirectory(source: string, target: string): number {
  let migrated = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (!fs.existsSync(targetPath)) {
      moveEntry(sourcePath, targetPath);
      migrated += countFiles(targetPath);
    } else if (entry.isDirectory()) {
      migrated += mergeDirectory(sourcePath, targetPath);
      fs.rmdirSync(sourcePath);
    } else {
      fs.rmSync(sourcePath);
    }
  }
  return migrated;
}

function moveEntry(source: string, target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.renameSync(source, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function countFiles(root: string): number {
  const stat = fs.lstatSync(root);
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(root).reduce((count, name) => count + countFiles(path.join(root, name)), 0);
}

function sameFile(left: string, right: string) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  return leftStat.size === rightStat.size && digest(left) === digest(right);
}

function digest(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
