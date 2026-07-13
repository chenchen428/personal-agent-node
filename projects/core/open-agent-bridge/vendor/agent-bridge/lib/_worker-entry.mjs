#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startWorker } from './worker.mjs';
import { readAgentAliasesJson } from './agent-aliases.mjs';
import { logWithTimestamp } from './logger.mjs';

const args = process.argv.slice(2);

function getArg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}

function readConfigFile(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

const fileConfig = getArg('--config') ? readConfigFile(getArg('--config')) : {};

function boolConfig(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
}

startWorker({
  ...fileConfig,
  baseUrl: getArg('--service-url') || getArg('--server-url') || getArg('--base-url') || fileConfig.serviceUrl || fileConfig.serverUrl || fileConfig.baseUrl,
  agentCommand: getArg('--agent-cmd') || fileConfig.agentCommand || 'codex app-server',
  agentAlias: getArg('--agent-alias') || fileConfig.agentAlias || 'codex',
  agentCommandAliases: readAgentAliasesJson(fileConfig.agentCommandAliases),
  workspace: getArg('--workspace') || fileConfig.workspace,
  workspaceProvided: boolConfig(fileConfig.workspaceProvided, false),
  workspaceName: getArg('--workspace-name') || fileConfig.workspaceName,
  workspaces: Array.isArray(fileConfig.workspaces) ? fileConfig.workspaces : undefined,
  appServerTransport: fileConfig.appServerTransport,
  appServerSocketPath: fileConfig.appServerSocketPath,
  appServerCommand: fileConfig.appServerCommand,
  appServerArgs: Array.isArray(fileConfig.appServerArgs) ? fileConfig.appServerArgs : undefined,
  pidFile: getArg('--pid-file') || fileConfig.pidFile,
  heartbeatIntervalMs: Number(getArg('--heartbeat-interval-ms') || fileConfig.heartbeatIntervalMs || 60_000),
  codexSessionSync: boolConfig(fileConfig.codexSessionSync, true),
  codexSessionsDir: fileConfig.codexSessionsDir,
  codexSessionScanIntervalMs: Number(fileConfig.codexSessionScanIntervalMs || 30_000),
  codexSessionMaxAgeMs: Number(fileConfig.codexSessionMaxAgeMs || 30 * 24 * 60 * 60 * 1000),
  codexSessionMaxFiles: Number(fileConfig.codexSessionMaxFiles || 500),
  codexSessionMaxMessages: Number(fileConfig.codexSessionMaxMessages || 80),
}).catch((error) => {
  logWithTimestamp(`[agent-bridge-worker] ${error.stack || error.message}`);
  process.exit(1);
});
