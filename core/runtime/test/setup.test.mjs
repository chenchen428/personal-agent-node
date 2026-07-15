import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initializeSite } from '../src/config.ts';
import { inspectRemoteConnectivity, setupDiagnostics, setupStatus, writeWebConversationAcceptance } from '../src/setup.ts';

test('setup status separates console, Agent, remote, mail, and optional WeChat readiness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-status-'));
  const dataRoot = path.join(root, 'data');
  const installRoot = path.join(root, 'install');
  const current = path.join(installRoot, 'releases', 'release-one');
  try {
    initializeSite({ dataRoot, domain: 'personal-agent.local' });
    fs.mkdirSync(current, { recursive: true });
    fs.symlinkSync(path.relative(installRoot, current), path.join(installRoot, 'current'));
    fs.writeFileSync(path.join(installRoot, 'installation.json'), `${JSON.stringify({ activeReleaseId: 'release-one' })}\n`);
    const envPath = path.join(dataRoot, 'secrets', 'applications', 'site.env');
    fs.appendFileSync(envPath, 'PERSONAL_AGENT_AUTH_PASSWORD=test-only-password\n');
    fs.writeFileSync(path.join(dataRoot, 'config', 'local-auth.json'), `${JSON.stringify({ schemaVersion: 1, algorithm: 'scrypt', verifier: 'test-verifier' })}\n`);
    fs.mkdirSync(path.join(dataRoot, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'runtime', 'supervisor.json'), `${JSON.stringify({
      pid: 123,
      status: 'running',
      components: Object.fromEntries(['personal-agent-control', 'open-agent-bridge', 'open-agent-bridge-worker', 'personal-agent-control-api', 'personal-agent-app', 'private-site-gateway'].map((name, index) => [name, { pid: index + 10 }])),
    })}\n`);
    writeWebConversationAcceptance({ dataRoot, now: () => new Date('2026-07-15T00:00:00.000Z') });

    const status = await setupStatus({
      dataRoot,
      installRoot,
      env: { PRIVATE_SITE_DATA_ROOT: dataRoot, PRIVATE_SITE_INSTALL_ROOT: installRoot },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      processAlive: () => true,
      portProbe: async () => true,
      codexProbe: async () => ({ installed: true, version: '1.2.3', versionSupported: true, authenticated: true, handshake: true }),
    });
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.readiness.console, 'ready');
    assert.equal(status.readiness.agent, 'ready');
    assert.equal(status.readiness.remote, 'not-selected');
    assert.equal(status.readiness.mail, 'not-selected');
    assert.equal(status.checks.find((check) => check.id === 'channels.wechat').state, 'not-selected');
    assert.equal(status.checks.find((check) => check.id === 'mail.identity').state, 'not-selected');
    assert.doesNotMatch(JSON.stringify(status), /test-only-password|secrets\/applications/);
    const diagnostics = setupDiagnostics(status);
    assert.match(diagnostics.diagnosticDigest, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /test-only-password|secrets\/applications/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('remote readiness proves DNS, TLS, and authenticated app separately', async () => {
  const ready = await inspectRemoteConnectivity({
    host: 'agent.example.com',
    token: 'test-token',
    lookup: async () => ({ address: '203.0.113.10' }),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://agent.example.com/app');
      assert.equal(options.headers.authorization, 'Bearer test-token');
      return { status: 200 };
    },
  });
  assert.deepEqual(ready, { dns: true, tls: true, remoteApp: true });
  assert.deepEqual(await inspectRemoteConnectivity({ host: 'bad host' }), { dns: false, tls: false, remoteApp: false });
  const tlsFailure = await inspectRemoteConnectivity({
    host: 'agent.example.com',
    lookup: async () => ({ address: '203.0.113.10' }),
    fetchImpl: async () => { throw new Error('certificate failure'); },
  });
  assert.deepEqual(tlsFailure, { dns: true, tls: false, remoteApp: false });
});

test('setup status blocks downstream Agent checks when Codex is missing', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-missing-codex-'));
  try {
    const status = await setupStatus({
      dataRoot,
      installRoot: path.join(dataRoot, 'install'),
      portProbe: async () => false,
      codexProbe: async () => ({ installed: false, version: '', versionSupported: false, authenticated: false, handshake: false }),
    });
    assert.equal(status.readiness.console, 'action-required');
    assert.equal(status.readiness.agent, 'blocked');
    assert.equal(status.checks.find((check) => check.id === 'agent.codex.executable').state, 'action-required');
    assert.equal(status.checks.find((check) => check.id === 'agent.codex.handshake').state, 'blocked');
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
