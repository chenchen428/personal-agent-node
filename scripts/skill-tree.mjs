#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readJson, root } from './harness-lib.mjs';

const [group = 'catalog', action] = process.argv.slice(2);
const catalog = readJson('registry/skills.json');
if (group === 'catalog') console.log(JSON.stringify(catalog.skills, null, 2));
else if (group === 'cases' && action === 'verify') {
  let count = 0;
  for (const skill of catalog.skills || []) {
    const file = path.join(root, 'test', 'fixtures', 'skill-cases', skill.name, 'case.json');
    if (!fs.existsSync(file)) throw new Error(`Missing case: ${skill.name}`);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ((value.skill || value.name) !== skill.name || !value.prompt || !Array.isArray(value.artifacts)) throw new Error(`Invalid case: ${skill.name}`);
    for (const artifact of value.artifacts) {
      const candidate = typeof artifact === 'string' ? artifact : artifact.path;
      const inRoot = candidate && path.join(root, candidate);
      const besideCase = candidate && path.join(path.dirname(file), candidate);
      if (candidate && !fs.existsSync(inRoot) && !fs.existsSync(besideCase)) throw new Error(`Missing artifact for ${skill.name}: ${candidate}`);
    }
    console.log(`[OK] ${skill.name}`); count += 1;
  }
  console.log(`OK: ${count} skill cases`);
} else throw new Error('Usage: skill-tree.mjs catalog | cases verify');
