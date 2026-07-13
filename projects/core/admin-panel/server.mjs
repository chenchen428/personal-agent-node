#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  buildNavigationItems,
  readNavigationState,
  recordNavigationClick,
  renderNavigationPage,
} from './page.mjs';
import { capacityState, readServerCapacity } from './capacity.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(projectRoot, '..', '..', '..');
const host = process.env.ADMIN_PANEL_HOST || '127.0.0.1';
const port = Number(process.env.ADMIN_PANEL_PORT || 8791);
const statusScript = path.join(projectRoot, 'status.mjs');
const projectRegistry = readJsonFile(path.join(root, 'registry', 'projects.json'));
const panelConfig = readJsonFile(path.join(root, 'registry', 'admin-panel.json'));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), '.personal-agent.local'));
const adminDataDir = path.resolve(process.env.ADMIN_PANEL_DATA_DIR || path.join(siteDataRoot, 'databases', 'admin'));
const navigationStateFile = path.join(adminDataDir, 'navigation-clicks.json');
const bridgeDir = path.join(root, 'projects', 'core', 'open-agent-bridge');
const bridgeDataDir = path.resolve(process.env.CLI_BRIDGE_DATA_DIR || path.join(siteDataRoot, 'channels', 'wechat'));
const accountFile = path.join(bridgeDataDir, 'account.json');
const syncBufFile = path.join(bridgeDataDir, 'sync_buf.txt');
const contextCacheFile = path.join(bridgeDataDir, 'context_tokens.json');
const daemonEndpointFile = path.join(bridgeDataDir, 'daemon-endpoint.json');
const wechatBaseUrl = (process.env.WECHAT_ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com').trim();
const wechatBotType = process.env.WECHAT_BOT_TYPE || '3';
const require = createRequire(import.meta.url);
const loginSessions = new Map();
const channelVersion = '0.3.0';
const openAgentBridgeBaseUrl = String(process.env.OPEN_AGENT_BRIDGE_INTERNAL_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const openAgentBridgeApiToken = String(process.env.OPEN_AGENT_BRIDGE_API_TOKEN || '');

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
    renderWithCli('json', request, response);
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
  if (url.pathname === '/api/navigation/click') {
    if (request.method !== 'POST') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    const input = await readRequestJson(request);
    const allowedIds = new Set(buildNavigationItems({ registry: projectRegistry, panelConfig }).map((item) => item.id));
    recordNavigationClick(navigationStateFile, String(input.id || ''), allowedIds);
    await sendJson(response, { ok: true });
    return;
  }
  if (url.pathname === '/api/wechat/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
      return;
    }
    await sendJson(response, await getWechatStatus(), request.method === 'HEAD');
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
  if (url.pathname === '/') {
    const items = buildNavigationItems({
      registry: projectRegistry,
      panelConfig,
      hostHeader: request.headers.host || '',
      clickState: readNavigationState(navigationStateFile),
    });
    send(response, 200, 'text/html; charset=utf-8', renderNavigationPage({ title: panelConfig.title, items }), request.method === 'HEAD');
    return;
  }
  if (url.pathname === '/channels' && (request.method === 'GET' || request.method === 'HEAD')) {
    sendRedirect(response, '/app/channels', request.method === 'HEAD');
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

function renderWithCli(format, request, response) {
  const hostHeader = String(request.headers.host || '');
  execFile(process.execPath, [statusScript, format, '--host', hostHeader], {
    cwd: root,
    timeout: 5000,
    env: process.env,
    maxBuffer: 1024 * 1024 * 2,
  }, (error, stdout, stderr) => {
    if (error) {
      const body = `project status failed\n\n${stderr || error.message}\n`;
      send(response, 500, 'text/plain; charset=utf-8', body);
      return;
    }
    send(
      response,
      200,
      format === 'json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      stdout,
      request.method === 'HEAD',
    );
  });
}

function isAuthorized(request) {
  const address = request.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  return loopback && String(request.headers['x-personal-agent-authenticated'] || '') === '1';
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

function sendRedirect(response, location, headOnly = false) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(headOnly ? undefined : `Redirecting to ${location}\n`);
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
  if (bridgeStatus?.status) return bridgeStatus;
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
  return {
    status: 'confirmed',
    connected: true,
    account: {
      accountId: account.accountId,
      userId: account.userId || '',
      savedAt: account.savedAt,
      baseUrl: account.baseUrl,
    },
  };
}

async function requestOpenAgentBridge(pathname, options = {}) {
  const token = process.env.OPEN_AGENT_BRIDGE_API_TOKEN || '';
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`http://127.0.0.1:8788${pathname}`, {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Open Agent Bridge HTTP ${response.status}`);
    return text ? JSON.parse(text) : {};
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
