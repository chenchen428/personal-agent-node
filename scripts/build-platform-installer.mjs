#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyOpenCliRuntime } from './lib/opencli-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const platform = args.platform || process.platform;
const architecture = args.arch || process.arch;
const target = targetFor(platform, architecture);
const tag = required(args.tag, '--tag');
const releaseRoot = path.resolve(required(args.releaseRoot, '--release-root'));
const nodeRuntime = path.resolve(args.nodeRuntime || process.execPath);
const output = path.resolve(args.output || path.join(root, 'dist', 'platform', tag));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-platform-'));

try {
  verifyInputs();
  fs.mkdirSync(output, { recursive: true });
  const setupBinary = path.join(temporary, platform === 'win32' ? 'personal-agent-setup.exe' : 'personal-agent-setup');
  buildGo('personal-agent-setup', './cmd/personal-agent-setup', setupBinary, target);
  const launcherBinary = path.join(temporary, platform === 'win32' ? 'personal-agent.exe' : 'personal-agent');
  buildGo('personal-agent', './cmd/personal-agent', launcherBinary, target);
  const uiLauncherBinary = path.join(temporary, platform === 'win32' ? 'personal-agent-ui.exe' : 'personal-agent-ui');
  buildGo('personal-agent-ui', './cmd/personal-agent-ui', uiLauncherBinary, target, { gui: true });

  const payloadRoot = path.join(temporary, 'payload');
  fs.mkdirSync(path.join(payloadRoot, 'node'), { recursive: true });
  const payloadRelease = path.join(payloadRoot, 'release');
  fs.cpSync(releaseRoot, payloadRelease, { recursive: true, preserveTimestamps: true });
  fs.copyFileSync(nodeRuntime, path.join(payloadRoot, 'node', platform === 'win32' ? 'node.exe' : 'node'));
  fs.copyFileSync(launcherBinary, path.join(payloadRelease, platform === 'win32' ? 'personal-agent.exe' : 'personal-agent'));
  fs.copyFileSync(uiLauncherBinary, path.join(payloadRelease, platform === 'win32' ? 'personal-agent-ui.exe' : 'personal-agent-ui'));
  signPlatformPayload(payloadRelease);
  finalizePlatformRelease(payloadRelease);
  const payload = path.join(temporary, 'payload.tar.gz');
  run('tar', ['-czf', path.basename(payload), '-C', path.basename(payloadRoot), 'release', 'node'], { cwd: temporary });
  appendPayload(setupBinary, payload);
  run(setupBinary, ['inspect']);

  const updater = packageUpdater({ platform, architecture, tag, setupBinary, output });
  const asset = packageAsset({ platform, architecture, tag, setupBinary, output, temporary });
  const digest = sha256(asset);
  process.stdout.write(`${JSON.stringify({ ok: true, tag, platform, architecture, target, asset, updater, sha256: digest, updaterSha256: sha256(updater) }, null, 2)}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function verifyInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'), 'utf8'));
  const dirtyAllowed = process.env.PERSONAL_AGENT_ALLOW_DIRTY_RELEASE === '1';
  if (manifest.releaseId !== tag.replace(/^v/, '') || (manifest.dirty === true && !dirtyAllowed)) throw new Error('Platform installer requires the exact clean tagged release payload');
  if (manifest.desktopShell?.framework !== 'tauri' || manifest.desktopShell?.platform !== `${platform}-${architecture}`) throw new Error('Platform installer requires the matching Tauri desktop overlay');
  const desktopEntrypoint = path.join(releaseRoot, ...String(manifest.desktopShell.entrypoint || '').split('/'));
  if (!manifest.desktopShell.entrypoint || !fs.existsSync(desktopEntrypoint)) throw new Error('Tauri desktop entrypoint is missing');
  if (!fs.statSync(nodeRuntime).isFile()) throw new Error('Bundled Node runtime is not a file');
  const openCliRuntime = verifyOpenCliRuntime({ releaseRoot });
  if (manifest.browserExecutors?.opencli?.entrypoint !== openCliRuntime.descriptor.entrypoint) throw new Error('Bundled OpenCLI runtime is not declared by the release manifest');
}

function buildGo(name, packagePath, outputFile, target, options = {}) {
  const nativeRoot = path.join(root, 'core', 'runtime', 'native');
  const environment = { ...process.env, CGO_ENABLED: '0', GOOS: target.goos, GOARCH: target.goarch };
  const subsystem = platform === 'win32' && options.gui ? ' -H windowsgui' : '';
  run('go', ['build', '-trimpath', '-ldflags', `-s -w${subsystem} -X main.buildVersion=${tag}`, '-o', outputFile, packagePath], { cwd: nativeRoot, env: environment });
  if (platform !== 'win32') fs.chmodSync(outputFile, 0o755);
}

function signPlatformPayload(payloadRelease) {
  if (platform === 'win32') {
    const certificate = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_CERTIFICATE || '').trim();
    const password = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_PASSWORD || '');
    if (args.requireSigning && (!certificate || !password)) throw new Error('Windows release signing certificate and password are required');
    if (!certificate) return;
    for (const file of listFiles(payloadRelease).filter((entry) => entry.toLowerCase().endsWith('.exe'))) {
      run(resolveSignTool(), ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/f', certificate, '/p', password, file]);
      run(resolveSignTool(), ['verify', '/pa', '/v', file]);
    }
    return;
  }
  if (platform === 'darwin') {
    const identity = String(process.env.PERSONAL_AGENT_APPLE_APPLICATION_IDENTITY || '').trim();
    if (args.requireSigning && !identity) throw new Error('macOS application signing identity is required');
    if (!identity) return;
    const app = path.join(payloadRelease, 'desktop', 'Personal Agent.app');
    run('codesign', ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, app]);
    for (const binary of [path.join(payloadRelease, 'personal-agent'), path.join(payloadRelease, 'personal-agent-ui')]) {
      run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, binary]);
    }
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  }
}

function finalizePlatformRelease(payloadRelease) {
  const manifestPath = path.join(payloadRelease, 'release-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.desktopShell.stableLauncher = platform === 'win32' ? 'personal-agent-ui.exe' : 'personal-agent-ui';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const entries = listFiles(payloadRelease)
    .map((file) => path.relative(payloadRelease, file).replaceAll('\\', '/'))
    .filter((relative) => relative !== 'SHA256SUMS');
  fs.writeFileSync(path.join(payloadRelease, 'SHA256SUMS'), `${entries.map((relative) => `${sha256(path.join(payloadRelease, relative))}  ${relative}`).join('\n')}\n`);
}

function appendPayload(binaryPath, payloadPath) {
  const payload = fs.readFileSync(payloadPath);
  const footer = Buffer.alloc(64);
  footer.write('PERSONAL_AGENT_PAYLOAD_1', 0, 'ascii');
  footer.writeBigUInt64BE(BigInt(payload.length), 24);
  crypto.createHash('sha256').update(payload).digest().copy(footer, 32);
  fs.appendFileSync(binaryPath, payload);
  fs.appendFileSync(binaryPath, footer);
}

function packageAsset({ platform, architecture, tag, setupBinary, output, temporary }) {
  const label = architecture === 'x64' ? 'x64' : 'arm64';
  if (platform === 'win32') {
    const target = path.join(output, `personal-agent-node-${tag}-windows-${label}-installer.exe`);
    fs.copyFileSync(setupBinary, target);
    const certificate = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_CERTIFICATE || '').trim();
    const password = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_PASSWORD || '');
    if (args.requireSigning && (!certificate || !password)) throw new Error('Windows release signing certificate and password are required');
    if (certificate) {
      run(resolveSignTool(), ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/f', certificate, '/p', password, target]);
      run(resolveSignTool(), ['verify', '/pa', '/v', target]);
    }
    return target;
  }
  if (platform === 'linux') {
    const stage = path.join(temporary, `personal-agent-node-${tag}-linux-${label}`);
    fs.mkdirSync(stage);
    fs.copyFileSync(setupBinary, path.join(stage, 'personal-agent-setup'));
    fs.chmodSync(path.join(stage, 'personal-agent-setup'), 0o755);
    fs.writeFileSync(path.join(stage, 'README.txt'), 'Run ./personal-agent-setup on this computer. The installer opens the local Setup Center.\n');
    const tarFile = path.join(temporary, `${path.basename(stage)}.tar`);
    run('tar', ['-cf', tarFile, '-C', temporary, path.basename(stage)]);
    const target = path.join(output, `${path.basename(stage)}.tar.zst`);
    run('zstd', ['-q', '-f', '-19', tarFile, '-o', target]);
    return target;
  }
  if (platform === 'darwin') {
    if (process.platform !== 'darwin') throw new Error('macOS package assembly must run on a native macOS runner');
    const packageRoot = path.join(temporary, 'pkgroot');
    const appRoot = path.join(packageRoot, 'Applications', 'Personal Agent Setup.app', 'Contents');
    fs.mkdirSync(path.join(appRoot, 'MacOS'), { recursive: true });
    fs.copyFileSync(setupBinary, path.join(appRoot, 'MacOS', 'personal-agent-setup'));
    fs.chmodSync(path.join(appRoot, 'MacOS', 'personal-agent-setup'), 0o755);
    fs.writeFileSync(path.join(appRoot, 'Info.plist'), infoPlist(tag));
    const appIdentity = String(process.env.PERSONAL_AGENT_APPLE_APPLICATION_IDENTITY || '').trim();
    const installerIdentity = String(process.env.PERSONAL_AGENT_APPLE_INSTALLER_IDENTITY || '').trim();
    if (args.requireSigning && (!appIdentity || !installerIdentity)) throw new Error('macOS release signing identities are required');
    if (appIdentity) run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', appIdentity, path.join(packageRoot, 'Applications', 'Personal Agent Setup.app')]);
    const target = path.join(output, `personal-agent-node-${tag}-macos-${label}.pkg`);
    const packageArgs = ['--root', packageRoot, '--identifier', 'site.personal-agent.setup', '--version', tag.replace(/^v/, ''), '--install-location', '/', target];
    if (installerIdentity) packageArgs.splice(packageArgs.length - 1, 0, '--sign', installerIdentity);
    run('pkgbuild', packageArgs);
    const notaryKey = String(process.env.PERSONAL_AGENT_APPLE_NOTARY_KEY || '').trim();
    const notaryKeyId = String(process.env.PERSONAL_AGENT_APPLE_NOTARY_KEY_ID || '').trim();
    const notaryIssuer = String(process.env.PERSONAL_AGENT_APPLE_NOTARY_ISSUER || '').trim();
    if (args.requireSigning && (!notaryKey || !notaryKeyId || !notaryIssuer)) throw new Error('macOS notarization API credentials are required');
    if (notaryKey) {
      run('xcrun', ['notarytool', 'submit', target, '--key', notaryKey, '--key-id', notaryKeyId, '--issuer', notaryIssuer, '--wait']);
      run('xcrun', ['stapler', 'staple', target]);
      run('pkgutil', ['--check-signature', target]);
      run('spctl', ['--assess', '--type', 'install', '--verbose=2', target]);
    }
    return target;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function packageUpdater({ platform, architecture, tag, setupBinary, output }) {
  const label = architecture === 'x64' ? 'x64' : 'arm64';
  const platformLabel = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform];
  const target = path.join(output, `personal-agent-node-${tag}-${platformLabel}-${label}-updater${platform === 'win32' ? '.exe' : ''}`);
  fs.copyFileSync(setupBinary, target);
  if (platform !== 'win32') fs.chmodSync(target, 0o755);
  if (platform === 'win32') {
    const certificate = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_CERTIFICATE || '').trim();
    const password = String(process.env.PERSONAL_AGENT_WINDOWS_SIGNING_PASSWORD || '');
    if (args.requireSigning && (!certificate || !password)) throw new Error('Windows release signing certificate and password are required');
    if (certificate) {
      run(resolveSignTool(), ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/f', certificate, '/p', password, target]);
      run(resolveSignTool(), ['verify', '/pa', '/v', target]);
    }
  }
  if (platform === 'darwin') {
    const identity = String(process.env.PERSONAL_AGENT_APPLE_APPLICATION_IDENTITY || '').trim();
    if (args.requireSigning && !identity) throw new Error('macOS application signing identity is required');
    if (identity) {
      run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, target]);
      run('codesign', ['--verify', '--strict', '--verbose=2', target]);
    }
  }
  return target;
}

function resolveSignTool() {
  const configured = String(process.env.PERSONAL_AGENT_SIGNTOOL || '').trim();
  if (configured) return configured;
  const kits = path.join(process.env['ProgramFiles(x86)'] || '', 'Windows Kits', '10', 'bin');
  if (!fs.existsSync(kits)) return 'signtool.exe';
  const versions = fs.readdirSync(kits).filter((name) => /^10\.\d+/.test(name)).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(kits, version, 'x64', 'signtool.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'signtool.exe';
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

function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>personal-agent-setup</string><key>CFBundleIdentifier</key><string>site.personal-agent.setup</string><key>CFBundleName</key><string>Personal Agent Setup</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version.replace(/^v/, '')}</string><key>LSMinimumSystemVersion</key><string>11.0</string></dict></plist>\n`;
}

function targetFor(platform, architecture) {
  const goos = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform];
  const goarch = { x64: 'amd64', arm64: 'arm64' }[architecture];
  if (!goos || !goarch || (platform === 'win32' && architecture !== 'x64')) throw new Error(`Unsupported platform target: ${platform}-${architecture}`);
  return { goos, goarch };
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: options.cwd || root, env: options.env || process.env, encoding: 'utf8', windowsHide: true, stdio: options.stdio || 'pipe' });
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout || result.error || '').trim()}`);
  return result.stdout;
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function required(value, label) { if (!String(value || '').trim()) throw new Error(`${label} is required`); return String(value); }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const key = argv[index]; if (key === '--tag') out.tag = argv[++index]; else if (key === '--release-root') out.releaseRoot = argv[++index]; else if (key === '--node-runtime') out.nodeRuntime = argv[++index]; else if (key === '--output') out.output = argv[++index]; else if (key === '--platform') out.platform = argv[++index]; else if (key === '--arch') out.arch = argv[++index]; else if (key === '--require-signing') out.requireSigning = true; else throw new Error(`Unknown option: ${key}`); } return out; }
