import fs from 'node:fs';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { managedServiceReadiness } from './cloud-resources.mjs';
import { localMailStatus } from './mail.mjs';
import { resolveCodexCli, resolveNodeConfig, workspaceRoot } from './config.mjs';

const setupRegistry = readJson(path.join(workspaceRoot, 'registry', 'setup-checks.json'));
const stateSet = new Set(setupRegistry.states);
const checkDefinitions = new Map(setupRegistry.checks.map((entry) => [entry.id, entry]));

export async function setupStatus({
  dataRoot,
  installRoot,
  env = process.env,
  now = () => new Date(),
  processAlive = defaultProcessAlive,
  portProbe = probePort,
  codexProbe = inspectCodex,
  remoteProbe = inspectRemoteConnectivity,
  platform = process.platform,
} = {}) {
  const resolvedDataRoot = path.resolve(dataRoot || env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), '.personal-agent'));
  const resolvedInstallRoot = path.resolve(installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(os.homedir(), '.private-site-node'));
  const effectiveEnv = { ...env, PRIVATE_SITE_DATA_ROOT: resolvedDataRoot, PRIVATE_SITE_INSTALL_ROOT: resolvedInstallRoot };
  const generatedAt = now().toISOString();
  const installation = readJson(path.join(resolvedInstallRoot, 'installation.json'));
  const config = safeConfig(effectiveEnv);
  const supervisor = readJson(path.join(resolvedDataRoot, 'runtime', 'supervisor.json'));
  const supervisorAlive = Boolean(supervisor?.pid && supervisor.status === 'running' && processAlive(supervisor.pid));
  const gatewayReady = Boolean(config && await portProbe(config.gateway.host, config.gateway.port));
  const localAuthDocument = readJson(path.join(resolvedDataRoot, 'config', 'local-auth.json'));
  const localAuthReady = Boolean(config?.env?.PERSONAL_AGENT_AUTH_PASSWORD || (localAuthDocument?.algorithm === 'scrypt' && localAuthDocument?.verifier));
  const codex = config?.site
    ? await codexProbe({ config, env: effectiveEnv, platform })
    : emptyCodex();
  const managed = managedServiceReadiness({ dataRoot: resolvedDataRoot, env: effectiveEnv });
  const connectionMode = config?.site?.connectionMode || 'local-only';
  const remoteSelected = connectionMode !== 'local-only';
  const cloud = readJson(path.join(resolvedDataRoot, 'config', 'cloud.json'));
  const connectivityAcceptance = readJson(path.join(resolvedDataRoot, 'runtime', 'setup', 'connectivity.json'));
  const conversationAcceptance = readJson(path.join(resolvedDataRoot, 'runtime', 'setup', 'web-conversation.json'));
  const mailAcceptance = readJson(path.join(resolvedDataRoot, 'runtime', 'setup', 'mail.json'));
  const selections = readJson(path.join(resolvedDataRoot, 'config', 'setup-selections.json')) || {};
  const mailSelected = selections.mail === true;
  const wechatAccount = readJson(path.join(resolvedDataRoot, 'channels', 'wechat', 'account.json'));
  const mail = config ? safeMailStatus(config, { env: effectiveEnv, installRoot: resolvedInstallRoot }) : null;

  const releaseReady = Boolean(installation?.activeReleaseId && pointerExists(path.join(resolvedInstallRoot, 'current')));
  const siteReady = Boolean(config?.site?.siteId && config?.site?.nodeId && fs.statSync(resolvedDataRoot, { throwIfNoEntry: false })?.isDirectory());
  const serviceReady = supervisorAlive && requiredComponentsReady(supervisor);
  const codexConversationReady = conversationAcceptance?.schemaVersion === 1
    && conversationAcceptance.realAgentRuntime === true
    && conversationAcceptance.sameSessionAgentReply === true
    && conversationAcceptance.route === '/app/chat';
  const enrolled = connectionMode === 'managed-cloud'
    ? Boolean(cloud?.managedHost && cloud?.siteId && cloud?.enrolledAt)
    : connectionMode === 'self-hosted-edge';
  const heartbeatReady = connectionMode === 'managed-cloud'
    ? ['active', 'connected', 'ready'].includes(String(cloud?.status || '').toLowerCase())
    : Boolean(connectivityAcceptance?.heartbeat === true);
  const tunnelReady = connectionMode === 'managed-cloud'
    ? Boolean(cloud?.tunnel?.address && cloud?.tunnel?.endpoint)
    : Boolean(connectivityAcceptance?.tunnel === true);
  const remoteHost = connectionMode === 'managed-cloud' ? String(cloud?.managedHost || '') : String(config?.domain || '');
  const remote = remoteSelected && remoteHost
    ? await remoteProbe({ host: remoteHost, token: config?.env?.OPEN_AGENT_BRIDGE_API_TOKEN || '' })
    : { dns: false, tls: false, remoteApp: false };

  const checks = [
    makeCheck('installation.release', releaseReady, releaseReady ? '已安装可信发行版' : '需要完成发行版安装', { installed: releaseReady, releaseId: releaseReady ? String(installation.activeReleaseId).slice(0, 128) : '' }, generatedAt),
    makeCheck('installation.data-root', siteReady, siteReady ? '本机数据目录已初始化' : '本机数据目录尚未初始化', { initialized: siteReady, confined: path.isAbsolute(resolvedDataRoot) }, generatedAt),
    makeCheck('installation.service', serviceReady, serviceReady ? '后台服务正在运行' : '后台服务需要启动或修复', { running: serviceReady }, generatedAt),
    makeCheck('installation.gateway', gatewayReady, gatewayReady ? '本机网关可访问' : '本机网关暂不可访问', { reachable: gatewayReady, loopback: config?.gateway?.host === '127.0.0.1' }, generatedAt),
    makeCheck('installation.console-auth', localAuthReady, localAuthDocument?.verifier ? '本机登录已使用不可逆密码校验器' : localAuthReady ? '请设置自己的本机登录密码' : '需要建立本机登录', { configured: localAuthReady, durableVerifier: Boolean(localAuthDocument?.verifier) }, generatedAt, localAuthDocument?.verifier ? undefined : 'action-required'),
    makeCheck('agent.codex.executable', codex.installed, codex.installed ? '已找到 Codex' : '尚未找到 Codex', { installed: codex.installed }, generatedAt),
    makeCheck('agent.codex.version', codex.versionSupported, codex.versionSupported ? 'Codex 版本受支持' : 'Codex 版本需要确认', { supported: codex.versionSupported, version: codex.version || '' }, generatedAt, codex.installed ? undefined : 'blocked'),
    makeCheck('agent.codex.authentication', codex.authenticated, codex.authenticated ? 'Codex 已登录' : 'Codex 尚未登录', { authenticated: codex.authenticated }, generatedAt, codex.installed ? undefined : 'blocked'),
    makeCheck('agent.codex.handshake', codex.handshake, codex.handshake ? 'Codex app-server 握手成功' : 'Codex app-server 握手未通过', { handshake: codex.handshake }, generatedAt, codex.authenticated ? undefined : 'blocked'),
    makeCheck('agent.web-conversation', codexConversationReady, codexConversationReady ? '真实 Web 对话已验证' : '请在本机对话中完成一次真实回复', { route: '/app/chat', realAgentRuntime: codexConversationReady, sameSessionAgentReply: codexConversationReady }, generatedAt, codex.handshake ? undefined : 'blocked'),
    makeCheck('connectivity.mode', remoteSelected, remoteSelected ? `已选择 ${connectionMode}` : '保持纯本机模式', { selected: remoteSelected, mode: connectionMode }, generatedAt, remoteSelected ? undefined : 'not-selected'),
    makeCheck('connectivity.enrollment', enrolled, enrolled ? '公网连接身份已建立' : '需要完成公网连接授权', { enrolled }, generatedAt, remoteSelected ? undefined : 'not-selected'),
    makeCheck('connectivity.heartbeat', heartbeatReady, heartbeatReady ? '公网连接心跳正常' : '公网连接心跳未就绪', { ready: heartbeatReady }, generatedAt, remoteSelected ? undefined : 'not-selected'),
    makeCheck('connectivity.tunnel', tunnelReady, tunnelReady ? '公网隧道已就绪' : '公网隧道未就绪', { ready: tunnelReady }, generatedAt, remoteSelected ? undefined : 'not-selected'),
    acceptanceCheck('connectivity.dns', remote.dns || connectivityAcceptance?.dns === true, 'DNS', remoteSelected, generatedAt),
    acceptanceCheck('connectivity.tls', remote.tls || connectivityAcceptance?.tls === true, 'TLS', remoteSelected, generatedAt),
    acceptanceCheck('connectivity.remote-app', remote.remoteApp || connectivityAcceptance?.remoteApp === true, '远程 /app', remoteSelected, generatedAt),
    makeCheck('mail.identity', managed.agentMail.ready, managed.agentMail.ready ? 'Agent 邮箱身份已匹配域名' : 'Agent 邮箱身份尚未绑定', { ready: managed.agentMail.ready, value: managed.agentMail.value || '' }, generatedAt, remoteSelected ? undefined : 'not-selected'),
    makeCheck('mail.local-ingest', Boolean(mail?.ingress?.ready), mail?.ingress?.ready ? '本地邮件入口已就绪' : '本地邮件入口尚未配置', { ready: Boolean(mail?.ingress?.ready), smtpServerBundled: false }, generatedAt, mailSelected ? undefined : 'not-selected'),
    makeCheck('mail.delivery', mailAcceptance?.delivery === true, mailAcceptance?.delivery === true ? '真实邮件投递已验证' : '尚未验证真实邮件投递', { verified: mailAcceptance?.delivery === true }, generatedAt, mailSelected ? undefined : 'not-selected'),
    makeCheck('mail.recovery', mailAcceptance?.recovery === true, mailAcceptance?.recovery === true ? '邮件备份恢复已验证' : '尚未验证邮件备份恢复', { verified: mailAcceptance?.recovery === true }, generatedAt, mailSelected ? undefined : 'not-selected'),
    makeCheck('channels.wechat', Boolean(wechatAccount?.accountId && wechatAccount?.userId), wechatAccount?.accountId && wechatAccount?.userId ? '微信渠道已绑定' : '微信渠道可选', { bound: Boolean(wechatAccount?.accountId && wechatAccount?.userId) }, generatedAt, wechatAccount?.accountId && wechatAccount?.userId ? undefined : 'not-selected'),
  ];

  return {
    schemaVersion: 1,
    generatedAt,
    readiness: {
      console: dimensionState(checks, 'console'),
      agent: dimensionState(checks, 'agent'),
      remote: remoteSelected ? dimensionState(checks, 'remote', { ignoreOptional: true }) : 'not-selected',
      mail: mailSelected ? dimensionState(checks.filter((check) => check.id.startsWith('mail.')), 'mail') : 'not-selected',
    },
    groups: setupRegistry.groups,
    checks,
  };
}

export function setupDiagnostics(snapshot) {
  const value = {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    readiness: snapshot.readiness,
    checks: (snapshot.checks || []).map(({ id, group, requirement, dimension, state, summary, evidence, checkedAt }) => ({ id, group, requirement, dimension, state, summary, evidence, checkedAt })),
  };
  return { ...value, diagnosticDigest: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

export async function inspectRemoteConnectivity({ host, token, lookup = dns.lookup, fetchImpl = fetch } = {}) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedHost)) return { dns: false, tls: false, remoteApp: false };
  let dnsReady = false;
  try { dnsReady = Boolean((await lookup(normalizedHost))?.address); } catch {}
  if (!dnsReady) return { dns: false, tls: false, remoteApp: false };
  try {
    const response = await fetchImpl(`https://${normalizedHost}/app`, {
      redirect: 'manual',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(7000),
    });
    return { dns: true, tls: true, remoteApp: response.status >= 200 && response.status < 400 };
  } catch { return { dns: true, tls: false, remoteApp: false }; }
}

export async function inspectCodex({ config, env = process.env, platform = process.platform } = {}) {
  if (!config) return emptyCodex();
  let executable;
  try {
    executable = resolveCodexCli(config.env || env, { platform });
  } catch {
    return emptyCodex();
  }
  const versionResult = spawnSync(executable.command, [...executable.prefixArgs, '--version'], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
  const version = normalizeVersion(`${versionResult.stdout || ''} ${versionResult.stderr || ''}`);
  const loginResult = spawnSync(executable.command, [...executable.prefixArgs, 'login', 'status'], { env, encoding: 'utf8', timeout: 8000, windowsHide: true });
  const authenticated = loginResult.status === 0;
  const handshake = authenticated ? await probeCodexAppServer(executable, { env, cwd: config.agentWorkspaceRoot }) : false;
  return { installed: versionResult.status === 0, version, versionSupported: versionResult.status === 0 && Boolean(version), authenticated, handshake };
}

export function writeWebConversationAcceptance({ dataRoot, now = () => new Date() } = {}) {
  const target = path.join(path.resolve(dataRoot), 'runtime', 'setup', 'web-conversation.json');
  writeJsonAtomic(target, {
    schemaVersion: 1,
    route: '/app/chat',
    authenticated: true,
    realAgentRuntime: true,
    sameSessionAgentReply: true,
    wechatRequired: false,
    verifiedAt: now().toISOString(),
  });
  return target;
}

async function probeCodexAppServer(executable, { env, cwd, timeoutMs = 10_000 } = {}) {
  return await new Promise((resolve) => {
    let settled = false;
    const child = spawn(executable.command, [...executable.prefixArgs, 'app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      resolve(value);
    };
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        try {
          const frame = JSON.parse(line);
          if (frame.id === 1 && frame.result && !frame.error) return finish(true);
        } catch {}
      }
    });
    child.once('error', () => finish(false));
    child.once('exit', () => finish(false));
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'personal-agent-setup', title: 'Personal Agent Setup', version: '1' }, capabilities: { experimentalApi: true } } })}\n`);
  });
}

function makeCheck(id, ready, summary, evidence, checkedAt, explicitState) {
  const definition = checkDefinitions.get(id);
  if (!definition) throw new Error(`Unknown setup check: ${id}`);
  const state = explicitState || (ready ? 'ready' : 'action-required');
  if (!stateSet.has(state)) throw new Error(`Invalid setup state: ${state}`);
  return { ...definition, state, summary, evidence, checkedAt };
}

function acceptanceCheck(id, ready, label, selected, generatedAt) {
  return makeCheck(id, ready, ready ? `${label} 已验证` : `${label} 尚未验证`, { verified: ready }, generatedAt, selected ? undefined : 'not-selected');
}

function dimensionState(checks, dimension, { ignoreOptional = false } = {}) {
  const selected = checks.filter((check) => check.dimension === dimension && !(ignoreOptional && check.requirement === 'optional') && check.state !== 'not-selected');
  if (!selected.length) return 'not-selected';
  if (selected.some((check) => check.state === 'blocked')) return 'blocked';
  if (selected.some((check) => check.state === 'action-required')) return 'action-required';
  if (selected.some((check) => check.state === 'checking')) return 'checking';
  return 'ready';
}

function safeConfig(env) {
  try { return resolveNodeConfig(env); } catch { return null; }
}

function safeMailStatus(config, options) {
  try { return localMailStatus(config, { ...options, scanArchive: false }); } catch { return null; }
}

function requiredComponentsReady(supervisor) {
  return ['personal-agent-control', 'open-agent-bridge', 'open-agent-bridge-worker', 'workspace-admin-panel', 'private-site-gateway']
    .every((name) => Number(supervisor?.components?.[name]?.pid) > 0);
}

function pointerExists(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function defaultProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function probePort(host, port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function normalizeVersion(value) {
  const match = String(value || '').match(/\b(?:codex-cli\s+)?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/i);
  return match ? match[1] : '';
}

function emptyCodex() {
  return { installed: false, version: '', versionSupported: false, authenticated: false, handshake: false };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
