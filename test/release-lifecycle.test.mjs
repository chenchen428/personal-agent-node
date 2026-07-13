import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rollback atomically swaps current and previous immutable releases', () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-release-'));
  const releases = path.join(installRoot, 'releases');
  const first = path.join(releases, '0.0.1');
  const second = path.join(releases, '0.0.2');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(first, 'release-manifest.json'), JSON.stringify({ releaseId: '0.0.1', revision: 'first' }));
  fs.writeFileSync(path.join(second, 'release-manifest.json'), JSON.stringify({ releaseId: '0.0.2', revision: 'second' }));
  fs.symlinkSync(path.relative(installRoot, second), path.join(installRoot, 'current'), 'dir');
  fs.symlinkSync(path.relative(installRoot, first), path.join(installRoot, 'previous'), 'dir');
  const result = spawnSync(process.execPath, ['scripts/rollback-private-site-node-release.mjs', '--install-root', installRoot], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.realpathSync(path.join(installRoot, 'current')), fs.realpathSync(first));
  assert.equal(fs.realpathSync(path.join(installRoot, 'previous')), fs.realpathSync(second));
  const state = JSON.parse(fs.readFileSync(path.join(installRoot, 'installation.json'), 'utf8'));
  assert.equal(state.activeReleaseId, '0.0.1');
  fs.rmSync(installRoot, { recursive: true, force: true });
});
