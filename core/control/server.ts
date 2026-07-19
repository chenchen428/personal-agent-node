#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { capacityState, readServerCapacity } from './capacity.ts';
import { onboardingStatus } from '../runtime/src/cloud-resources.ts';
import { initializeSite, resolveNodeConfig } from '../runtime/src/config.ts';
import { localMailPlan, localMailStatus } from '../runtime/src/mail.ts';
import { setupDiagnostics, setupStatus } from '../runtime/src/setup.ts';
import { executeSetupAction, planSetupAction } from '../runtime/src/setup-actions.ts';
import { createOperationStore } from '../runtime/src/operations.ts';
import { listExtensions } from '../runtime/src/extensions.ts';
import { publicPersonalApp, scanPersonalApps } from '../runtime/src/apps.ts';
import { requestControl } from '../runtime/src/control-service.ts';
import { getDataExport, startDataExport } from './data-export.js';
import { createSpace, deleteSpace, getSpace, listSpaces, setSpaceDesiredState } from '../runtime/src/space-registry.ts';
import { bridgeInvalidResponseError, bridgeResponseError, bridgeTransportError, controlApiErrorResponse } from './api-errors.ts';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(projectRoot, '..', '..');
const host = process.env.ADMIN_PANEL_HOST || '127.0.0.1';
const port = Number(process.env.PERSONAL_AGENT_CONTROL_PORT || 8792);
const projectRegistry = readJsonFile(path.join(root, 'registry', 'projects.json'));
const personalAgentHome = path.resolve(process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), '.personal-agent'));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(personalAgentHome, 'workspace'));
const installRoot = path.resolve(process.env.PRIVATE_SITE_INSTALL_ROOT || path.join(personalAgentHome, 'core'));
const bridgeDir = path.join(root, 'core', 'agent');
const bridgeDataDir = path.resolve(process.env.CLI_BRIDGE_DATA_DIR || path.join(siteDataRoot, 'channels', 'wechat'));
const accountFile = path.join(bridgeDataDir, 'account.json');
const syncBufFile = path.join(bridgeDataDir, 'sync_buf.txt');
const contextCacheFile = path.join(bridgeDataDir, 'context_tokens.json');
const daemonEndpointFile = path.join(bridgeDataDir, 'daemon-endpoint.json');
const onboardingNotificationFile = path.join(siteDataRoot, 'config', 'wechat-onboarding-notification.json');
const wechatBaseUrl = (process.env.WECHAT_ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com').trim();
const wechatBotType = process.env.WECHAT_BOT_TYPE || '3';
const require = createRequire(import.meta.url);
const loginSessions = new Map();
const channelVersion = '0.3.0';
const openAgentBridgeBaseUrl = String(process.env.OPEN_AGENT_BRIDGE_INTERNAL_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const openAgentBridgeApiToken = String(process.env.OPEN_AGENT_BRIDGE_API_TOKEN || '');
const setupOperations = createOperationStore({ dataRoot: siteDataRoot });
const updateConfig = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: siteDataRoot });

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.writableEnded) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (response.headersSent) {
      response.end(request.method === 'HEAD' ? undefined : `${message}\n`);
      return;
    }
    if (String(request.url || '').startsWith('/api/')) {
      const failure = controlApiErrorResponse(error);
      sendJsonStatus(response, failure.statusCode, failure.payload, request.method === 'HEAD');
      return;
    }
    send(response, 500, 'text/plain; charset=utf-8', `${message}\n`, request.method === 'HEAD');
  });
});

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
    send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
    return;
  }
  if (url.pathname === '/healthz') {
    send(response, 200, 'text/plain; charset=utf-8', 'ok\n');
    return;
  }

  if (!isAuthorized(request)) {
    response.writeHead(401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : 'Authentication required\n');
    return;
  }

  if (url.pathname === '/api/projects') {
    await sendJson(response, { ok: true, projects: projectRegistry?.projects || [] }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/server-status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const capacity = readServerCapacity();
    await sendJson(response, { ok: true, state: capacityState(capacity), ...capacity }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/plugins') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const config = { pluginsDir: path.join(siteDataRoot, 'plugins'), pluginDataDir: path.join(siteDataRoot, 'data', 'plugins'), coreVersion: process.env.PERSONAL_AGENT_VERSION || '0.2.0' };
    const plugins = listExtensions(config).map(({ id, version, name, description, state, permissions, contributes, compatibility }) => ({ id, version, name, description, state, permissions, contributes, compatibility }));
    await sendJson(response, { schemaVersion: 1, apiVersion: 'personal-agent/v1', plugins }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/apps') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: siteDataRoot });
    const scan = scanPersonalApps(config);
    await sendJson(response, {
      schemaVersion: 1,
      apps: scan.apps.map(publicPersonalApp),
      invalid: scan.invalid,
    }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/spaces') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      await sendJson(response, {
        ok: true,
        currentSpaceId: updateConfig.space?.id || null,
        spaces: listSpaces(updateConfig.installationDataRoot).map(publicSpace),
      }, request.method === 'HEAD');
      return;
    }
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = await readRequestJson(request);
    try {
      if (input.action === 'create') {
        const space = createSpace({ dataRoot: updateConfig.installationDataRoot, slug: input.slug, displayName: input.displayName });
        try {
          initializeSite({ dataRoot: updateConfig.installationDataRoot, spaceId: space.id, domain: 'personal-agent.local' });
        } catch (error) {
          deleteSpace(updateConfig.installationDataRoot, space.id);
          throw error;
        }
        await sendJson(response, { ok: true, space: publicSpace(space) });
        return;
      }
      if (input.action === 'start' || input.action === 'stop') {
        const space = setSpaceDesiredState(updateConfig.installationDataRoot, String(input.spaceId || ''), input.action === 'start' ? 'running' : 'stopped');
        await sendJson(response, { ok: true, space: publicSpace(space) });
        return;
      }
      if (input.action === 'delete') {
        const existing = getSpace(updateConfig.installationDataRoot, String(input.spaceId || ''));
        if (!existing) throw Object.assign(new Error('隔离空间不存在'), { code: 'SPACE_NOT_FOUND' });
        if (existing.desiredState !== 'stopped' || existing.state !== 'stopped') throw Object.assign(new Error('请先停止隔离空间并等待 Runtime 完全退出'), { code: 'SPACE_RUNNING' });
        if (String(input.confirm || '') !== existing.slug) throw Object.assign(new Error('删除确认与隔离空间标识不一致'), { code: 'CONFIRMATION_REQUIRED' });
        await sendJson(response, { ok: true, space: publicSpace(deleteSpace(updateConfig.installationDataRoot, existing.id)) });
        return;
      }
      throw Object.assign(new Error('未知的隔离空间操作'), { code: 'INVALID_ARGUMENT' });
    } catch (error) {
      const status = error?.code === 'SPACE_NOT_FOUND' ? 404 : error?.code === 'SPACE_RUNNING' ? 409 : 400;
      sendJsonStatus(response, status, { ok: false, error: { code: error?.code || 'SPACE_ACTION_FAILED', message: String(error?.message || '隔离空间操作失败').slice(0, 300) } });
      return;
    }
  }
  if (url.pathname === '/api/wechat/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, await getWechatStatus(), request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/onboarding/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, { ok: true, ...onboardingStatus({ dataRoot: siteDataRoot }) }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/setup') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, await setupStatus({ dataRoot: siteDataRoot, installRoot }), request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/authorization') {
    if (request.method !== 'GET' && request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = request.method === 'POST' ? await readRequestJson(request) : undefined;
    const result = await requestOpenAgentBridge('/api/node/v1/client/authorization', {
      method: request.method,
      headers: input ? { 'content-type': 'application/json' } : undefined,
      body: input ? JSON.stringify(input) : undefined,
    });
    await sendJson(response, result || { ok: false, error: { message: '主 Agent 尚未就绪' } }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/token-limit') {
    if (request.method !== 'GET' && request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = request.method === 'POST' ? await readRequestJson(request) : undefined;
    const result = await requestOpenAgentBridge('/api/node/v1/client/token-limit', {
      method: request.method,
      headers: input ? { 'content-type': 'application/json' } : undefined,
      body: input ? JSON.stringify(input) : undefined,
    });
    await sendJson(response, result || { ok: false, error: { message: '主 Agent 尚未就绪' } }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/codex-settings') {
    if (request.method !== 'GET' && request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = request.method === 'POST' ? await readRequestJson(request) : undefined;
    const result = await requestOpenAgentBridge('/api/node/v1/client/codex-settings', {
      method: request.method,
      headers: input ? { 'content-type': 'application/json' } : undefined,
      body: input ? JSON.stringify(input) : undefined,
    });
    await sendJson(response, result || { ok: false, error: { message: '本机 Agent 尚未就绪' } }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/data-export') {
    if (request.method === 'POST') {
      await readRequestJson(request);
      await sendJson(response, { ok: true, export: startDataExport(siteDataRoot) });
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const job = getDataExport(String(url.searchParams.get('id') || ''));
      if (!job) {
        sendJsonStatus(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: '导出任务不存在' } });
        return;
      }
      await sendJson(response, { ok: true, export: job }, request.method === 'HEAD');
      return;
    }
  }
  if (url.pathname === '/api/setup/diagnostics') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const snapshot = await setupStatus({ dataRoot: siteDataRoot, installRoot });
    await sendJson(response, setupDiagnostics(snapshot), request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/mail/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: siteDataRoot });
    await sendJson(response, { ok: true, status: localMailStatus(config, { installRoot }) }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/mail/plan') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: siteDataRoot });
    await sendJson(response, { ok: true, plan: localMailPlan(config) }, request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/update') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const result = await requestControl(updateConfig, 'update.status', { background: true, jobId: url.searchParams.get('job') || undefined });
      await sendJson(response, { ok: true, ...result.result }, request.method === 'HEAD');
      return;
    }
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = await readRequestJson(request);
    try {
      let result;
      if (input.action === 'check') result = await requestControl(updateConfig, 'update.check', { channel: input.channel }, {}, { timeoutMs: 30_000 });
      else if (input.action === 'plan') result = await requestControl(updateConfig, 'update.plan', { version: input.version }, {}, { timeoutMs: 30_000 });
      else if (input.action === 'rollback-plan') result = await requestControl(updateConfig, 'update.rollback-plan');
      else if (input.action === 'approve') result = await requestControl(updateConfig, 'update.console-approve', { jobId: input.jobId, operationId: input.operationId, digest: input.digest });
      else if (input.action === 'apply') result = await requestControl(updateConfig, 'update.apply', { jobId: input.jobId, operationId: input.operationId, digest: input.digest }, {}, { timeoutMs: 130_000 });
      else throw Object.assign(new Error('未知的软件更新动作'), { code: 'INVALID_ARGUMENT' });
      await sendJson(response, { ok: true, ...result.result });
    } catch (error) {
      sendJsonStatus(response, updateActionStatus(error), { ok: false, error: { code: error?.code || 'UPDATE_FAILED', message: String(error?.message || '软件更新失败').slice(0, 300) } });
    }
    return;
  }
  const setupActionRoute = /^\/api\/setup\/actions\/([a-z0-9.-]+)\/(plan|approve|execute)$/.exec(url.pathname);
  if (setupActionRoute) {
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const [, actionId, phase] = setupActionRoute;
    const input = await readRequestJson(request);
    try {
      if (phase === 'plan') {
        await sendJson(response, { ok: true, operation: planSetupAction({ actionId, operations: setupOperations, dataRoot: siteDataRoot }) });
        return;
      }
      const operation = setupOperations.inspect(input.operationId);
      if (operation.command !== `setup ${actionId}`) throw Object.assign(new Error('操作计划与启用动作不匹配'), { code: 'ACTION_PLAN_MISMATCH' });
      if (phase === 'approve') {
        if (input.approved !== true) throw Object.assign(new Error('需要本机用户明确确认'), { code: 'APPROVAL_REQUIRED' });
        const actor = { kind: 'human', authenticated: true, loopback: true, channel: 'local-console' };
        await sendJson(response, { ok: true, operation: setupOperations.approve(operation.id, { digest: input.digest, actor }) });
        return;
      }
      const executed = await setupOperations.execute(operation.id, {
        digest: input.digest,
        actor: { kind: 'runtime' },
        handler: () => executeSetupAction({ actionId, input: input.input || {}, dataRoot: siteDataRoot }),
      });
      await sendJson(response, { ok: true, operation: executed });
    } catch (error) {
      sendJsonStatus(response, setupActionStatus(error), { ok: false, error: { code: error?.code || 'SETUP_ACTION_FAILED', message: String(error?.message || '启用动作失败').slice(0, 300) } });
    }
    return;
  }
  if (url.pathname === '/api/wechat/login/start') {
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, await startWechatLogin());
    return;
  }
  if (url.pathname === '/api/wechat/login/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, await pollWechatLoginStatus(url.searchParams.get('session')), request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/api/wechat/logout') {
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    unlinkWechatAccount();
    await sendJson(response, { ok: true });
    return;
  }
  send(response, 404, 'text/plain; charset=utf-8', 'Not Found');
}

server.listen(port, host, () => {
  console.log(`workspace admin panel listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

function isAuthorized(request) {
  const address = request.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  return loopback && String(request.headers['x-personal-agent-authenticated'] || '') === '1';
}

function publicSpace(space) {
  return {
    id: space.id,
    slug: space.slug,
    displayName: space.displayName,
    kind: space.kind,
    state: space.state,
    desiredState: space.desiredState,
    localUrl: `http://127.0.0.1:${space.ports.gateway}`,
    managedHost: space.managedHost || null,
    agentMail: space.agentMail || null,
    workspaceRoot: path.join(space.root, 'agent-workspace'),
    createdAt: space.createdAt,
  };
}

function send(response, statusCode, contentType, body, headOnly = false) {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(headOnly ? undefined : body);
}

function sendJson(response, value, headOnly = false) {
  send(response, 200, 'application/json; charset=utf-8', `${JSON.stringify(value, null, 2)}\n`, headOnly);
}

function sendJsonStatus(response, statusCode, value, headOnly = false) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(headOnly ? undefined : `${JSON.stringify(value, null, 2)}\n`);
}

function setupActionStatus(error) {
  if (['APPROVAL_REQUIRED', 'DIGEST_MISMATCH', 'ACTION_PLAN_MISMATCH', 'PASSWORD_CONFIRMATION_MISMATCH', 'INVALID_ARGUMENT'].includes(error?.code)) return 400;
  if (['INVALID_STATE', 'PLAN_EXPIRED'].includes(error?.code)) return 409;
  if (error?.code === 'NOT_FOUND') return 404;
  return 500;
}

function updateActionStatus(error) {
  if (['INVALID_ARGUMENT', 'APPROVAL_REQUIRED', 'DIGEST_MISMATCH'].includes(error?.code)) return 400;
  if (['INVALID_STATE', 'PLAN_EXPIRED', 'ALREADY_CURRENT'].includes(error?.code)) return 409;
  if (['NOT_FOUND', 'UPDATE_UNAVAILABLE', 'VERSION_UNAVAILABLE', 'ROLLBACK_UNAVAILABLE'].includes(error?.code)) return 404;
  return 500;
}

async function readRequestJson(request, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeAccount(account) {
  fs.mkdirSync(bridgeDataDir, { recursive: true });
  fs.writeFileSync(accountFile, `${JSON.stringify(account, null, 2)}\n`, 'utf8');
  for (const staleFile of [syncBufFile, contextCacheFile]) {
    fs.rmSync(staleFile, { force: true });
  }
  try {
    fs.chmodSync(accountFile, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || wechatBaseUrl).trim() || wechatBaseUrl;
  return value.endsWith('/') ? value : `${value}/`;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf8').toString('base64');
}

function isWechatSyncSessionTimeout(response) {
  return response?.errcode === -14 && /session timeout/i.test(response?.errmsg || '');
}

async function validateWechatAccount(account) {
  if (!account?.token || !account?.accountId) {
    return 'Saved WeChat credentials are incomplete.';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const body = JSON.stringify({
      get_updates_buf: '',
      base_info: { channel_version: channelVersion },
    });
    const res = await fetch(`${normalizeBaseUrl(account.baseUrl)}ilink/bot/getupdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${account.token}`,
        'X-WECHAT-UIN': randomWechatUin(),
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      return 'Saved WeChat credentials were rejected by the server.';
    }
    if (!res.ok) {
      return null;
    }
    const payload = JSON.parse(text);
    if (isWechatSyncSessionTimeout(payload)) {
      return 'Saved WeChat login has expired.';
    }
    return null;
  } catch (error) {
    if (error?.name === 'AbortError') {
      return null;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonEndpoint() {
  const endpoint = readJsonFile(daemonEndpointFile);
  if (
    !endpoint ||
    typeof endpoint.pid !== 'number' ||
    typeof endpoint.port !== 'number' ||
    typeof endpoint.token !== 'string' ||
    typeof endpoint.cwd !== 'string'
  ) {
    return null;
  }
  return endpoint;
}

async function sendDaemonRequest(endpoint, payload, timeoutMs = 1200) {
  const id = crypto.randomUUID();
  return await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: endpoint.port });
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for daemon response.' }), timeoutMs);

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ id, token: endpoint.token, payload })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) {
          return;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        try {
          const frame = JSON.parse(line);
          if (frame.id === id) {
            finish(frame.response);
          }
        } catch {
          // Ignore malformed daemon IPC frames.
        }
      }
    });
    socket.once('error', () => finish({ ok: false, error: 'Daemon endpoint is not reachable.' }));
  });
}

async function getDaemonStatus() {
  const endpoint = readDaemonEndpoint();
  if (!endpoint) {
    return { connected: false, state: 'missing-endpoint' };
  }
  if (!isPidAlive(endpoint.pid)) {
    return {
      connected: false,
      state: 'stale-endpoint',
      pid: endpoint.pid,
      cwd: endpoint.cwd,
      startedAt: endpoint.startedAt,
    };
  }
  const response = await sendDaemonRequest(endpoint, { command: 'status' });
  if (!response.ok) {
    return {
      connected: false,
      state: 'unreachable',
      pid: endpoint.pid,
      cwd: endpoint.cwd,
      startedAt: endpoint.startedAt,
      error: response.error,
    };
  }
  return {
    connected: true,
    state: 'running',
    pid: endpoint.pid,
    cwd: endpoint.cwd,
    startedAt: endpoint.startedAt,
    status: response.result,
  };
}

async function getWechatStatus() {
  const bridgeStatus = await requestOpenAgentBridge('/api/status').catch(() => null);
  if (bridgeStatus?.wechat) {
    const wechat = bridgeStatus.wechat;
    return {
      generatedAt: new Date().toISOString(),
      loggedIn: wechat.connected === true,
      polling: wechat.polling === true,
      loginState: wechat.connected === true ? 'connected' : 'login-required',
      reason: wechat.reason || wechat.lastPollError || '',
    };
  }
  const account = readJsonFile(accountFile);
  const invalidReason = account ? await validateWechatAccount(account) : 'No saved WeChat credentials found.';
  const daemon = await getDaemonStatus();
  return {
    generatedAt: new Date().toISOString(),
    dataDir: bridgeDataDir,
    loggedIn: Boolean(account && !invalidReason),
    polling: daemon.connected === true,
    loginState: account && !invalidReason ? 'connected' : 'login-required',
    reason: invalidReason || '',
    account: account ? {
      accountId: account.accountId || '',
      userId: account.userId || '',
      savedAt: account.savedAt || '',
      baseUrl: account.baseUrl || '',
    } : null,
    daemon,
  };
}

async function fetchWechatQrCode() {
  const url = `${normalizeBaseUrl(wechatBaseUrl)}ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(wechatBotType)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`QR fetch failed: ${res.status}`);
  }
  return await res.json();
}

async function pollWechatQrCode(qrcode) {
  const url = `${normalizeBaseUrl(wechatBaseUrl)}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(url, {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`QR status failed: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function renderQrSvg(qrContent) {
  try {
    const qrcodePath = require.resolve('qrcode', { paths: [bridgeDir, root] });
    const qrcode = require(qrcodePath);
    return await qrcode.toString(qrContent, {
      type: 'svg',
      margin: 1,
      width: 260,
      color: {
        dark: '#111113',
        light: '#ffffff',
      },
    });
  } catch {
    return '';
  }
}

async function startWechatLogin() {
  const bridgeLogin = await requestOpenAgentBridge('/api/channels/wechat/login/start', { method: 'POST' }).catch(() => null);
  if (bridgeLogin?.session) return bridgeLogin;
  pruneLoginSessions();
  const qr = await fetchWechatQrCode();
  if (!qr?.qrcode || !qr?.qrcode_img_content) {
    throw new Error('QR fetch failed: response did not include qrcode data.');
  }
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    qrcode: qr.qrcode,
    qrContent: qr.qrcode_img_content,
    baseUrl: wechatBaseUrl,
    createdAt: Date.now(),
    expiresAt: Date.now() + 8 * 60 * 1000,
  };
  loginSessions.set(sessionId, session);
  return {
    session: sessionId,
    status: 'wait',
    expiresAt: new Date(session.expiresAt).toISOString(),
    qrSvg: await renderQrSvg(session.qrContent),
    qrContent: session.qrContent,
  };
}

async function pollWechatLoginStatus(sessionId) {
  const bridgeStatus = await requestOpenAgentBridge(`/api/channels/wechat/login/status?session=${encodeURIComponent(sessionId || '')}`).catch(() => null);
  if (bridgeStatus?.status) {
    if (bridgeStatus.connected || bridgeStatus.status === 'confirmed') {
      return { ...bridgeStatus, ...await completeWechatOnboarding(bridgeStatus.account || {}) };
    }
    return bridgeStatus;
  }
  pruneLoginSessions();
  const session = sessionId ? loginSessions.get(sessionId) : null;
  if (!session) {
    return { status: 'missing', connected: false };
  }
  const status = await pollWechatQrCode(session.qrcode);
  if (status.status !== 'confirmed') {
    return {
      status: status.status || 'wait',
      connected: false,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }
  if (!status.ilink_bot_id || !status.bot_token) {
    throw new Error('Login failed: missing bot credentials from server.');
  }
  const account = {
    token: status.bot_token,
    baseUrl: status.baseurl || session.baseUrl,
    accountId: status.ilink_bot_id,
    userId: status.ilink_user_id,
    savedAt: new Date().toISOString(),
  };
  writeAccount(account);
  loginSessions.delete(sessionId);
  const completion = await completeWechatOnboarding(account);
  return {
    status: 'confirmed',
    connected: true,
    account: {
      accountId: account.accountId,
      userId: account.userId || '',
      savedAt: account.savedAt,
      baseUrl: account.baseUrl,
    },
    ...completion,
  };
}

async function completeWechatOnboarding(account) {
  const onboarding = onboardingStatus({ dataRoot: siteDataRoot });
  const recipientId = String(account?.userId || '').trim();
  if (!recipientId) return { onboarding, notification: { sent: false, reason: 'wechat-user-id-missing' } };
  const digest = crypto.createHash('sha256').update(JSON.stringify({ accountId: account.accountId || '', recipientId, services: onboarding.services })).digest('hex');
  const previous = readJsonFile(onboardingNotificationFile);
  if (previous?.digest === digest) return { onboarding, notification: { sent: true, replay: true } };
  const message = buildOnboardingMessage(onboarding);
  try {
    const delivery = await requestOpenAgentBridge('/api/channels/wechat/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipientId, message }),
    });
    fs.mkdirSync(path.dirname(onboardingNotificationFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(onboardingNotificationFile, `${JSON.stringify({ schemaVersion: 1, digest, sentAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    return { onboarding, notification: { sent: delivery?.sent === true, deferred: delivery?.deferred === true, replay: false } };
  } catch (error) {
    return { onboarding, notification: { sent: false, reason: 'bridge-notify-failed', detail: error instanceof Error ? error.message : String(error) } };
  }
}

function buildOnboardingMessage(onboarding) {
  const services = onboarding.services;
  const lines = [
    'Personal Agent 微信绑定已完成。',
    `公网域名：${services.publicDomain.ready ? services.publicDomain.value : '未绑定'}`,
    `Agent 邮箱：${services.agentMail.ready ? services.agentMail.value : '未绑定'}`,
    `邮件服务：${services.managedMail.enabled ? '已启用' : '默认关闭'}`,
    `配置服务：${services.managedConfiguration.enabled ? '已启用' : '默认关闭'}`,
  ];
  if (services.state !== 'enabled') {
    lines.push('', '请回复“云账号绑定”获取 Personal Agent Cloud 浏览器免密授权链接。授权完成后会自动检测并同步公网域名、Agent 邮箱及服务状态，无需提供 GitHub 用户 ID 或密码。');
  } else {
    lines.push('', '功能检测已完成，域名、邮箱和渠道绑定均可用。');
  }
  return lines.join('\n');
}

async function requestOpenAgentBridge(pathname, options = {}) {
  const token = process.env.OPEN_AGENT_BRIDGE_API_TOKEN || '';
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${openAgentBridgeBaseUrl}${pathname}`, {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw bridgeResponseError(response.status, text);
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { throw bridgeInvalidResponseError(); }
  } catch (error) {
    throw bridgeTransportError(error);
  } finally {
    clearTimeout(timer);
  }
}

function unlinkWechatAccount() {
  loginSessions.clear();
  for (const file of [accountFile, syncBufFile, contextCacheFile]) fs.rmSync(file, { force: true });
}

function pruneLoginSessions() {
  const now = Date.now();
  for (const [id, session] of loginSessions) {
    if (session.expiresAt <= now) {
      loginSessions.delete(id);
    }
  }
}
