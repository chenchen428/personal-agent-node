import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
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

  const cloudConnectHelp = JSON.parse(runOk(['cloud', 'connect', '--help', '--json']).stdout);
  assert.equal(cloudConnectHelp.result.visibility, 'command');
  assert.equal(cloudConnectHelp.result.command.usage, 'personal-agent cloud connect [--cloud-url <https-url>] [--no-open] [--data-root <path>] --json');
  assert.equal(cloudConnectHelp.result.command.risk, 'R2');
  assert.equal(cloudConnectHelp.result.command.authorization.method, 'browser-device-authorization');
  assert.equal(cloudConnectHelp.result.command.authorization.userActionRequired, true);
  const cloudUrlOption = cloudConnectHelp.result.command.options.find((option) => option.name === '--cloud-url');
  assert.equal(cloudUrlOption.default, 'https://chenjianhui.site');
  assert.equal(cloudUrlOption.environment, 'PERSONAL_AGENT_CLOUD_URL');
  assert.ok(cloudConnectHelp.result.command.options.some((option) => option.name === '--no-open'));
  assert.ok(cloudConnectHelp.result.command.authorization.forbiddenCommandLineInputs.includes('nodeToken'));
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

test('cloud password login requires stdin and emits only redacted resources', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-cloud-login-cli-'));
  const server = http.createServer(async (request, response) => {
    const body = await new Promise((resolve) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')));
    });
    assert.equal(request.url, '/api/cli/session');
    assert.deepEqual(body, { githubUserId: '12345678', password: 'correct horse battery staple' });
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      token: 'cli-session-token-that-is-long-enough',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      resources: {
        account: { githubUserId: '12345678', githubLogin: 'owner-login' },
        site: { id: 'site_one', status: 'active', managedHost: 'owner.chenjianhui.site', publicDomain: 'owner.chenjianhui.site' },
        agentMailAddress: 'agent@owner.chenjianhui.site',
        mailOperational: false,
        eligibility: { publicDomain: true, agentMail: true, managedMail: true, managedConfiguration: true },
        generatedAt: new Date().toISOString(),
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const cloudUrl = `http://127.0.0.1:${server.address().port}`;
  const result = await runAsync(['cloud', 'login', '--github-user-id', '12345678', '--password-stdin', '--cloud-url', cloudUrl, '--data-root', dataRoot, '--json'], 'correct horse battery staple\n');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.result.services.state, 'enabled');
  assert.doesNotMatch(result.stdout, /correct horse|cli-session-token/);
  const rejected = run(['cloud', 'login', '--github-user-id', '12345678', '--password', 'DO_NOT_ECHO', '--json']);
  assert.equal(rejected.status, 2);
  assert.doesNotMatch(rejected.stderr, /DO_NOT_ECHO/);
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

test('mail status is R0 read-only while mail plan is preview-only', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-mail-cli-'));
  try {
    const initialized = initializeSite({ domain: 'local.example', dataRoot });
    const envPath = initialized.config.envPath;
    const withoutMailToken = fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN='))
      .join('\n');
    fs.writeFileSync(envPath, `${withoutMailToken.replace(/\n*$/, '')}\n`, { mode: 0o600 });
    fs.writeFileSync(initialized.config.configPath, `${JSON.stringify({ ...initialized.config.site, schemaVersion: 1, edgeMode: 'local-only' }, null, 2)}\n`, { mode: 0o600 });
    const before = snapshotDataRoot(dataRoot);

    const status = run(['mail', 'status', '--json', '--data-root', dataRoot]);
    assert.equal(status.status, 0, status.stderr);
    const statusBody = JSON.parse(status.stdout);
    assert.equal(statusBody.result.mail.ingress.tokenConfigured, false);
    assert.equal(statusBody.result.mail.policy.mtaUserManaged, true);
    assert.equal(statusBody.result.mail.policy.smtpServerBundled, false);
    assert.equal(statusBody.result.mail.policy.managedRawMailTunnelBundled, false);
    assert.deepEqual(snapshotDataRoot(dataRoot), before, 'R0 mail status must not rewrite any Site state');

    const doctor = run(['doctor', '--json', '--data-root', dataRoot]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const doctorBody = JSON.parse(doctor.stdout);
    assert.equal(doctorBody.result.checks.find((check) => check.id === 'mail-ingress-token').ok, false);
    assert.deepEqual(snapshotDataRoot(dataRoot), before, 'doctor must remain read-only across the complete data root');

    const blockedPlan = run(['mail', 'plan', '--json', '--data-root', dataRoot]);
    assert.equal(blockedPlan.status, 7);
    assert.equal(JSON.parse(blockedPlan.stderr).error.code, 'CAPABILITY_UNAVAILABLE');
    const plan = run(['mail', 'plan', '--preview', '--json', '--data-root', dataRoot]);
    assert.equal(plan.status, 0, plan.stderr);
    const planBody = JSON.parse(plan.stdout);
    assert.equal(planBody.result.plan.mutates, false);
    assert.equal(planBody.result.plan.previewOnly, true);
    assert.ok(planBody.warnings.some((warning) => warning.code === 'PREVIEW_COMMAND'));
    assert.deepEqual(snapshotDataRoot(dataRoot), before, 'preview mail plan must remain read-only across the complete data root');
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

function runAsync(args, input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function snapshotDataRoot(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replaceAll('\\', '/');
      const stat = fs.lstatSync(target);
      if (entry.isDirectory()) {
        entries.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
        walk(target);
      } else if (entry.isFile()) {
        entries.push({ path: relative, type: 'file', mode: stat.mode & 0o777, sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
      } else entries.push({ path: relative, type: 'other' });
    }
  };
  walk(root);
  return entries;
}
