import { unlinkSync, writeFileSync } from 'node:fs';
import { registerWorkspace, sendHeartbeat, startHeartbeatLoop } from './heartbeat.mjs';
import { startCommandChannel } from './command-channel.mjs';
import { normalizeAgentCommandAliases } from './agent-aliases.mjs';
import { discoverAppServerDefaultModel, discoverAppServerModels, discoverAppServerSkills } from './app-server-runner.mjs';
import { startCodexSessionSync } from './codex-session-discovery.mjs';
import { createTimestampedLogger } from './logger.mjs';

export async function startWorker(config) {
  if (!config.baseUrl) throw new Error('baseUrl is required');
  const runtimeConfig = { agentCommand: 'codex app-server', agentAlias: 'codex', ...config };
  const log = createTimestampedLogger();
  runtimeConfig.appServerLog = log;

  try {
    writePidMetadata(runtimeConfig, 'starting');
    const codexSessionSync = startCodexSessionSync(runtimeConfig, { log });
    await registerWorkspace(runtimeConfig);
    await sendHeartbeat(runtimeConfig);
    reportWorkspaceCapabilities(runtimeConfig, log);
    const heartbeat = startHeartbeatLoop(runtimeConfig, { log });
    const commandChannel = startCommandChannel(runtimeConfig, { log });
    writePidMetadata(runtimeConfig, 'running');

    const cleanup = () => {
      codexSessionSync.stop();
      heartbeat.stop();
      commandChannel.stop();
      if (config.pidFile) {
        try { unlinkSync(config.pidFile); } catch {}
      }
      process.exit(0);
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    await new Promise(() => {});
  } catch (error) {
    writePidMetadata(runtimeConfig, 'error', error);
    throw error;
  }
}

// Discover codex skills + selectable models once at startup and report them via machine.specs
// (the web builds its slash-command palette and model picker from these). Fire-and-forget: a
// worker without an app-server alias, or a failing list call, simply reports nothing.
function reportWorkspaceCapabilities(runtimeConfig, log) {
  const hasAppServerAlias = normalizeAgentCommandAliases(runtimeConfig).some((alias) => alias.enabled && alias.transport === 'app-server');
  if (!hasAppServerAlias) return;
  const settle = (promise, what, fallback = []) =>
    promise.catch((error) => { log(`[agent-bridge] ${what} discovery failed: ${error.message}`); return fallback; });
  void Promise.all([
    settle(discoverAppServerSkills(runtimeConfig), 'skills'),
    settle(discoverAppServerModels(runtimeConfig), 'models'),
    settle(discoverAppServerDefaultModel(runtimeConfig), 'default model', null),
  ]).then(([skills, models, defaultModel]) => {
    if (skills.length === 0 && models.length === 0 && !defaultModel) return;
    if (skills.length > 0) runtimeConfig.skills = skills;
    if (models.length > 0) runtimeConfig.models = models;
    if (defaultModel && defaultModel.id) runtimeConfig.defaultModel = defaultModel;
    return sendHeartbeat(runtimeConfig);
  }).catch((error) => log(`[agent-bridge] capability reporting failed: ${error.message}`));
}

function writePidMetadata(config, status, error) {
  if (!config.pidFile) return;
  writeFileSync(config.pidFile, JSON.stringify({
    pid: process.pid,
    status,
    instanceId: 'harness-env',
    baseUrl: config.baseUrl,
    workspace: config.workspace,
    workspaceName: config.workspaceName,
    workspaces: config.workspaces,
    appServerTransport: config.appServerTransport,
    appServerSocketPath: config.appServerSocketPath,
    agentCommandAliases: normalizeAgentCommandAliases(config).map((alias) => ({
      key: alias.key,
      agentType: alias.agentType,
      enabled: alias.enabled,
      isDefault: alias.isDefault,
    })),
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    lastError: error ? error.message : undefined,
    startedAt: new Date().toISOString(),
  }, null, 2));
}
