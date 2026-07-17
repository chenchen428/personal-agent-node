#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { bridgeCliStatus } from '../src/cli-shims.ts';
import { resolveNodeConfig, workspaceRoot } from '../src/config.ts';
import { listExtensions } from '../src/extensions.ts';
import { readBackupState } from '../src/backup-scheduler.ts';
import { providerStatus } from '../src/providers.ts';
import { requestControl } from '../src/control-service.ts';
import { DEFAULT_CLOUD_URL, enrollWithCloudDeviceAuthorization, openExternalUrl, resolveCloudUrl } from '../src/cloud-enrollment.ts';
import { commandKey, expandCommandName, HANDLED_COMMAND_KEYS } from '../src/command-surface.ts';
import { localMailPlan, localMailStatus } from '../src/mail.ts';
import { authorizeCloudResources, managedServiceReadiness, onboardingStatus, refreshCloudResources } from '../src/cloud-resources.ts';
import { setupStatus } from '../src/setup.ts';
import { clearDefaultPersonalApp, inspectPersonalApp, publicPersonalApp, readPersonalAppSettings, resolveDefaultPersonalApp, scanPersonalApps, setDefaultPersonalApp, verifyPersonalApp } from '../src/apps.ts';
import { requestActivity } from '../src/activity.ts';

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
  if (resource === 'setup' && action === 'status') return setupStatusResult();
  if (resource === 'setup' && action === 'open') return setupOpen(args);
  if (resource === 'capabilities' && action === 'list') return capabilityList();
  if (resource === 'capabilities' && action === 'inspect') return capabilityInspect(id);
  if (resource === 'skill' && action === 'list') return skillList();
  if (resource === 'skill' && action === 'inspect') return skillInspect(id);
  if (resource === 'skill' && action === 'verify') return skillVerify(id);
  if (resource === 'connection' && action === 'status') return connectionStatus();
  if (resource === 'cloud' && action === 'connect') return cloudConnect(args);
  if (resource === 'cloud' && action === 'login') return cloudLogin(args);
  if (resource === 'cloud' && action === 'resources') return cloudResources(args);
  if (resource === 'cloud' && action === 'status') return cloudStatus();
  if (resource === 'backup' && action === 'status') return backupStatus();
  if (resource === 'mail' && action === 'status') return mailStatus();
  if (resource === 'mail' && action === 'plan') return mailPlan();
  if (resource === 'app' && action === 'list') return appList();
  if (resource === 'app' && action === 'inspect') return appInspect(id);
  if (resource === 'app' && action === 'verify') return appVerify(id);
  if (resource === 'app' && action === 'set-default') return appSetDefault(id);
  if (resource === 'app' && action === 'clear-default') return appClearDefault();
  if (resource === 'extension' && action === 'list') return extensionList();
  if (resource === 'extension' && action === 'inspect') return extensionInspect(id);
  if (resource === 'activity' && ['list', 'search', 'show', 'create', 'upsert', 'update', 'hide', 'restore'].includes(action)) {
    return activityCommand(action, id, args);
  }
  if (resource === 'update' && action === 'status') return controlResult(await requestControl(requireConfig(), 'update.status', { jobId: args.job }));
  if (resource === 'update' && action === 'check') return controlResult(await requestControl(requireConfig(), 'update.check', { channel: args.channel }));
  if (resource === 'update' && action === 'plan') return controlResult(await requestControl(requireConfig(), 'update.plan', { version: args.version }));
  if (resource === 'update' && action === 'apply') {
    requireId(args.operation, '--operation'); requireId(args.digest, '--digest');
    return controlResult(await requestControl(requireConfig(), 'update.apply', { jobId: args.job, operationId: args.operation, digest: args.digest }, {}, { timeoutMs: 130_000 }));
  }
  if (resource === 'update' && action === 'rollback') {
    if (!args.operation) return controlResult(await requestControl(requireConfig(), 'update.rollback-plan'));
    requireId(args.digest, '--digest');
    return controlResult(await requestControl(requireConfig(), 'update.apply', { jobId: args.job, operationId: args.operation, digest: args.digest }, {}, { timeoutMs: 130_000 }));
  }
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
    onboarding: onboardingStatus({ dataRoot: config?.dataRoot || process.env.PRIVATE_SITE_DATA_ROOT }),
    legacyBridge: config ? bridgeCliStatus(config) : { ready: false },
  });
}

async function doctorResult() {
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
    { id: 'mail-ingest-entrypoint', ok: fs.existsSync(path.join(workspaceRoot, 'core', 'agent', 'bin', 'pa-cli.mjs')) },
    { id: 'mail-ingest-shim', ok: !config || !packaged || mail.ingress.shimReady },
  ];
  const setup = await setupStatus({ dataRoot: config?.dataRoot || process.env.PRIVATE_SITE_DATA_ROOT, installRoot: resolveInstallRoot() });
  return success('doctor', { healthy: checks.every((check) => check.ok) && setup.readiness.console === 'ready', checks, setup: { readiness: setup.readiness } });
}

async function setupStatusResult() {
  return success('setup status', await setupStatus({ dataRoot: process.env.PRIVATE_SITE_DATA_ROOT, installRoot: resolveInstallRoot() }));
}

async function setupOpen(args) {
  const config = requireConfig();
  const url = `http://127.0.0.1:${config.gateway.port}/app/setup`;
  const opened = args.noOpen ? false : await openExternalUrl(url);
  return success('setup open', { url, opened }, [], opened ? [] : ['Open the local Setup Center URL in a browser on this computer']);
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
  return success('cloud status', { cloud: sanitizedCloud(config), services: managedServiceReadiness({ dataRoot: config.dataRoot }) });
}

async function cloudLogin(args) {
  const packageMetadata = readJsonIfExists(path.join(workspaceRoot, 'package.json'));
  const result = await authorizeCloudResources({
    cloudUrl: resolveCloudUrl({ cloudUrl: args.cloudUrl }),
    dataRoot: args.dataRoot,
    clientVersion: packageMetadata?.version || 'unknown',
    ...(args.noOpen ? { openBrowser: async () => false } : {}),
    onAuthorization: (authorization) => emitProgress('cloud.resource-authorization', authorization),
  });
  return success('cloud login', { expiresAt: result.expiresAt, resources: result.resources, services: result.serviceReadiness, authorization: result.authorization }, [], ['Run personal-agent cloud resources --json']);
}

async function cloudResources(args) {
  const result = await refreshCloudResources({ dataRoot: args.dataRoot });
  return success('cloud resources', result, [], result.refreshed ? [] : ['Run personal-agent cloud login --json']);
}

async function cloudConnect(args) {
  const cloudUrl = resolveCloudUrl({ cloudUrl: args.cloudUrl });
  const packageMetadata = readJsonIfExists(path.join(workspaceRoot, 'package.json'));
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
  return success('mail status', { mail: localMailStatus(config), managedIntegration: managedServiceReadiness({ dataRoot: config.dataRoot }).managedMail });
}

function mailPlan() {
  const config = requireConfig();
  return success('mail plan', { plan: localMailPlan(config) }, [], ['Review workflows/local-mail.md before configuring a local MTA pipe']);
}

function appList() {
  const config = requireConfig();
  const scan = scanPersonalApps(config);
  const resolved = resolveDefaultPersonalApp(config);
  return success('app list', {
    apps: scan.apps.map(publicPersonalApp),
    invalid: scan.invalid,
    defaultAppId: resolved.configuredAppId,
    effectiveDefaultAppId: resolved.app?.id || '',
    fallback: resolved.fallback,
  });
}

function appInspect(id) {
  requireId(id, 'App id');
  try { return success('app inspect', { app: publicPersonalApp(inspectPersonalApp(requireConfig(), id)) }); }
  catch (error) { throw cliError('NOT_FOUND', error.message || `Unknown App: ${id}`, 3); }
}

function appVerify(id) {
  requireId(id, 'App id');
  try {
    const app = verifyPersonalApp(requireConfig(), id);
    if (!app.compatible) throw new Error(`App requires unsupported Node API ${app.requires.nodeApi}`);
    return success('app verify', { verified: true, app: publicPersonalApp(app) });
  } catch (error) {
    throw cliError('ACCEPTANCE_FAILED', error.message || `App verification failed: ${id}`, 8);
  }
}

function appSetDefault(id) {
  requireId(id, 'App id');
  try {
    const resolved = setDefaultPersonalApp(requireConfig(), id);
    return success('app set-default', { defaultAppId: resolved.app.id, route: `/apps/${resolved.app.id}/` });
  } catch (error) {
    throw cliError('ACCEPTANCE_FAILED', error.message || `Unable to select App: ${id}`, 8);
  }
}

function appClearDefault() {
  const config = requireConfig();
  const previous = readPersonalAppSettings(config).defaultAppId || '';
  clearDefaultPersonalApp(config);
  return success('app clear-default', { previousDefaultAppId: previous, defaultAppId: '', route: '/app' });
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

async function activityCommand(action, id, args) {
  const config = requireConfig();
  const activityId = ['show', 'update', 'hide', 'restore'].includes(action) ? requireActivityId(id) : '';
  const input = {};
  if (['list', 'search'].includes(action)) {
    if (args.query) input.query = args.query;
    if (args.type) input.type = args.type;
    if (args.limit !== undefined) input.limit = numericOption(args.limit, '--limit');
    if (args.cursor) input.cursor = args.cursor;
    if (args.includeHidden) input.includeHidden = true;
  } else if (action === 'show') {
    if (args.includeHidden) input.includeHidden = true;
  } else if (['create', 'upsert', 'update'].includes(action)) {
    if (args.type) input.type = args.type;
    if (args.title) input.title = args.title;
    if (args.detail) input.detail = args.detail;
    if (args.attachments.length) input.attachments = args.attachments;
    if (args.targetType || args.targetId) input.target = { type: args.targetType || '', id: args.targetId || '' };
    if (args.correlationKey) input.correlationKey = args.correlationKey;
    if (args.idempotencyKey) input.idempotencyKey = args.idempotencyKey;
    if (args.occurredAt) input.occurredAt = args.occurredAt;
    if (action === 'update') input.expectedRevision = numericOption(args.expectedRevision, '--expected-revision');
  } else if (action === 'hide') {
    input.reason = args.reason || '';
    input.expectedRevision = numericOption(args.expectedRevision, '--expected-revision');
  } else if (action === 'restore') {
    input.expectedRevision = numericOption(args.expectedRevision, '--expected-revision');
  }
  const requestId = args.requestId || `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await requestActivity(config, args.capability, {
    action: action === 'list' ? 'search' : action === 'show' ? 'get' : action,
    activityId,
    input,
    requestId,
  });
  return success(`activity ${action}`, { activity: result.data });
}

function helpResult(args) {
  if (args.preview && args.all) throw cliError('INVALID_ARGUMENT', '--preview and --all cannot be combined', 2);
  const commands = registry('commands.json');
  if (args.help && args._[0] && args._[0] !== 'help') {
    const requestedCommand = commandKey(args._[0], args._[1]);
    const descriptor = commandDescriptor(requestedCommand);
    if (!descriptor || !expandCommandName(descriptor.name).includes(requestedCommand)) throw unavailableCommand(requestedCommand);
    return success('help', {
      binary: commands.binary,
      visibility: 'command',
      command: commandHelp(requestedCommand, descriptor),
      output: commands.output,
    });
  }
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

function commandHelp(command, descriptor) {
  const commonOptions = [
    { name: '--json', type: 'boolean', required: false, secret: false, description: 'Emit the versioned JSON envelope.' },
    { name: '--data-root', type: 'path', required: false, secret: false, description: 'Use a non-default local data root.' },
  ];
  if (command === 'cloud connect') {
    return {
      name: command,
      usage: 'personal-agent cloud connect [--cloud-url <https-url>] [--no-open] [--data-root <path>] --json',
      risk: descriptor.risk,
      capability: descriptor.capability,
      implementationStatus: descriptor.implementationStatus,
      description: descriptor.description,
      options: [
        ...commonOptions,
        { name: '--cloud-url', type: 'https-url', required: false, secret: false, default: DEFAULT_CLOUD_URL, environment: 'PERSONAL_AGENT_CLOUD_URL', description: 'Select the trusted Cloud origin; the command-line value overrides the environment.' },
        { name: '--no-open', type: 'boolean', required: false, secret: false, description: 'Do not launch a browser; use verificationUrlComplete from progress output.' },
      ],
      authorization: {
        method: 'browser-device-authorization',
        userActionRequired: true,
        oneTimeEnrollmentCredential: true,
        forbiddenCommandLineInputs: ['deviceCode', 'enrollmentCredential', 'nodeToken', 'localPassword', 'tunnelSecret'],
      },
    };
  }
  if (command === 'cloud login') {
    return {
      name: command,
      usage: 'personal-agent cloud login [--cloud-url <https-url>] [--no-open] [--data-root <path>] --json',
      risk: descriptor.risk,
      capability: descriptor.capability,
      implementationStatus: descriptor.implementationStatus,
      description: descriptor.description,
      options: [
        ...commonOptions,
        { name: '--cloud-url', type: 'https-url', required: false, secret: false, default: DEFAULT_CLOUD_URL, environment: 'PERSONAL_AGENT_CLOUD_URL', description: 'Select the trusted Cloud origin.' },
        { name: '--no-open', type: 'boolean', required: false, secret: false, description: 'Do not launch a browser; use verificationUrlComplete from progress output.' },
      ],
      authorization: {
        method: 'browser-device-authorization',
        userActionRequired: true,
        shortLivedResourceToken: true,
        forbiddenCommandLineInputs: ['githubUserId', 'password', 'deviceCode', 'token'],
      },
    };
  }
  if (command.startsWith('activity ')) {
    return {
      name: command,
      usage: activityUsage(command),
      risk: descriptor.risk,
      capability: descriptor.capability,
      implementationStatus: descriptor.implementationStatus,
      description: descriptor.description,
      options: [
        ...commonOptions,
        { name: '--capability', type: 'secret', required: true, secret: true, description: 'Use the ephemeral capability issued to the current verified main-Agent turn.' },
      ],
      authorization: {
        method: 'ephemeral-main-agent-capability',
        userActionRequired: false,
        expiresAtTurnEnd: true,
        workerDelegationAllowed: false,
      },
    };
  }
  return {
    name: command,
    usage: `personal-agent ${command} --json`,
    risk: descriptor.risk,
    capability: descriptor.capability,
    implementationStatus: descriptor.implementationStatus,
    description: descriptor.description,
    options: commonOptions,
  };
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
  return { enrolled: true, managedHost: value.managedHost, plan: value.plan, status: value.status, tunnel: value.tunnel ? { protocol: value.tunnel.protocol, endpoint: value.tunnel.endpoint, generation: value.tunnel.generation } : null };
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

function requireActivityId(value) {
  requireId(value, 'Activity id');
  return value;
}

function numericOption(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw cliError('INVALID_ARGUMENT', `${name} requires a non-negative integer`, 2);
  return number;
}

function activityUsage(command) {
  if (command === 'activity search' || command === 'activity list') return `personal-agent ${command} --capability <ephemeral> [--query <text>] [--type <type>] [--limit <n>] [--cursor <cursor>] [--include-hidden] --json`;
  if (command === 'activity show') return 'personal-agent activity show <id> --capability <ephemeral> [--include-hidden] --json';
  if (command === 'activity create' || command === 'activity upsert') return `personal-agent ${command} --capability <ephemeral> --type <type> --title <text> --detail <text> --idempotency-key <key> [--attachment <object-id>] [--correlation-key <key>] --json`;
  if (command === 'activity update') return 'personal-agent activity update <id> --capability <ephemeral> --expected-revision <n> [--title <text>] [--detail <text>] [--attachment <object-id>] --json';
  if (command === 'activity hide') return 'personal-agent activity hide <id> --capability <ephemeral> --expected-revision <n> --reason <text> --json';
  return 'personal-agent activity restore <id> --capability <ephemeral> --expected-revision <n> --json';
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveInstallRoot() {
  const homeRoot = path.resolve(process.env.PERSONAL_AGENT_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.personal-agent'));
  return path.resolve(process.env.PRIVATE_SITE_INSTALL_ROOT || path.join(homeRoot, 'core'));
}

function parseArgs(argv) {
  const result = { _: [], json: false, help: false, preview: false, all: false, attachments: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json' || value === '--output=json') result.json = true;
    else if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--preview') result.preview = true;
    else if (value === '--all') result.all = true;
    else if (value === '--data-root') result.dataRoot = argv[++index];
    else if (value === '--digest') result.digest = argv[++index];
    else if (value === '--operation') result.operation = argv[++index];
    else if (value === '--job') result.job = argv[++index];
    else if (value === '--version') result.version = argv[++index];
    else if (value === '--channel') result.channel = argv[++index];
    else if (value === '--cloud-url') result.cloudUrl = argv[++index];
    else if (value === '--no-open') result.noOpen = true;
    else if (value === '--capability') result.capability = argv[++index];
    else if (value === '--request-id') result.requestId = argv[++index];
    else if (value === '--query') result.query = argv[++index];
    else if (value === '--type') result.type = argv[++index];
    else if (value === '--title') result.title = argv[++index];
    else if (value === '--detail') result.detail = argv[++index];
    else if (value === '--attachment') result.attachments.push(argv[++index]);
    else if (value === '--target-type') result.targetType = argv[++index];
    else if (value === '--target-id') result.targetId = argv[++index];
    else if (value === '--correlation-key') result.correlationKey = argv[++index];
    else if (value === '--idempotency-key') result.idempotencyKey = argv[++index];
    else if (value === '--occurred-at') result.occurredAt = argv[++index];
    else if (value === '--expected-revision') result.expectedRevision = argv[++index];
    else if (value === '--reason') result.reason = argv[++index];
    else if (value === '--limit') result.limit = argv[++index];
    else if (value === '--cursor') result.cursor = argv[++index];
    else if (value === '--include-hidden') result.includeHidden = true;
    else if (value.startsWith('-')) throw cliError('INVALID_ARGUMENT', `Unknown option: ${value}`, 2);
    else result._.push(value);
  }
  return result;
}

function cliError(code, message, exitCode, nextActions = []) {
  return Object.assign(new Error(message), { code, exitCode, nextActions });
}
