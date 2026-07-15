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
    if (process.platform === 'win32') fs.writeFileSync(path.join(installRoot, 'current'), `${current}\n`);
    else fs.symlinkSync(path.relative(installRoot, current), path.join(installRoot, 'current'));
    fs.writeFileSync(path.join(installRoot, 'installation.json'), `${JSON.stringify({ activeReleaseId: 'release-one' })}\n`);
    const envPath = path.join(dataRoot, 'secrets', 'applications', 'site.env');
    fs.appendFileSync(envPath, 'PERSONAL_AGENT_AUTH_PASSWORD=test-only-password\n');
    fs.writeFileSync(path.join(dataRoot, 'config', 'local-auth.json'), `${JSON.stringify({ schemaVersion: 1, algorithm: 'scrypt', verifier: 'test-verifier' })}\n`);
    fs.mkdirSync(path.join(dataRoot, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'runtime', 'supervisor.json'), `${JSON.stringify({
      pid: 123,
      status: 'running',
      components: Object.fromEntries(['personal-agent-control', 'open-agent-bridge', 'open-agent-bridge-worker', 'personal-agent-control-api', 'personal-agent-app', 'private-site-gateway', 'personal-agent-tunnel'].map((name, index) => [name, { pid: index + 10 }])),
    })}\n`);
    fs.mkdirSync(path.join(dataRoot, 'runtime', 'setup'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'runtime', 'setup', 'managed-cloud-action.json'), `${JSON.stringify({ schemaVersion: 1, state: 'running', phase: 'resources', pid: 123, secret: 'must-not-leak' })}\n`);
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
    assert.match(status.checks.find((check) => check.id === 'agent.codex.executable').why, /Codex/);
    assert.match(status.checks.find((check) => check.id === 'agent.codex.executable').guidance, /官方 Codex CLI 指南/);
    assert.ok(status.checks.every((check) => check.why && check.guidance));
    assert.deepEqual(status.actions.managedCloud, { state: 'running', phase: 'resources' });
    assert.doesNotMatch(JSON.stringify(status), /test-only-password|secrets\/applications/);
    const diagnostics = setupDiagnostics(status);
    assert.match(diagnostics.diagnosticDigest, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /test-only-password|secrets\/applications/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /must-not-leak|"pid"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup status rejects a missing Windows-style release pointer target', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-pointer-'));
  const dataRoot = path.join(root, 'data');
  const installRoot = path.join(root, 'install');
  try {
    initializeSite({ dataRoot, domain: 'personal-agent.local' });
    fs.mkdirSync(installRoot, { recursive: true });
    fs.writeFileSync(path.join(installRoot, 'current'), `${path.join(installRoot, 'releases', 'missing')}\n`);
    fs.writeFileSync(path.join(installRoot, 'installation.json'), `${JSON.stringify({ activeReleaseId: 'missing' })}\n`);

    const status = await setupStatus({
      dataRoot,
      installRoot,
      env: {},
      processAlive: () => false,
      portProbe: async () => false,
      codexProbe: async () => ({ installed: false, version: '', versionSupported: false, authenticated: false, handshake: false }),
      remoteProbe: async () => ({ dns: false, tls: false, remoteApp: false }),
    });

    assert.equal(status.checks.find((entry) => entry.id === 'installation.release')?.evidence.installed, false);
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

test('managed remote readiness requires a fresh reverse application tunnel instead of a network interface', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-reverse-tunnel-'));
  try {
    const initialized = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const now = new Date('2026-07-15T12:00:00.000Z');
    fs.writeFileSync(path.join(dataRoot, 'config', 'cloud.json'), `${JSON.stringify({
      schemaVersion: 2,
      cloudUrl: 'https://chenjianhui.site',
      managedHost: 'owner.chenjianhui.site',
      siteId: 'site-1',
      enrolledAt: now.toISOString(),
      tunnel: { protocol: 'pa-reverse-ws-v1', endpoint: 'wss://relay.chenjianhui.site/v1/connect', heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1 },
    })}\n`);
    fs.writeFileSync(path.join(dataRoot, 'config', 'cloud-resources.json'), `${JSON.stringify({
      schemaVersion: 1,
      resources: {
        site: { managedHost: 'owner.chenjianhui.site', publicDomain: 'owner.chenjianhui.site' },
        agentMailAddress: 'agent@owner.chenjianhui.site',
        eligibility: { managedMail: true, managedConfiguration: true },
      },
      syncedAt: now.toISOString(),
    })}\n`);
    fs.writeFileSync(initialized.config.configPath, `${JSON.stringify({ ...initialized.config.site, connectionMode: 'managed-cloud' })}\n`);
    fs.mkdirSync(path.join(dataRoot, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, 'runtime', 'setup'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'runtime', 'reverse-tunnel.json'), `${JSON.stringify({ schemaVersion: 1, protocol: 'pa-reverse-ws-v1', state: 'ready', generation: 1, lastPongAt: now.toISOString() })}\n`);
    fs.writeFileSync(path.join(dataRoot, 'runtime', 'setup', 'managed-cloud-action.json'), `${JSON.stringify({ schemaVersion: 1, state: 'failed', phase: 'enrollment', code: 'CLI_EXIT_7' })}\n`);
    const status = await setupStatus({
      dataRoot,
      installRoot: path.join(dataRoot, 'install'),
      now: () => now,
      portProbe: async () => false,
      codexProbe: async () => ({ installed: false, version: '', versionSupported: false, authenticated: false, handshake: false }),
      remoteProbe: async () => ({ dns: true, tls: true, remoteApp: true }),
    });
    assert.equal(status.checks.find((check) => check.id === 'connectivity.enrollment').state, 'ready');
    assert.equal(status.checks.find((check) => check.id === 'connectivity.heartbeat').state, 'ready');
    assert.equal(status.checks.find((check) => check.id === 'connectivity.tunnel').state, 'ready');
    assert.match(status.checks.find((check) => check.id === 'connectivity.tunnel').summary, /应用层反向隧道/);
    assert.equal(status.readiness.remote, 'ready');
    assert.deepEqual(status.actions.managedCloud, { state: 'succeeded', phase: 'complete' });
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
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
