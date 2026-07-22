#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { root } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cargo = fs.readFileSync(new URL('../core/desktop/src-tauri/Cargo.toml', import.meta.url), 'utf8');
const tauri = JSON.parse(fs.readFileSync(new URL('../core/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
const expected = `v${pkg.version}`;
const tag = args.tag || process.env.GITHUB_REF_NAME || '';
if (tag && tag !== expected) throw new Error(`Release tag ${tag} does not match package version ${expected}`);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error(`Invalid semantic version: ${pkg.version}`);
if (cargoVersion !== pkg.version || tauri.version !== pkg.version) {
  throw new Error(`Desktop version mismatch: package=${pkg.version} cargo=${cargoVersion} tauri=${tauri.version}`);
}
if (!args.allowDirty) {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty) throw new Error('Release requires a clean Git worktree');
}
console.log(JSON.stringify({ ok: true, version: pkg.version, expectedTag: expected, tag: tag || null }, null, 2));

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') output.tag = argv[++index];
    else if (argv[index] === '--allow-dirty') output.allowDirty = true;
  }
  return output;
}
