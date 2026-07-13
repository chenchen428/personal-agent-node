#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions } from './skill-tree/common.mjs';
import { runCases } from './skill-tree/cases.mjs';
import { runCatalog } from './skill-tree/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillEntrypoints = {
  research: 'skills/deep-research/scripts/cli.mjs',
  capture: 'skills/knowledge-capture/scripts/cli.mjs',
  content: 'skills/content-workbench/scripts/cli.mjs',
  media: 'skills/media-toolkit/scripts/cli.mjs',
};

const [group = 'help', action, ...rest] = process.argv.slice(2);
const parsed = parseOptions(rest);

const help = `Personal Agent Node skill tree CLI

Usage:
  skill-tree catalog [--json]
  skill-tree research init --topic <topic> [--items a,b] [--fields id:label] --out <dir>
  skill-tree research validate --project <dir> [--allow-incomplete] [--json]
  skill-tree research report --project <dir> [--out report.md]
  skill-tree capture url --url <url> --out <file.md>
  skill-tree content format --input <file.md> --output <file.md>
  skill-tree content html --input <file.md> --output <file.html>
  skill-tree media inspect --input <image>
  skill-tree media compress --input <image> --output <image.webp> [--quality 80]
  open-abg pages upload --file <artifact> --folder <folder> --json
  skill-tree cases verify
`;

try {
  if (group === 'catalog') runCatalog(parseOptions([action, ...rest].filter(Boolean)).options);
  else if (skillEntrypoints[group]) runSkillCli(group, [action, ...rest].filter(Boolean));
  else if (group === 'cases') runCases(action, parsed);
  else if (group === 'help' || group === '--help' || group === '-h') console.log(help);
  else throw new Error(`Unknown command: ${group}\n\n${help}`);
} catch (error) {
  console.error(`[skill-tree] ${error.message}`);
  process.exitCode = 1;
}

function runSkillCli(group, args) {
  const entrypoint = path.join(root, skillEntrypoints[group]);
  const result = spawnSync(process.execPath, [entrypoint, ...args], { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
