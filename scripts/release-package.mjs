#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = args.tag || process.env.GITHUB_REF_NAME || `v${pkg.version}`;
execFileSync(process.execPath, [path.join(root, 'scripts/release-check.mjs'), '--tag', tag], { cwd: root, stdio: 'inherit' });
const releaseId = args.releaseId || tag.replace(/^v/, '');
const stage = path.resolve(args.stage || path.join(root, 'dist', 'private-site-node', releaseId));
const output = path.resolve(args.output || path.join(root, 'dist', 'releases', tag));
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'scripts/build-private-site-node-dist.mjs'), '--profile', 'universal', '--release-id', releaseId, '--output', stage], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'scripts/verify-private-site-node-dist.mjs'), stage], { cwd: root, stdio: 'inherit' });
const base = `personal-agent-node-${tag}-universal`;
const archive = path.join(output, `${base}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', path.dirname(stage), path.basename(stage)], { cwd: root, stdio: 'inherit' });
for (const name of ['release-manifest.json', 'SBOM.cdx.json']) fs.copyFileSync(path.join(stage, name), path.join(output, `${base}-${name}`));
fs.copyFileSync(path.join(root, 'scripts', 'install-from-github-release.mjs'), path.join(output, `personal-agent-node-${tag}-installer.mjs`));
const files = fs.readdirSync(output).filter((name) => name !== 'SHA256SUMS').sort();
fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${files.map((name) => `${sha256(path.join(output, name))}  ${name}`).join('\n')}\n`);
console.log(JSON.stringify({ ok: true, tag, releaseId, stage, output, artifacts: [...files, 'SHA256SUMS'] }, null, 2));

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') output.tag = argv[++index];
    else if (argv[index] === '--release-id') output.releaseId = argv[++index];
    else if (argv[index] === '--stage') output.stage = argv[++index];
    else if (argv[index] === '--output') output.output = argv[++index];
  }
  return output;
}
