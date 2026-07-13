import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) { return spawnSync(command, args, { cwd: root, encoding: 'utf8' }); }

test('customer Harness contains both registries and Agent guidance', () => {
  for (const file of ['AGENTS.md', 'registry/projects.json', 'registry/skills.json', 'workflows/project-iteration.md', 'workflows/skill-iteration.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('generated Agent compatibility bridges stay outside Git', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['.agents/', '.claude/', '.codex/', '.cursor/', 'CLAUDE.md']) assert.equal(ignore.includes(entry), true, entry);
});

test('public dependency metadata uses only the public npm registry', () => {
  const files = ['.npmrc', 'package-lock.json', 'projects/core/open-agent-bridge/package-lock.json'];
  const forbiddenRegistry = ['registry', 'anpm', 'alibaba-inc', 'com'].join('.');
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(content.includes(forbiddenRegistry), false, file);
  }
  assert.match(fs.readFileSync(path.join(root, '.npmrc'), 'utf8'), /^registry=https:\/\/registry\.npmjs\.org\/$/m);
});

test('project and skill guards pass', () => {
  for (const file of ['scripts/project-guard.mjs', 'scripts/skill-guard.mjs']) {
    const result = run(process.execPath, [file, '--working']);
    assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
  }
});

test('skill cases are reproducible', () => {
  const result = run(process.execPath, ['scripts/skill-tree.mjs', 'cases', 'verify']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('cloud is optional in public project inventory', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry/projects.json'), 'utf8'));
  assert.equal(registry.projects.some((project) => /cloud/i.test(project.name)), false);
});

test('GitHub release chain is version-gated and publishes verifiable artifacts', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/release-check.mjs', 'scripts/release-package.mjs', 'scripts/rollback-private-site-node-release.mjs', 'workflows/release.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gate = run(process.execPath, ['scripts/release-check.mjs', '--tag', `v${pkg.version}`, '--allow-dirty']);
  assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);
  const bad = run(process.execPath, ['scripts/release-check.mjs', '--tag', 'v999.0.0', '--allow-dirty']);
  assert.notEqual(bad.status, 0);
});
