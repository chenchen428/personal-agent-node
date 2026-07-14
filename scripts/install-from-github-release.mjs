#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalInstallRoot } from './install-root.mjs';
import { downloadReleaseAsset } from './release-download.mjs';

const args = parseArgs(process.argv.slice(2));
const repository = args.repository || 'chenchen428/personal-agent-node';
const tag = args.tag || 'v0.1.0-beta.11';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^v[0-9][0-9A-Za-z.-]+$/.test(tag)) throw new Error('Invalid repository or tag');
const base = `https://github.com/${repository}/releases/download/${tag}`;
const archiveName = `personal-agent-node-${tag}-universal.tar.gz`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-release-'));
try {
  const sums = await downloadReleaseAsset(`${base}/SHA256SUMS`);
  const expected = checksumFor(sums.toString('utf8'), archiveName);
  const archive = await downloadReleaseAsset(`${base}/${archiveName}`);
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`Release checksum mismatch for ${archiveName}`);
  const archivePath = path.join(temporary, archiveName);
  fs.writeFileSync(archivePath, archive, { mode: 0o600 });
  const extracted = path.join(temporary, 'extracted');
  fs.mkdirSync(extracted);
  run('tar', ['-xzf', archivePath, '-C', extracted]);
  const directories = fs.readdirSync(extracted, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (directories.length !== 1) throw new Error('Release archive has an invalid root layout');
  const releaseRoot = path.join(extracted, directories[0].name);
  const installer = path.join(releaseRoot, 'scripts', 'install-private-site-node-release.mjs');
  const command = [installer, releaseRoot];
  if (args.installRoot) command.push('--install-root', path.resolve(args.installRoot));
  run(process.execPath, command);
  const installRoot = canonicalInstallRoot(args.installRoot || path.join(os.homedir(), '.private-site-node'));
  const current = path.join(installRoot, 'current');
  const prepareEntrypoint = path.join(current, 'projects', 'core', 'node', 'bin', 'private-site.mjs');
  const prepareEnvironment = {
    ...process.env,
    PRIVATE_SITE_INSTALL_ROOT: installRoot,
    ...(args.dataRoot ? { PRIVATE_SITE_DATA_ROOT: path.resolve(args.dataRoot) } : {}),
  };
  run(process.execPath, [prepareEntrypoint, 'prepare'], { env: prepareEnvironment });
  console.log(JSON.stringify({ ok: true, repository, tag, verifiedSha256: actual, prepared: true, installRoot, current, connectCommand: 'personal-agent cloud connect --json', connectEntrypoint: `node ${path.join(current, 'projects', 'core', 'node', 'bin', 'personal-agent.mjs')} cloud connect --json` }, null, 2));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

function checksumFor(text, name) { const line=text.split(/\r?\n/).find((entry)=>entry.endsWith(`  ${name}`)); const match=/^([a-f0-9]{64})  /.exec(line||''); if(!match) throw new Error(`SHA256SUMS does not contain ${name}`); return match[1]; }
function run(command, commandArgs, options = {}) { const result=spawnSync(command, commandArgs, { stdio:'inherit', windowsHide:true, ...options }); if(result.status!==0) throw new Error(`${path.basename(command)} failed with ${result.status}`); }
function parseArgs(argv) { const output={}; for(let index=0;index<argv.length;index+=1){ if(argv[index]==='--repository') output.repository=argv[++index]; else if(argv[index]==='--tag') output.tag=argv[++index]; else if(argv[index]==='--install-root') output.installRoot=argv[++index]; else if(argv[index]==='--data-root') output.dataRoot=argv[++index]; } return output; }
