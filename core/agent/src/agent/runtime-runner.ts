import crypto from 'node:crypto';
import { createAppServerClient } from './app-server-client.ts';
import { appServerClientOptions, releaseAppServerSession, runAppServerCommand, steerActiveTurn, stopAppServerCommand } from './app-server-runner.ts';
import { runClaudeCodeCommand, stopClaudeCodeCommand } from './claude-code-runner.ts';
import { runtimeProviderBaseUrl } from '../runtime-environments/validation.ts';
import { attachSkillCatalog, nativeSkillMetadata, disableNativeCodexSkills, assertNativeSkillsDisabled } from '../skills/runtime-policy.ts';

const active = new Map();

/** Convert a private settings snapshot into process-only provider overrides. Never persist credentials. */
export function runtimeExecutionConfig(base, execution) {
  const engine = execution?.engine === 'claude-code' ? 'claude-code' : 'codex';
  const profile = execution?.profile || {};
  const env = { ...(base.agentEnv || process.env) };
  const config = { ...base, agentType: engine, agentAlias: engine, agentEnv: env,
    appServerModel: profile.model || undefined, appServerReasoningEffort: profile.reasoningEffort || undefined,
    runtimeCredential: execution?.credential || '', literalInput: true, refreshThreadInstructions: true };
  if (engine === 'claude-code' && profile.mode === 'custom') {
    // A custom endpoint must never receive inherited subscription or alternative-provider credentials.
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
    env.ANTHROPIC_BASE_URL = runtimeProviderBaseUrl(engine, profile.baseUrl);
    if (execution.credential) env[profile.authType === 'bearer' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = execution.credential;
  }
  if (engine === 'codex' && profile.mode === 'custom') {
    const provider = 'personal_agent_runtime';
    env.PERSONAL_AGENT_MODEL_API_KEY = execution.credential || '';
    config.appServerModelProvider = provider;
    const fields = {
      model_provider: provider,
      [`model_providers.${provider}.name`]: 'Personal Agent',
      [`model_providers.${provider}.base_url`]: runtimeProviderBaseUrl(engine, profile.baseUrl),
      [`model_providers.${provider}.wire_api`]: 'responses',
      [`model_providers.${provider}.requires_openai_auth`]: false,
      ...(execution.credential ? { [`model_providers.${provider}.env_key`]: 'PERSONAL_AGENT_MODEL_API_KEY' } : {}),
    };
    // Only validated non-secret configuration goes to argv; auth enters the dedicated child's env.
    config.appServerArgs = [...(base.appServerArgs?.length ? base.appServerArgs : ['app-server']),
      ...Object.entries(fields).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
    config.appServerConfig = fields;
  }
  return config;
}

export async function runRuntimeCommand(base) {
  const execution = base.runtimeExecution || { engine: 'codex', profile: { model: base.appServerModel, reasoningEffort: base.appServerReasoningEffort } };
  let config = attachSkillCatalog(runtimeExecutionConfig(base, execution));
  const engine = config.agentType;
  if (active.has(config.sessionId)) throw new Error('runtime session is already executing');
  active.set(config.sessionId, engine);
  let client;
  let deadline;
  const abort = () => {
    stopRuntimeCommand(config.sessionId);
    client?.shutdown();
  };
  const originalEvent = config.onSessionEvent;
  config.onSessionEvent = (event) => {
    // A provider can echo request credentials even on error; redact every field before persistence.
    const clean = (value) => {
      if (typeof value === 'string' && execution.credential) return value.replaceAll(execution.credential, '[REDACTED]');
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
      return value;
    };
    return originalEvent?.(clean(event));
  };
  try {
    if (base.signal?.aborted) throw new Error('runtime execution aborted');
    base.signal?.addEventListener('abort', abort, { once: true });
    if (engine === 'claude-code') return await runClaudeCodeCommand(config);
    // Every turn owns a transport snapshot. Concurrent Spaces/providers can never inherit another
    // process's credentials, and settings changes cannot mutate an already running turn.
    client = createAppServerClient(appServerClientOptions(config));
    if (config.coveSkillsManaged) {
      const nativeSkills = await nativeSkillMetadata(client, config.workspace);
      client.shutdown();
      config = disableNativeCodexSkills(config, nativeSkills);
      client = createAppServerClient(appServerClientOptions(config));
      await assertNativeSkillsDisabled(client, config.workspace);
    }
    if (base.runtimeTimeoutMs) deadline = setTimeout(() => client.shutdown(), base.runtimeTimeoutMs);
    return await runAppServerCommand({ ...config, appServerClient: client });
  } finally {
    active.delete(config.sessionId);
    base.signal?.removeEventListener('abort', abort);
    clearTimeout(deadline);
    if (client) {
      let cleanupTimeout;
      const closed = client.isRunning() ? new Promise((resolve) => {
        client.onClose(resolve);
        cleanupTimeout = setTimeout(resolve, 2_000);
        cleanupTimeout.unref?.();
      }) : Promise.resolve();
      client.shutdown();
      await closed;
      clearTimeout(cleanupTimeout);
      releaseAppServerSession(config.sessionId);
    }
  }
}

export function stopRuntimeCommand(sessionId) {
  return active.get(sessionId) === 'claude-code' ? stopClaudeCodeCommand(sessionId) : stopAppServerCommand(sessionId);
}

export async function steerRuntimeTurn(sessionId, ...args) {
  // Claude print-mode turns are immutable; the orchestrator queues input for the next turn.
  return active.get(sessionId) === 'claude-code' ? false : steerActiveTurn(sessionId, ...args);
}

/** Short, isolated account round trip used by settings; creates no product conversation or events. */
export async function probeRuntimeAccount(execution, base = {}, signal) {
  const sessionId = `runtime-probe-${crypto.randomUUID()}`;
  let timer;
  try {
    timer = setTimeout(() => stopRuntimeCommand(sessionId), 30_000);
    timer.unref?.();
    const result = await runRuntimeCommand({ ...base, signal, runtimeExecution: execution, sessionId,
      stdin: 'Reply with OK only. Do not use tools.', allowCreateThread: true, cliSessionId: undefined,
      appServerApprovalPolicy: 'never', appServerSandbox: 'read-only', appServerEphemeral: true,
      claudeTools: [], claudeNoSessionPersistence: true, claudeTimeoutMs: 30_000,
      runtimeTimeoutMs: 30_000,
      harnessRoot: undefined, skillReleaseRoot: undefined, appServerDeveloperInstructions: undefined, onSessionEvent: () => {} });
    return result.success === true;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export const runtimeRunner = { runAppServerCommand: runRuntimeCommand, steerActiveTurn: steerRuntimeTurn, stopAppServerCommand: stopRuntimeCommand };
