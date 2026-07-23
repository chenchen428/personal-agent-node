import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { harnessLinks, materializeHarnessLinks, verifyHarnessLinks } from '../scripts/harness-links.mjs';
import { canonicalInstallRoot } from '../scripts/install-root.mjs';
import { installPersonalAgentCommand } from '../scripts/personal-agent-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('install roots resolve filesystem aliases before release pointers are created', () => {
  const temporaryRoot = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  const requested = fs.mkdtempSync(path.join(temporaryRoot, 'personal-agent-install-root-'));
  try {
    assert.equal(canonicalInstallRoot(requested), fs.realpathSync(requested));
  } finally {
    fs.rmSync(requested, { recursive: true, force: true });
  }
});

test('rollback atomically swaps current and previous immutable releases', () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-release-'));
  const releases = path.join(installRoot, 'releases');
  const first = path.join(releases, '0.0.1');
  const second = path.join(releases, '0.0.2');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(first, 'release-manifest.json'), JSON.stringify({ releaseId: '0.0.1', revision: 'first' }));
  fs.writeFileSync(path.join(second, 'release-manifest.json'), JSON.stringify({ releaseId: '0.0.2', revision: 'second' }));
  fs.symlinkSync(process.platform === 'win32' ? second : path.relative(installRoot, second), path.join(installRoot, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(process.platform === 'win32' ? first : path.relative(installRoot, first), path.join(installRoot, 'previous'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, ['scripts/rollback-private-site-node-release.mjs', '--install-root', installRoot], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.realpathSync(path.join(installRoot, 'current')), fs.realpathSync(first));
  assert.equal(fs.realpathSync(path.join(installRoot, 'previous')), fs.realpathSync(second));
  const state = JSON.parse(fs.readFileSync(path.join(installRoot, 'installation.json'), 'utf8'));
  assert.equal(state.activeReleaseId, '0.0.1');
  fs.rmSync(installRoot, { recursive: true, force: true });
});

test('repository development Harness supports verified compatibility links for Agent clients', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-links-'));
  try {
    fs.mkdirSync(path.join(releaseRoot, 'skills'));
    fs.writeFileSync(path.join(releaseRoot, 'AGENTS.md'), '# Agent\n');
    const links = materializeHarnessLinks(releaseRoot);
    const repeated = materializeHarnessLinks(releaseRoot);
    assert.equal(links.length, 5);
    assert.equal(repeated.length, 5);
    assert.deepEqual(verifyHarnessLinks(releaseRoot).map((entry) => entry.link), harnessLinks.map((entry) => entry.link));
    for (const spec of harnessLinks) {
      const link = path.join(releaseRoot, spec.link);
      if (process.platform === 'win32' && spec.kind === 'file') {
        const target = path.resolve(path.dirname(link), spec.target);
        const linkStat = fs.statSync(link, { bigint: true });
        const targetStat = fs.statSync(target, { bigint: true });
        assert.equal(linkStat.isFile(), true, spec.link);
        assert.equal(linkStat.dev, targetStat.dev, spec.link);
        assert.equal(linkStat.ino, targetStat.ino, spec.link);
        assert.ok(linkStat.nlink >= 2n, spec.link);
      } else {
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true, spec.link);
        assert.equal(path.resolve(path.dirname(link), fs.readlinkSync(link)), path.resolve(path.dirname(link), spec.target));
      }
    }
  } finally { fs.rmSync(releaseRoot, { recursive: true, force: true }); }
});

test('Windows link plan uses a hard link and directory junctions', () => {
  const calls = [];
  const hardLinkStat = { dev: 1n, ino: 2n, nlink: 2n, isFile: () => true };
  const fileSystem = {
    mkdirSync() {}, unlinkSync() {}, rmSync() {}, symlinkSync(target, link, type) { calls.push({ target, link, type }); },
    linkSync(target, link) { calls.push({ target, link, type: 'hardlink' }); },
    statSync() { return hardLinkStat; },
    lstatSync() { return { isSymbolicLink: () => true }; },
    readlinkSync(link) { return calls.find((entry) => entry.link === link).target; },
  };
  materializeHarnessLinks('C:\\personal-agent', { platform: 'win32', fileSystem });
  assert.equal(calls.find((entry) => entry.link.endsWith('CLAUDE.md')).type, 'hardlink');
  assert.equal(calls.filter((entry) => entry.type === 'junction').length, 4);
  assert.equal(calls.filter((entry) => entry.type === 'file').length, 0);
});

test('Windows rematerializes bridge directories expanded by release copy', { skip: process.platform !== 'win32' }, () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-link-source-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-link-target-'));
  try {
    fs.mkdirSync(path.join(source, 'skills'));
    fs.writeFileSync(path.join(source, 'AGENTS.md'), '# Agent\n');
    materializeHarnessLinks(source);
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
    assert.equal(fs.lstatSync(path.join(target, '.agents', 'skills')).isDirectory(), true);
    assert.doesNotThrow(() => materializeHarnessLinks(target));
    assert.deepEqual(verifyHarnessLinks(target).map((entry) => entry.link), harnessLinks.map((entry) => entry.link));
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('release installation does not materialize repository Agent compatibility links', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-private-site-node-release.mjs'), 'utf8');
  assert.doesNotMatch(installer, /materializeHarnessLinks|verifyHarnessLinks/);
});

test('local deployment installs and rolls back with the bundled release installer', () => {
  const deployment = fs.readFileSync(path.join(root, 'scripts', 'deploy-private-site-node.mjs'), 'utf8');
  assert.match(deployment, /releaseInstaller\(releaseRoot\)/);
  assert.match(deployment, /releaseInstaller\(previousRoot\)/);
  assert.match(deployment, /args\.domain \|\| installedDomain\(previousRoot\)/);
  assert.match(deployment, /"--domain", domain/);
  assert.match(deployment, /let domain = "";\s*\n\s*try \{/);
  assert.match(deployment, /releaseInstaller\(previousRoot\)[^\n]*"--domain", domain/);
  assert.doesNotMatch(deployment, /path\.join\(root,\s*["']scripts["'],\s*["']install-private-site-node-release\.mjs["']\)/);
});

test('fresh release installation points to the local Setup Center with optional WeChat guidance', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-private-site-node-release.mjs'), 'utf8');
  const githubInstaller = fs.readFileSync(path.join(root, 'scripts', 'install-from-github-release.mjs'), 'utf8');
  for (const source of [installer, githubInstaller]) {
    assert.match(source, /requiredAction:\s*["']open-setup-center["']/);
    assert.match(source, /\/app\/setup/);
    assert.match(source, /wechatRequired:\s*false/);
    assert.match(source, /personal-agent setup status --json/);
    assert.doesNotMatch(source, /bind WeChat first/);
  }
});

test('Windows double-click setup selects one root for Core, Workspace, and staging without changing macOS', () => {
  const setup = fs.readFileSync(path.join(root, 'core', 'runtime', 'native', 'cmd', 'personal-agent-setup', 'main.go'), 'utf8');
  const windowsPicker = fs.readFileSync(path.join(root, 'core', 'runtime', 'native', 'cmd', 'personal-agent-setup', 'install_location_windows.go'), 'utf8');
  const otherPlatforms = fs.readFileSync(path.join(root, 'core', 'runtime', 'native', 'cmd', 'personal-agent-setup', 'install_location_other.go'), 'utf8');
  assert.match(setup, /installCommand\(nil, true\)/);
  assert.match(setup, /resolveInstallHome\(\*homeRoot, interactive, runtime\.GOOS, selectInstallHome\)/);
  assert.match(setup, /filepath\.Join\(\*homeRoot, "core"\)/);
  assert.match(setup, /filepath\.Join\(\*homeRoot, "workspace"\)/);
  assert.match(setup, /os\.MkdirTemp\(temporaryBase, "\.personal-agent-setup-"\)/);
  assert.match(windowsPicker, /SHBrowseForFolderW/);
  assert.match(windowsPicker, /选择 Personal Agent 安装位置/);
  assert.match(otherPlatforms, /return defaultPath, true, nil/);
});

test('installed personal-agent command follows the immutable current release', () => {
  const files = new Map();
  const fileSystem = { mkdirSync() {}, chmodSync() {}, writeFileSync(file, content) { files.set(file, content); } };
  const posix = installPersonalAgentCommand({ installRoot: '/home/user/.private-site-node', dataRoot: '/srv/personal-agent', homeDir: '/home/user', platform: 'linux', fileSystem });
  assert.equal(posix.commandPath, '/home/user/.local/bin/personal-agent');
  assert.match(files.get(posix.commandPath), /current\/core\/runtime\/bin\/personal-agent\.mjs/);
  assert.match(files.get(posix.commandPath), /PRIVATE_SITE_INSTALL_ROOT='\/home\/user\/\.private-site-node'/);
  assert.match(files.get(posix.commandPath), /PRIVATE_SITE_DATA_ROOT='\/srv\/personal-agent'/);
  const windows = installPersonalAgentCommand({ installRoot: 'C:\\Users\\user\\.private-site-node', dataRoot: 'D:\\personal-agent-data', homeDir: 'C:\\Users\\user', platform: 'win32', env: { APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, fileSystem });
  assert.equal(windows.commandPath, 'C:\\Users\\user\\AppData\\Roaming\\npm\\personal-agent.cmd');
  assert.match(files.get(windows.commandPath), /personal-agent\.mjs/);
  assert.match(files.get(windows.commandPath), /PRIVATE_SITE_INSTALL_ROOT=C:\\Users\\user\\\.private-site-node/);
  assert.match(files.get(windows.commandPath), /PRIVATE_SITE_DATA_ROOT=D:\\personal-agent-data/);
});
