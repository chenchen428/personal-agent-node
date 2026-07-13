#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const repository = args.repository || 'chenchen428/personal-agent-node';
const tag = args.tag || 'v0.1.0-beta.1';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^v[0-9][0-9A-Za-z.-]+$/.test(tag)) throw new Error('Invalid repository or tag');
const base = `https://github.com/${repository}/releases/download/${tag}`;
const archiveName = `personal-agent-node-${tag}-universal.tar.gz`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-release-'));
try {
  const sums = await download(`${base}/SHA256SUMS`);
  const expected = checksumFor(sums.toString('utf8'), archiveName);
  const archive = await download(`${base}/${archiveName}`);
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
  const installRoot = path.resolve(args.installRoot || path.join(os.homedir(), '.private-site-node'));
  console.log(JSON.stringify({ ok: true, repository, tag, verifiedSha256: actual, installRoot, current: path.join(installRoot, 'current'), onboardingCommand: `node ${path.join(installRoot, 'current', 'projects', 'core', 'node', 'bin', 'private-site.mjs')} onboarding` }, null, 2));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

async function download(url) { const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'personal-agent-node-installer/0.1' } }); if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`); return Buffer.from(await response.arrayBuffer()); }
function checksumFor(text, name) { const line=text.split(/\r?\n/).find((entry)=>entry.endsWith(`  ${name}`)); const match=/^([a-f0-9]{64})  /.exec(line||''); if(!match) throw new Error(`SHA256SUMS does not contain ${name}`); return match[1]; }
function run(command, commandArgs) { const result=spawnSync(command, commandArgs, { stdio:'inherit', windowsHide:true }); if(result.status!==0) throw new Error(`${path.basename(command)} failed with ${result.status}`); }
function parseArgs(argv) { const output={}; for(let index=0;index<argv.length;index+=1){ if(argv[index]==='--repository') output.repository=argv[++index]; else if(argv[index]==='--tag') output.tag=argv[++index]; else if(argv[index]==='--install-root') output.installRoot=argv[++index]; } return output; }
