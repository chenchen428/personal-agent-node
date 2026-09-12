import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseSkillFrontmatter, readWorkspaceSkillCatalog, resolveWorkspaceSkills } from '../src/skills/catalog.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cove-skill-sources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, 'release'), space = path.join(root, 'space');
  for (const dir of [release, space]) fs.mkdirSync(path.join(dir, 'registry'), { recursive: true });
  const put = (base, name, content, extra = {}) => {
    const dir = path.join(base, 'skills', name); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
    for (const [file, text] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    return dir;
  };
  const skill = (name, description = 'fixture') => '---\nname: ' + name + '\ndescription: ' + description + '\n---\nInstructions.';
  const builtin = put(release, 'cove-runtime', skill('cove-runtime'));
  fs.writeFileSync(path.join(release, 'registry', 'skills.json'), JSON.stringify({ skills: [{ name: 'cove-runtime', directory: 'skills/cove-runtime' }] }));
  return { root, release, space, put, skill, builtin };
}
function baseline(release, name, files) {
  fs.writeFileSync(path.join(release, 'registry', 'legacy-builtin-skills.json'), JSON.stringify({ schemaVersion: 1, skills: [{ name, directory: 'skills/' + name, files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, { bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') }])) }] }));
}

test('builtin ownership comes only from the release; user prefix/frontmatter/registry cannot forge it', t => {
  const f = fixture(t);
  f.put(f.space, 'cove-runtime', f.skill('cove-runtime', 'my custom version') + '\nsource: builtin');
  fs.writeFileSync(path.join(f.space, 'registry', 'skills.json'), JSON.stringify({ skills: [{ name: 'cove-runtime', directory: 'skills/cove-runtime', source: { kind: 'builtin' }, origin: { kind: 'builtin' } }] }));
  const result = readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release });
  assert.deepEqual(result.skills.map(s => s.source.kind), ['builtin', 'user']);
  assert.equal(new Set(result.skills.map(s => s.id)).size, 2);
  assert.ok(result.skills.every(s => !('skillPath' in s)));
  assert.deepEqual(resolveWorkspaceSkills(f.space, { releaseRoot: f.release }).skills.map(s => s.skillPath), [path.join(f.builtin, 'SKILL.md'), path.join(f.space, 'skills/cove-runtime/SKILL.md')]);
});

test('only an unchanged complete legacy file tree is excluded, while every file remains in place', t => {
  const f = fixture(t), old = f.skill('frontend-design');
  const folder = f.put(f.space, 'frontend-design', old, { 'references/guide.md': 'old guide' });
  baseline(f.release, 'frontend-design', { 'SKILL.md': old, 'references/guide.md': 'old guide' });
  let result = readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release });
  assert.equal(result.excludedLegacyCount, 1); assert.equal(result.skills.length, 1);
  assert.equal(fs.readFileSync(path.join(folder, 'references/guide.md'), 'utf8'), 'old guide');
  fs.writeFileSync(path.join(folder, 'references/guide.md'), 'user change');
  result = readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release });
  assert.equal(result.excludedLegacyCount, 0); assert.equal(result.skills[1].source.kind, 'user');
  fs.writeFileSync(path.join(folder, 'references/guide.md'), 'old guide');
  fs.writeFileSync(path.join(folder, 'my-extra.txt'), 'my data');
  assert.equal(readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release }).excludedLegacyCount, 0);
});

test('a missing legacy file or absent provenance never licenses exclusion', t => {
  const f = fixture(t), old = f.skill('personal-runtime');
  f.put(f.space, 'personal-runtime', old);
  baseline(f.release, 'personal-runtime', { 'SKILL.md': old, 'references/extra.md': 'not present' });
  assert.equal(readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release }).skills.length, 2);
  f.put(f.space, 'unknown', f.skill('unknown'));
  assert.equal(readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release }).skills.length, 3);
});

test('new skills appear on the next read and remain isolated to their Space', t => {
  const f = fixture(t), other = path.join(f.root, 'other-space'); fs.mkdirSync(other);
  assert.equal(readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release }).skills.length, 1);
  f.put(f.space, 'my-weekly', f.skill('my-weekly'));
  assert.equal(readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release }).skills.length, 2);
  assert.equal(readWorkspaceSkillCatalog(other, { releaseRoot: f.release }).skills.length, 1);
});

test('user symlink directories stay untouched and are not followed into another source', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.space, 'skills'));
  const link = path.join(f.space, 'skills', 'linked');
  fs.symlinkSync(f.builtin, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = readWorkspaceSkillCatalog(f.space, { releaseRoot: f.release });
  assert.equal(result.skills[1].source.kind, 'user'); assert.equal(result.skills[1].status, 'unavailable');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
});

test('parses quoted and folded descriptions without loading fields as authority', () => {
  assert.equal(parseSkillFrontmatter('---\nname: mine\ndescription: >\n  first\n  second\n---\n').description, 'first second');
});
