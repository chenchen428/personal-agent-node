#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { bridgeCliStatus } from '../src/cli-shims.mjs';
import { resolveNodeConfig, workspaceRoot } from '../src/config.mjs';
import { listExtensions } from '../src/extensions.mjs';
import { readBackupState } from '../src/backup-scheduler.mjs';
import { providerStatus } from '../src/providers.mjs';
import { requestControl } from '../src/control-service.mjs';

const parsed = parseArgs(process.argv.slice(2));
if (parsed.dataRoot) process.env.PRIVATE_SITE_DATA_ROOT = path.resolve(parsed.dataRoot);

try {
  const response = await execute(parsed);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, ...response })}\n`);
} catch (error) {
  const exitCode = Number(error.exitCode || 7);
  process.stderr.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: { code: error.code || 'DEPENDENCY_UNAVAILABLE', message: error.message || 'Command failed', retryable: exitCode === 7 }, nextActions: error.nextActions || [] })}\n`);
  process.exitCode = exitCode;
}

async function execute(args) {
  const [resource = 'status', action, id] = args._;
  if (resource === 'help' || args.help) return helpResult();
  if (resource === 'status') return statusResult();
  if (resource === 'doctor') return doctorResult();
  if (resource === 'capabilities' && action === 'list') return capabilityList();
  if (resource === 'capabilities' && action === 'inspect') return capabilityInspect(id);
  if (resource === 'skill' && action === 'list') return skillList();
  if (resource === 'skill' && action === 'inspect') return skillInspect(id);
  if (resource === 'skill' && action === 'verify') return skillVerify(id);
  if (resource === 'connection' && action === 'status') return connectionStatus();
  if (resource === 'cloud' && action === 'status') return cloudStatus();
  if (resource === 'backup' && action === 'status') return backupStatus();
  if (resource === 'extension' && action === 'list') return extensionList();
  if (resource === 'extension' && action === 'inspect') return extensionInspect(id);
  if (resource === 'operation' && action === 'list') return controlResult(await requestControl(requireConfig(), 'operation.list'));
  if (resource === 'operation' && (action === 'show' || action === 'inspect')) return controlResult(await requestControl(requireConfig(), 'operation.inspect', { id }));
  if (resource === 'operation' && action === 'approve') {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) throw cliError('APPROVAL_REQUIRED', 'Operation approval requires an interactive local terminal', 5);
    const config = requireConfig();
    const challenge = await requestControl(config, 'operation.approval-challenge', { id, digest: args.digest });
    const confirmation = await confirmApproval(challenge.result.prompt);
    return controlResult(await requestControl(config, 'operation.approve', { id, digest: args.digest, nonce: challenge.result.nonce, confirmation }));
  }
  throw cliError('CAPABILITY_UNAVAILABLE', `Command is not implemented in this release: ${[resource, action].filter(Boolean).join(' ')}`, 7, ['Run personal-agent capabilities list --json']);
}

function statusResult() {
  const config = safeConfig();
  const installation = readJsonIfExists(path.join(resolveInstallRoot(), 'installation.json'));
  return success('status', {
    release: installation ? { releaseId: installation.activeReleaseId, revision: installation.revision, profile: installation.profile } : null,
    initialized: Boolean(config && fs.existsSync(config.configPath)),
    connection: config ? providerStatus(config) : null,
    cloud: config ? sanitizedCloud(config) : null,
    legacyBridge: config ? bridgeCliStatus(config) : { ready: false },
  });
}

function doctorResult() {
  const config = safeConfig();
  const checks = [
    { id: 'node-version', ok: Number(process.versions.node.split('.')[0]) === 22 },
    { id: 'release-or-source', ok: fs.existsSync(path.join(workspaceRoot, 'release-manifest.json')) || fs.existsSync(path.join(workspaceRoot, 'package.json')) },
    { id: 'capability-registry', ok: fs.existsSync(path.join(workspaceRoot, 'registry', 'capabilities.json')) },
    { id: 'data-root-confined', ok: !config || path.isAbsolute(config.dataRoot) },
  ];
  return success('doctor', { healthy: checks.every((check) => check.ok), checks });
}

function capabilityList() {
  return success('capabilities list', { capabilities: registry('capabilities.json').capabilities });
}

function capabilityInspect(id) {
  requireId(id, 'capability id');
  const capability = registry('capabilities.json').capabilities.find((entry) => entry.id === id);
  if (!capability) throw cliError('NOT_FOUND', `Unknown capability: ${id}`, 3);
  return success('capabilities inspect', { capability });
}

function skillList() {
  const skills = registry('skills.json').skills.map(({ id, category, maturity, risk, path: skillPath }) => ({ id, category, maturity, risk, path: skillPath }));
  return success('skill list', { skills });
}

function skillInspect(id) {
  requireId(id, 'skill id');
  const skill = registry('skills.json').skills.find((entry) => entry.id === id);
  if (!skill) throw cliError('NOT_FOUND', `Unknown skill: ${id}`, 3);
  return success('skill inspect', { skill });
}

function skillVerify(id) {
  requireId(id, 'skill id');
  const skill = registry('skills.json').skills.find((entry) => entry.id === id);
  if (!skill) throw cliError('NOT_FOUND', `Unknown skill: ${id}`, 3);
  const result = spawnSync(process.execPath, [path.join(workspaceRoot, 'scripts', 'skill-tree.mjs'), 'cases', 'verify'], { cwd: workspaceRoot, encoding: 'utf8' });
  if (result.status !== 0) throw cliError('ACCEPTANCE_FAILED', 'Skill verification failed', 8);
  return success('skill verify', { skillId: id, verified: true, case: skill.case || null });
}

function connectionStatus() {
  const config = requireConfig();
  return success('connection status', { mode: config.site.edgeMode, providers: providerStatus(config) });
}

function cloudStatus() {
  const config = requireConfig();
  return success('cloud status', { cloud: sanitizedCloud(config) });
}

function backupStatus() {
  const config = requireConfig();
  return success('backup status', { backup: readBackupState(config) });
}

function extensionList() {
  const config = requireConfig();
  return success('extension list', { extensions: listExtensions(config) });
}

function extensionInspect(id) {
  requireId(id, 'extension id');
  const extension = extensionList().result.extensions.find((entry) => entry.id === id);
  if (!extension) throw cliError('NOT_FOUND', `Unknown extension: ${id}`, 3);
  return success('extension inspect', { extension });
}

function helpResult() {
  const commands = registry('commands.json');
  return success('help', { binary: commands.binary, output: commands.output, commands: commands.commands });
}

function safeConfig() {
  try { return resolveNodeConfig(); } catch { return null; }
}

function requireConfig() {
  const config = safeConfig();
  if (!config || !fs.existsSync(config.configPath)) throw cliError('NOT_INITIALIZED', 'Personal Agent Node is not initialized', 3, ['Open the local onboarding page or run cloud enroll from an interactive session']);
  return config;
}

function sanitizedCloud(config) {
  const value = readJsonIfExists(path.join(config.configDir, 'cloud.json'));
  if (!value) return { enrolled: false };
  return { enrolled: true, managedHost: value.managedHost, plan: value.plan, status: value.status, tunnel: value.tunnel ? { address: value.tunnel.address, endpoint: value.tunnel.endpoint, generation: value.tunnel.generation } : null };
}

function registry(name) {
  const value = readJsonIfExists(path.join(workspaceRoot, 'registry', name));
  if (!value) throw cliError('REGISTRY_UNAVAILABLE', `Missing registry: ${name}`, 7);
  return value;
}

function success(command, result, warnings = [], nextActions = []) {
  return { command, result, warnings, nextActions };
}

function controlResult(response) {
  return { command: response.command, result: response.result, warnings: response.warnings || [], nextActions: response.nextActions || [] };
}

async function confirmApproval(prompt) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await terminal.question(`Type exactly \"${prompt}\" to approve: `)).trim(); }
  finally { terminal.close(); }
}

function requireId(value, label) {
  if (!value) throw cliError('INVALID_ARGUMENT', `Missing ${label}`, 2);
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveInstallRoot() {
  return path.resolve(process.env.PRIVATE_SITE_INSTALL_ROOT || path.join(process.env.HOME || process.env.USERPROFILE || '', '.private-site-node'));
}

function parseArgs(argv) {
  const result = { _: [], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json' || value === '--output=json') result.json = true;
    else if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--data-root') result.dataRoot = argv[++index];
    else if (value === '--digest') result.digest = argv[++index];
    else if (value.startsWith('-')) throw cliError('INVALID_ARGUMENT', `Unknown option: ${value}`, 2);
    else result._.push(value);
  }
  return result;
}

function cliError(code, message, exitCode, nextActions = []) {
  return Object.assign(new Error(message), { code, exitCode, nextActions });
}
