#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

  const payloadRoot = path.join(temporary, 'payload');
  fs.mkdirSync(path.join(payloadRoot, 'node'), { recursive: true });
  fs.cpSync(releaseRoot, path.join(payloadRoot, 'release'), { recursive: true, preserveTimestamps: true });
  fs.copyFileSync(nodeRuntime, path.join(payloadRoot, 'node', platform === 'win32' ? 'node.exe' : 'node'));
  fs.copyFileSync(launcherBinary, path.join(payloadRoot, 'release', platform === 'win32' ? 'personal-agent.exe' : 'personal-agent'));
  const payload = path.join(temporary, 'payload.tar.gz');
  const tarArgs = platform === 'win32' ? ['--force-local'] : [];
  run('tar', [...tarArgs, '-czf', payload, '-C', payloadRoot, 'release', 'node']);
  appendPayload(setupBinary, payload);
  run(setupBinary, ['inspect']);

  const asset = packageAsset({ platform, architecture, tag, setupBinary, output, temporary });
  const digest = sha256(asset);
  fs.writeFileSync(`${asset}.sha256`, `${digest}  ${path.basename(asset)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, tag, platform, architecture, target, asset, sha256: digest }, null, 2)}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function verifyInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'), 'utf8'));
  if (manifest.releaseId !== tag.replace(/^v/, '') || manifest.dirty === true) throw new Error('Platform installer requires the exact clean tagged release payload');
  if (!fs.statSync(nodeRuntime).isFile()) throw new Error('Bundled Node runtime is not a file');
}

function buildGo(name, packagePath, outputFile, target) {
  const nativeRoot = path.join(root, 'projects', 'core', 'node', 'native');
  const environment = { ...process.env, CGO_ENABLED: '0', GOOS: target.goos, GOARCH: target.goarch };
  run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.buildVersion=${tag}`, '-o', outputFile, packagePath], { cwd: nativeRoot, env: environment });
  if (platform !== 'win32') fs.chmodSync(outputFile, 0o755);
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
