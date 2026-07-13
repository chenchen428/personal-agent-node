#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, executable, report, root, trackedFiles } from './harness-lib.mjs';

const checks = [];
checks.push({ name: 'Node.js 22+', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.version });
for (const file of ['AGENTS.md', 'README.md', 'registry/projects.json', 'registry/skills.json', 'scripts/project-guard.mjs', 'scripts/skill-guard.mjs', 'scripts/skill-tree.mjs', 'scripts/setup-agent-bridge.sh']) checks.push({ name: `harness file ${file}`, ok: exists(file) });
for (const file of ['scripts/project-guard.mjs', 'scripts/skill-guard.mjs', 'scripts/skill-tree.mjs', 'scripts/setup-agent-bridge.sh']) checks.push({ name: `executable ${file}`, ok: exists(file) && executable(file) });
checks.push({ name: 'dependencies installed', ok: exists('node_modules'), detail: 'run npm install when missing' });
const tracked = trackedFiles();
checks.push({ name: 'no tracked secrets', ok: !tracked.some((file) => file.startsWith('secrets/')) });
checks.push({ name: 'no tracked Agent compatibility links', ok: !tracked.some((file) => /^(?:CLAUDE\.md|\.(?:agents|codex|claude|cursor)\/)/.test(file)) });
checks.push({ name: 'gitignore protects runtime state', ok: ['.local/', 'secrets/', 'node_modules/', 'dist/'].every((line) => fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes(line)) });
try { execFileSync(process.execPath, ['scripts/discover-projects.mjs', 'check'], { cwd: root, stdio: 'pipe' }); checks.push({ name: 'project registry', ok: true }); } catch (error) { checks.push({ name: 'project registry', ok: false, detail: error.stderr?.toString().trim() }); }
report(checks);
