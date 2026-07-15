#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.join(root, 'core', 'desktop');
const nativeRoot = path.join(desktopRoot, 'src-tauri');
const args = parseArgs(process.argv.slice(2));
const platform = args.platform || process.platform;
const architecture = args.arch || process.arch;
const packageMetadata = readJson(path.join(root, 'package.json'));
const output = path.resolve(args.output || path.join(root, 'dist', 'desktop', `${platform}-${architecture}`));

main();

function main() {
  assertHostTarget();
  assertVersionAlignment();
  assertIcons();
  if (!args.skipBuild) build();
  if (fs.existsSync(output)) throw new Error(`Desktop output already exists: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const copied = copyArtifact(output);
  const bytes = directoryBytes(copied);
  const compressedBytes = gzipBytes(copied);
  const packageBudget = { rawBytes: 10 * 1024 * 1024, compressedBytes: 5 * 1024 * 1024 };
  if (bytes > packageBudget.rawBytes || compressedBytes > packageBudget.compressedBytes) {
    throw new Error(`Desktop shell exceeds package budget: raw=${bytes}/${packageBudget.rawBytes} compressed=${compressedBytes}/${packageBudget.compressedBytes}`);
  }
  let releaseOverlay = null;
  if (args.releaseRoot) releaseOverlay = overlayRelease(path.resolve(args.releaseRoot), copied);
  process.stdout.write(`${JSON.stringify({ ok: true, platform, architecture, version: packageMetadata.version, artifact: copied, bytes, compressedBytes, packageBudget, releaseOverlay }, null, 2)}\n`);
}

function build() {
  const tauriCli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
  const buildArgs = platform === 'darwin' ? ['build', '--bundles', 'app'] : ['build', '--no-bundle'];
  const result = spawnSync(process.execPath, [tauriCli, ...buildArgs], {
    cwd: desktopRoot,
    env: { ...process.env, CARGO_TERM_COLOR: 'always' },
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`Tauri desktop build failed with status ${result.status}`);
}

function copyArtifact(destination) {
  const releaseRoot = path.join(nativeRoot, 'target', 'release');
  if (platform === 'darwin') {
    const source = path.join(releaseRoot, 'bundle', 'macos', 'Personal Agent.app');
    requirePath(source);
    const target = path.join(destination, 'Personal Agent.app');
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
    return target;
  }
  const name = platform === 'win32' ? 'personal-agent-ui.exe' : 'personal-agent-ui';
  const source = path.join(releaseRoot, name);
  requirePath(source);
  const target = path.join(destination, name);
  fs.copyFileSync(source, target);
  if (platform !== 'win32') fs.chmodSync(target, 0o755);
  return target;
}

function overlayRelease(releaseRoot, artifact) {
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const checksumsPath = path.join(releaseRoot, 'SHA256SUMS');
  requirePath(manifestPath);
  requirePath(checksumsPath);
  const desktopDirectory = path.join(releaseRoot, 'desktop');
  if (fs.existsSync(desktopDirectory)) throw new Error(`Release already has a desktop overlay: ${desktopDirectory}`);
  fs.mkdirSync(desktopDirectory, { recursive: true });
  const target = path.join(desktopDirectory, path.basename(artifact));
  if (fs.statSync(artifact).isDirectory()) fs.cpSync(artifact, target, { recursive: true, preserveTimestamps: true });
  else fs.copyFileSync(artifact, target);
  fs.copyFileSync(path.join(desktopRoot, 'icon.svg'), path.join(desktopDirectory, 'icon.svg'));
  const manifest = readJson(manifestPath);
  manifest.desktopShell = {
    framework: 'tauri',
    version: packageMetadata.version,
    platform: `${platform}-${architecture}`,
    entrypoint: platform === 'darwin' ? 'desktop/Personal Agent.app' : `desktop/${path.basename(artifact)}`,
    origin: 'http://127.0.0.1:8843',
    serviceOwner: 'node-runtime',
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeChecksums(releaseRoot);
  return { root: releaseRoot, entrypoint: manifest.desktopShell.entrypoint };
}

function assertHostTarget() {
  if (platform !== process.platform || architecture !== process.arch) {
    throw new Error(`Desktop shell must build on its native target: host=${process.platform}-${process.arch} target=${platform}-${architecture}`);
  }
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(architecture)) {
    throw new Error(`Unsupported desktop target: ${platform}-${architecture}`);
  }
}

function assertVersionAlignment() {
  const cargo = fs.readFileSync(path.join(nativeRoot, 'Cargo.toml'), 'utf8');
  const config = readJson(path.join(nativeRoot, 'tauri.conf.json'));
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  if (cargoVersion !== packageMetadata.version || config.version !== packageMetadata.version) {
    throw new Error(`Desktop version mismatch: package=${packageMetadata.version} cargo=${cargoVersion} tauri=${config.version}`);
  }
}

function assertIcons() {
  for (const name of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico']) {
    requirePath(path.join(nativeRoot, 'icons', name));
  }
}

function writeChecksums(directory) {
  const files = listFiles(directory)
    .map((file) => path.relative(directory, file).replaceAll('\\', '/'))
    .filter((relative) => relative !== 'SHA256SUMS');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${files.map((relative) => `${sha256(path.join(directory, relative))}  ${relative}`).join('\n')}\n`);
}

function directoryBytes(target) {
  if (fs.statSync(target).isFile()) return fs.statSync(target).size;
  return listFiles(target).reduce((total, file) => total + fs.statSync(file).size, 0);
}

function gzipBytes(target) {
  const files = fs.statSync(target).isFile() ? [target] : listFiles(target);
  return gzipSync(Buffer.concat(files.map((file) => fs.readFileSync(file))), { level: 9 }).length;
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  walk(directory);
  return files.sort();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--platform') parsed.platform = argv[++index];
    else if (value === '--arch') parsed.arch = argv[++index];
    else if (value === '--output') parsed.output = argv[++index];
    else if (value === '--release-root') parsed.releaseRoot = argv[++index];
    else if (value === '--skip-build') parsed.skipBuild = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function requirePath(target) { if (!fs.existsSync(target)) throw new Error(`Required desktop file is missing: ${target}`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
