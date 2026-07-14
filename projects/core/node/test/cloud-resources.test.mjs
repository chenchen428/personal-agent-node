import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loginCloudResources, managedServiceReadiness, onboardingStatus, refreshCloudResources } from '../src/cloud-resources.mjs';

const resources = {
  account: { githubUserId: '12345678', githubLogin: 'owner-login' },
  site: { id: 'site_one', status: 'active', managedHost: 'owner-login.chenjianhui.site', customDomain: '', customDomainStatus: '', publicDomain: 'owner-login.chenjianhui.site' },
  agentMailAddress: 'agent@owner-login.chenjianhui.site',
  mailOperational: false,
  eligibility: { publicDomain: true, agentMail: true, managedMail: true, managedConfiguration: true },
  generatedAt: '2026-07-15T00:00:00.000Z',
};

test('CLI password login stores no password and enables managed services only after public domain and mail detection', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-cloud-resources-'));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/cli/session')) {
      assert.deepEqual(JSON.parse(options.body), { githubUserId: '12345678', password: 'correct horse battery staple' });
      return Response.json({ ok: true, token: 'cli-session-token-that-is-long-enough', expiresAt: '2026-07-16T00:00:00.000Z', resources }, { status: 201 });
    }
    assert.equal(options.headers.authorization, 'Bearer cli-session-token-that-is-long-enough');
    return Response.json({ ok: true, resources });
  };
  try {
    const before = managedServiceReadiness({ dataRoot });
    assert.equal(before.state, 'disabled');
    assert.equal(before.reason, 'cloud-binding-required');
    const loggedIn = await loginCloudResources({
      githubUserId: '12345678',
      password: 'correct horse battery staple',
      cloudUrl: 'http://127.0.0.1:8765',
      dataRoot,
      fetchImpl,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    });
    assert.equal(loggedIn.serviceReadiness.state, 'enabled');
    assert.equal(loggedIn.serviceReadiness.managedMail.enabled, true);
    assert.equal(loggedIn.serviceReadiness.managedConfiguration.enabled, true);
    const publicDocument = fs.readFileSync(path.join(dataRoot, 'config', 'cloud-resources.json'), 'utf8');
    assert.doesNotMatch(publicDocument, /correct horse|cli-session-token/);
    const secretDocument = fs.readFileSync(path.join(dataRoot, 'secrets', 'applications', 'cloud-cli-session.json'), 'utf8');
    assert.match(secretDocument, /cli-session-token/);
    assert.doesNotMatch(secretDocument, /correct horse/);
    const refreshed = await refreshCloudResources({ dataRoot, fetchImpl, now: () => new Date('2026-07-15T01:00:00.000Z') });
    assert.equal(refreshed.refreshed, true);
    assert.equal(calls.length, 2);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('managed services fail closed for a local domain, mismatched mail, or missing WeChat binding', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-cloud-resources-invalid-'));
  try {
    fs.mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'config', 'cloud-resources.json'), `${JSON.stringify({ schemaVersion: 1, resources: { ...resources, site: { ...resources.site, publicDomain: 'personal-agent.local' } }, syncedAt: '2026-07-15T00:00:00.000Z' })}\n`);
    assert.equal(managedServiceReadiness({ dataRoot }).reason, 'public-domain-required');
    fs.writeFileSync(path.join(dataRoot, 'config', 'cloud-resources.json'), `${JSON.stringify({ schemaVersion: 1, resources: { ...resources, agentMailAddress: 'agent@other.example' }, syncedAt: '2026-07-15T00:00:00.000Z' })}\n`);
    assert.equal(managedServiceReadiness({ dataRoot }).reason, 'agent-mail-required');
    const onboarding = onboardingStatus({ dataRoot });
    assert.equal(onboarding.complete, false);
    assert.equal(onboarding.wechat.bound, false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
