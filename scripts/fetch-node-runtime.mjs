#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractZipMember } from './lib/zip-member.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'registry', 'node-runtime.json'), 'utf8'));
const args = parseArgs(process.argv.slice(2));
const platform = args.platform || process.platform;
const architecture = args.arch || process.arch;
const output = path.resolve(required(args.output, '--output'));
const descriptor = archiveDescriptor(runtime.version, platform, architecture);
if (!runtime.platforms.includes(`${platform}-${architecture}`)) throw new Error(`Unsupported pinned Node runtime target: ${platform}-${architecture}`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-node-runtime-'));

try {
  const sums = await download(`${runtime.source}/${runtime.checksumFile}`);
  const match = sums.toString('utf8').split(/\r?\n/).find((line) => line.endsWith(`  ${descriptor.archive}`));
  const expected = /^([a-f0-9]{64})  /.exec(match || '')?.[1];
  if (!expected) throw new Error(`Pinned Node checksum is missing ${descriptor.archive}`);
  const archive = await download(`${runtime.source}/${descriptor.archive}`);
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`Pinned Node checksum mismatch for ${descriptor.archive}`);
  const archivePath = path.join(temporary, descriptor.archive);
  fs.writeFileSync(archivePath, archive, { mode: 0o600 });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (platform === 'win32') {
    fs.writeFileSync(output, extractZipMember(archive, descriptor.member), { mode: 0o700 });
  } else {
    const extracted = path.join(temporary, 'extracted');
    fs.mkdirSync(extracted);
    run('tar', ['-xf', archivePath, '-C', extracted, descriptor.member]);
    fs.copyFileSync(path.join(extracted, ...descriptor.member.split('/')), output);
  }
  if (platform !== 'win32') fs.chmodSync(output, 0o755);
  process.stdout.write(`${JSON.stringify({ ok: true, version: runtime.version, platform, architecture, archive: descriptor.archive, sha256: actual, output }, null, 2)}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function archiveDescriptor(version, platform, architecture) {
  const nodePlatform = { win32: 'win', darwin: 'darwin', linux: 'linux' }[platform];
  const nodeArchitecture = architecture === 'x64' ? 'x64' : architecture === 'arm64' ? 'arm64' : '';
  if (!nodePlatform || !nodeArchitecture || (platform === 'win32' && architecture !== 'x64')) throw new Error(`Unsupported Node runtime target: ${platform}-${architecture}`);
  const extension = platform === 'win32' ? 'zip' : 'tar.gz';
  const rootName = `node-v${version}-${nodePlatform}-${nodeArchitecture}`;
  return { archive: `${rootName}.${extension}`, member: `${rootName}/${platform === 'win32' ? 'node.exe' : 'bin/node'}` };
}

async function download(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'nodejs.org') throw new Error('Node runtime source must be HTTPS nodejs.org');
  if (process.platform === 'win32') return downloadWithCurl(parsed);
  try {
    const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Node runtime download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  } catch (fetchError) {
    return downloadWithCurl(parsed, fetchError);
  }
}

function downloadWithCurl(url, fetchError = null) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const result = spawnSync(curl, ['--fail', '--silent', '--show-error', '--proto', '=https', '--max-time', '180', url.href], {
    encoding: null,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status === 0 && Buffer.isBuffer(result.stdout)) return result.stdout;
  const detail = String(result.stderr || result.error || fetchError || '').trim();
  throw new Error(`Node runtime download failed: ${detail}`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout || result.error || '').trim()}`);
}

function required(value, label) { if (!String(value || '').trim()) throw new Error(`${label} is required`); return String(value); }
function parseArgs(argv) { const output = {}; for (let index = 0; index < argv.length; index += 1) { if (argv[index] === '--platform') output.platform = argv[++index]; else if (argv[index] === '--arch') output.arch = argv[++index]; else if (argv[index] === '--output') output.output = argv[++index]; else throw new Error(`Unknown option: ${argv[index]}`); } return output; }
