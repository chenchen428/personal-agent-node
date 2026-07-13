import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { harnessLinks, materializeHarnessLinks, verifyHarnessLinks } from '../scripts/harness-links.mjs';
import { installPersonalAgentCommand } from '../scripts/personal-agent-command.mjs';

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

test('installed Harness uses real relative symlinks for every Agent client', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-links-'));
  try {
    fs.mkdirSync(path.join(releaseRoot, 'skills'));
    fs.writeFileSync(path.join(releaseRoot, 'AGENTS.md'), '# Agent\n');
    const links = materializeHarnessLinks(releaseRoot);
    assert.equal(links.length, 5);
    assert.deepEqual(verifyHarnessLinks(releaseRoot).map((entry) => entry.link), harnessLinks.map((entry) => entry.link));
    for (const spec of harnessLinks) {
      const link = path.join(releaseRoot, spec.link);
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true, spec.link);
      assert.equal(path.resolve(path.dirname(link), fs.readlinkSync(link)), path.resolve(path.dirname(link), spec.target));
    }
  } finally { fs.rmSync(releaseRoot, { recursive: true, force: true }); }
});

test('Windows link plan uses a file link and directory junctions', () => {
  const calls = [];
  const fileSystem = {
    mkdirSync() {}, rmSync() {}, symlinkSync(target, link, type) { calls.push({ target, link, type }); },
    lstatSync() { return { isSymbolicLink: () => true }; },
    readlinkSync(link) { return calls.find((entry) => entry.link === link).target; },
  };
  materializeHarnessLinks('C:\\personal-agent', { platform: 'win32', fileSystem });
  assert.equal(calls.find((entry) => entry.link.endsWith('CLAUDE.md')).type, 'file');
  assert.equal(calls.filter((entry) => entry.type === 'junction').length, 4);
});

test('installed personal-agent command follows the immutable current release', () => {
  const files = new Map();
  const fileSystem = { mkdirSync() {}, chmodSync() {}, writeFileSync(file, content) { files.set(file, content); } };
  const posix = installPersonalAgentCommand({ installRoot: '/home/user/.private-site-node', homeDir: '/home/user', platform: 'linux', fileSystem });
  assert.equal(posix.commandPath, '/home/user/.local/bin/personal-agent');
  assert.match(files.get(posix.commandPath), /current\/projects\/core\/node\/bin\/personal-agent\.mjs/);
  const windows = installPersonalAgentCommand({ installRoot: 'C:\\Users\\user\\.private-site-node', homeDir: 'C:\\Users\\user', platform: 'win32', env: { APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, fileSystem });
  assert.match(windows.commandPath, /personal-agent\.cmd$/);
  assert.match(files.get(windows.commandPath), /personal-agent\.mjs/);
});
