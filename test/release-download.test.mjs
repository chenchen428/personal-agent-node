import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadReleaseAsset, validateReleaseUrl } from '../scripts/release-download.mjs';

const assetUrl = 'https://github.com/example/personal-agent-node/releases/download/v1.0.0/asset.tar.gz';

test('release downloader returns a successful fetch without starting a fallback process', async () => {
  let spawned = false;
  const value = await downloadReleaseAsset(assetUrl, {
    fetchImpl: async () => new Response('fetched', { status: 200 }),
    spawnImpl: () => { spawned = true; return { status: 1 }; },
  });
  assert.equal(value.toString(), 'fetched');
  assert.equal(spawned, false);
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
    assert.deepEqual(invocation.args.slice(0, 9), ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2']);
    assert.deepEqual(invocation.args.slice(-2), ['--', assetUrl]);
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
  assert.match(installer, /downloadReleaseAsset\(`\$\{base\}\/SHA256SUMS`\)/);
  assert.match(installer, /createHash\('sha256'\)/);
  assert.match(installer, /Release checksum mismatch/);
  assert.match(installer, /install-private-site-node-release\.mjs/);
});
