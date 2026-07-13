#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = readJson('registry/projects.json');
const command = process.argv[2] || 'list';

if (command === 'list') {
  console.log(['name', 'runtime', 'path'].join('\t'));
  for (const project of registry.projects) console.log([project.name, project.runtime?.type || '-', project.path].join('\t'));
} else if (command === 'show') {
  const project = registry.projects.find((item) => item.name === process.argv[3]);
  if (!project) fail(`Unknown project: ${process.argv[3] || '<missing>'}`);
  console.log(JSON.stringify(project, null, 2));
} else if (command === 'json') {
  console.log(JSON.stringify(registry, null, 2));
} else if (command === 'check') {
  const names = new Set();
  for (const project of registry.projects) {
    if (!project.name || names.has(project.name)) fail(`Invalid or duplicate project: ${project.name || '<missing>'}`);
    names.add(project.name);
    if (!project.path || !fs.existsSync(path.join(root, project.path))) fail(`${project.name}: missing ${project.path}`);
  }
  console.log(`OK: ${registry.projects.length} projects`);
} else fail(`Unknown command: ${command}`);

function readJson(file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function fail(message) { console.error(message); process.exit(1); }
