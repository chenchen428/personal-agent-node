import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enrollWithCloud } from '../src/cloud-enrollment.mjs';
import { startOnboardingServer } from '../src/onboarding-server.mjs';

test('authorization code redeems a device code and activates Free managed Edge', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-enroll-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const result = await enrollWithCloud({ email: 'User@example.com', authorizationCode: 'invite-1234', slug: 'user-one', cloudUrl: cloud.url, dataRoot, wireGuardExecutor: () => ({ started: true }) });
  assert.equal(result.ok, true);
  assert.equal(result.site.plan, 'free');
  assert.equal(result.site.status, 'active');
  assert.equal(cloud.calls.join(','), 'activate,enroll,heartbeat');
  const providers = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config', 'providers.json'), 'utf8'));
  assert.equal(providers.tunnel.provider, 'personal-agent-cloud');
  assert.equal(providers.tunnel.credentialEnv, 'PERSONAL_AGENT_CLOUD_TOKEN');
  const tunnel = fs.readFileSync(path.join(dataRoot, 'secrets', 'node-identity', 'personal-agent.conf'), 'utf8');
  assert.match(tunnel, /Address = 10\.77\.0\.2\/32/);
  assert.match(tunnel, /AllowedIPs = 10\.77\.0\.1\/32/);
  const wireGuardKey = path.join(dataRoot, 'secrets', 'node-identity', 'wireguard.key');
  assert.ok(fs.statSync(wireGuardKey).isFile());
  if (process.platform !== 'win32') assert.equal(fs.statSync(wireGuardKey).mode & 0o777, 0o600);
  const env = fs.readFileSync(path.join(dataRoot, 'secrets', 'applications', 'site.env'), 'utf8');
  assert.match(env, /PERSONAL_AGENT_CLOUD_TOKEN="node-secret-token"/);
  const metadata = fs.readFileSync(path.join(dataRoot, 'config', 'cloud.json'), 'utf8');
  assert.doesNotMatch(metadata, /node-secret-token|invite-1234/);
});

test('loopback onboarding page submits email, code and slug to the enrollment client', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-onboarding-'));
  const onboarding = await startOnboardingServer({ port: 0, cloudUrl: cloud.url, dataRoot, enrollmentOptions: { wireGuardExecutor: () => ({ started: true }) } });
  t.after(async () => { await close(onboarding.server); await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const page = await fetch(onboarding.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /邮箱[\s\S]*授权码[\s\S]*专属前缀/);
  const response = await fetch(new URL('/api/enroll', onboarding.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com', authorizationCode: 'invite-1234', slug: 'user-one' }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.managedUrl, 'https://user-one.personal-agent.cn');
  assert.equal(body.started, false);
});

test('a failed tunnel authorization resumes without redeeming the invitation twice', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-enroll-resume-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  await assert.rejects(
    enrollWithCloud({ email: 'user@example.com', authorizationCode: 'invite-1234', slug: 'user-one', cloudUrl: cloud.url, dataRoot, wireGuardExecutor: () => { throw new Error('authorization cancelled'); } }),
    /authorization cancelled/
  );
  const pendingPath = path.join(dataRoot, 'secrets', 'applications', 'cloud-enrollment-pending.json');
  assert.ok(fs.existsSync(pendingPath));
  if (process.platform !== 'win32') assert.equal(fs.statSync(pendingPath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(pendingPath, 'utf8'), /node-secret-token/);
  const resumed = await enrollWithCloud({ email: 'user@example.com', authorizationCode: 'already-consumed', slug: 'user-one', cloudUrl: cloud.url, dataRoot, wireGuardExecutor: () => ({ started: true }) });
  assert.equal(resumed.ok, true);
  assert.equal(cloud.calls.join(','), 'activate,enroll,heartbeat');
  assert.equal(fs.existsSync(pendingPath), false);
});

async function mockCloud() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const body = await read(request);
    if (request.url === '/activate') {
      calls.push('activate');
      assert.deepEqual(body, { email: 'user@example.com', code: 'invite-1234', slug: 'user-one' });
      return send(response, 201, { ok: true, site: { id: 'site-1', slug: 'user-one', managedHost: 'user-one.personal-agent.cn', plan: 'free' }, deviceCode: 'device-code-1' });
    }
    if (request.url === '/api/node/enroll') {
      calls.push('enroll'); assert.deepEqual(Object.keys(body).sort(), ['deviceCode', 'publicKey']); assert.equal(body.deviceCode, 'device-code-1'); assert.match(body.publicKey, /^[A-Za-z0-9+/]{43}=$/);
      return send(response, 201, { ok: true, site: { id: 'site-1', slug: 'user-one', managed_host: 'user-one.personal-agent.cn', plan: 'free', status: 'active' }, nodeToken: 'node-secret-token', tunnel: { schemaVersion: 1, endpoint: 'edge.personal-agent.cn:51821', edgePublicKey: `${'E'.repeat(43)}=`, address: '10.77.0.2/32', dns: ['10.77.0.1'], allowedIPs: ['10.77.0.1/32'], persistentKeepalive: 25, originUrl: 'http://10.77.0.2:8843' } });
    }
    if (request.url === '/api/node/heartbeat') {
      calls.push('heartbeat'); assert.equal(request.headers.authorization, 'Bearer node-secret-token'); return send(response, 200, { ok: true, siteId: 'site-1', status: 'active', tunnelGeneration: 1 });
    }
    send(response, 404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, calls, url: `http://127.0.0.1:${server.address().port}` };
}
async function read(request) { const chunks=[]; for await (const chunk of request) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
