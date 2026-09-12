import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeSite } from '../src/config.ts';
import { setupStatus, writeWebConversationAcceptance } from '../src/setup.ts';
import { createRuntimeEnvironmentStore } from '../../agent/src/runtime-environments/store.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-selected-setup-'));
  const { config } = initializeSite({ dataRoot: root, domain: 'personal-agent.local' });
  const store = createRuntimeEnvironmentStore({ workspaceRoot: config.dataRoot, spaceId: config.space.id });
  const selected = (engine, profile) => store.save({ engine, revision: store.view().revision, profiles: profile ? { [engine]: profile } : {} });
  const status = (runtimeProbe) => setupStatus({
    dataRoot: config.dataRoot, installRoot: path.join(root, 'install'), env: {},
    portProbe: async () => false, processAlive: () => false,
    codexProbe: async () => { throw new Error('Unselected Codex must never be probed'); }, runtimeProbe,
  });
  const receipt = (engine, revision, spaceId = config.space.id) => writeWebConversationAcceptance({ dataRoot: config.dataRoot, engine, revision, spaceId });
  return { root, config, store, selected, status, receipt, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const installed = { installed: true, version: '2.1.0', authentication: 'authenticated', protocolReady: true, models: [] };

test('selected Claude missing executable cannot inherit Codex readiness or its receipt', async () => {
  const f = fixture();
  try {
    f.selected('claude-code');
    f.receipt('codex', 1);
    const snapshot = await f.status(async ({ engine }) => {
      assert.equal(engine, 'claude-code');
      return { ...installed, installed: false, version: '', authentication: 'missing' };
    });
    assert.equal(snapshot.groups.find(group => group.id === 'agent').label, 'Claude Code Agent');
    assert.equal(snapshot.checks.some(check => check.id.startsWith('agent.codex.')), false);
    assert.equal(snapshot.checks.find(check => check.id === 'agent.claude-code.executable').state, 'action-required');
    assert.equal(snapshot.checks.find(check => check.id === 'agent.web-conversation').state, 'blocked');
    assert.equal(snapshot.readiness.agent, 'blocked');
  } finally { f.cleanup(); }
});

test('Claude readiness requires current authorization and an engine/revision-bound real reply', async () => {
  const f = fixture();
  try {
    const saved = f.selected('claude-code');
    const pending = await f.status(async () => installed);
    assert.equal(pending.checks.find(check => check.id === 'agent.claude-code.authentication').state, 'ready');
    assert.equal(pending.checks.find(check => check.id === 'agent.claude-code.handshake').state, 'action-required');
    assert.deepEqual(pending.checks.find(check => check.id === 'agent.claude-code.handshake').actionIds, ['agent.open-chat']);
    assert.notEqual(pending.readiness.agent, 'ready');
    f.receipt('claude-code', saved.revision);
    assert.equal((await f.status(async () => installed)).readiness.agent, 'ready');
    const loggedOut = await f.status(async () => ({ ...installed, authentication: 'missing' }));
    assert.equal(loggedOut.readiness.agent, 'blocked');
    f.selected('claude-code', { model: 'changed-model' });
    assert.notEqual((await f.status(async () => installed)).readiness.agent, 'ready');
  } finally { f.cleanup(); }
});

test('custom key presence is configuration, never proof of connectivity; old and foreign receipts fail closed', async () => {
  const f = fixture();
  try {
    const saved = f.selected('codex', { mode: 'custom', model: 'fixture-model', baseUrl: 'https://api.example.com/v1', credential: 'fixture-secret-only' });
    const probe = async ({ profile }) => { assert.equal(profile.mode, 'custom'); return { ...installed, authentication: 'unknown' }; };
    writeWebConversationAcceptance({ dataRoot: f.config.dataRoot });
    const pending = await f.status(probe);
    assert.equal(pending.checks.find(check => check.id === 'agent.codex.authentication').state, 'ready');
    assert.match(pending.checks.find(check => check.id === 'agent.codex.authentication').summary, /尚不代表连通/);
    assert.equal(pending.checks.find(check => check.id === 'agent.codex.handshake').state, 'action-required');
    assert.notEqual(pending.readiness.agent, 'ready');
    f.receipt('codex', saved.revision, 'another-space');
    assert.notEqual((await f.status(probe)).readiness.agent, 'ready');
    f.receipt('codex', saved.revision);
    const ready = await f.status(probe);
    assert.equal(ready.readiness.agent, 'ready');
    assert.doesNotMatch(JSON.stringify(ready), /fixture-secret-only|api\.example\.com/);
    f.selected('codex', { clearCredential: true });
    assert.equal((await f.status(probe)).readiness.agent, 'blocked');
  } finally { f.cleanup(); }
});

test('corrupt runtime configuration is not silently treated as default Codex', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.config.dataRoot, 'config', 'runtime-environments.json'), '{invalid');
    const snapshot = await f.status(async () => { throw new Error('No selected engine should be probed'); });
    assert.equal(snapshot.checks.find(check => check.id === 'agent.runtime.configuration').state, 'action-required');
    assert.notEqual(snapshot.readiness.agent, 'ready');
  } finally { f.cleanup(); }
});

test('saving a Codex account profile expires an unbound historical receipt', async () => {
  const f = fixture();
  try {
    writeWebConversationAcceptance({ dataRoot: f.config.dataRoot });
    const readStatus = () => setupStatus({ dataRoot: f.config.dataRoot, installRoot: path.join(f.root, 'install'), env: {},
      portProbe: async () => false, processAlive: () => false,
      codexProbe: async () => ({ installed: true, version: '1.2.3', versionSupported: true, authenticated: true, handshake: true }) });
    assert.equal((await readStatus()).readiness.agent, 'ready');
    const saved = f.selected('codex', { model: 'selected-model' });
    assert.notEqual((await readStatus()).readiness.agent, 'ready');
    f.receipt('codex', saved.revision);
    assert.equal((await readStatus()).readiness.agent, 'ready');
  } finally { f.cleanup(); }
});
