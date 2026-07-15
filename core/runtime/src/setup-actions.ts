import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { writePasswordVerifier } from '../../agent/src/auth/personal-auth.js';
import { removeSecretEnvKeys, resolveNodeConfig, writeJsonAtomic, workspaceRoot } from './config.ts';

const mutationActions = Object.freeze({
  'installation.local-auth': {
    risk: 'R2',
    summary: 'Set a durable local access password',
    target: 'local-auth',
  },
  'connectivity.managed-authorize': {
    risk: 'R2',
    summary: 'Verify chenjianhui.site and bind public domain and Agent mail resources',
    target: 'managed-cloud',
  },
  'mail.enable': {
    risk: 'R1',
    summary: 'Enable local mail readiness checks',
    target: 'local-mail',
  },
});

export function planSetupAction({ actionId, operations, dataRoot }) {
  const definition = mutationActions[actionId];
  if (!definition) throw setupActionError('ACTION_NOT_MUTATING', `Setup action does not require an execution plan: ${actionId}`);
  const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  return operations.plan({
    command: `setup ${actionId}`,
    risk: definition.risk,
    inputSummary: definition.summary,
    target: definition.target,
    stateFingerprint: `${config.site?.siteId || 'uninitialized'}:${config.site?.connectionMode || 'local-only'}`,
    idempotencyKey: actionId,
  });
}

export async function executeSetupAction({ actionId, input, dataRoot }) {
  if (actionId === 'installation.local-auth') return establishLocalAuth({ input, dataRoot });
  if (actionId === 'connectivity.managed-authorize') return launchManagedCloudSetup({ dataRoot });
  if (actionId === 'mail.enable') return enableMailChecks({ dataRoot });
  throw setupActionError('ACTION_UNAVAILABLE', `Setup action cannot be executed: ${actionId}`);
}

function enableMailChecks({ dataRoot }) {
  const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  const filePath = path.join(config.configDir, 'setup-selections.json');
  const current = readJson(filePath) || {};
  writeJsonAtomic(filePath, { ...current, schemaVersion: 1, mail: true }, 0o600);
  return { selected: true, dimension: 'mail', next: '/app/mail' };
}

function establishLocalAuth({ input, dataRoot }) {
  const password = String(input?.password || '');
  if (password !== String(input?.confirmation || '')) throw setupActionError('PASSWORD_CONFIRMATION_MISMATCH', '两次输入的本机密码不一致');
  const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  const verifierFile = path.join(config.configDir, 'local-auth.json');
  writePasswordVerifier(verifierFile, password);
  removeSecretEnvKeys(config.envPath, ['PERSONAL_AGENT_AUTH_PASSWORD']);
  return { configured: true, verifier: 'scrypt', plaintextStored: false, effectiveImmediately: true };
}

function launchManagedCloudSetup({ dataRoot }) {
  const statusFile = path.join(dataRoot, 'runtime', 'setup', 'managed-cloud-action.json');
  const current = readJson(statusFile);
  if (current?.state === 'running' && processAlive(current.pid)) {
    return { started: false, state: 'running', phase: current.phase || 'enrollment' };
  }
  const cli = path.join(workspaceRoot, 'core', 'runtime', 'bin', 'personal-agent.mjs');
  const startingPhase = managedCloudAuthorizationPhase({ dataRoot });
  const startResourceAuthorization = () => {
    const resource = spawn(process.execPath, [cli, 'cloud', 'login', '--data-root', dataRoot, '--json'], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot },
    });
    writeActionStatus(statusFile, { state: 'running', phase: 'resources', pid: resource.pid || 0 });
    resource.once('error', (error) => writeActionStatus(statusFile, { state: 'failed', phase: 'resources', code: safeCode(error) }));
    resource.once('exit', (resourceCode) => writeActionStatus(statusFile, resourceCode === 0
      ? { state: 'succeeded', phase: 'complete' }
      : { state: 'failed', phase: 'resources', code: `CLI_EXIT_${Number(resourceCode ?? -1)}` }));
    return resource;
  };
  if (startingPhase === 'resources') {
    writeActionStatus(statusFile, { state: 'starting', phase: 'resources' });
    startResourceAuthorization();
    return { started: true, state: 'running', phase: 'resources' };
  }
  writeActionStatus(statusFile, { state: 'starting', phase: 'enrollment' });
  const first = spawn(process.execPath, [cli, 'cloud', 'connect', '--data-root', dataRoot, '--json'], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot },
  });
  writeActionStatus(statusFile, { state: 'running', phase: 'enrollment', pid: first.pid || 0 });
  first.once('error', (error) => writeActionStatus(statusFile, { state: 'failed', phase: 'enrollment', code: safeCode(error) }));
  first.once('exit', (code) => {
    if (code !== 0) {
      writeActionStatus(statusFile, { state: 'failed', phase: 'enrollment', code: `CLI_EXIT_${Number(code ?? -1)}` });
      return;
    }
    startResourceAuthorization();
  });
  return { started: true, state: 'running', phase: 'enrollment' };
}

export function managedCloudAuthorizationPhase({ dataRoot }) {
  const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  return fs.existsSync(path.join(config.configDir, 'cloud.json')) ? 'resources' : 'enrollment';
}

function writeActionStatus(filePath, value) {
  writeJsonAtomic(filePath, { schemaVersion: 1, ...value, updatedAt: new Date().toISOString() }, 0o600);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function processAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function safeCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? String(error.code) : 'PROCESS_START_FAILED';
}

function setupActionError(code, message) {
  return Object.assign(new Error(message), { code });
}
