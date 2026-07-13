import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Heavy build/dependency dirs are never interesting in the web file browser and can hold
// hundreds of thousands of entries; dot-entries (.git, .env, .DS_Store…) are skipped wholesale.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'target', '__pycache__']);
const MAX_FILES = 500;
const MAX_DEPTH = 6;

/**
 * Bounded breadth-first listing of a workspace directory for the web "所有文件" tab.
 * Returns { files: [{ path, size? }], truncated } with workspace-relative paths;
 * BFS keeps shallow entries when the MAX_FILES cap truncates a huge tree.
 */
export function listWorkspaceFiles(root, { maxFiles = MAX_FILES, maxDepth = MAX_DEPTH } = {}) {
  const files = [];
  const queue = [{ dir: root, rel: '', depth: 0 }];
  while (queue.length > 0) {
    const { dir, rel, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir (permissions, races): skip rather than fail the whole listing
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth + 1 < maxDepth) queue.push({ dir: join(dir, entry.name), rel: relPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) return { files, truncated: true };
      files.push({ path: relPath });
    }
  }
  return { files, truncated: false };
}
