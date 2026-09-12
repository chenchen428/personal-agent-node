import { execFile } from 'node:child_process';
import path from 'node:path';
import { createRuntimeEnvironmentService } from '../../agent/src/runtime-environments/index.ts';
import { detectRuntimeEnvironment } from '../../agent/src/runtime-environments/detection.ts';
import { resolveClaudeCommand } from '../../agent/src/agent/claude-code-runner.ts';
import { resolveCodexCli } from './config.ts';

const blank = { installed: false, version: '', versionSupported: false, authenticated: false, authorizationReady: false, handshake: false };

/** Doctor reads installation/authentication facts; only user-requested tests or real turns spend model tokens. */
export async function inspectSetupRuntime({ config, env, platform, codexProbe, runtimeProbe, acceptance }: any) {
  const base = { ...blank, engine: 'codex', label: 'Codex', revision: 0, mode: 'account', configured: false, conversationReady: false, configError: false };
  if (!config?.site) return base;
  let service;
  let view;
  try {
    service = createRuntimeEnvironmentService({
      workspaceRoot: config.dataRoot,
      spaceId: config.space.id,
      legacyFile: path.join(config.dataRoot, 'config', 'codex-runtime-settings.json'),
      legacyFallback: { model: config.env?.OPEN_AGENT_BRIDGE_CODEX_MODEL || '', reasoningEffort: config.env?.OPEN_AGENT_BRIDGE_CODEX_REASONING_EFFORT || '' },
    });
    view = service.view();
  } catch { return { ...base, label: '运行环境', configError: true }; }
  const profile = view.profiles[view.engine];
  const current = { ...base, engine: view.engine, label: view.engine === 'codex' ? 'Codex' : 'Claude Code', revision: view.revision, mode: profile.mode };
  const receipt = matchesRuntimeAcceptance(acceptance, view);
  if (view.engine === 'codex' && profile.mode === 'account') {
    const codex = await codexProbe({ config, env, platform });
    return { ...current, ...codex, authorizationReady: codex.authenticated, conversationReady: Boolean(receipt && codex.handshake) };
  }
  let credentialAvailable = false;
  if (profile.mode === 'custom' && profile.credentialConfigured) {
    try { credentialAvailable = Boolean(service.readExecution().credential); } catch { /* Missing credential files never count as configured authorization. */ }
  }
  const configured = profile.mode === 'custom' && Boolean(profile.baseUrl && profile.model && credentialAvailable);
  let detected;
  try {
    if (runtimeProbe) detected = await runtimeProbe({ config, env, platform, engine: view.engine, profile, revision: view.revision });
    else {
      const executable = view.engine === 'codex' ? resolveCodexCli(config.env || env, { platform }) : resolveClaudeCommand({ env: config.env || env, platform });
      const command = { command: executable.command, args: 'prefixArgs' in executable ? executable.prefixArgs : executable.args };
      detected = await detectRuntimeEnvironment({ engine: view.engine, revision: view.revision, profile, credential: '' }, {
        commands: { [view.engine]: command },
        exec: (binary, args) => probeCommand(binary, args, config.env || env),
      });
    }
  } catch { return { ...current, configured }; }
  const installed = detected.installed === true;
  const version = String(detected.version || '').match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] || '';
  const authenticated = profile.mode === 'account' && detected.authentication === 'authenticated';
  const authorizationReady = profile.mode === 'custom' ? configured : authenticated;
  const handshake = Boolean(installed && version && authorizationReady && receipt);
  return { ...current, installed, version, versionSupported: installed && Boolean(version), authenticated, authorizationReady, configured, handshake, conversationReady: handshake };
}

export function matchesRuntimeAcceptance(acceptance: any, view: any) {
  if (acceptance?.schemaVersion !== 1 || acceptance.realAgentRuntime !== true || acceptance.sameSessionAgentReply !== true || acceptance.route !== '/app/chat') return false;
  if (acceptance.spaceId && acceptance.spaceId !== view.spaceId) return false;
  if (acceptance.engine !== undefined || acceptance.revision !== undefined) {
    return acceptance.engine === view.engine && acceptance.revision === view.revision;
  }
  // Only the never-migrated Codex account can reuse the historical unbound receipt.
  return view.engine === 'codex' && view.revision === 0 && view.profiles.codex.mode === 'account';
}

export function runtimeSetupChecks(runtime: any, makeCheck: any, generatedAt: string) {
  if (runtime.configError) return [makeCheck('agent.runtime.configuration', false, '运行环境配置无法读取，请修复后重新检测', { readable: false }, generatedAt)];
  const { engine, label, installed, versionSupported, version, authenticated, authorizationReady, handshake, configured, revision, mode } = runtime;
  const custom = mode === 'custom';
  const checks = [
    makeCheck(`agent.${engine}.executable`, installed, installed ? `已找到 ${label}` : `尚未找到 ${label}`, { installed, engine }, generatedAt),
    makeCheck(`agent.${engine}.version`, versionSupported, versionSupported ? `${label} 版本受支持` : `${label} 版本需要确认`, { supported: versionSupported, version }, generatedAt, installed ? undefined : 'blocked'),
    makeCheck(`agent.${engine}.authentication`, authorizationReady, custom ? configured ? '自定义模型与授权凭据已配置，尚不代表连通' : '自定义模型配置不完整' : authenticated ? `${label} 已登录` : `${label} 尚未登录`, { authenticated, configured, mode }, generatedAt, installed ? undefined : 'blocked'),
    makeCheck(`agent.${engine}.handshake`, handshake, handshake ? custom || engine === 'claude-code' ? `${label} 当前配置的真实回复已验证` : 'Codex app-server 握手成功' : custom || engine === 'claude-code' ? '请完成当前配置的一次真实对话以验证执行' : 'Codex app-server 握手未通过', { handshake, engine, revision }, generatedAt, authorizationReady ? undefined : 'blocked'),
    makeCheck('agent.web-conversation', runtime.conversationReady, runtime.conversationReady ? '真实 Web 对话已验证' : '请在本机对话中完成一次当前配置的真实回复', { route: '/app/chat', realAgentRuntime: runtime.conversationReady, sameSessionAgentReply: runtime.conversationReady, engine, revision }, generatedAt, installed && authorizationReady ? undefined : 'blocked'),
  ];
  if (custom || engine === 'claude-code') {
    for (const check of checks.slice(0, 4)) {
      check.guidance = '前往当前隔离空间的“运行设置 → 运行环境”，安装并检测所选基座，完成账号授权或自定义模型配置；保存后在本机对话中取得一次真实回复，再重新检测。';
      check.actionIds = ['agent.runtime.settings'];
    }
    if (installed && authorizationReady) checks[3].actionIds = ['agent.open-chat'];
    checks[3].why = '当前基座与配置版本的一次真实回复才能证明模型执行链路可用；配置保存本身不是连通证据。';
    if (custom) checks[2].why = '自定义模型需要完整的服务地址、模型和可读取凭据；完成配置后仍需验证真实回复。';
  }
  return checks;
}

function probeCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(command, args, { env, timeout: 8000, windowsHide: true, shell: false, maxBuffer: 128 * 1024 },
    (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
}
