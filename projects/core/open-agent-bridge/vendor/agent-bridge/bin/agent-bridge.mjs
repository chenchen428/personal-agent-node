#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { startDaemon, stopDaemon, listDaemons, describeDaemon, statusDaemon, prepareForegroundWorker, upsertWorkspaceRegistry, readRuntimeConfig, APP_SERVER_SOCKET_FILE } from '../lib/daemon.mjs';
import { startWorker } from '../lib/worker.mjs';
import { installService } from '../lib/service.mjs';
import { registerWorkspace, sendHeartbeat } from '../lib/heartbeat.mjs';
import { readAgentAliasesJson } from '../lib/agent-aliases.mjs';
import { syncCodexSessions } from '../lib/codex-session-discovery.mjs';
import {
  listWorkspaces as abListWorkspaces,
  listSessions as abListSessions,
  startSession as abStartSession,
  sessionInput as abSessionInput,
  sessionStatus as abSessionStatus,
} from '../lib/ab-client.mjs';

const args = process.argv.slice(2);
const command = args[0];
const PROD_BASE_URL = 'https://abg.alibaba-inc.com';
const PRE_BASE_URL = 'https://pre-abg.alibaba-inc.com';
const LOCAL_BASE_URL = 'http://localhost:3000';
const DEFAULT_BASE_URL = PROD_BASE_URL;
const DEFAULT_AGENT_COMMAND = 'codex app-server';

function getArg(name, fallback) {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function boolConfig(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
}

function baseConfig() {
  const configFile = getArg('--config') || process.env.AGENT_BRIDGE_CONFIG;
  const fileConfig = configFile ? readConfigFile(configFile) : {};
  if (fileConfig.instanceId) {
    throw new Error('Agent Bridge is a singleton daemon; config.instanceId is forbidden');
  }
  const serviceUrlInput = getArg('--service-url') ||
    getArg('--server-url') ||
    getArg('--base-url') ||
    process.env.AGENT_BRIDGE_SERVICE_URL ||
    process.env.AGENT_BRIDGE_SERVER_URL ||
    process.env.AGENT_BRIDGE_WEB_BASE_URL ||
    fileConfig.serviceUrl ||
    fileConfig.serverUrl ||
    fileConfig.baseUrl;
  const workspaceInput = getArg('--workspace') || process.env.AGENT_BRIDGE_WORKSPACE || fileConfig.workspace;
  return {
    configFile: configFile ? resolve(configFile) : undefined,
    baseUrl: normalizeBaseUrl(serviceUrlInput || DEFAULT_BASE_URL),
    serviceUrlProvided: Boolean(serviceUrlInput),
    agentCommand: getArg('--agent-cmd') || process.env.AGENT_BRIDGE_AGENT_CMD || fileConfig.agentCommand || DEFAULT_AGENT_COMMAND,
    agentAlias: getArg('--agent-alias') || process.env.AGENT_BRIDGE_AGENT_ALIAS || fileConfig.agentAlias || 'codex',
    agentCommandAliases: readAgentAliasesJson(process.env.AGENT_BRIDGE_AGENT_ALIASES) ?? fileConfig.agentCommandAliases,
    appServerSandbox: getArg('--app-server-sandbox') || process.env.AGENT_BRIDGE_APP_SERVER_SANDBOX || fileConfig.appServerSandbox,
    appServerApprovalPolicy: getArg('--app-server-approval-policy') || process.env.AGENT_BRIDGE_APP_SERVER_APPROVAL_POLICY || fileConfig.appServerApprovalPolicy,
    appServerModel: getArg('--app-server-model') || process.env.AGENT_BRIDGE_APP_SERVER_MODEL || fileConfig.appServerModel,
    appServerTransport: getArg('--app-server-transport') || process.env.AGENT_BRIDGE_APP_SERVER_TRANSPORT || fileConfig.appServerTransport || 'unix',
    appServerSocketPath: getArg('--app-server-socket') || process.env.AGENT_BRIDGE_APP_SERVER_SOCKET || fileConfig.appServerSocketPath || APP_SERVER_SOCKET_FILE,
    workspace: resolve(workspaceInput || process.cwd()),
    workspaceProvided: Boolean(workspaceInput),
    workspaceName: getArg('--workspace-name') || process.env.AGENT_BRIDGE_WORKSPACE_NAME || fileConfig.workspaceName,
    workspaces: Array.isArray(fileConfig.workspaces) ? fileConfig.workspaces : undefined,
    heartbeatIntervalMs: Number(getArg('--heartbeat-interval-ms') || process.env.AGENT_BRIDGE_HEARTBEAT_INTERVAL_MS || fileConfig.heartbeatIntervalMs || 60_000),
    codexSessionSync: !hasFlag('--no-codex-session-sync') && boolConfig(process.env.AGENT_BRIDGE_CODEX_SESSION_SYNC ?? fileConfig.codexSessionSync, true),
    codexSessionsDir: getArg('--codex-sessions-dir') || process.env.AGENT_BRIDGE_CODEX_SESSIONS_DIR || fileConfig.codexSessionsDir,
    codexSessionScanIntervalMs: Number(getArg('--codex-session-scan-interval-ms') || process.env.AGENT_BRIDGE_CODEX_SESSION_SCAN_INTERVAL_MS || fileConfig.codexSessionScanIntervalMs || 30_000),
    codexSessionMaxAgeMs: Number(getArg('--codex-session-max-age-ms') || process.env.AGENT_BRIDGE_CODEX_SESSION_MAX_AGE_MS || fileConfig.codexSessionMaxAgeMs || 30 * 24 * 60 * 60 * 1000),
    codexSessionMaxFiles: Number(getArg('--codex-session-max-files') || process.env.AGENT_BRIDGE_CODEX_SESSION_MAX_FILES || fileConfig.codexSessionMaxFiles || 500),
    codexSessionMaxMessages: Number(getArg('--codex-session-max-messages') || process.env.AGENT_BRIDGE_CODEX_SESSION_MAX_MESSAGES || fileConfig.codexSessionMaxMessages || 80),
  };
}

function printHelp() {
  console.log(`Agent Bridge CLI

Usage:
  abg register
  abg start
  abg restart
  abg install-service --config ~/.agent-bridge/harness-env/configs/agent-bridge.json
  abg stop
  abg status [--json]
  abg list
  abg info

Alias:
  abg is the short alias of agent-bridge. Both commands use the same CLI.

Main-agent orchestration tools (single local runner):
  abg workspace list
  abg session list [--status running]
  abg session start --workspace-name <ws> --agent <alias> --task <text> [--parent <mainSessionId>]
  abg session input --session <id> --text <text>
  abg session status --session <id>

Options:
  --service-url <url>             Agent Bridge service URL. Omit to choose pre/prod/local interactively.
  --server-url <url>              Alias of --service-url.
  --base-url <url>                Legacy alias of --service-url.
  --agent-cmd <cmd>               Advanced override for Codex app-server command. Default: ${DEFAULT_AGENT_COMMAND}
  --agent-alias <key>             Default alias key for local agent command selection.
  --app-server-transport <stdio|unix> Local app-server transport. Default: unix.
  --app-server-socket <path>       Unix socket path for codex app-server.
  --workspace <dir>               Advanced default workspace override. Codex sessions are auto-discovered.
  --workspace-name <name>          Advanced display/routing override for the default workspace.
  --codex-sessions-dir <dir>       Codex sessions directory. Default: ~/.codex/sessions.
  --no-codex-session-sync          Disable auto-discovery of local Codex sessions.
  --config <file>                 Local JSON config for service / boot startup.
  --heartbeat-interval-ms <ms>    Background heartbeat interval. Default: 60000.
  --foreground                    Run worker in foreground for local debugging.
`);
}

async function main() {
  rejectSingletonBypass();
  if (!command || command === 'help' || hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }

  if (command === 'start') {
    requireCodexInstalled();
    const config = await completeInteractiveConfig(baseConfig(), { service: true });
    const consoleUrl = `${config.baseUrl}/agent-bridge`;
    if (hasFlag('--foreground')) {
      const workspaces = initialWorkspaces(config);
      await printConsole(consoleUrl);
      await startWorker({ ...config, workspaces, pidFile: prepareForegroundWorker() });
    } else {
      startDaemon(config);
      await printConsole(consoleUrl);
    }
    return;
  }

  if (command === 'restart') {
    requireCodexInstalled();
    const previous = readRuntimeConfig();
    if (!previous?.baseUrl) {
      throw new Error('没有可恢复的 Agent Bridge 配置，请先运行 abg start');
    }
    // startDaemon 内部会先停掉在跑的 daemon 再拉起,等同重启;复用上次落盘配置,免交互。
    const consoleUrl = `${previous.baseUrl}/agent-bridge`;
    startDaemon(previous);
    await printConsole(consoleUrl);
    return;
  }

  if (command === 'register') {
    const config = await completeInteractiveConfig(baseConfig(), { service: true });
    await syncCodexSessions(config, { log: (line) => console.error(line) });
    const registryWorkspaces = config.workspaceProvided === true ? upsertWorkspaceRegistry(config) : [];
    const workspaces = [
      ...(Array.isArray(config.workspaces) ? config.workspaces : []),
      ...registryWorkspaces,
    ];
    const registered = await registerWorkspace({ ...config, workspaces });
    await sendHeartbeat({ ...config, workspaces });
    console.log(JSON.stringify({ ok: true, workspace: registered.workspace ?? registered }, null, 2));
    return;
  }

  if (command === 'install-service') {
    const config = await completeInteractiveConfig(baseConfig(), { service: true });
    installService({ ...config, binPath: fileURLToPath(import.meta.url), load: hasFlag('--load') });
    return;
  }

  if (command === 'workspace') {
    const sub = args[1];
    if (sub !== 'list') throw new Error(`Unknown workspace command: ${sub ?? ''}`);
    const config = await completeInteractiveConfig(baseConfig());
    printJson(await abListWorkspaces(config));
    return;
  }

  if (command === 'session') {
    const sub = args[1];
    const config = await completeInteractiveConfig(baseConfig());
    if (sub === 'list') {
      printJson(await abListSessions(config, { status: getArg('--status') }));
      return;
    }
    if (sub === 'start') {
      const task = getArg('--task') || getArg('--task-description');
      const session = await abStartSession(config, {
        workspace: getArg('--workspace-name') || config.workspaceName,
        agentAlias: getArg('--agent'),
        task,
        parentSessionId: getArg('--parent'),
      });
      // 建会话只落记录；服务端在首轮 send 时才入队 session.start command，
      // 所以带 --task 时紧跟一次 send 把任务作为首条消息真正派发给 worker。
      if (task && session?.id) {
        try {
          const dispatched = await abSessionInput(config, { sessionId: session.id, text: task });
          console.error(`[agent-bridge] task dispatched: session=${session.id} command=${dispatched?.command?.id ?? '?'}`);
          printJson(dispatched?.session ?? session);
        } catch (error) {
          console.error(`[agent-bridge] 会话 ${session.id} 已创建，但任务派发失败: ${error.message}`);
          console.error(`[agent-bridge] 本地 runner 在线后可补发: abg session input --session ${session.id} --text "<任务>"`);
          printJson(session);
          process.exitCode = 1;
        }
        return;
      }
      printJson(session);
      return;
    }
    if (sub === 'input') {
      requireValue(getArg('--session'), '--session');
      printJson(await abSessionInput(config, { sessionId: getArg('--session'), text: getArg('--text') }));
      return;
    }
    if (sub === 'status') {
      requireValue(getArg('--session'), '--session');
      printJson(await abSessionStatus(config, { sessionId: getArg('--session') }));
      return;
    }
    throw new Error(`Unknown session command: ${sub ?? ''}`);
  }

  if (command === 'stop') {
    if (hasFlag('--all')) throw new Error('Agent Bridge is a singleton daemon; --all is not supported');
    stopDaemon();
    return;
  }

  if (command === 'status') {
    statusDaemon({ json: hasFlag('--json') });
    return;
  }

  if (command === 'list') {
    listDaemons();
    return;
  }

  if (command === 'info') {
    describeDaemon();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function readConfigFile(file) {
  try {
    return JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`failed to read --config ${file}: ${error.message}`);
  }
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

// Preflight: the worker drives every session through `codex app-server` (app-server-client spawns
// the literal `codex` binary). Without it the worker still registers + heartbeats "online" but every
// session fails with an opaque spawn error, so block startup early with an actionable install hint.
function requireCodexInstalled() {
  const probe = spawnSync('codex', ['--version'], { stdio: 'ignore' });
  if (!(probe.error && probe.error.code === 'ENOENT')) return;
  throw new Error(
    '未检测到 codex 命令。Agent Bridge worker 依赖 Codex CLI（codex app-server）驱动会话。\n' +
    '请先安装后重试：npm install -g @openai/codex\n' +
    '安装完成后执行 codex --version 确认可用，再重新运行 abg start。',
  );
}

function printJson(value) {
  console.log(JSON.stringify(value ?? null, null, 2));
}

// 打印控制台链接;在 TTY 下额外渲染二维码,方便手机扫码打开当前 CLI 使用的 URL。
// qrcode-terminal 缺失时静默降级为只打印链接,不影响启动。
async function printConsole(url) {
  console.log(`[agent-bridge] console: ${url}`);
  if (!process.stdout.isTTY) return;
  try {
    const { default: qrcode } = await import('qrcode-terminal');
    await new Promise((resolve) => {
      qrcode.generate(url, { small: true }, (qr) => {
        console.log('[agent-bridge] 扫码打开控制台:');
        process.stdout.write(qr.endsWith('\n') ? qr : `${qr}\n`);
        resolve();
      });
    });
  } catch {
    // qrcode-terminal 未安装或渲染失败:链接已打印,忽略即可。
  }
}

function initialWorkspaces(config) {
  if (config.workspaceProvided === true) return upsertWorkspaceRegistry(config);
  return Array.isArray(config.workspaces) ? config.workspaces : undefined;
}

async function completeInteractiveConfig(config, { service = false } = {}) {
  if (service && !config.serviceUrlProvided && canPrompt()) {
    config.baseUrl = await promptServiceUrl(config.baseUrl);
  }
  return config;
}

function canPrompt() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function promptServiceUrl(current) {
  const answer = await ask(`选择 Agent Bridge 环境:
  1) 线上 ${PROD_BASE_URL} (默认)
  2) 预发 ${PRE_BASE_URL}
  3) 本地 ${LOCAL_BASE_URL}
  4) 自定义
请输入序号: `);
  const choice = answer.trim();
  if (!choice || choice === '1' || /^prod(uction)?$/i.test(choice)) return PROD_BASE_URL;
  if (choice === '2' || /^pre$/i.test(choice)) return PRE_BASE_URL;
  if (choice === '3' || /^local$/i.test(choice)) return LOCAL_BASE_URL;
  if (choice === '4') {
    const custom = await ask('请输入 Agent Bridge 服务地址: ');
    return normalizeBaseUrl(custom.trim() || current || DEFAULT_BASE_URL);
  }
  if (/^https?:\/\//i.test(choice)) return normalizeBaseUrl(choice);
  return normalizeBaseUrl(current || DEFAULT_BASE_URL);
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function rejectSingletonBypass() {
  if (args.includes('--instance-id') || args.some((arg) => arg.startsWith('--instance-id='))) {
    throw new Error('Agent Bridge is a singleton daemon; --instance-id is forbidden');
  }
  if (process.env.AGENT_BRIDGE_INSTANCE_ID) {
    throw new Error('Agent Bridge is a singleton daemon; AGENT_BRIDGE_INSTANCE_ID is forbidden');
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

main().catch((error) => {
  console.error(`[agent-bridge] ${error.message}`);
  process.exit(1);
});
