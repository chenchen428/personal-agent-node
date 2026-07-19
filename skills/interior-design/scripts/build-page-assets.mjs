#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(skill, 'assets', 'interior-viewer.bundle');
await build({
  entryPoints: [path.join(skill, 'scripts', 'page-client.mjs')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
});
fs.writeFileSync(outfile, fs.readFileSync(outfile, 'utf8').replace(/[ \t]+$/gm, ''));
console.log('Built skills/interior-design/assets/interior-viewer.bundle');
