import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { writeJsonAtomic } from './config.mjs';

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export async function loginCloudResources({ githubUserId, password, cloudUrl, dataRoot, fetchImpl = fetch, now = () => new Date() } = {}) {
  const resolvedDataRoot = resolveDataRoot({ dataRoot });
  const baseUrl = normalizeCloudUrl(cloudUrl || process.env.PERSONAL_AGENT_CLOUD_URL || 'https://chenjianhui.site');
  const userId = normalizeGitHubUserId(githubUserId);
  const secret = String(password || '');
  if (!secret) throw cloudResourceError('PASSWORD_REQUIRED', 'Cloud password is required');
  const session = await requestJson(fetchImpl, `${baseUrl}/api/cli/session`, {
    method: 'POST',
    body: { githubUserId: userId, password: secret },
  });
  const token = boundedString(session.token, 24, 1024, 'Cloud did not return a valid CLI session');
  const expiresAt = validFutureTimestamp(session.expiresAt, now(), 'Cloud returned an invalid CLI session expiry');
  const resources = normalizeResources(session.resources);
  const paths = resourcePaths(resolvedDataRoot);
  writeJsonAtomic(paths.session, { schemaVersion: 1, cloudUrl: baseUrl, token, expiresAt, githubUserId: userId }, 0o600);
  writeJsonAtomic(paths.resources, { schemaVersion: 1, cloudUrl: baseUrl, resources, syncedAt: now().toISOString() }, 0o600);
  return { resources, serviceReadiness: managedServiceReadiness({ dataRoot: resolvedDataRoot }), expiresAt };
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
  if (!services.cloudBinding.configured) nextActions.push('Complete GitHub sign-in, set the Cloud password, then bind Cloud resources');
  else if (services.state !== 'enabled') nextActions.push('Finish the public domain and Agent mail binding shown in Cloud');
  return { complete: wechat.bound && services.state === 'enabled', wechat, services, nextActions };
}

function resolveDataRoot({ dataRoot, env = process.env } = {}) {
  return path.resolve(dataRoot || env.PRIVATE_SITE_DATA_ROOT || path.join(os.homedir(), '.personal-agent'));
}

function resourcePaths(dataRoot) {
  return {
    session: path.join(dataRoot, 'secrets', 'applications', 'cloud-cli-session.json'),
    resources: path.join(dataRoot, 'config', 'cloud-resources.json'),
  };
}

async function requestJson(fetchImpl, url, { method, body, token } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw cloudResourceError(response.status === 401 ? 'CLOUD_AUTH_FAILED' : 'CLOUD_REQUEST_FAILED', payload.error || payload.message || `Cloud request failed (${response.status})`);
  return payload;
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

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function cloudResourceError(code, message) {
  return Object.assign(new Error(message), { code });
}
