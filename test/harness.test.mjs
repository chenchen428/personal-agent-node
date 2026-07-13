import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCommandRegistry } from '../scripts/lib/command-registry-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) { return spawnSync(command, args, { cwd: root, encoding: 'utf8' }); }

test('customer Harness contains architecture registries and Agent guidance', () => {
  for (const file of ['AGENTS.md', 'docs/adr/0001-node-product-boundary-freeze.md', 'registry/projects.json', 'registry/skills.json', 'registry/behavior-baselines.json', 'registry/capabilities.json', 'registry/routes.json', 'registry/extensions.json', 'registry/commands.json', 'workflows/project-iteration.md', 'workflows/skill-iteration.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('customer Harness carries the portable Node acceptance standard', () => {
  const standard = fs.readFileSync(path.join(root, 'skills/personal-agent/references/acceptance.md'), 'utf8');
  for (const requirement of ['Node Core Gate', 'Optional Managed Cloud Integration', 'local-admin', 'ten minutes', 'previous-release rollback']) assert.match(standard, new RegExp(requirement));
  assert.equal(fs.existsSync(path.join(root, 'test/fixtures/skill-cases/personal-agent-acceptance/case.json')), true);
});

test('Phase 0 behavior baseline registry and cases are complete', () => {
  const result = run(process.execPath, ['scripts/verify-behavior-baselines.mjs']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /8\/8/);
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

test('project, architecture, and skill guards pass', () => {
  for (const file of ['scripts/project-guard.mjs', 'scripts/architecture-guard.mjs', 'scripts/skill-guard.mjs']) {
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
  assert.deepEqual(registry.projects.map((project) => project.name), ['personal-agent-node', 'private-site-edge']);
});

test('command registry validates against the public command schema', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry/commands.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/personal-agent/commands.schema.json'), 'utf8'));
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, 'registry/capabilities.json'), 'utf8'));
  const capabilityIds = new Set(capabilities.capabilities.map((entry) => entry.id));
  const valid = validateCommandRegistry({ registry, schema, capabilityIds });
  assert.equal(valid.ok, true, valid.errors.join('\n'));
  assert.deepEqual(registry.output.formats, ['json'], 'partial beta must not advertise unimplemented table or text output');

  const invalid = structuredClone(registry);
  invalid.implementationStatuses.preview.requiresPreviewFlag = false;
  assert.equal(validateCommandRegistry({ registry: invalid, schema, capabilityIds }).ok, false, 'contract must reject preview commands without explicit opt-in');

  const extraFields = structuredClone(registry);
  extraFields.undocumented = true;
  extraFields.output.undocumented = true;
  assert.equal(validateCommandRegistry({ registry: extraFields, schema, capabilityIds }).ok, false, 'contract must reject undocumented top-level and output fields');

  const invalidSchema = structuredClone(schema);
  invalidSchema.$defs.command.properties.implementationStatus.enum = ['implemented', 'planned'];
  assert.equal(validateCommandRegistry({ registry, schema: invalidSchema, capabilityIds }).ok, false, 'contract must reject a schema that omits preview');
});

test('GitHub release chain is version-gated and publishes verifiable artifacts', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/release-check.mjs', 'scripts/release-package.mjs', 'scripts/release-download.mjs', 'scripts/rollback-private-site-node-release.mjs', 'workflows/release.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gate = run(process.execPath, ['scripts/release-check.mjs', '--tag', `v${pkg.version}`, '--allow-dirty']);
  assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);
  const bad = run(process.execPath, ['scripts/release-check.mjs', '--tag', 'v999.0.0', '--allow-dirty']);
  assert.notEqual(bad.status, 0);
});
