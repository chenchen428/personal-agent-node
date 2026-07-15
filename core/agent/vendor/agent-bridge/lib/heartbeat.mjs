import { postJson } from './http.mjs';
import { normalizeAgentCommandAliases } from './agent-aliases.mjs';
import { workspaceNameFromConfig } from './workspace-name.mjs';
import { normalizeWorkspaceEntries } from './workspace-registry.mjs';
import { deriveAppServerTransport, isAppServerClientRunning } from './app-server-client.mjs';

export async function registerWorkspace(config, options = {}) {
  const workspaceName = workspaceNameFromConfig(config);
  return postJson(config.baseUrl, '/api/agent-bridge/workspaces', {
    name: workspaceName,
    workspaceRoot: config.workspace,
    description: `${workspaceName} Agent Bridge workspace`,
    routingTags: [workspaceName, 'agent-bridge-cli'],
    contextSummary: 'Agent Bridge CLI registered on the local runner.',
    appServer: appServerStatus(config),
    agentCommandAliases: normalizeAgentCommandAliases(config),
  }, options);
}

export async function sendHeartbeat(config, options = {}) {
  const workspaceName = workspaceNameFromConfig(config);
  return postJson(config.baseUrl, '/api/agent-bridge/heartbeat', {
    name: workspaceName,
    workspaceRoot: config.workspace,
    workspaces: normalizeWorkspaceEntries(config),
    appServer: appServerStatus(config),
    agentCommandAliases: normalizeAgentCommandAliases(config),
  }, options);
}

export function startHeartbeatLoop(config, { log = console.log } = {}) {
  let stopped = false;
  let inflight = null;
  const intervalMs = normalizeInterval(config.heartbeatIntervalMs);

  const tick = async () => {
    if (stopped || inflight) return;
    inflight = sendHeartbeat(config)
      .catch((error) => log(`[heartbeat] failed: ${error.message}`))
      .finally(() => { inflight = null; });
    await inflight;
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function normalizeInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 10_000) return 60_000;
  return interval;
}

function appServerStatus(config) {
  return {
    // 心跳与 worker 同进程：app-server 客户端存活即 online；未启动时不知道真实状态，报 unknown
    // （服务端对 unknown 保留已有的明确状态，不会冲掉 hello 探测结果）。
    status: isAppServerClientRunning() ? 'online' : 'unknown',
    transport: deriveAppServerTransport(config),
    socketPath: config.appServerSocketPath,
    lastCheckedAt: new Date().toISOString(),
  };
}
