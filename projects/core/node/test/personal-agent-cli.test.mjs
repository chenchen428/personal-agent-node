import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'bin', 'personal-agent.mjs');

test('personal-agent exposes machine-readable help and capability discovery', () => {
  const help = run(['help', '--json']);
  assert.equal(help.status, 0);
  const helpBody = JSON.parse(help.stdout);
  assert.equal(helpBody.schemaVersion, 1);
  assert.equal(helpBody.ok, true);
  assert.equal(helpBody.result.binary, 'personal-agent');
  assert.ok(helpBody.result.commands.some((entry) => entry.name.startsWith('status')));

  const capabilities = run(['capabilities', 'list', '--json']);
  assert.equal(capabilities.status, 0);
  assert.ok(JSON.parse(capabilities.stdout).result.capabilities.some((entry) => entry.id === 'runtime'));
});

test('personal-agent uses stable JSON errors and fails closed for unavailable commands', () => {
  const result = run(['managed-task', 'execute', '--json']);
  assert.equal(result.status, 7);
  assert.equal(result.stdout, '');
  const body = JSON.parse(result.stderr);
  assert.deepEqual({ schemaVersion: body.schemaVersion, ok: body.ok, code: body.error.code, retryable: body.error.retryable }, { schemaVersion: 1, ok: false, code: 'CAPABILITY_UNAVAILABLE', retryable: true });
});

test('personal-agent status never emits local secret values', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-cli-'));
  try {
    const result = run(['status', '--json', '--data-root', dataRoot], { PERSONAL_AGENT_CLOUD_TOKEN: 'DO_NOT_EMIT_TOKEN' });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /DO_NOT_EMIT_TOKEN/);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
