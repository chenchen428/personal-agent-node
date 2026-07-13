#!/usr/bin/env node
import { exists, readJson, report, trackedFiles } from './harness-lib.mjs';

const registry = readJson('registry/projects.json');
const checks = [];
const names = new Set();
for (const dir of ['projects/core/node', 'projects/edge', 'registry', 'scripts', 'skills', 'workflows', 'test/fixtures']) checks.push({ name: `required path ${dir}`, ok: exists(dir) });
for (const project of registry.projects) {
  checks.push({ name: `unique project ${project.name}`, ok: Boolean(project.name) && !names.has(project.name) });
  names.add(project.name);
  checks.push({ name: `project path ${project.name}`, ok: Boolean(project.path) && exists(project.path), detail: project.path });
}
checks.push({ name: 'no top-level data directory', ok: !exists('data') });
checks.push({ name: 'project workflow', ok: exists('workflows/project-iteration.md') });
const tracked = trackedFiles();
checks.push({ name: 'no tracked mutable state', ok: !tracked.some((file) => /^(?:\.local|secrets|node_modules|dist)\//.test(file)) });
checks.push({ name: 'no nested Git metadata', ok: !tracked.some((file) => /(?:^|\/)\.git(?:\/|$)/.test(file)) });
checks.push({ name: 'only two product registrations', ok: registry.projects.length === 2 });
checks.push({ name: 'legacy Edge path removed', ok: !exists(['projects', 'core', 'edge'].join('/')) });
report(checks);
