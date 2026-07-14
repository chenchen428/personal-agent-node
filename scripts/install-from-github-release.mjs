#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep this installer self-contained. The release workflow publishes this exact
// file as an individual immutable asset so a new machine does not need a source
// checkout, npm install, or any sibling scripts before it can verify and install
// the complete release archive.
const USER_AGENT = 'personal-agent-node-installer/0.1';
const FETCH_TIMEOUT_MILLISECONDS = 10_000;
const HARNESS_BRIDGE_PATHS = Object.freeze([
  'CLAUDE.md',
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
]);

if (isMainModule()) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = args.repository || 'chenchen428/personal-agent-node';
  const tag = args.tag;
  if (!tag) throw new Error('Usage: node personal-agent-node-<tag>-installer.mjs --tag <tag> [--install-root <path>] [--data-root <path>]');
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
    const layout = validateArchiveListing(runCapture('tar', ['-tzf', archivePath]));
    run('tar', archiveExtractionArgs(archivePath, extracted, layout, process.platform));
    const entries = fs.readdirSync(extracted, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name !== layout.root) throw new Error('Release archive has an invalid root layout');
    const releaseRoot = path.join(extracted, layout.root);
    const installer = path.join(releaseRoot, 'scripts', 'install-private-site-node-release.mjs');
    const installRoot = canonicalInstallRoot(args.installRoot || path.join(os.homedir(), '.private-site-node'));
    const dataRoot = path.resolve(args.dataRoot || process.env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), '.personal-agent'));
    const command = [installer, releaseRoot, '--install-root', installRoot, '--data-root', dataRoot];
    run(process.execPath, command);
    const current = path.join(installRoot, 'current');
    const prepareEntrypoint = path.join(current, 'projects', 'core', 'node', 'bin', 'private-site.mjs');
    const prepareEnvironment = {
      ...process.env,
      PRIVATE_SITE_INSTALL_ROOT: installRoot,
      PRIVATE_SITE_DATA_ROOT: dataRoot,
    };
    run(process.execPath, [prepareEntrypoint, 'prepare'], { env: prepareEnvironment });
    console.log(JSON.stringify({ ok: true, repository, tag, verifiedSha256: actual, prepared: true, installRoot, current, connectCommand: 'personal-agent cloud connect --json', connectEntrypoint: `node ${path.join(current, 'projects', 'core', 'node', 'bin', 'personal-agent.mjs')} cloud connect --json` }, null, 2));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function checksumFor(text, name) { const line=text.split(/\r?\n/).find((entry)=>entry.endsWith(`  ${name}`)); const match=/^([a-f0-9]{64})  /.exec(line||''); if(!match) throw new Error(`SHA256SUMS does not contain ${name}`); return match[1]; }
function run(command, commandArgs, options = {}) { const result=spawnSync(command, commandArgs, { stdio:'inherit', windowsHide:true, ...options }); if(result.status!==0) throw new Error(`${path.basename(command)} failed with ${result.status}`); }
function runCapture(command, commandArgs) { const result=spawnSync(command, commandArgs, { encoding:'utf8', shell:false, windowsHide:true, maxBuffer:16*1024*1024 }); if(result.status!==0) throw new Error(`${path.basename(command)} failed with ${result.status}`); return result.stdout; }
function isMainModule() { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }

export function validateArchiveListing(listing) {
  const members = String(listing || '').split(/\r?\n/).filter(Boolean);
  if (!members.length) throw new Error('Release archive is empty');
  let root = '';
  for (const member of members) {
    const normalized = member.endsWith('/') ? member.slice(0, -1) : member;
    const parts = normalized.split('/');
    if (!normalized || normalized.includes('\\') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
      || parts.some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Release archive contains an unsafe path: ${member}`);
    }
    root ||= parts[0];
    if (parts[0] !== root) throw new Error('Release archive has multiple roots');
  }
  return { root, members };
}

export function archiveExtractionArgs(archivePath, extracted, layout, platform = process.platform) {
  const args = ['-xzf', archivePath, '-C', extracted];
  if (platform === 'win32') {
    for (const relative of HARNESS_BRIDGE_PATHS) args.push('--exclude', `${layout.root}/${relative}`);
  }
  return args;
}
function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--repository') output.repository = requiredValue(argv, ++index, option);
    else if (option === '--tag') output.tag = requiredValue(argv, ++index, option);
    else if (option === '--install-root') output.installRoot = requiredValue(argv, ++index, option);
    else if (option === '--data-root') output.dataRoot = requiredValue(argv, ++index, option);
    else throw new Error(`Unknown installer option: ${option}`);
  }
  return output;
}
function requiredValue(argv, index, option) { const value=argv[index]; if(!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`); return value; }
function canonicalInstallRoot(value) { const requested=path.resolve(value); fs.mkdirSync(requested,{recursive:true}); return fs.realpathSync(requested); }

async function downloadReleaseAsset(value) {
  const url = validateReleaseUrl(value);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (fetchError) {
    return downloadWithPlatformClient(url, fetchError);
  }
}

function validateReleaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.hash) {
    throw new Error('Release download URL must be an HTTPS github.com URL without credentials or fragments');
  }
  return url.toString();
}

function downloadWithPlatformClient(url, fetchError) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-download-'));
  const target = path.join(directory, 'asset');
  try {
    const invocation = process.platform === 'win32' ? powershellInvocation(url, target, directory) : curlInvocation(url, target);
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    if (!result.error && result.status === 0 && fs.existsSync(target)) return fs.readFileSync(target);
    const fetchDetail = fetchError instanceof Error ? fetchError.message : 'unknown fetch failure';
    const fallbackDetail = String(result.error?.message || result.stderr || `exit ${result.status}`).trim().slice(0, 300);
    throw new Error(`Release download failed with fetch (${fetchDetail}) and ${invocation.label} (${fallbackDetail})`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function curlInvocation(url, target) {
  return {
    command: 'curl',
    label: 'curl',
    args: ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--connect-timeout', '10', '--max-time', '90', '--output', target, '--', url],
  };
}

function powershellInvocation(url, target, directory) {
  const scriptPath = path.join(directory, 'download.ps1');
  fs.writeFileSync(scriptPath, "param([Parameter(Mandatory=$true)][string]$Uri,[Parameter(Mandatory=$true)][string]$OutFile)\n$ErrorActionPreference='Stop'\n[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12\nInvoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile\n", { mode: 0o600 });
  return {
    command: 'powershell.exe',
    label: 'PowerShell Invoke-WebRequest',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Uri', url, '-OutFile', target],
  };
}
