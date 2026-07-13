#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function pruneLocalDist(releasesRoot, { keep = 2, preserve = [] } = {}) {
  const root = path.resolve(releasesRoot);
  if (!Number.isInteger(keep) || keep < 1) throw new Error("Local dist retention must be at least one release");
  if (!fs.existsSync(root)) return { root, keep, retained: [], removed: [] };
  const preserved = new Set(preserve.map((entry) => path.resolve(entry)));
  const releases = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const releasePath = path.resolve(root, entry.name);
      assertDirectChild(root, releasePath);
      const completed = fs.existsSync(path.join(releasePath, "release-manifest.json"))
        && fs.existsSync(path.join(releasePath, "SHA256SUMS"));
      return { name: entry.name, path: releasePath, mtimeMs: fs.statSync(releasePath).mtimeMs, completed };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  const completed = releases.filter((release) => release.completed);
  for (const candidate of preserved) {
    if (!completed.some((release) => release.path === candidate)) throw new Error(`Cannot preserve incomplete dist release: ${candidate}`);
  }
  const retainedPaths = new Set([...preserved]);
  for (const release of completed) {
    if (retainedPaths.size >= keep) break;
    retainedPaths.add(release.path);
  }
  const removed = [];
  for (const release of releases) {
    if (retainedPaths.has(release.path)) continue;
    assertDirectChild(root, release.path);
    fs.rmSync(release.path, { recursive: true, force: true });
    removed.push(release.name);
  }
  return {
    root,
    keep,
    retained: releases.filter((entry) => retainedPaths.has(entry.path)).map((entry) => entry.name),
    removed,
  };
}

function assertDirectChild(root, candidate) {
  if (path.dirname(candidate) !== root || candidate === root) throw new Error(`Refusing to prune unsafe dist path: ${candidate}`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error("Usage: prune-local-dist.mjs <releases-root> [keep]");
  process.stdout.write(`${JSON.stringify(pruneLocalDist(root, { keep: Number(process.argv[3] || 2) }), null, 2)}\n`);
}
