import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadReleaseAsset, validateReleaseUrl } from '../scripts/release-download.mjs';
import { archiveExtractionArgs, validateArchiveListing } from '../scripts/install-from-github-release.mjs';

const assetUrl = 'https://github.com/example/personal-agent-node/releases/download/v1.0.0/asset.tar.gz';

test('release downloader returns a successful fetch without starting a fallback process', async () => {
  let spawned = false;
  let fetchSignal;
  const value = await downloadReleaseAsset(assetUrl, {
    fetchImpl: async (_url, options) => { fetchSignal = options.signal; return new Response('fetched', { status: 200 }); },
    spawnImpl: () => { spawned = true; return { status: 1 }; },
  });
  assert.equal(value.toString(), 'fetched');
  assert.equal(spawned, false);
  assert.ok(fetchSignal instanceof AbortSignal);
});

test('release fetch timeout signal is bounded and triggers the platform fallback', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-timeout-test-'));
  const timeoutSignal = { aborted: false };
  let timeoutMilliseconds;
  let fallbackStarted = false;
  try {
    const value = await downloadReleaseAsset(assetUrl, {
      fetchTimeoutMs: 3210,
      createTimeoutSignal(milliseconds) { timeoutMilliseconds = milliseconds; return timeoutSignal; },
      fetchImpl: async (_url, options) => {
        assert.equal(options.signal, timeoutSignal);
        throw Object.assign(new Error('fetch timed out'), { name: 'TimeoutError' });
      },
      platform: 'linux',
      temporaryRoot,
      spawnImpl(_command, args) {
        fallbackStarted = true;
        fs.writeFileSync(args[args.indexOf('--output') + 1], 'timeout-fallback');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(timeoutMilliseconds, 3210);
    assert.equal(fallbackStarted, true);
    assert.equal(value.toString(), 'timeout-fallback');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('release downloader falls back to curl with shell-free HTTPS-only arguments', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-curl-test-'));
  let invocation;
  try {
    const value = await downloadReleaseAsset(assetUrl, {
      fetchImpl: async () => { throw new Error('proxy-aware fallback required'); },
      platform: 'darwin',
      temporaryRoot,
      spawnImpl(command, args, options) {
        invocation = { command, args, options };
        fs.writeFileSync(args[args.indexOf('--output') + 1], 'curl-fallback');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(value.toString(), 'curl-fallback');
    assert.equal(invocation.command, 'curl');
    assert.equal(invocation.options.shell, false);
    assert.deepEqual(invocation.args.slice(0, 15), [
      '--fail', '--silent', '--show-error', '--location',
      '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2',
      '--ipv4', '--http1.1', '--connect-timeout', '10', '--max-time', '90',
    ]);
    assert.deepEqual(invocation.args.slice(-2), ['--', assetUrl]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('release downloader uses the official GitHub API when the direct asset host is unreachable', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-api-fallback-test-'));
  const invocations = [];
  try {
    const value = await downloadReleaseAsset(assetUrl, {
      fetchImpl: async () => { throw new Error('direct fetch unavailable'); },
      platform: 'darwin',
      temporaryRoot,
      spawnImpl(command, args, options) {
        invocations.push({ command, args, options });
        const output = args[args.indexOf('--output') + 1];
        const requestedUrl = args.at(-1);
        if (invocations.length === 1) return { status: 28, stdout: '', stderr: 'connect timeout' };
        if (requestedUrl.includes('/releases/tags/v1.0.0')) {
          fs.writeFileSync(output, JSON.stringify({ assets: [{ name: 'asset.tar.gz', url: 'https://api.github.com/repos/example/personal-agent-node/releases/assets/123' }] }));
          return { status: 0, stdout: '', stderr: '' };
        }
        assert.equal(requestedUrl, 'https://api.github.com/repos/example/personal-agent-node/releases/assets/123');
        assert.ok(args.includes('Accept: application/octet-stream'));
        fs.writeFileSync(output, 'api-fallback');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(value.toString(), 'api-fallback');
    assert.equal(invocations.length, 3);
    assert.ok(invocations.every((entry) => entry.command === 'curl' && entry.options.shell === false));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('release downloader falls back to PowerShell with URL and output as separate arguments', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-powershell-test-'));
  let invocation;
  try {
    const value = await downloadReleaseAsset(assetUrl, {
      fetchImpl: async () => { throw new Error('proxy-aware fallback required'); },
      platform: 'win32',
      temporaryRoot,
      spawnImpl(command, args, options) {
        invocation = { command, args, options, script: fs.readFileSync(args[args.indexOf('-File') + 1], 'utf8') };
        fs.writeFileSync(args.at(-1), 'powershell-fallback');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(value.toString(), 'powershell-fallback');
    assert.equal(invocation.command, 'powershell.exe');
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.args[invocation.args.indexOf('-Uri') + 1], assetUrl);
    assert.doesNotMatch(invocation.script, /github\.com/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('release downloader rejects unsafe URLs before fetch or fallback', async () => {
  for (const value of ['http://github.com/example/asset', 'https://user:secret@github.com/example/asset', 'https://example.com/asset', 'https://github.com/example/asset#fragment']) {
    assert.throws(() => validateReleaseUrl(value), /HTTPS github\.com/);
  }
});

test('GitHub installer keeps checksum verification after transport fallback', () => {
  const installer = fs.readFileSync(new URL('../scripts/install-from-github-release.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(installer, /from ['"]\.\//, 'published installer must not require sibling files');
  assert.match(installer, /if \(!tag\) throw new Error/);
  assert.match(installer, /downloadReleaseAsset\(`\$\{base\}\/SHA256SUMS`\)/);
  assert.match(installer, /createHash\('sha256'\)/);
  assert.match(installer, /Release checksum mismatch/);
  assert.match(installer, /install-private-site-node-release\.mjs/);
  assert.match(installer, /prepareEntrypoint/);
  assert.match(installer, /\[prepareEntrypoint, 'prepare'\]/);
  assert.match(installer, /PRIVATE_SITE_INSTALL_ROOT/);
  assert.match(installer, /PRIVATE_SITE_DATA_ROOT/);
});

test('platform release extraction needs no Agent compatibility-link exceptions', () => {
  const layout = validateArchiveListing([
    '0.1.0/','0.1.0/AGENTS.md','0.1.0/skills/','0.1.0/skills/example/SKILL.md',
  ].join('\n'));
  assert.deepEqual(archiveExtractionArgs('release.tar.gz', 'extracted', layout, 'win32'), [
    '-xzf', 'release.tar.gz', '-C', 'extracted',
  ]);
  assert.deepEqual(archiveExtractionArgs('release.tar.gz', 'extracted', layout, 'linux'), [
    '-xzf', 'release.tar.gz', '-C', 'extracted',
  ]);
});

test('release extraction rejects path traversal and multiple archive roots before unpacking', () => {
  for (const listing of [
    '0.1.0/../outside',
    '/absolute/path',
    'C:/absolute/path',
    '0.1.0\\windows-path',
    '0.1.0/file\nother-root/file',
  ]) assert.throws(() => validateArchiveListing(listing), /unsafe path|multiple roots/);
});

test('release packaging delegates customer installation to self-contained Go platform artifacts', () => {
  const packager = fs.readFileSync(new URL('../scripts/release-package.mjs', import.meta.url), 'utf8');
  const platformBuilder = fs.readFileSync(new URL('../scripts/build-platform-installer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(packager, /installer\.mjs|install-from-github-release\.mjs/);
  assert.match(platformBuilder, /personal-agent-setup/);
  assert.match(platformBuilder, /projects['"], ['"]core['"], ['"]node['"], ['"]native/);
  assert.match(platformBuilder, /nodeRuntime/);
});

test('public installation documentation pins the workspace release version', () => {
  const root = new URL('..', import.meta.url);
  const version = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
  for (const relative of ['README.md', 'README.en.md', 'docs/getting-started.md']) {
    const document = fs.readFileSync(new URL(relative, root), 'utf8');
    assert.match(document, new RegExp(`personal-agent-node-v${version.replaceAll('.', '\\.')}-(?:windows|macos|linux)`), relative);
    assert.match(document, /Setup Center/i, relative);
    assert.doesNotMatch(document, /installer\.mjs|Copyable one-click Agent prompt|复制给本机 Agent/, relative);
  }
});
