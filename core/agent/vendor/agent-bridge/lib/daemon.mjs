import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const STATE_DIR = join(homedir(), '.agent-bridge', 'harness-env');
const PID_DIR = join(STATE_DIR, 'pids');
const LOG_DIR = join(STATE_DIR, 'logs');
const RUN_DIR = join(STATE_DIR, 'run');
const SINGLETON_ID = 'harness-env';
const PID_FILE = join(PID_DIR, 'agent-bridge.json');
const LOG_FILE = join(LOG_DIR, 'agent-bridge.log');
const RUNTIME_CONFIG_FILE = join(RUN_DIR, 'worker-config.json');
const WORKSPACE_REGISTRY_FILE = join(RUN_DIR, 'workspaces.json');
export const APP_SERVER_SOCKET_FILE = join(RUN_DIR, 'codex-app-server.sock');

function ensureDirs() {
  mkdirSync(PID_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
}

function workerEntryPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '_worker-entry.mjs');
}

export function startDaemon(config) {
  ensureDirs();
  const pFile = PID_FILE;
  const lFile = LOG_FILE;
  const workspaces = initialWorkspaces(config);
  stopExisting(pFile);
  const runtimeConfig = writeRuntimeConfig({ ...config, pidFile: pFile, workspaces });

  const args = [
    workerEntryPath(),
    '--config', runtimeConfig,
  ];

  const out = openSync(lFile, 'a');
  const err = openSync(lFile, 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  });
  child.unref();

  writePidFile(pFile, {
    pid: child.pid,
    instanceId: SINGLETON_ID,
    baseUrl: config.baseUrl,
    workspace: config.workspace,
    workspaces,
    startedAt: new Date().toISOString(),
    logFile: lFile,
    status: 'starting',
  });
  waitForStartup(pFile, child.pid);
  console.log(`[agent-bridge] started PID=${child.pid} log=${lFile}`);
}

export function stopDaemon() {
  ensureDirs();
  stopExisting(PID_FILE, true);
}

export function prepareForegroundWorker() {
  ensureDirs();
  stopExisting(PID_FILE);
  return PID_FILE;
}

export function listDaemons() {
  ensureDirs();
  const row = describeFile(PID_FILE);
  if (!row) {
    console.log('No Agent Bridge daemons');
    return [];
  }
  console.log(`${SINGLETON_ID} PID=${row.pid} ${row.alive ? 'running' : 'stopped'} workspace=${row.workspace || '-'}`);
  return [row];
}

export function describeDaemon() {
  ensureDirs();
  const row = describeFile(PID_FILE);
  if (!row) {
    console.log('No matching Agent Bridge daemon');
    return null;
  }
  console.log(JSON.stringify(row, null, 2));
  return row;
}

export function statusDaemon({ json = false } = {}) {
  ensureDirs();
  const status = daemonStatusFromRow(describeFile(PID_FILE));
  if (json) console.log(JSON.stringify(status, null, 2));
  else console.log(formatDaemonStatus(status));
  return status;
}

function stopExisting(file, verbose = false) {
  if (!existsSync(file)) {
    if (verbose) console.log(`No daemon metadata at ${file}`);
    return;
  }
  try {
    const info = JSON.parse(readFileSync(file, 'utf8'));
    if (isProcessAlive(info.pid)) {
      process.kill(info.pid, 'SIGTERM');
      waitForStop(info.pid);
      if (verbose) console.log(`[agent-bridge] stopped PID=${info.pid}`);
    } else if (verbose) {
      console.log('[agent-bridge] process already stopped');
    }
  } catch (error) {
    if (verbose) console.log(`Failed to stop daemon from ${file}: ${error.message}`);
  }
  try { unlinkSync(file); } catch {}
}

function daemonStatusFromRow(row) {
  if (!row) {
    return {
      instanceId: SINGLETON_ID,
      status: 'stopped',
      alive: false,
      pid: null,
    };
  }
  const alive = row.alive === true;
  return {
    instanceId: row.instanceId || SINGLETON_ID,
    status: alive ? (row.status || 'running') : 'stopped',
    alive,
    pid: Number.isFinite(row.pid) ? row.pid : null,
    baseUrl: row.baseUrl,
    workspace: row.workspace,
    workspaceName: row.workspaceName,
    startedAt: row.startedAt,
    logFile: row.logFile,
    lastError: row.lastError,
  };
}

function formatDaemonStatus(status) {
  const parts = [`[agent-bridge] ${status.status}`];
  if (status.pid) parts.push(`PID=${status.pid}`);
  if (status.baseUrl) parts.push(`service=${status.baseUrl}`);
  if (status.workspaceName) parts.push(`workspace=${status.workspaceName}`);
  else if (status.workspace) parts.push(`workspace=${status.workspace}`);
  if (status.logFile) parts.push(`log=${status.logFile}`);
  if (status.lastError) parts.push(`error=${status.lastError}`);
  return parts.join(' ');
}

function describeFile(file) {
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(readFileSync(file, 'utf8'));
    return { ...info, alive: isProcessAlive(info.pid) };
  } catch {
    return null;
  }
}

function writePidFile(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function writeRuntimeConfig(config) {
  const data = {
    baseUrl: config.baseUrl,
    serviceUrl: config.baseUrl,
    agentCommand: config.agentCommand,
    agentAlias: config.agentAlias,
    agentCommandAliases: config.agentCommandAliases,
    workspace: config.workspace,
    workspaceProvided: config.workspaceProvided,
    workspaceName: config.workspaceName,
    workspaces: config.workspaces,
    pidFile: config.pidFile,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    appServerTransport: config.appServerTransport || 'unix',
    appServerSocketPath: config.appServerSocketPath || APP_SERVER_SOCKET_FILE,
    codexSessionSync: config.codexSessionSync,
    codexSessionsDir: config.codexSessionsDir,
    codexSessionScanIntervalMs: config.codexSessionScanIntervalMs,
    codexSessionMaxAgeMs: config.codexSessionMaxAgeMs,
    codexSessionMaxFiles: config.codexSessionMaxFiles,
    codexSessionMaxMessages: config.codexSessionMaxMessages,
  };
  writeFileSync(RUNTIME_CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(RUNTIME_CONFIG_FILE, 0o600);
  return RUNTIME_CONFIG_FILE;
}

// 读取上次 start 落盘的完整 worker 配置,供 restart 免交互复用。无历史时返回 null。
export function readRuntimeConfig() {
  if (!existsSync(RUNTIME_CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(RUNTIME_CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function upsertWorkspaceRegistry(config) {
  ensureDirs();
  const current = readWorkspaceRegistry();
  const name = config.workspaceName || basenameFromPath(config.workspace) || 'harness-env';
  const root = config.workspace;
  const key = name || root;
  if (key) {
    current.set(key, {
      name,
      workspaceRoot: root,
      routingTags: [name, 'agent-bridge-cli'].filter(Boolean),
      contextSummary: 'Agent Bridge CLI registered on the local runner.',
      agentCommandAliases: config.agentCommandAliases,
      updatedAt: new Date().toISOString(),
    });
  }
  const list = Array.from(current.values());
  writeFileSync(WORKSPACE_REGISTRY_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
  chmodSync(WORKSPACE_REGISTRY_FILE, 0o600);
  return list;
}

function initialWorkspaces(config) {
  if (config.workspaceProvided === true) return upsertWorkspaceRegistry(config);
  return Array.isArray(config.workspaces) ? config.workspaces : undefined;
}

function readWorkspaceRegistry() {
  const result = new Map();
  if (!existsSync(WORKSPACE_REGISTRY_FILE)) return result;
  try {
    const parsed = JSON.parse(readFileSync(WORKSPACE_REGISTRY_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return result;
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const workspaceRoot = typeof entry.workspaceRoot === 'string' ? entry.workspaceRoot.trim() : '';
      const key = name || workspaceRoot;
      if (!key) continue;
      result.set(key, { ...entry, name: name || key, workspaceRoot });
    }
  } catch {}
  return result;
}

function basenameFromPath(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parts = value.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || '';
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForStartup(file, pid) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const row = describeFile(file);
    if (row?.status === 'running') return;
    if (row?.status === 'error') throw new Error(row.lastError || 'Agent Bridge worker startup failed');
    if (!isProcessAlive(pid)) throw new Error('Agent Bridge worker exited during startup');
    sleep(200);
  }
  throw new Error('Agent Bridge worker did not report running within startup timeout');
}

function waitForStop(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    sleep(100);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
