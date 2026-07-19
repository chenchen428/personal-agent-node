import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { refreshManagedCloudCredential } from '../src/cloud-token-refresh.ts';
import { initializeSite, mergeSecretEnv, resolveNodeConfig, writeJsonAtomic } from '../src/config.ts';
import { initializeInstallation } from '../src/space-registry.ts';

test('managed Cloud refresh rotates both secrets atomically and persists only redacted metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-refresh-'));
  try {
    const { config: initial } = initializeSite({ dataRoot: root, domain: 'personal-agent.local' });
    const installationId = initializeInstallation({ dataRoot: initial.installationDataRoot }).installation.installationId;
    const endpoint = 'https://personal-agent.cn/api/node/token/refresh';
    mergeSecretEnv(initial.envPath, {
      PERSONAL_AGENT_CLOUD_TOKEN: 'old-access-token-123456',
      PERSONAL_AGENT_CLOUD_REFRESH_TOKEN: 'old-refresh-token-123456',
    });
    writeJsonAtomic(path.join(initial.configDir, 'cloud.json'), cloudMetadata(initial, installationId, endpoint));
    const requests = [];
    const result = await refreshManagedCloudCredential({
      config: resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: initial.dataRoot }),
      fetchImpl: async (url, options) => {
        requests.push({ url, authorization: options.headers.authorization, body: JSON.parse(options.body) });
        return Response.json({
          ok: true,
          nodeToken: 'new-access-token-123456',
          refreshToken: 'new-refresh-token-123456',
          credential: credential(installationId, initial.space.id, endpoint),
          tunnelGeneration: 4,
        });
      },
    });
    assert.equal(result.generation, 4);
    assert.deepEqual(requests, [{
      url: endpoint,
      authorization: 'Bearer old-refresh-token-123456',
      body: { installationId, spaceId: initial.space.id },
    }]);
    const env = fs.readFileSync(initial.envPath, 'utf8');
    assert.match(env, /PERSONAL_AGENT_CLOUD_TOKEN="new-access-token-123456"/);
    assert.match(env, /PERSONAL_AGENT_CLOUD_REFRESH_TOKEN="new-refresh-token-123456"/);
    const metadata = fs.readFileSync(path.join(initial.configDir, 'cloud.json'), 'utf8');
    assert.doesNotMatch(metadata, /old-refresh|new-refresh|new-access/);
    assert.match(metadata, /"generation": 4/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed Cloud refresh fails closed on replay and never rewrites the existing secret file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-refresh-replay-'));
  try {
    const { config: initial } = initializeSite({ dataRoot: root, domain: 'personal-agent.local' });
    const installationId = initializeInstallation({ dataRoot: initial.installationDataRoot }).installation.installationId;
    const endpoint = 'https://personal-agent.cn/api/node/token/refresh';
    mergeSecretEnv(initial.envPath, { PERSONAL_AGENT_CLOUD_REFRESH_TOKEN: 'replayed-refresh-token-123456' });
    writeJsonAtomic(path.join(initial.configDir, 'cloud.json'), cloudMetadata(initial, installationId, endpoint));
    const before = fs.readFileSync(initial.envPath, 'utf8');
    await assert.rejects(
      refreshManagedCloudCredential({
        config: resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: initial.dataRoot }),
        fetchImpl: async () => Response.json({ ok: false, code: 'refresh_replayed' }, { status: 401 }),
      }),
      (error) => error.code === 'REFRESH_REPLAYED',
    );
    assert.equal(fs.readFileSync(initial.envPath, 'utf8'), before);
    await assert.rejects(
      refreshManagedCloudCredential({
        config: resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: initial.dataRoot }),
        fetchImpl: async () => Response.json({ ok: false }, { status: 503 }),
      }),
      (error) => error.code === 'CLOUD_REFRESH_UNAVAILABLE',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed Cloud refresh rejects a cross-origin endpoint before any request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-refresh-origin-'));
  try {
    const { config: initial } = initializeSite({ dataRoot: root, domain: 'personal-agent.local' });
    const installationId = initializeInstallation({ dataRoot: initial.installationDataRoot }).installation.installationId;
    mergeSecretEnv(initial.envPath, { PERSONAL_AGENT_CLOUD_REFRESH_TOKEN: 'refresh-token-1234567890' });
    writeJsonAtomic(path.join(initial.configDir, 'cloud.json'), cloudMetadata(initial, installationId, 'https://evil.example/api/node/token/refresh'));
    let called = false;
    await assert.rejects(
      refreshManagedCloudCredential({ config: resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: initial.dataRoot }), fetchImpl: async () => { called = true; } }),
      (error) => error.code === 'CLOUD_REFRESH_ENDPOINT_INVALID',
    );
    assert.equal(called, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function cloudMetadata(config, installationId, endpoint) {
  return {
    schemaVersion: 3,
    cloudUrl: 'https://personal-agent.cn',
    managedHost: 'owner.personal-agent.cn',
    siteId: 'site-test',
    credential: credential(installationId, config.space.id, endpoint),
    tunnel: { protocol: 'pa-reverse-ws-v1', endpoint: 'wss://relay.personal-agent.cn/v1/connect', heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 3 },
  };
}

function credential(installationId, spaceId, refreshEndpoint) {
  return {
    tokenType: 'Bearer',
    accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    refreshEndpoint,
    deviceBinding: { installationId, spaceId },
  };
}
