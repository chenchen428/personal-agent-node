import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { initializeSite, mergeSecretEnv, resolveNodeConfig, setConnectionMode, writeJsonAtomic } from './config.ts';
import { setProvider } from './providers.ts';
import { validateReverseTunnelContract } from './reverse-tunnel.ts';
import { initializeInstallation, setSpaceManagedIdentity } from './space-registry.ts';

export const DEFAULT_CLOUD_URL = 'https://personal-agent.cn';
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 30;
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export async function enrollWithCloudDeviceAuthorization({
  cloudUrl = DEFAULT_CLOUD_URL,
  dataRoot,
  fetchImpl = fetch,
  openBrowser = openExternalUrl,
  onAuthorization = () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  clientName = 'personal-agent-cli',
  clientVersion = '0.1.0-beta',
} = {}) {
  const baseUrl = normalizeCloudUrl(cloudUrl);
  const preliminary = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot || process.env.PRIVATE_SITE_DATA_ROOT });
  const pendingPath = path.join(preliminary.dataRoot, 'secrets', 'applications', 'cloud-enrollment-pending.json');
  const pending = readDevicePendingEnrollment(pendingPath, baseUrl);
  if (pending) return finalizeEnrollment({ pending, pendingPath, dataRoot: preliminary.dataRoot, fetchImpl });
  if (fs.existsSync(path.join(preliminary.configDir, 'cloud.json'))) throw new Error('当前 Node 已接入 Cloud；请先检查 cloud status 或执行受控断开');

  if (!preliminary.space?.id) throw new Error('Cloud 接入必须绑定到一个隔离空间');
  const installationId = initializeInstallation({ dataRoot: preliminary.installationDataRoot }).installation.installationId;
  const authorization = await startCloudDeviceAuthorization({
    baseUrl,
    fetchImpl,
    clientName,
    clientVersion,
    installationId,
    spaceId: preliminary.space.id,
    spaceKind: preliminary.space.kind === 'personal' ? 'personal' : 'custom',
    spaceSlug: preliminary.space.slug,
  });
  const publicAuthorization = publicDeviceAuthorization(authorization);
  await onAuthorization(publicAuthorization);
  let browserOpened = false;
  try { browserOpened = await openBrowser(authorization.verificationUrlComplete || authorization.verificationUrl); } catch {}

  const enrollmentCredential = await pollCloudDeviceAuthorization({ baseUrl, fetchImpl, authorization, sleep, now });
  const enrolled = await requestJson(fetchImpl, `${baseUrl}/api/node/enroll`, { enrollmentCredential });
  const activationSite = normalizeEnrolledSite(enrolled.site);
  validateEnrollmentResponse(enrolled, activationSite);
  const resumable = { schemaVersion: 3, flow: 'device-authorization', baseUrl, activationSite, enrolled, createdAt: new Date(now()).toISOString() };
  writeJsonAtomic(pendingPath, resumable, 0o600);
  const result = await finalizeEnrollment({ pending: resumable, pendingPath, dataRoot: preliminary.dataRoot, fetchImpl });
  return { ...result, authorization: { ...publicAuthorization, browserOpened } };
}

export function resolveCloudUrl({ cloudUrl, env = process.env } = {}) {
  return cloudUrl || env.PERSONAL_AGENT_CLOUD_URL || DEFAULT_CLOUD_URL;
}

export async function startCloudDeviceAuthorization({ baseUrl, cloudUrl, fetchImpl = fetch, clientName = 'personal-agent-cli', clientVersion = '0.1.0-beta', installationId, spaceId, spaceKind = 'personal', spaceSlug = 'personal' } = {}) {
  const normalizedBaseUrl = normalizeCloudUrl(baseUrl || cloudUrl || DEFAULT_CLOUD_URL);
  const response = await requestJson(fetchImpl, `${normalizedBaseUrl}/api/node/auth/start`, { clientName, clientVersion, installationId, spaceId, spaceKind, spaceSlug });
  const authorization = {
    deviceCode: boundedString(response.deviceCode, 'Cloud 未返回有效 device code', 16, 512),
    userCode: boundedString(response.userCode, 'Cloud 未返回有效 user code', 4, 32),
    verificationUrl: validateVerificationUrl(response.verificationUrl, normalizedBaseUrl),
    verificationUrlComplete: response.verificationUrlComplete ? validateVerificationUrl(response.verificationUrlComplete, normalizedBaseUrl) : '',
    expiresIn: boundedInteger(response.expiresIn, 60, 1800, 'Cloud 返回的授权有效期无效'),
    interval: boundedInteger(response.interval ?? DEFAULT_POLL_INTERVAL_SECONDS, 1, MAX_POLL_INTERVAL_SECONDS, 'Cloud 返回的轮询间隔无效'),
  };
  return authorization;
}

export async function pollCloudDeviceAuthorization({ baseUrl, cloudUrl, fetchImpl = fetch, authorization, sleep, now = () => Date.now() } = {}) {
  const normalizedBaseUrl = normalizeCloudUrl(baseUrl || cloudUrl || DEFAULT_CLOUD_URL);
  if (!authorization?.deviceCode || !authorization?.expiresIn) throw new Error('设备授权状态无效');
  const wait = sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const expiresAt = now() + authorization.expiresIn * 1000;
  let interval = authorization.interval || DEFAULT_POLL_INTERVAL_SECONDS;
  while (now() < expiresAt) {
    await wait(interval * 1000);
    const { response, payload } = await requestJsonResponse(fetchImpl, `${normalizedBaseUrl}/api/node/auth/poll`, { deviceCode: authorization.deviceCode });
    const errorCode = payload.code || payload.error;
    if (response.ok && payload.status === 'approved') {
      return boundedString(payload.enrollmentCredential, 'Cloud 未返回有效一次性接入凭证', 16, 1024);
    }
    if (response.status === 202 || payload.status === 'authorization_pending' || errorCode === 'authorization_pending') {
      interval = normalizeNextInterval(payload.interval, interval);
      continue;
    }
    if (response.status === 429 || errorCode === 'slow_down') {
      const retryAfter = response.headers.get('retry-after');
      interval = Math.min(MAX_POLL_INTERVAL_SECONDS, Math.max(interval + 5, normalizeNextInterval(retryAfter || payload.retryAfter || payload.interval, interval)));
      continue;
    }
    if (errorCode === 'expired_token') throw cloudAuthError('CLOUD_AUTH_EXPIRED', '页面授权已过期，请重新运行 cloud connect');
    if (errorCode === 'access_denied') throw cloudAuthError('CLOUD_AUTH_DENIED', '页面授权已被拒绝');
    throw new Error(payload.message || payload.error || errorCode || `Cloud 页面授权失败 (${response.status})`);
  }
  throw cloudAuthError('CLOUD_AUTH_EXPIRED', '页面授权已过期，请重新运行 cloud connect');
}

async function finalizeEnrollment({ pending, pendingPath, dataRoot, fetchImpl }) {
  const { enrolled, activationSite } = pending;
  const selectedSlug = activationSite.slug;
  const before = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  let config;
  if (fs.existsSync(before.configPath)) {
    writeJsonAtomic(before.configPath, { ...before.site, displayDomain: activationSite.managedHost, asciiDomain: activationSite.managedHost, routingMode: 'path', updatedAt: new Date().toISOString() }, 0o600);
    config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: activationSite.managedHost });
  } else {
    config = initializeSite({ domain: activationSite.managedHost, dataRoot }).config;
  }
  const tunnel = validateReverseTunnelContract(enrolled.tunnel);
  mergeSecretEnv(config.envPath, { SITE_DOMAIN: activationSite.managedHost, PERSONAL_AGENT_CLOUD_TOKEN: enrolled.nodeToken }, ['SITE_DOMAIN', 'PERSONAL_AGENT_CLOUD_TOKEN']);
  config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot });
  setProvider(resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot }), { kind: 'tunnel', provider: 'personal-agent-cloud', endpoint: `${pending.baseUrl}/${selectedSlug}`, credentialEnv: 'PERSONAL_AGENT_CLOUD_TOKEN' });
  const heartbeat = await requestJson(fetchImpl, `${pending.baseUrl}/api/node/heartbeat`, undefined, { authorization: `Bearer ${enrolled.nodeToken}` });
  const metadata = { schemaVersion: 2, cloudUrl: pending.baseUrl, slug: selectedSlug, managedHost: activationSite.managedHost, siteId: enrolled.site.id, plan: activationSite.plan || 'free', status: heartbeat.status || enrolled.site.status, tunnel: { ...tunnel, generation: heartbeat.tunnelGeneration || tunnel.generation }, enrolledAt: new Date().toISOString() };
  writeJsonAtomic(path.join(config.configDir, 'cloud.json'), metadata, 0o600);
  if (config.space?.id) setSpaceManagedIdentity({ dataRoot: config.installationDataRoot, selector: config.space.id, managedHost: metadata.managedHost });
  setConnectionMode(config, 'managed-cloud');
  fs.rmSync(pendingPath, { force: true });
  return { ok: true, site: metadata, tunnel: metadata.tunnel, dataRoot: config.dataRoot, managedUrl: `https://${metadata.managedHost}` };
}

function readDevicePendingEnrollment(pendingPath, baseUrl) {
  if (!fs.existsSync(pendingPath)) return null;
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  if (pending.schemaVersion !== 3 || pending.flow !== 'device-authorization' || pending.baseUrl !== baseUrl) {
    if (pending.schemaVersion === 1) throw new Error('本机存在已废弃的邀请接入状态；请回滚 previous 完成恢复，或清理该未完成状态后重新运行 cloud connect');
    throw new Error('本机存在另一个未完成的 Cloud 接入，请使用原 Cloud 地址恢复');
  }
  validatePending(pending);
  return pending;
}

function validatePending(pending) {
  if (!pending.enrolled?.nodeToken || !pending.enrolled?.tunnel || !pending.activationSite?.managedHost) throw new Error('本机 Cloud 接入恢复状态无效');
}

function normalizeEnrolledSite(site) {
  if (!site || typeof site !== 'object') return {};
  return { ...site, managedHost: site.managedHost || site.managed_host || '', slug: site.slug || '' };
}

function validateEnrollmentResponse(enrolled, site) {
  if (!enrolled?.nodeToken || enrolled.site?.status !== 'active' || !enrolled.tunnel || !site.managedHost || !site.slug) throw new Error('Cloud 设备接入未激活');
  validateReverseTunnelContract(enrolled.tunnel);
}

function publicDeviceAuthorization(value) {
  return { userCode: value.userCode, verificationUrl: value.verificationUrl, verificationUrlComplete: value.verificationUrlComplete || '', expiresIn: value.expiresIn, interval: value.interval };
}

async function requestJson(fetchImpl, url, body, headers = {}) {
  const { response, payload } = await requestJsonResponse(fetchImpl, url, body, headers);
  if (!response.ok) throw cloudAuthError(response.status >= 500 ? 'CLOUD_REQUEST_FAILED' : 'CLOUD_AUTH_FAILED', payload.error || payload.message || `Cloud 请求失败 (${response.status})`);
  return payload;
}

async function requestJsonResponse(fetchImpl, url, body, headers = {}) {
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch {
    throw cloudAuthError('CLOUD_NETWORK_UNREACHABLE', '无法连接 Personal Agent Cloud，请检查 DNS 和网络后重试');
  }
}

function normalizeCloudUrl(value) {
  const url = new URL(String(value || '').trim());
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('Cloud 地址必须使用 HTTPS');
  if (url.username || url.password || url.hash || url.search) throw new Error('Cloud 地址不能包含凭据、查询或片段');
  return url.toString().replace(/\/$/, '');
}

function validateVerificationUrl(value, baseUrl) {
  const url = new URL(String(value || ''));
  const trusted = new URL(baseUrl);
  if (url.origin !== trusted.origin || url.protocol !== trusted.protocol || url.username || url.password || url.hash) throw new Error('Cloud 返回的验证地址不受信任');
  return url.toString();
}

function boundedString(value, message, minimum, maximum) {
  const normalized = String(value || '').trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(message);
  return normalized;
}

function boundedInteger(value, minimum, maximum, message) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(message);
  return number;
}

function normalizeNextInterval(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, MAX_POLL_INTERVAL_SECONDS) : fallback;
}

function cloudAuthError(code, message) { return Object.assign(new Error(message), { code }); }

export function openExternalUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const target = new URL(String(url)).toString();
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', target] : [target];
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}
