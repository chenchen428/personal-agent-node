import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enrollWithCloudDeviceAuthorization, pollCloudDeviceAuthorization, resolveCloudUrl, startCloudDeviceAuthorization } from '../src/cloud-enrollment.ts';
import { initializeSite } from '../src/config.ts';

test('Cloud URL resolution prefers an explicit CLI value, then environment, then the managed default', () => {
  assert.equal(resolveCloudUrl({ cloudUrl: 'https://explicit.example', env: { PERSONAL_AGENT_CLOUD_URL: 'https://environment.example' } }), 'https://explicit.example');
  assert.equal(resolveCloudUrl({ env: { PERSONAL_AGENT_CLOUD_URL: 'https://environment.example' } }), 'https://environment.example');
  assert.equal(resolveCloudUrl({ env: {} }), 'https://personal-agent.cn');
});

test('Cloud connection failures expose a stable network error instead of an authorization error', async () => {
  await assert.rejects(
    startCloudDeviceAuthorization({ cloudUrl: 'https://personal-agent.cn', fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (error) => error.code === 'CLOUD_NETWORK_UNREACHABLE' && /DNS|网络/.test(error.message),
  );
});

test('browser device authorization emits only public codes then consumes a one-time enrollment credential', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-device-auth-'));
  const opened = [];
  const progress = [];
  const delays = [];
  let clock = Date.parse('2026-07-13T12:00:00.000Z');
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const initialized = initializeSite({ domain: 'personal-agent.local', dataRoot });
  const result = await enrollWithCloudDeviceAuthorization({
    cloudUrl: cloud.url,
    dataRoot,
    openBrowser: async (url) => { opened.push(url); return true; },
    onAuthorization: (authorization) => progress.push(authorization),
    sleep: async (milliseconds) => { delays.push(milliseconds); clock += milliseconds; },
    now: () => clock,
  });
  assert.equal(result.ok, true);
  assert.equal(result.site.managedHost, 'user-one.chenjianhui.site');
  assert.deepEqual(cloud.calls, ['auth-start', 'auth-poll', 'auth-poll', 'auth-poll', 'enroll', 'heartbeat']);
  assert.deepEqual(delays, [1000, 2000, 9000]);
  assert.equal(opened[0], `${cloud.url}/connect?code=PA-1234`);
  assert.equal(progress[0].userCode, 'PA-1234');
  assert.equal('deviceCode' in progress[0], false);
  assert.equal('enrollmentCredential' in progress[0], false);
  assert.equal('nodeToken' in result, false);
  assert.equal('localPassword' in result, false);
  const metadata = fs.readFileSync(path.join(initialized.config.configDir, 'cloud.json'), 'utf8');
  assert.doesNotMatch(metadata, /device-code-123456|enrollment-credential-123456|node-secret-token/);
  const env = fs.readFileSync(initialized.config.envPath, 'utf8');
  assert.match(env, /PERSONAL_AGENT_CLOUD_TOKEN="node-secret-token"/);
  assert.match(env, /PERSONAL_AGENT_CLOUD_REFRESH_TOKEN="refresh-secret-token/);
  assert.doesNotMatch(metadata, /refresh-secret-token/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(initialized.config.envPath).mode & 0o777, 0o600);
});

test('browser authorization attaches an existing local-only Node without replacing its identity or data', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-device-upgrade-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const initialized = initializeSite({ domain: 'personal-agent.local', dataRoot });
  const original = JSON.parse(fs.readFileSync(initialized.config.configPath, 'utf8'));
  fs.writeFileSync(path.join(initialized.config.dataRoot, 'memory.txt'), 'preserve me');
  const result = await enrollWithCloudDeviceAuthorization({
    cloudUrl: cloud.url,
    dataRoot,
    openBrowser: async () => true,
    sleep: async () => {},
  });
  const attached = JSON.parse(fs.readFileSync(initialized.config.configPath, 'utf8'));
  assert.equal(result.site.managedHost, 'user-one.chenjianhui.site');
  assert.equal(attached.siteId, original.siteId);
  assert.equal(attached.nodeId, original.nodeId);
  assert.equal(attached.asciiDomain, 'user-one.chenjianhui.site');
  assert.equal(attached.connectionMode, 'managed-cloud');
  assert.equal('edgeMode' in attached, false);
  assert.equal(fs.readFileSync(path.join(initialized.config.dataRoot, 'memory.txt'), 'utf8'), 'preserve me');
});

test('repair enrollment preserves the local binding but still requires the official browser authorization flow', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-device-repair-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const initialized = initializeSite({ domain: 'personal-agent.local', dataRoot });
  await enrollWithCloudDeviceAuthorization({ cloudUrl: cloud.url, dataRoot, openBrowser: async () => true, sleep: async () => {} });
  const identity = JSON.parse(fs.readFileSync(initialized.config.configPath, 'utf8'));
  await assert.rejects(
    enrollWithCloudDeviceAuthorization({ cloudUrl: cloud.url, dataRoot, openBrowser: async () => true, sleep: async () => {} }),
    /cloud status/,
  );
  const authorizations = [];
  await enrollWithCloudDeviceAuthorization({
    cloudUrl: cloud.url,
    dataRoot,
    repairExisting: true,
    openBrowser: async () => true,
    onAuthorization: (authorization) => authorizations.push(authorization),
    sleep: async () => {},
  });
  const repaired = JSON.parse(fs.readFileSync(initialized.config.configPath, 'utf8'));
  assert.equal(repaired.siteId, identity.siteId);
  assert.equal(repaired.nodeId, identity.nodeId);
  assert.equal(authorizations.length, 1);
  assert.equal('deviceCode' in authorizations[0], false);
});

test('browser unavailability keeps the official authorization entry visible instead of reporting false success', async (t) => {
  const cloud = await mockCloud();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-device-no-browser-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  initializeSite({ domain: 'personal-agent.local', dataRoot });
  const result = await enrollWithCloudDeviceAuthorization({
    cloudUrl: cloud.url,
    dataRoot,
    openBrowser: async () => false,
    sleep: async () => {},
  });
  assert.equal(result.authorization.browserOpened, false);
  assert.equal(result.authorization.verificationUrlComplete, `${cloud.url}/connect?code=PA-1234`);
});

test('invalid reverse tunnel enrollment remains local-only', async (t) => {
  const cloud = await mockCloud({ tunnel: { protocol: 'wireguard-v1', endpoint: 'edge.chenjianhui.site:51821' } });
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-device-failed-'));
  t.after(async () => { await close(cloud.server); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const initialized = initializeSite({ domain: 'personal-agent.local', dataRoot });
  await assert.rejects(enrollWithCloudDeviceAuthorization({
    cloudUrl: cloud.url,
    dataRoot,
    openBrowser: async () => true,
    sleep: async () => {},
  }), /Unsupported reverse tunnel protocol/);
  assert.equal(JSON.parse(fs.readFileSync(initialized.config.configPath, 'utf8')).connectionMode, 'local-only');
  assert.equal(fs.existsSync(path.join(initialized.config.configDir, 'cloud.json')), false);
});

test('device authorization refuses a verification URL outside the selected Cloud origin', async (t) => {
  const cloud = await mockCloud({ verificationUrl: 'https://evil.example/connect' });
  t.after(async () => { await close(cloud.server); });
  await assert.rejects(startCloudDeviceAuthorization({ cloudUrl: cloud.url, installationId: 'ins_AAAAAAAAAAAAAAAA', spaceId: 'sp_AAAAAAAAAAAAAAAA' }), /不受信任/);
  assert.deepEqual(cloud.calls, ['auth-start']);
});

test('device authorization fails closed on denial and local expiry', async () => {
  const authorization = { deviceCode: 'device-code-123456', expiresIn: 60, interval: 1 };
  let clock = 0;
  const deniedFetch = async () => new Response(JSON.stringify({ error: 'Authorization denied', code: 'access_denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    pollCloudDeviceAuthorization({ cloudUrl: 'http://127.0.0.1:8765', authorization, fetchImpl: deniedFetch, sleep: async (milliseconds) => { clock += milliseconds; }, now: () => clock }),
    (error) => error.code === 'CLOUD_AUTH_DENIED'
  );
  clock = 0;
  let calls = 0;
  await assert.rejects(
    pollCloudDeviceAuthorization({ cloudUrl: 'http://127.0.0.1:8765', authorization, fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ status: 'authorization_pending' }), { status: 202 }); }, sleep: async () => { clock = 60_001; }, now: () => clock }),
    (error) => error.code === 'CLOUD_AUTH_EXPIRED'
  );
  assert.equal(calls, 1);
});

async function mockCloud(options = {}) {
  const calls = [];
  let polls = 0;
  let binding = { installationId: '', spaceId: '' };
  const server = http.createServer(async (request, response) => {
    const body = await read(request);
    if (request.url === '/api/node/auth/start') {
      calls.push('auth-start');
      assert.equal(body.clientName, 'personal-agent-cli');
      assert.equal(body.clientVersion, '0.1.0-beta');
      assert.equal(body.spaceKind, 'personal');
      assert.equal(body.spaceSlug, 'personal');
      assert.match(body.installationId, /^ins_/);
      if (body.spaceId !== undefined) assert.match(body.spaceId, /^sp_/);
      binding = { installationId: body.installationId, spaceId: body.spaceId || '' };
      return send(response, 201, { deviceCode: 'device-code-123456', userCode: 'PA-1234', verificationUrl: options.verificationUrl || `${serverUrl(server)}/connect`, verificationUrlComplete: `${serverUrl(server)}/connect?code=PA-1234`, expiresIn: 600, interval: 1 });
    }
    if (request.url === '/api/node/auth/poll') {
      calls.push('auth-poll');
      assert.deepEqual(body, { deviceCode: 'device-code-123456' });
      polls += 1;
      if (polls === 1) return send(response, 202, { status: 'authorization_pending', interval: 2 });
      if (polls === 2) { response.setHeader('Retry-After', '9'); return send(response, 429, { error: 'Polling too quickly', code: 'slow_down' }); }
      return send(response, 200, { status: 'approved', enrollmentCredential: 'enrollment-credential-123456' });
    }
    if (request.url === '/api/node/enroll') {
      calls.push('enroll'); assert.deepEqual(Object.keys(body).sort(), ['enrollmentCredential']);
      assert.equal(body.enrollmentCredential, 'enrollment-credential-123456');
      return send(response, 201, {
        ok: true,
        site: { id: 'site-1', slug: 'user-one', managed_host: 'user-one.chenjianhui.site', plan: 'free', status: 'active' },
        nodeToken: 'node-secret-token',
        refreshToken: 'refresh-secret-token-1234567890',
        credential: {
          tokenType: 'Bearer', accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
          refreshEndpoint: `${serverUrl(server)}/api/node/token/refresh`, deviceBinding: binding,
        },
        tunnel: options.tunnel || { protocol: 'pa-reverse-ws-v1', endpoint: `ws://127.0.0.1:${server.address().port}/v1/connect`, heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1 },
      });
    }
    if (request.url === '/api/node/heartbeat') {
      calls.push('heartbeat'); assert.equal(request.headers.authorization, 'Bearer node-secret-token'); return send(response, 200, { ok: true, siteId: 'site-1', status: 'active', tunnelGeneration: 1 });
    }
    send(response, 404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, calls, url: serverUrl(server) };
}
function serverUrl(server) { return `http://127.0.0.1:${server.address().port}`; }
async function read(request) { const chunks=[]; for await (const chunk of request) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
