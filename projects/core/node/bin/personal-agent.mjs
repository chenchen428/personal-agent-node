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
import { enrollWithCloudDeviceAuthorization } from '../src/cloud-enrollment.mjs';
import { commandKey, expandCommandName, HANDLED_COMMAND_KEYS } from '../src/command-surface.mjs';
import { localMailPlan, localMailStatus } from '../src/mail.mjs';

const handledCommandKeys = new Set(HANDLED_COMMAND_KEYS);

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.dataRoot) process.env.PRIVATE_SITE_DATA_ROOT = path.resolve(parsed.dataRoot);
  const response = await execute(parsed);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, ...response })}\n`);
} catch (error) {
  const exitCode = Number(error.exitCode || 7);
  process.stderr.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: { code: error.code || 'DEPENDENCY_UNAVAILABLE', message: error.message || 'Command failed', retryable: exitCode === 7 }, nextActions: error.nextActions || [] })}\n`);
  process.exitCode = exitCode;
}

async function execute(args) {
  const [resource = 'status', action, id] = args._;
  if (resource === 'help' || args.help) return helpResult(args);
  if (args.all) throw cliError('INVALID_ARGUMENT', '--all is only valid with help', 2, ['Run personal-agent help --all --json']);
  const requestedCommand = commandKey(resource, action);
  const descriptor = commandDescriptor(requestedCommand);
  if (!descriptor || descriptor.implementationStatus === 'planned' || !handledCommandKeys.has(requestedCommand)) throw unavailableCommand(requestedCommand);
  if (descriptor.implementationStatus === 'preview' && !args.preview) {
    throw unavailableCommand(requestedCommand, [`Run personal-agent ${requestedCommand} --preview --json to opt in to the non-stable command`]);
  }
  const response = await executeHandled({ resource, action, id, args, requestedCommand });
  if (descriptor.implementationStatus === 'preview') {
    response.warnings = [...(response.warnings || []), { code: 'PREVIEW_COMMAND', message: `${requestedCommand} is a non-stable preview command` }];
  }
  return response;
}

async function executeHandled({ resource, action, id, args, requestedCommand }) {
  if (resource === 'status') return statusResult();
  if (resource === 'doctor') return doctorResult();
  if (resource === 'capabilities' && action === 'list') return capabilityList();
  if (resource === 'capabilities' && action === 'inspect') return capabilityInspect(id);
  if (resource === 'skill' && action === 'list') return skillList();
  if (resource === 'skill' && action === 'inspect') return skillInspect(id);
  if (resource === 'skill' && action === 'verify') return skillVerify(id);
  if (resource === 'connection' && action === 'status') return connectionStatus();
  if (resource === 'cloud' && action === 'connect') return cloudConnect(args);
  if (resource === 'cloud' && action === 'status') return cloudStatus();
  if (resource === 'backup' && action === 'status') return backupStatus();
  if (resource === 'mail' && action === 'status') return mailStatus();
  if (resource === 'mail' && action === 'plan') return mailPlan();
  if (resource === 'extension' && action === 'list') return extensionList();
  if (resource === 'extension' && action === 'inspect') return extensionInspect(id);
  if (resource === 'operation' && action === 'list') return controlResult(await requestControl(requireConfig(), 'operation.list'));
  if (resource === 'operation' && action === 'show') return controlResult(await requestControl(requireConfig(), 'operation.inspect', { id }));
  if (resource === 'operation' && action === 'approve') {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) throw cliError('APPROVAL_REQUIRED', 'Operation approval requires an interactive local terminal', 5);
    const config = requireConfig();
    const challenge = await requestControl(config, 'operation.approval-challenge', { id, digest: args.digest });
    const confirmation = await confirmApproval(challenge.result.prompt);
    return controlResult(await requestControl(config, 'operation.approve', { id, digest: args.digest, nonce: challenge.result.nonce, confirmation }));
  }
  throw unavailableCommand(requestedCommand);
}

function statusResult() {
  const config = safeConfig();
  const installation = readJsonIfExists(path.join(resolveInstallRoot(), 'installation.json'));
  const initialized = Boolean(config && fs.existsSync(config.configPath));
  return success('status', {
    release: installation ? { releaseId: installation.activeReleaseId, revision: installation.revision, profile: installation.profile } : null,
    initialized,
    connection: initialized ? connectionResult(config) : null,
    cloud: initialized ? sanitizedCloud(config) : null,
    legacyBridge: config ? bridgeCliStatus(config) : { ready: false },
  });
}

function doctorResult() {
  const config = safeConfig();
  const packaged = fs.existsSync(path.join(workspaceRoot, 'release-manifest.json'));
  // Doctor is a bounded readiness probe. Archive accounting belongs to the
  // explicit mail status command and must never make every doctor run rescan EML.
  const mail = config ? localMailStatus(config, { scanArchive: false }) : null;
  const checks = [
    { id: 'node-version', ok: Number(process.versions.node.split('.')[0]) === 22 },
    { id: 'release-or-source', ok: fs.existsSync(path.join(workspaceRoot, 'release-manifest.json')) || fs.existsSync(path.join(workspaceRoot, 'package.json')) },
    { id: 'capability-registry', ok: fs.existsSync(path.join(workspaceRoot, 'registry', 'capabilities.json')) },
    { id: 'data-root-confined', ok: !config || path.isAbsolute(config.dataRoot) },
    { id: 'mail-data-root', ok: !config || config.mailDir === path.join(config.dataRoot, 'mail') },
    { id: 'mail-ingress-token', ok: !config || mail.ingress.tokenConfigured },
    { id: 'mail-ingest-entrypoint', ok: fs.existsSync(path.join(workspaceRoot, 'projects', 'core', 'open-agent-bridge', 'bin', 'oab-mail-ingest.mjs')) },
    { id: 'mail-ingest-shim', ok: !config || !packaged || mail.ingress.shimReady },
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
  const skills = registry('skills.json').skills.map(({ name, category, maturity, risks, directory }) => ({ name, category, maturity, risks, directory }));
  return success('skill list', { skills });
}

function skillInspect(name) {
  requireId(name, 'skill name');
  const skill = registry('skills.json').skills.find((entry) => entry.name === name);
  if (!skill) throw cliError('NOT_FOUND', `Unknown skill: ${name}`, 3);
  return success('skill inspect', { skill });
}

function skillVerify(name) {
  requireId(name, 'skill name');
  const skill = registry('skills.json').skills.find((entry) => entry.name === name);
  if (!skill) throw cliError('NOT_FOUND', `Unknown skill: ${name}`, 3);
  const result = spawnSync(process.execPath, [path.join(workspaceRoot, 'scripts', 'skill-tree.mjs'), 'cases', 'verify'], { cwd: workspaceRoot, encoding: 'utf8' });
  if (result.status !== 0) throw cliError('ACCEPTANCE_FAILED', 'Skill verification failed', 8);
  return success('skill verify', { skillName: name, verified: true, examples: skill.examples || [] });
}

function connectionStatus() {
  const config = requireConfig();
  return success('connection status', connectionResult(config));
}

function connectionResult(config) {
  return { mode: config.site.connectionMode, providers: providerStatus(config) };
}

function cloudStatus() {
  const config = requireConfig();
  return success('cloud status', { cloud: sanitizedCloud(config) });
}

async function cloudConnect(args) {
  const cloudUrl = args.cloudUrl || process.env.PERSONAL_AGENT_CLOUD_URL || 'https://personal-agent.cn';
  const packageMetadata = readJsonIfExists(path.join(workspaceRoot, 'projects', 'core', 'node', 'package.json'));
  const enrolled = await enrollWithCloudDeviceAuthorization({
    cloudUrl,
    dataRoot: args.dataRoot,
    clientVersion: packageMetadata?.version || 'unknown',
    ...(args.noOpen ? { openBrowser: async () => false } : {}),
    onAuthorization: (authorization) => emitProgress('cloud.device-authorization', authorization),
  });
  return success('cloud connect', {
    cloud: { enrolled: true, managedHost: enrolled.site.managedHost, plan: enrolled.site.plan, status: enrolled.site.status, tunnel: enrolled.site.tunnel },
    managedUrl: enrolled.managedUrl,
    authorization: enrolled.authorization,
  }, [], ['Run personal-agent status --json']);
}

function backupStatus() {
  const config = requireConfig();
  return success('backup status', { backup: readBackupState(config) });
}

function mailStatus() {
  const config = requireConfig();
  return success('mail status', { mail: localMailStatus(config) });
}

function mailPlan() {
  const config = requireConfig();
  return success('mail plan', { plan: localMailPlan(config) }, [], ['Review workflows/local-mail.md before configuring a local MTA pipe']);
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

function helpResult(args) {
  if (args.preview && args.all) throw cliError('INVALID_ARGUMENT', '--preview and --all cannot be combined', 2);
  const commands = registry('commands.json');
  const visibleStatuses = args.all ? ['implemented', 'preview', 'planned'] : args.preview ? ['implemented', 'preview'] : ['implemented'];
  const commandGroups = Object.fromEntries(visibleStatuses.map((status) => [status, commands.commands.filter((entry) => entry.implementationStatus === status)]));
  const visibleCommands = commands.commands.filter((entry) => visibleStatuses.includes(entry.implementationStatus));
  return success('help', {
    binary: commands.binary,
    implementationStatus: commands.implementationStatus,
    implementationStatuses: commands.implementationStatuses,
    visibility: args.all ? 'all' : args.preview ? 'preview' : 'implemented',
    output: commands.output,
    commands: visibleCommands,
    commandGroups,
  });
}

function unavailableCommand(command, nextActions = ['Run personal-agent help --all --json to inspect implemented, preview, and planned commands']) {
  return cliError('CAPABILITY_UNAVAILABLE', `Command is not available in this release: ${command}`, 7, nextActions);
}

function commandDescriptor(command) {
  return registry('commands.json').commands.find((entry) => expandCommandName(entry.name).includes(command)) || null;
}

function safeConfig() {
  try { return resolveNodeConfig(); } catch { return null; }
}

function requireConfig() {
  const config = safeConfig();
  if (!config || !fs.existsSync(config.configPath)) throw cliError('NOT_INITIALIZED', 'Personal Agent Node is not initialized', 3, ['Run personal-agent cloud connect from an interactive session or initialize local-only mode']);
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

function emitProgress(event, result) {
  process.stderr.write(`${JSON.stringify({ schemaVersion: 1, ok: true, event, result })}\n`);
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
  const result = { _: [], json: false, help: false, preview: false, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json' || value === '--output=json') result.json = true;
    else if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--preview') result.preview = true;
    else if (value === '--all') result.all = true;
    else if (value === '--data-root') result.dataRoot = argv[++index];
    else if (value === '--digest') result.digest = argv[++index];
    else if (value === '--cloud-url') result.cloudUrl = argv[++index];
    else if (value === '--no-open') result.noOpen = true;
    else if (value.startsWith('-')) throw cliError('INVALID_ARGUMENT', `Unknown option: ${value}`, 2);
    else result._.push(value);
  }
  return result;
}

function cliError(code, message, exitCode, nextActions = []) {
  return Object.assign(new Error(message), { code, exitCode, nextActions });
}
