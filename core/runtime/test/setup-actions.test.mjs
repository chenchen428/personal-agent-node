import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyPasswordVerifier } from '../../agent/src/auth/personal-auth.js';
import { initializeSite, readEnvFile } from '../src/config.ts';
import { createOperationStore } from '../src/operations.ts';
import { executeSetupAction, managedCliRuntimeArgs, managedCloudAuthorizationPhase, planSetupAction, safeCliFailureCode } from '../src/setup-actions.ts';

test('local auth setup uses an approved R2 plan and removes the migration plaintext', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-action-'));
  const password = 'customer-owned-local-password';
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    assert.ok(readEnvFile(config.envPath).PERSONAL_AGENT_AUTH_PASSWORD);
    const operations = createOperationStore({ dataRoot, randomUUID: () => '00000000-0000-4000-8000-000000000001' });
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
    const verifierFile = path.join(dataRoot, 'config', 'local-auth.json');
    const verifier = JSON.parse(fs.readFileSync(verifierFile, 'utf8'));
    assert.equal(verifyPasswordVerifier(password, verifier), true);
    assert.doesNotMatch(fs.readFileSync(verifierFile, 'utf8'), new RegExp(password));
    assert.doesNotMatch(fs.readFileSync(path.join(dataRoot, 'runtime', 'operations', `${plan.id}.json`), 'utf8'), new RegExp(password));
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('local auth setup rejects mismatched confirmation without changing credentials', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-action-mismatch-'));
  try {
    const { config } = initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const before = fs.readFileSync(config.envPath, 'utf8');
    await assert.rejects(executeSetupAction({ actionId: 'installation.local-auth', input: { password: 'customer-owned-local-password', confirmation: 'different-password' }, dataRoot }), /不一致/);
    assert.equal(fs.readFileSync(config.envPath, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(dataRoot, 'config', 'local-auth.json')), false);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('mail setup explicitly selects optional readiness without storing secrets', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-setup-mail-action-'));
  try {
    initializeSite({ dataRoot, domain: 'personal-agent.local' });
    const result = await executeSetupAction({ actionId: 'mail.enable', input: {}, dataRoot });
    assert.deepEqual(result, { selected: true, dimension: 'mail', next: '/app/mail' });
    const selections = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config', 'setup-selections.json'), 'utf8'));
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
