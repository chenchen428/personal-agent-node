import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { resolveNodeConfig, writeJsonAtomic } from './config.ts';
import { DEFAULT_CLOUD_URL, openExternalUrl } from './cloud-enrollment.ts';
import { initializeInstallation } from './space-registry.ts';

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 30;

export async function authorizeCloudResources({
  cloudUrl,
  dataRoot,
  fetchImpl = fetch,
  openBrowser = openExternalUrl,
  onAuthorization = () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  clientName = 'personal-agent-cli',
  clientVersion = 'unknown',
} = {}) {
  const config = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot || process.env.PRIVATE_SITE_DATA_ROOT });
  if (!config.space?.id) throw new Error('Cloud resource authorization requires an isolated Space');
  const installationId = initializeInstallation({ dataRoot: config.installationDataRoot }).installation.installationId;
  const pending = await startCloudResourceAuthorization({
    cloudUrl,
    fetchImpl,
    clientName,
    clientVersion,
    installationId,
    spaceId: config.space.id,
    spaceKind: config.space.kind === 'personal' ? 'personal' : 'custom',
    spaceSlug: config.space.slug,
  });
  await onAuthorization(publicBrowserAuthorization(pending.authorization));
  let browserOpened = false;
  try { browserOpened = await openBrowser(pending.authorization.verificationUrlComplete || pending.authorization.verificationUrl); } catch {}
  const result = await completeCloudResourceAuthorization({ ...pending, dataRoot, fetchImpl, sleep, now });
  return { ...result, authorization: { ...publicBrowserAuthorization(pending.authorization), browserOpened } };
}

export async function startCloudResourceAuthorization({ cloudUrl, fetchImpl = fetch, clientName = 'personal-agent-cli', clientVersion = 'unknown', installationId, spaceId, spaceKind = 'personal', spaceSlug = 'personal' } = {}) {
  const baseUrl = normalizeCloudUrl(cloudUrl || process.env.PERSONAL_AGENT_CLOUD_URL || DEFAULT_CLOUD_URL);
  const response = await requestJson(fetchImpl, `${baseUrl}/api/cli/auth/start`, {
    method: 'POST',
    body: { clientName: String(clientName).slice(0, 80), clientVersion: String(clientVersion).slice(0, 40), installationId, spaceId, spaceKind, spaceSlug },
  });
  return {
    baseUrl,
    authorization: {
      deviceCode: boundedString(response.deviceCode, 16, 512, 'Cloud did not return a valid device code'),
      userCode: boundedString(response.userCode, 4, 32, 'Cloud did not return a valid user code'),
      verificationUrl: validateVerificationUrl(response.verificationUrl, baseUrl),
      verificationUrlComplete: response.verificationUrlComplete ? validateVerificationUrl(response.verificationUrlComplete, baseUrl) : '',
      expiresIn: boundedInteger(response.expiresIn, 60, 1800, 'Cloud returned an invalid authorization lifetime'),
      interval: boundedInteger(response.interval ?? DEFAULT_POLL_INTERVAL_SECONDS, 1, MAX_POLL_INTERVAL_SECONDS, 'Cloud returned an invalid polling interval'),
    },
  };
}

export async function completeCloudResourceAuthorization({ baseUrl, authorization, dataRoot, fetchImpl = fetch, sleep, now = () => new Date() } = {}) {
  const resolvedDataRoot = resolveDataRoot({ dataRoot });
  const normalizedBaseUrl = normalizeCloudUrl(baseUrl);
  if (!authorization?.deviceCode || !authorization?.expiresIn) throw cloudResourceError('CLOUD_AUTH_INVALID', 'Cloud browser authorization state is invalid');
  const session = await pollCloudResourceAuthorization({ baseUrl: normalizedBaseUrl, authorization, fetchImpl, sleep, now });
  const token = boundedString(session.token, 24, 1024, 'Cloud did not return a valid CLI session');
  const current = currentDate(now);
  const expiresAt = validFutureTimestamp(session.expiresAt, current, 'Cloud returned an invalid CLI session expiry');
  const resources = normalizeResources(session.resources);
  const paths = resourcePaths(resolvedDataRoot);
  writeJsonAtomic(paths.session, { schemaVersion: 2, authorization: 'browser', cloudUrl: normalizedBaseUrl, token, expiresAt }, 0o600);
  writeJsonAtomic(paths.resources, { schemaVersion: 1, cloudUrl: normalizedBaseUrl, resources, syncedAt: current.toISOString() }, 0o600);
  return { resources, serviceReadiness: managedServiceReadiness({ dataRoot: resolvedDataRoot }), expiresAt };
}

async function pollCloudResourceAuthorization({ baseUrl, authorization, fetchImpl, sleep, now }) {
  const wait = sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = currentDate(now).getTime();
  const expiresAt = startedAt + authorization.expiresIn * 1000;
  let interval = authorization.interval || DEFAULT_POLL_INTERVAL_SECONDS;
  while (currentDate(now).getTime() < expiresAt) {
    await wait(interval * 1000);
    const { response, payload } = await requestJsonResponse(fetchImpl, `${baseUrl}/api/cli/auth/poll`, {
      method: 'POST', body: { deviceCode: authorization.deviceCode },
    });
    const errorCode = payload.code || payload.error;
    if (response.ok && payload.status === 'approved') return payload;
    if (response.status === 202 || payload.status === 'authorization_pending' || errorCode === 'authorization_pending') {
      interval = normalizeNextInterval(payload.interval, interval);
      continue;
    }
    if (response.status === 429 || errorCode === 'slow_down') {
      interval = Math.min(MAX_POLL_INTERVAL_SECONDS, Math.max(interval + 5, normalizeNextInterval(response.headers.get('retry-after') || payload.retryAfter || payload.interval, interval)));
      continue;
    }
    if (errorCode === 'expired_token') throw cloudResourceError('CLOUD_AUTH_EXPIRED', 'Browser authorization expired; run cloud login again');
    if (errorCode === 'access_denied') throw cloudResourceError('CLOUD_AUTH_DENIED', 'Browser authorization was denied');
    throw cloudResourceError('CLOUD_AUTH_FAILED', payload.message || payload.error || errorCode || `Cloud authorization failed (${response.status})`);
  }
  throw cloudResourceError('CLOUD_AUTH_EXPIRED', 'Browser authorization expired; run cloud login again');
}

export async function refreshCloudResources({ dataRoot, fetchImpl = fetch, now = () => new Date() } = {}) {
  const resolvedDataRoot = resolveDataRoot({ dataRoot });
  const paths = resourcePaths(resolvedDataRoot);
  const session = readJson(paths.session);
  if (!session?.token || !session?.cloudUrl || !session?.expiresAt) return { refreshed: false, reason: 'cli-session-missing', serviceReadiness: managedServiceReadiness({ dataRoot: resolvedDataRoot }) };
  if (new Date(session.expiresAt).getTime() <= now().getTime()) return { refreshed: false, reason: 'cli-session-expired', serviceReadiness: managedServiceReadiness({ dataRoot: resolvedDataRoot }) };
  const payload = await requestJson(fetchImpl, `${normalizeCloudUrl(session.cloudUrl)}/api/cli/resources`, {
    method: 'GET',
    token: boundedString(session.token, 24, 1024, 'Stored Cloud CLI session is invalid'),
  });
  const resources = normalizeResources(payload.resources);
  writeJsonAtomic(paths.resources, { schemaVersion: 1, cloudUrl: session.cloudUrl, resources, syncedAt: now().toISOString() }, 0o600);
  return { refreshed: true, resources, serviceReadiness: managedServiceReadiness({ dataRoot: resolvedDataRoot }) };
}

export function managedServiceReadiness({ dataRoot, env = process.env } = {}) {
  const resolvedDataRoot = resolveDataRoot({ dataRoot, env });
  const document = readJson(resourcePaths(resolvedDataRoot).resources);
  const resources = document?.schemaVersion === 1 ? document.resources : null;
  const publicDomain = normalizePublicDomain(resources?.site?.publicDomain || resources?.site?.customDomain || resources?.site?.managedHost || '');
  const agentMailAddress = normalizeBoundMail(resources?.agentMailAddress, publicDomain);
  const publicDomainReady = Boolean(publicDomain);
  const agentMailReady = Boolean(agentMailAddress);
  const eligible = resources?.eligibility || {};
  const prerequisitesReady = publicDomainReady && agentMailReady;
  const reason = !resources ? 'cloud-binding-required' : !publicDomainReady ? 'public-domain-required' : !agentMailReady ? 'agent-mail-required' : 'ready';
  return {
    state: prerequisitesReady ? 'enabled' : 'disabled',
    reason,
    publicDomain: { ready: publicDomainReady, value: publicDomain || '' },
    agentMail: { ready: agentMailReady, value: agentMailAddress || '' },
    managedMail: { enabled: prerequisitesReady && eligible.managedMail !== false },
    managedConfiguration: { enabled: prerequisitesReady && eligible.managedConfiguration !== false },
    cloudBinding: { configured: Boolean(resources), syncedAt: document?.syncedAt || null },
  };
}

export function onboardingStatus({ dataRoot, env = process.env } = {}) {
  const resolvedDataRoot = resolveDataRoot({ dataRoot, env });
  const account = readJson(path.join(resolvedDataRoot, 'channels', 'wechat', 'account.json'));
  const wechat = { bound: Boolean(account?.accountId && account?.userId), savedAt: account?.savedAt || null };
  const services = managedServiceReadiness({ dataRoot: resolvedDataRoot, env });
  const nextActions = [];
  if (!wechat.bound) nextActions.push('Open the local console and complete WeChat QR binding');
  if (!services.cloudBinding.configured) nextActions.push('Run personal-agent cloud login and approve Cloud resource access in the browser');
  else if (services.state !== 'enabled') nextActions.push('Finish the public domain and Agent mail binding shown in Cloud');
  return { complete: wechat.bound && services.state === 'enabled', wechat, services, nextActions };
}

function resolveDataRoot({ dataRoot, env = process.env } = {}) {
  const homeRoot = path.resolve(env.PERSONAL_AGENT_HOME || path.join(os.homedir(), '.personal-agent'));
  const requested = path.resolve(dataRoot || env.PRIVATE_SITE_DATA_ROOT || path.join(homeRoot, 'workspace'));
  try {
    const config = resolveNodeConfig({ ...env, PERSONAL_AGENT_DATA_ROOT: requested, PRIVATE_SITE_DATA_ROOT: requested });
    if (config.space?.id) return config.dataRoot;
  } catch {}
  return requested;
}

function resourcePaths(dataRoot) {
  return {
    session: path.join(dataRoot, 'secrets', 'applications', 'cloud-cli-session.json'),
    resources: path.join(dataRoot, 'config', 'cloud-resources.json'),
  };
}

async function requestJson(fetchImpl, url, { method, body, token } = {}) {
  const { response, payload } = await requestJsonResponse(fetchImpl, url, { method, body, token });
  if (!response.ok) throw cloudResourceError(response.status === 401 ? 'CLOUD_AUTH_FAILED' : 'CLOUD_REQUEST_FAILED', payload.error || payload.message || `Cloud request failed (${response.status})`);
  return payload;
}

async function requestJsonResponse(fetchImpl, url, { method, body, token } = {}) {
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch {
    throw cloudResourceError('CLOUD_NETWORK_UNREACHABLE', 'Unable to reach Personal Agent Cloud; check DNS and network connectivity');
  }
}

function normalizeResources(value) {
  if (!value || typeof value !== 'object') throw cloudResourceError('CLOUD_RESPONSE_INVALID', 'Cloud resources are missing');
  const githubUserId = normalizeGitHubUserId(value.account?.githubUserId);
  const publicDomain = normalizePublicDomain(value.site?.publicDomain || value.site?.managedHost || '');
  if (!publicDomain) throw cloudResourceError('CLOUD_RESPONSE_INVALID', 'Cloud resources do not contain a public domain');
  const agentMailAddress = normalizeBoundMail(value.agentMailAddress, publicDomain);
  if (!agentMailAddress) throw cloudResourceError('CLOUD_RESPONSE_INVALID', 'Cloud resources do not contain a matching Agent mail address');
  return {
    account: { githubUserId, githubLogin: String(value.account?.githubLogin || '').slice(0, 39) },
    site: {
      id: String(value.site?.id || '').slice(0, 128),
      status: String(value.site?.status || '').slice(0, 32),
      managedHost: normalizePublicDomain(value.site?.managedHost || ''),
      customDomain: normalizePublicDomain(value.site?.customDomain || ''),
      customDomainStatus: String(value.site?.customDomainStatus || '').slice(0, 32),
      publicDomain,
    },
    agentMailAddress,
    mailOperational: value.mailOperational === true,
    eligibility: {
      publicDomain: true,
      agentMail: true,
      managedMail: value.eligibility?.managedMail === true,
      managedConfiguration: value.eligibility?.managedConfiguration === true,
    },
    generatedAt: validTimestamp(value.generatedAt, 'Cloud resources have an invalid timestamp'),
  };
}

function normalizeCloudUrl(value) {
  const url = new URL(String(value || '').trim());
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw cloudResourceError('INVALID_CLOUD_URL', 'Cloud URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw cloudResourceError('INVALID_CLOUD_URL', 'Cloud URL cannot contain credentials, query, or fragment');
  return url.toString().replace(/\/$/, '');
}

function validateVerificationUrl(value, baseUrl) {
  const url = new URL(String(value || ''));
  const trusted = new URL(baseUrl);
  if (url.origin !== trusted.origin || url.protocol !== trusted.protocol || url.username || url.password || url.hash) throw cloudResourceError('CLOUD_RESPONSE_INVALID', 'Cloud returned an untrusted verification URL');
  return url.toString();
}

function normalizeGitHubUserId(value) {
  const id = String(value || '').trim();
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw cloudResourceError('INVALID_GITHUB_USER_ID', 'GitHub user ID must be numeric');
  return id;
}

function normalizePublicDomain(value) {
  const input = String(value || '').trim().replace(/\.$/, '');
  if (!input || net.isIP(input)) return '';
  const domain = domainToASCII(input).toLowerCase();
  if (!domain || !domain.includes('.') || domain.endsWith('.local') || domain === 'localhost' || domain.length > 253) return '';
  if (domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
  return domain;
}

function normalizeBoundMail(value, publicDomain) {
  const email = String(value || '').trim().toLowerCase();
  if (!publicDomain || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email)) return '';
  return email.endsWith(`@${publicDomain}`) ? email : '';
}

function validTimestamp(value, message) {
  const timestamp = new Date(String(value || ''));
  if (!Number.isFinite(timestamp.getTime())) throw cloudResourceError('CLOUD_RESPONSE_INVALID', message);
  return timestamp.toISOString();
}

function validFutureTimestamp(value, now, message) {
  const timestamp = validTimestamp(value, message);
  if (new Date(timestamp).getTime() <= now.getTime()) throw cloudResourceError('CLOUD_RESPONSE_INVALID', message);
  return timestamp;
}

function boundedString(value, minimum, maximum, message) {
  const string = String(value || '').trim();
  if (string.length < minimum || string.length > maximum) throw cloudResourceError('CLOUD_RESPONSE_INVALID', message);
  return string;
}

function boundedInteger(value, minimum, maximum, message) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw cloudResourceError('CLOUD_RESPONSE_INVALID', message);
  return number;
}

function normalizeNextInterval(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, MAX_POLL_INTERVAL_SECONDS) : fallback;
}

function currentDate(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw cloudResourceError('CLOUD_RESPONSE_INVALID', 'Local clock is invalid');
  return date;
}

function publicBrowserAuthorization(value) {
  return { userCode: value.userCode, verificationUrl: value.verificationUrl, verificationUrlComplete: value.verificationUrlComplete || '', expiresIn: value.expiresIn, interval: value.interval };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function cloudResourceError(code, message) {
  return Object.assign(new Error(message), { code });
}
