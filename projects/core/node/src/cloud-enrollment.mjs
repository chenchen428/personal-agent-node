import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { initializeSite, mergeSecretEnv, resolveNodeConfig, writeJsonAtomic } from './config.mjs';
import { installManagedWireGuardTunnel, prepareManagedWireGuardIdentity } from './identity.mjs';
import { setProvider } from './providers.mjs';

const DEFAULT_CLOUD_URL = 'https://personal-agent.cn';
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 30;
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export async function enrollWithCloudDeviceAuthorization({
  cloudUrl = DEFAULT_CLOUD_URL,
  dataRoot,
  fetchImpl = fetch,
  wireGuardExecutor,
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
  if (pending) return finalizeEnrollment({ pending, pendingPath, dataRoot: preliminary.dataRoot, wireGuardExecutor, fetchImpl });
  if (fs.existsSync(path.join(preliminary.configDir, 'cloud.json'))) throw new Error('当前 Node 已接入 Cloud；请先检查 cloud status 或执行受控断开');

  const authorization = await startCloudDeviceAuthorization({ baseUrl, fetchImpl, clientName, clientVersion });
  const publicAuthorization = publicDeviceAuthorization(authorization);
  await onAuthorization(publicAuthorization);
  let browserOpened = false;
  try { browserOpened = await openBrowser(authorization.verificationUrlComplete || authorization.verificationUrl); } catch {}

  const enrollmentCredential = await pollCloudDeviceAuthorization({ baseUrl, fetchImpl, authorization, sleep, now });
  const identity = prepareManagedWireGuardIdentity(preliminary);
  const enrolled = await requestJson(fetchImpl, `${baseUrl}/api/node/enroll`, { enrollmentCredential, publicKey: identity.publicKey });
  const activationSite = normalizeEnrolledSite(enrolled.site);
  validateEnrollmentResponse(enrolled, activationSite);
  const resumable = { schemaVersion: 2, flow: 'device-authorization', baseUrl, activationSite, enrolled, createdAt: new Date(now()).toISOString() };
  writeJsonAtomic(pendingPath, resumable, 0o600);
  const result = await finalizeEnrollment({ pending: resumable, pendingPath, dataRoot: preliminary.dataRoot, wireGuardExecutor, fetchImpl });
  return { ...result, authorization: { ...publicAuthorization, browserOpened } };
}

export async function startCloudDeviceAuthorization({ baseUrl, cloudUrl, fetchImpl = fetch, clientName = 'personal-agent-cli', clientVersion = '0.1.0-beta' } = {}) {
  const normalizedBaseUrl = normalizeCloudUrl(baseUrl || cloudUrl || DEFAULT_CLOUD_URL);
  const response = await requestJson(fetchImpl, `${normalizedBaseUrl}/api/node/auth/start`, { clientName, clientVersion });
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

// Compatibility path for invitation-based onboarding from older releases.
export async function enrollWithCloud({ email, authorizationCode, slug, cloudUrl = DEFAULT_CLOUD_URL, dataRoot, fetchImpl = fetch, wireGuardExecutor } = {}) {
  const baseUrl = normalizeCloudUrl(cloudUrl);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const code = String(authorizationCode || '').trim();
  const selectedSlug = String(slug || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('请输入有效邮箱');
  if (code.length < 4 || code.length > 256) throw new Error('授权码格式无效');
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(selectedSlug)) throw new Error('slug 必须为 3-32 位小写字母、数字或连字符');
  const preliminary = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot || process.env.PRIVATE_SITE_DATA_ROOT });
  const pendingPath = path.join(preliminary.dataRoot, 'secrets', 'applications', 'cloud-enrollment-pending.json');
  let pending = readLegacyPendingEnrollment(pendingPath, { baseUrl, normalizedEmail, selectedSlug });
  if (!pending && fs.existsSync(preliminary.configPath)) throw new Error('Site data root 已初始化，请选择空的数据目录或恢复原 Cloud 接入');
  if (!pending) {
    const activation = await requestJson(fetchImpl, `${baseUrl}/activate`, { email: normalizedEmail, code, slug: selectedSlug });
    if (!activation.deviceCode || !activation.site?.managedHost) throw new Error('Cloud 未返回有效设备码或托管域名');
    const config = initializeSite({ domain: activation.site.managedHost, dataRoot, edgeMode: 'managed' }).config;
    const identity = prepareManagedWireGuardIdentity(config);
    const enrolled = await requestJson(fetchImpl, `${baseUrl}/api/node/enroll`, { deviceCode: activation.deviceCode, publicKey: identity.publicKey });
    if (!enrolled.nodeToken || enrolled.site?.status !== 'active' || !enrolled.tunnel) throw new Error('Cloud 设备接入未激活');
    pending = { schemaVersion: 1, baseUrl, email: normalizedEmail, slug: selectedSlug, activationSite: activation.site, enrolled, createdAt: new Date().toISOString() };
    writeJsonAtomic(pendingPath, pending, 0o600);
  }
  return finalizeEnrollment({ pending, pendingPath, dataRoot: preliminary.dataRoot, wireGuardExecutor, fetchImpl });
}

async function finalizeEnrollment({ pending, pendingPath, dataRoot, wireGuardExecutor, fetchImpl }) {
  const { enrolled, activationSite } = pending;
  const selectedSlug = activationSite.slug;
  const before = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot });
  let config;
  if (fs.existsSync(before.configPath)) {
    writeJsonAtomic(before.configPath, { ...before.site, displayDomain: activationSite.managedHost, asciiDomain: activationSite.managedHost, edgeMode: 'managed', routingMode: 'path', updatedAt: new Date().toISOString() }, 0o600);
    config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: activationSite.managedHost });
  } else {
    config = initializeSite({ domain: activationSite.managedHost, dataRoot, edgeMode: 'managed' }).config;
  }
  const tunnel = installManagedWireGuardTunnel(config, enrolled.tunnel, { ...(wireGuardExecutor ? { executor: wireGuardExecutor } : {}) });
  const localPassword = crypto.randomBytes(18).toString('base64url');
  mergeSecretEnv(config.envPath, { SITE_DOMAIN: activationSite.managedHost, PERSONAL_AGENT_CLOUD_TOKEN: enrolled.nodeToken, PERSONAL_AGENT_AUTH_PASSWORD: localPassword }, ['SITE_DOMAIN', 'PERSONAL_AGENT_CLOUD_TOKEN', 'PERSONAL_AGENT_AUTH_PASSWORD']);
  config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot });
  setProvider(resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot }), { kind: 'tunnel', provider: 'personal-agent-cloud', endpoint: `${pending.baseUrl}/${selectedSlug}`, credentialEnv: 'PERSONAL_AGENT_CLOUD_TOKEN' });
  const heartbeat = await requestJson(fetchImpl, `${pending.baseUrl}/api/node/heartbeat`, undefined, { authorization: `Bearer ${enrolled.nodeToken}` });
  const metadata = { schemaVersion: 1, cloudUrl: pending.baseUrl, slug: selectedSlug, managedHost: activationSite.managedHost, siteId: enrolled.site.id, plan: activationSite.plan || 'free', status: heartbeat.status || enrolled.site.status, tunnel: { address: enrolled.tunnel.address, endpoint: enrolled.tunnel.endpoint, generation: heartbeat.tunnelGeneration || 1 }, enrolledAt: new Date().toISOString() };
  writeJsonAtomic(path.join(config.configDir, 'cloud.json'), metadata, 0o600);
  fs.rmSync(pendingPath, { force: true });
  return { ok: true, site: metadata, tunnel, dataRoot: config.dataRoot, managedUrl: `https://${metadata.managedHost}` };
}

function readDevicePendingEnrollment(pendingPath, baseUrl) {
  if (!fs.existsSync(pendingPath)) return null;
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  if (pending.schemaVersion !== 2 || pending.flow !== 'device-authorization' || pending.baseUrl !== baseUrl) {
    if (pending.schemaVersion === 1) throw new Error('本机存在旧版邀请接入恢复状态，请使用原版设置页完成恢复');
    throw new Error('本机存在另一个未完成的 Cloud 接入，请使用原 Cloud 地址恢复');
  }
  validatePending(pending);
  return pending;
}

function readLegacyPendingEnrollment(pendingPath, expected) {
  if (!fs.existsSync(pendingPath)) return null;
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  if (pending.schemaVersion !== 1 || pending.baseUrl !== expected.baseUrl || pending.email !== expected.normalizedEmail || pending.slug !== expected.selectedSlug) {
    throw new Error('本机存在另一个未完成的 Cloud 接入，请使用原邮箱和专属前缀恢复');
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
}

function publicDeviceAuthorization(value) {
  return { userCode: value.userCode, verificationUrl: value.verificationUrl, verificationUrlComplete: value.verificationUrlComplete || '', expiresIn: value.expiresIn, interval: value.interval };
}

async function requestJson(fetchImpl, url, body, headers = {}) {
  const { response, payload } = await requestJsonResponse(fetchImpl, url, body, headers);
  if (!response.ok) throw new Error(payload.error || payload.message || `Cloud 请求失败 (${response.status})`);
  return payload;
}

async function requestJsonResponse(fetchImpl, url, body, headers = {}) {
  const response = await fetchImpl(url, { method: 'POST', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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
