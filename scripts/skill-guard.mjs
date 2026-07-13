#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { exists, readJson, report, root, trackedFiles } from './harness-lib.mjs';

const catalog = readJson('registry/skills.json');
const checks = [];
const names = new Set();
for (const skill of catalog.skills || []) {
  const dir = skill.directory || `skills/${skill.name}`;
  const manifest = path.join(root, dir, 'SKILL.md');
  checks.push({ name: `unique skill ${skill.name}`, ok: Boolean(skill.name) && !names.has(skill.name) });
  names.add(skill.name);
  checks.push({ name: `skill directory ${skill.name}`, ok: dir === `skills/${skill.name}` && exists(dir) });
  checks.push({ name: `skill manifest ${skill.name}`, ok: fs.existsSync(manifest) });
  checks.push({ name: `skill UI metadata ${skill.name}`, ok: exists(`${dir}/agents/openai.yaml`) });
  checks.push({ name: `skill case ${skill.name}`, ok: exists(`test/fixtures/skill-cases/${skill.name}/case.json`) });
  if (fs.existsSync(manifest)) {
    const text = fs.readFileSync(manifest, 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    const keys = match ? [...match[1].matchAll(/^([\w-]+):/gm)].map((item) => item[1]) : [];
    checks.push({ name: `skill frontmatter ${skill.name}`, ok: Boolean(match) && keys.length === 2 && keys.includes('name') && keys.includes('description') });
    checks.push({ name: `skill name ${skill.name}`, ok: new RegExp(`^name:\\s*${skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(match?.[1] || '') });
  }
}
const skillDirs = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
checks.push({ name: 'all disk skills cataloged', ok: skillDirs.every((name) => names.has(name)) });
const tracked = trackedFiles();
checks.push({ name: 'no secret-like skill files', ok: !tracked.some((file) => file.startsWith('skills/') && /(?:\.pem|\.key|\.p12|\.env)$/i.test(file)) });
checks.push({ name: 'no nested skill repositories', ok: !tracked.some((file) => /^skills\/.*\/\.git(?:\/|$)/.test(file)) });
report(checks);
