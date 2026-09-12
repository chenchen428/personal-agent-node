import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { seedAgentWorkspace, copyMissingTree, COVE_BUILTIN_SKILLS } from '../src/workspace-seed.ts';

test('seeding preserves user skills, registries, links and backups byte-for-byte', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cove-preserve-seed-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, 'release'), dataRoot = path.join(root, 'space'), agentWorkspaceRoot = path.join(dataRoot, 'agent-workspace');
  const files = { 'skills/personal-agent/SKILL.md': 'user-adjusted legacy', 'skills/personal-pages/SKILL.md': 'user pages', 'skills/frontend-design/SKILL.md': 'user design', 'skills/interior-design/custom.txt': 'extra user file', 'registry/skills.json': '{"user":true}', '.codex/skills/own/SKILL.md': 'real user directory' };
  for (const [relative, content] of Object.entries(files)) { const file = path.join(agentWorkspaceRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  fs.mkdirSync(path.join(dataRoot, 'backups')); fs.writeFileSync(path.join(dataRoot, 'backups', 'existing.psb'), 'untouched backup');
  fs.mkdirSync(path.join(releaseRoot, 'workspace', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, 'workspace', 'AGENTS.md'), 'new guide'); fs.writeFileSync(path.join(releaseRoot, 'workspace', 'registry', 'skills.json'), '{}');
  fs.mkdirSync(path.join(releaseRoot, 'workspace', 'skills', 'cove-runtime'), { recursive: true }); fs.writeFileSync(path.join(releaseRoot, 'workspace', 'skills', 'cove-runtime', 'SKILL.md'), 'builtin');
  for (let run = 0; run < 2; run++) {
    const result = seedAgentWorkspace({ dataRoot, agentWorkspaceRoot }, { releaseRoot });
    assert.deepEqual(result.retiredSkills, []); assert.deepEqual(result.refreshedPaths, []);
    for (const [relative, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, relative), 'utf8'), content);
    assert.equal(fs.readFileSync(path.join(dataRoot, 'backups', 'existing.psb'), 'utf8'), 'untouched backup');
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, 'skills', 'cove-runtime')), false);
    assert.equal(fs.existsSync(path.join(dataRoot, 'runtime', 'harness-migrations')), false);
  }
  assert.equal(COVE_BUILTIN_SKILLS.length, 13);
});

test('copy-missing never overwrites existing files or follows a user link', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cove-copy-missing-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'target'), external = path.join(root, 'external');
  for (const dir of [source, target, external]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(source, 'keep'), 'source'); fs.writeFileSync(path.join(target, 'keep'), 'user');
  fs.mkdirSync(path.join(source, 'linked')); fs.writeFileSync(path.join(source, 'linked', 'new'), 'must not copy');
  fs.symlinkSync(external, path.join(target, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  copyMissingTree(source, target);
  assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'user'); assert.equal(fs.readdirSync(external).length, 0);
});


test('only a regular guide exactly matching the trusted old seed is refreshed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cove-guide-refresh-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, 'release'); fs.mkdirSync(path.join(releaseRoot, 'registry'), { recursive: true }); fs.mkdirSync(path.join(releaseRoot, 'workspace'));
  const previous = 'old trusted product guide'; fs.writeFileSync(path.join(releaseRoot, 'workspace/AGENTS.md'), 'current Cove contract');
  fs.writeFileSync(path.join(releaseRoot, 'registry/legacy-builtin-skills.json'), JSON.stringify({ schemaVersion: 1, skills: [], guides: [{ path: 'AGENTS.md', bytes: Buffer.byteLength(previous), sha256: crypto.createHash('sha256').update(previous).digest('hex') }] }));
  for (const [name, content, changed] of [['unchanged', previous, true], ['modified', previous + ' user notes', false]]) {
    const dataRoot = path.join(root, name), agentWorkspaceRoot = path.join(dataRoot, 'agent-workspace'); fs.mkdirSync(agentWorkspaceRoot, { recursive: true }); fs.writeFileSync(path.join(agentWorkspaceRoot, 'AGENTS.md'), content);
    const result = seedAgentWorkspace({ dataRoot, agentWorkspaceRoot }, { releaseRoot });
    assert.equal(result.refreshedPaths.includes('AGENTS.md'), changed);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, 'AGENTS.md'), 'utf8'), changed ? 'current Cove contract' : content);
  }
});
