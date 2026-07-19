import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyPasswordVerifier } from '../../agent/src/auth/personal-auth.js';
import { initializeSite, readEnvFile } from '../src/config.ts';
import { createOperationStore } from '../src/operations.ts';
import { cancelManagedCloudSetup, disconnectManagedCloud, executeSetupAction, managedCliRuntimeArgs, managedCloudAuthorizationPhase, planSetupAction, safeCliFailureCode, startAutomaticManagedCloudBootstrap } from '../src/setup-actions.ts';

test('local auth setup uses an approved R2 plan and removes the migration plaintext', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-action-'));
  const password = 'customer-owned-local-password';
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    assert.ok(readEnvFile(config.envPath).PERSONAL_AGENT_AUTH_PASSWORD);
    const operations = createOperationStore({ dataRoot: config.dataRoot, randomUUID: () => '00000000-0000-4000-8000-000000000001' });
    const plan = planSetupAction({ actionId: 'installation.local-auth', operations, dataRoot });
    assert.equal(plan.risk, 'R2');
    assert.doesNotMatch(JSON.stringify(plan), new RegExp(password));
    operations.approve(plan.id, { digest: plan.digest, actor: { kind: 'human', authenticated: true, loopback: true, channel: 'local-console' } });
    const executed = await operations.execute(plan.id, {
      digest: plan.digest,
      actor: { kind: 'runtime' },
      handler: () => executeSetupAction({ actionId: 'installation.local-auth', input: { password, confirmation: password }, dataRoot }),
    });
    assert.equal(executed.status, 'succeeded');
    assert.equal(readEnvFile(config.envPath).PERSONAL_AGENT_AUTH_PASSWORD, undefined);
    const verifierFile = path.join(config.configDir, 'local-auth.json');
    const verifier = JSON.parse(fs.readFileSync(verifierFile, 'utf8'));
    assert.equal(verifyPasswordVerifier(password, verifier), true);
    assert.doesNotMatch(fs.readFileSync(verifierFile, 'utf8'), new RegExp(password));
    assert.doesNotMatch(fs.readFileSync(path.join(config.dataRoot, 'runtime', 'operations', `${plan.id}.json`), 'utf8'), new RegExp(password));
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('local auth setup rejects mismatched confirmation without changing credentials', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-action-mismatch-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const before = fs.readFileSync(config.envPath, 'utf8');
    await assert.rejects(executeSetupAction({ actionId: 'installation.local-auth', input: { password: 'customer-owned-local-password', confirmation: 'different-password' }, dataRoot }), /不一致/);
    assert.equal(fs.readFileSync(config.envPath, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(config.configDir, 'local-auth.json')), false);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('mail setup explicitly selects optional readiness without storing secrets', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-mail-action-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const result = await executeSetupAction({ actionId: 'mail.enable', input: {}, dataRoot });
    assert.deepEqual(result, { selected: true, dimension: 'mail', next: '/app/mail' });
    const selections = JSON.parse(fs.readFileSync(path.join(config.configDir, 'setup-selections.json'), 'utf8'));
    assert.deepEqual(selections, { schemaVersion: 1, mail: true });
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('managed verification skips completed enrollment and resource authorization phases', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-cloud-phase-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    assert.equal(managedCloudAuthorizationPhase({ dataRoot }), 'enrollment');
    fs.writeFileSync(path.join(config.configDir, 'cloud.json'), `${JSON.stringify({ schemaVersion: 1, managedHost: 'node.chenjianhui.site' })}\n`);
    assert.equal(managedCloudAuthorizationPhase({ dataRoot }), 'resources');
    fs.writeFileSync(path.join(config.configDir, 'cloud-resources.json'), `${JSON.stringify({
      schemaVersion: 1,
      resources: {
        site: { managedHost: 'node.chenjianhui.site', publicDomain: 'node.chenjianhui.site' },
        agentMailAddress: 'agent@node.chenjianhui.site',
        eligibility: { managedMail: true, managedConfiguration: true },
      },
      syncedAt: '2026-07-15T00:00:00.000Z',
    })}\n`);
    assert.equal(managedCloudAuthorizationPhase({ dataRoot }), 'complete');
    fs.writeFileSync(path.join(config.runtimeDir, 'reverse-tunnel.json'), `${JSON.stringify({ schemaVersion: 1, state: 'reauth_required' })}\n`);
    assert.equal(managedCloudAuthorizationPhase({ dataRoot }), 'reauth');
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('managed verification resolves a Space root through the installation registry', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-space-root-'));
  const previous = {
    dataRoot: process.env.PERSONAL_AGENT_DATA_ROOT,
    spaceId: process.env.PERSONAL_AGENT_SPACE_ID,
    spaceRoot: process.env.PERSONAL_AGENT_SPACE_ROOT,
  };
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    process.env.PERSONAL_AGENT_DATA_ROOT = config.installationDataRoot;
    process.env.PERSONAL_AGENT_SPACE_ID = config.space.id;
    process.env.PERSONAL_AGENT_SPACE_ROOT = config.dataRoot;
    fs.writeFileSync(path.join(config.configDir, 'cloud.json'), `${JSON.stringify({ schemaVersion: 1, managedHost: 'alice.personal-agent.cn' })}\n`);
    fs.writeFileSync(path.join(config.configDir, 'cloud-resources.json'), `${JSON.stringify({
      schemaVersion: 1,
      resources: {
        site: { managedHost: 'alice.personal-agent.cn', publicDomain: 'alice.personal-agent.cn' },
        agentMailAddress: 'agent@alice.personal-agent.cn',
        eligibility: { managedMail: true, managedConfiguration: true },
      },
      syncedAt: '2026-07-18T00:00:00.000Z',
    })}\n`);
    const result = await executeSetupAction({ actionId: 'connectivity.managed-authorize', input: {}, dataRoot: config.dataRoot });
    assert.deepEqual(result, { started: false, state: 'succeeded', phase: 'complete' });
  } finally {
    for (const [key, value] of Object.entries({ PERSONAL_AGENT_DATA_ROOT: previous.dataRoot, PERSONAL_AGENT_SPACE_ID: previous.spaceId, PERSONAL_AGENT_SPACE_ROOT: previous.spaceRoot })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('managed disconnect removes the local platform binding while preserving enrollment and Workspace data', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-cloud-disconnect-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const cloudFile = path.join(config.configDir, 'cloud.json');
    const resourcesFile = path.join(config.configDir, 'cloud-resources.json');
    const workspaceFile = path.join(config.agentWorkspaceRoot, 'customer-note.txt');
    fs.mkdirSync(path.dirname(workspaceFile), { recursive: true });
    fs.writeFileSync(cloudFile, `${JSON.stringify({ schemaVersion: 1, managedHost: 'node.personal-agent.cn' })}\n`);
    fs.writeFileSync(resourcesFile, `${JSON.stringify({ schemaVersion: 1, resources: { site: { publicDomain: 'node.personal-agent.cn' }, agentMailAddress: 'agent@node.personal-agent.cn' } })}\n`);
    fs.writeFileSync(workspaceFile, 'preserve me');
    const result = disconnectManagedCloud({ dataRoot });
    assert.deepEqual(result, { disconnected: true, mode: 'local-only', localDataPreserved: true });
    assert.equal(fs.existsSync(resourcesFile), false);
    assert.equal(fs.existsSync(cloudFile), true);
    assert.equal(fs.readFileSync(workspaceFile, 'utf8'), 'preserve me');
    assert.equal(JSON.parse(fs.readFileSync(config.configPath, 'utf8')).connectionMode, 'local-only');
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('managed authorization cancellation preserves an existing binding and records a recoverable state', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-cloud-cancel-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const cloudFile = path.join(config.configDir, 'cloud.json');
    const statusFile = path.join(config.dataRoot, 'runtime', 'setup', 'managed-cloud-action.json');
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(cloudFile, `${JSON.stringify({ schemaVersion: 1, managedHost: 'node.personal-agent.cn' })}\n`);
    fs.writeFileSync(statusFile, `${JSON.stringify({ schemaVersion: 1, state: 'running', phase: 'resources', pid: 0 })}\n`);

    assert.deepEqual(cancelManagedCloudSetup({ dataRoot }), { cancelled: true, existingBindingPreserved: true });
    assert.equal(fs.existsSync(cloudFile), true);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    assert.deepEqual({ state: status.state, phase: status.phase, code: status.code }, { state: 'cancelled', phase: 'resources', code: 'USER_CANCELLED' });
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('automatic managed bootstrap never retries a failed or explicitly cancelled silent attempt', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-cloud-auto-stop-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const statusFile = path.join(config.dataRoot, 'runtime', 'setup', 'managed-cloud-action.json');
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, `${JSON.stringify({ schemaVersion: 1, state: 'failed', phase: 'enrollment', code: 'CLOUD_AUTH_FAILED' })}\n`);
    assert.deepEqual(startAutomaticManagedCloudBootstrap({ dataRoot }), {
      started: false,
      state: 'failed',
      phase: 'enrollment',
      code: 'CLOUD_AUTH_FAILED',
    });
    fs.writeFileSync(statusFile, `${JSON.stringify({ schemaVersion: 1, state: 'cancelled', phase: 'idle', code: 'USER_DISCONNECTED' })}\n`);
    assert.deepEqual(startAutomaticManagedCloudBootstrap({ dataRoot }), {
      started: false,
      state: 'cancelled',
      phase: 'idle',
      code: 'USER_DISCONNECTED',
    });
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('managed verification exposes only a safe CLI failure code', () => {
  const output = [
    JSON.stringify({ ok: true, event: 'cloud.device-authorization', result: { userCode: 'PRIVATE-CODE', verificationUrl: 'https://chenjianhui.site/connect' } }),
    JSON.stringify({ ok: false, error: { code: 'CLOUD_REQUEST_FAILED', message: 'private upstream detail' } }),
  ].join('\n');
  assert.equal(safeCliFailureCode(output, 7), 'CLOUD_REQUEST_FAILED');
  assert.equal(safeCliFailureCode('not-json', 7), 'CLI_EXIT_7');
});

test('managed verification preserves source module loaders without copying debugger flags', () => {
  assert.deepEqual(
    managedCliRuntimeArgs(['--inspect=127.0.0.1:9229', '--import', 'tsx', '--no-warnings']),
    ['--import', 'tsx'],
  );
  assert.deepEqual(
    managedCliRuntimeArgs(['--experimental-loader=custom-loader', '--experimental-strip-types']),
    ['--experimental-loader=custom-loader', '--experimental-strip-types'],
  );
});

test('custom-domain R2 plan binds only the approved domain and kind', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-custom-domain-plan-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const operations = createOperationStore({ dataRoot: config.dataRoot, randomUUID: () => '00000000-0000-4000-8000-000000000099' });
    const input = { kind: 'sites', domain: 'agent.example.net' };
    const plan = planSetupAction({ actionId: 'connectivity.custom-domain-start', operations, dataRoot: config.dataRoot, input });
    assert.equal(plan.risk, 'R2');
    assert.match(plan.stateFingerprint, /sites:agent\.example\.net$/);
    operations.approve(plan.id, { digest: plan.digest, actor: { kind: 'human', authenticated: true, loopback: true, channel: 'local-console' } });
    await assert.rejects(operations.execute(plan.id, {
      digest: plan.digest,
      actor: { kind: 'runtime' },
      handler: (operation) => executeSetupAction({ actionId: 'connectivity.custom-domain-start', input: { ...input, domain: 'changed.example.net' }, dataRoot: config.dataRoot, operation }),
    }), /已批准计划不一致/);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});
