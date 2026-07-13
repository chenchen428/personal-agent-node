import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { expandCommandName, HANDLED_COMMAND_KEYS } from '../src/command-surface.mjs';
import { initializeSite } from '../src/config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'bin', 'personal-agent.mjs');

test('personal-agent exposes machine-readable help and capability discovery', () => {
  const defaultHelp = JSON.parse(runOk(['help', '--json']).stdout);
  assert.equal(defaultHelp.schemaVersion, 1);
  assert.equal(defaultHelp.ok, true);
  assert.equal(defaultHelp.result.binary, 'personal-agent');
  assert.equal(defaultHelp.result.visibility, 'implemented');
  assert.deepEqual(Object.keys(defaultHelp.result.commandGroups), ['implemented']);
  assert.ok(defaultHelp.result.commands.every((entry) => entry.implementationStatus === 'implemented'));
  assert.ok(defaultHelp.result.commands.every((entry) => typeof entry.description === 'string' && entry.description.length > 0));

  const previewHelp = JSON.parse(runOk(['help', '--preview', '--json']).stdout);
  assert.equal(previewHelp.result.visibility, 'preview');
  assert.deepEqual(Object.keys(previewHelp.result.commandGroups), ['implemented', 'preview']);
  assert.ok(previewHelp.result.commands.some((entry) => entry.implementationStatus === 'preview'));
  const handledHelpCommands = previewHelp.result.commands.flatMap((entry) => expandCommandName(entry.name)).sort();
  assert.deepEqual(handledHelpCommands, [...HANDLED_COMMAND_KEYS].sort());

  const allHelp = JSON.parse(runOk(['help', '--all', '--json']).stdout);
  assert.equal(allHelp.result.visibility, 'all');
  assert.deepEqual(Object.keys(allHelp.result.commandGroups), ['implemented', 'preview', 'planned']);
  assert.equal(allHelp.result.implementationStatuses.implemented.executable, true);
  assert.equal(allHelp.result.implementationStatuses.preview.requiresPreviewFlag, true);
  assert.equal(allHelp.result.implementationStatuses.planned.executable, false);
  assert.ok(allHelp.result.commandGroups.planned.some((entry) => entry.name === 'managed-task list|show|plan|approve|execute|cancel'));

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
  assert.match(body.nextActions[0], /help --all --json/);

  const legacyAlias = run(['operation', 'inspect', 'example', '--json']);
  assert.equal(legacyAlias.status, 7);
  assert.equal(JSON.parse(legacyAlias.stderr).error.code, 'CAPABILITY_UNAVAILABLE');

  const allIsHelpOnly = run(['status', '--all', '--json']);
  assert.equal(allIsHelpOnly.status, 2);
  assert.equal(JSON.parse(allIsHelpOnly.stderr).error.code, 'INVALID_ARGUMENT');
});

test('every planned command leaf remains unavailable by default and with preview opt-in', () => {
  const help = JSON.parse(runOk(['help', '--all', '--json']).stdout);
  const planned = help.result.commandGroups.planned.flatMap((entry) => expandCommandName(entry.name));
  assert.ok(planned.length > 0);
  for (const command of planned) {
    for (const optIn of [[], ['--preview']]) {
      const result = run([...command.split(' '), ...optIn, '--json']);
      assert.equal(result.status, 7, `${command} ${optIn.join(' ')}`);
      assert.equal(JSON.parse(result.stderr).error.code, 'CAPABILITY_UNAVAILABLE', `${command} ${optIn.join(' ')}`);
    }
  }
});

test('preview commands require explicit opt-in and warn on success', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-preview-'));
  try {
    initializeSite({ domain: 'local.example', dataRoot });
    const blocked = run(['extension', 'list', '--json', '--data-root', dataRoot]);
    assert.equal(blocked.status, 7);
    assert.equal(JSON.parse(blocked.stderr).error.code, 'CAPABILITY_UNAVAILABLE');

    const enabled = run(['extension', 'list', '--preview', '--json', '--data-root', dataRoot]);
    assert.equal(enabled.status, 0, enabled.stderr);
    const body = JSON.parse(enabled.stdout);
    assert.equal(body.command, 'extension list');
    assert.ok(body.warnings.some((warning) => warning.code === 'PREVIEW_COMMAND'));
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('skill commands use the public registry fields and succeed for a real skill', () => {
  const list = JSON.parse(runOk(['skill', 'list', '--json']).stdout);
  const personalAgent = list.result.skills.find((entry) => entry.name === 'personal-agent');
  assert.ok(personalAgent);
  assert.equal(personalAgent.directory, 'skills/personal-agent');
  assert.ok(Array.isArray(personalAgent.risks));
  assert.equal(Object.hasOwn(personalAgent, 'id'), false);

  const inspect = JSON.parse(runOk(['skill', 'inspect', 'personal-agent', '--json']).stdout);
  assert.equal(inspect.result.skill.name, 'personal-agent');
  assert.equal(inspect.result.skill.directory, 'skills/personal-agent');

  const verify = JSON.parse(runOk(['skill', 'verify', 'personal-agent', '--json']).stdout);
  assert.equal(verify.result.skillName, 'personal-agent');
  assert.equal(verify.result.verified, true);
});

test('cloud enrollment does not accept long-lived or invitation credentials on the command line', () => {
  for (const option of ['--authorization-code', '--enrollment-credential', '--node-token']) {
    const result = run(['cloud', 'connect', option, 'DO_NOT_ACCEPT', '--json']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    const body = JSON.parse(result.stderr);
    assert.equal(body.error.code, 'INVALID_ARGUMENT');
    assert.doesNotMatch(body.error.message, /DO_NOT_ACCEPT/);
  }
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

test('connection status uses the canonical mode in the standard JSON envelope', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-connection-'));
  try {
    initializeSite({ domain: 'local.example', dataRoot });
    const result = run(['connection', 'status', '--json', '--data-root', dataRoot]);
    assert.equal(result.status, 0);
    const body = JSON.parse(result.stdout);
    assert.deepEqual({ schemaVersion: body.schemaVersion, ok: body.ok, command: body.command, mode: body.result.mode }, { schemaVersion: 1, ok: true, command: 'connection status', mode: 'local-only' });
    assert.deepEqual(body.warnings, []);
    assert.deepEqual(body.nextActions, []);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}

function runOk(args, env = {}) {
  const result = run(args, env);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}
