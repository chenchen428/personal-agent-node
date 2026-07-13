// Unit tests for the bounded workspace file walker behind the workspace.files command.
// Run: node --test libs/cli/agent-bridge/test/workspace-files.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorkspaceFiles } from '../lib/workspace-files.mjs';

function makeWorkspace(build) {
  const root = mkdtempSync(join(tmpdir(), 'agent-bridge-ws-'));
  build(root);
  return root;
}

test('lists files recursively with workspace-relative paths', () => {
  const root = makeWorkspace((dir) => {
    writeFileSync(join(dir, 'readme.md'), 'hi');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'x');
  });
  try {
    const result = listWorkspaceFiles(root);
    assert.deepEqual(result.files.map((file) => file.path), ['readme.md', 'src/index.ts']);
    assert.equal(result.truncated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips dot entries and dependency/build dirs', () => {
  const root = makeWorkspace((dir) => {
    writeFileSync(join(dir, '.env'), 'secret');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref');
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
    writeFileSync(join(dir, 'app.ts'), 'x');
  });
  try {
    const result = listWorkspaceFiles(root);
    assert.deepEqual(result.files.map((file) => file.path), ['app.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('caps the file count and flags truncation', () => {
  const root = makeWorkspace((dir) => {
    for (let index = 0; index < 12; index += 1) writeFileSync(join(dir, `f${String(index).padStart(2, '0')}.txt`), 'x');
  });
  try {
    const result = listWorkspaceFiles(root, { maxFiles: 10 });
    assert.equal(result.files.length, 10);
    assert.equal(result.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('respects the depth cap', () => {
  const root = makeWorkspace((dir) => {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'a', 'shallow.txt'), 'x');
    writeFileSync(join(dir, 'a', 'b', 'deep.txt'), 'x');
  });
  try {
    const result = listWorkspaceFiles(root, { maxDepth: 2 });
    assert.deepEqual(result.files.map((file) => file.path), ['a/shallow.txt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
