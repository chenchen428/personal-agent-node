import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initializeSite, mergeSecretEnv, resolveNodeConfig, writeJsonAtomic } from './config.mjs';
import { setProvider } from './providers.mjs';

export async function enrollWithCloud({ email, authorizationCode, slug, cloudUrl = 'https://personal-agent.cn', dataRoot, originUrl = 'http://10.77.0.2:8843', fetchImpl = fetch } = {}) {
  const baseUrl = normalizeCloudUrl(cloudUrl);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const code = String(authorizationCode || '').trim();
  const selectedSlug = String(slug || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('请输入有效邮箱');
  if (code.length < 4 || code.length > 256) throw new Error('授权码格式无效');
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(selectedSlug)) throw new Error('slug 必须为 3-32 位小写字母、数字或连字符');
  const activation = await requestJson(fetchImpl, `${baseUrl}/activate`, { email: normalizedEmail, code, slug: selectedSlug });
  if (!activation.deviceCode || !activation.site?.managedHost) throw new Error('Cloud 未返回设备码或托管域名');
  const initialized = initializeSite({ domain: activation.site.managedHost, dataRoot, edgeMode: 'managed', distributionVersion: '0.1.0-beta.1' });
  const config = initialized.config;
  const publicKey = ensureCloudIdentity(config);
  const enrolled = await requestJson(fetchImpl, `${baseUrl}/api/node/enroll`, { deviceCode: activation.deviceCode, publicKey, originUrl });
  if (!enrolled.nodeToken || enrolled.site?.status !== 'active') throw new Error('Cloud 设备接入未激活');
  const localPassword = crypto.randomBytes(18).toString('base64url');
  mergeSecretEnv(config.envPath, { PERSONAL_AGENT_CLOUD_TOKEN: enrolled.nodeToken, PERSONAL_AGENT_AUTH_PASSWORD: localPassword }, ['PERSONAL_AGENT_CLOUD_TOKEN', 'PERSONAL_AGENT_AUTH_PASSWORD']);
  setProvider(resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot }), { kind: 'tunnel', provider: 'personal-agent-cloud', endpoint: `${baseUrl}/${selectedSlug}`, credentialEnv: 'PERSONAL_AGENT_CLOUD_TOKEN' });
  const heartbeat = await requestJson(fetchImpl, `${baseUrl}/api/node/heartbeat`, undefined, { authorization: `Bearer ${enrolled.nodeToken}` });
  const metadata = { schemaVersion: 1, cloudUrl: baseUrl, email: normalizedEmail, slug: selectedSlug, managedHost: activation.site.managedHost, siteId: enrolled.site.id, plan: activation.site.plan || 'free', status: heartbeat.status || enrolled.site.status, enrolledAt: new Date().toISOString() };
  writeJsonAtomic(path.join(config.configDir, 'cloud.json'), metadata, 0o600);
  return { ok: true, site: metadata, dataRoot: config.dataRoot, localPassword, managedUrl: `https://${metadata.managedHost}` };
}

function ensureCloudIdentity(config) {
  const directory = path.join(config.dataRoot, 'secrets', 'node-identity');
  const privatePath = path.join(directory, 'cloud-x25519-private.pem');
  const publicPath = path.join(directory, 'cloud-x25519-public.txt');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
    const pair = crypto.generateKeyPairSync('x25519');
    const der = pair.publicKey.export({ type: 'spki', format: 'der' });
    fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(publicPath, `${der.subarray(-32).toString('base64')}\n`, { mode: 0o600 });
  }
  return fs.readFileSync(publicPath, 'utf8').trim();
}

async function requestJson(fetchImpl, url, body, headers = {}) {
  const response = await fetchImpl(url, { method: 'POST', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Cloud 请求失败 (${response.status})`);
  return payload;
}

function normalizeCloudUrl(value) {
  const url = new URL(String(value || '').trim());
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('Cloud 地址必须使用 HTTPS');
  if (url.username || url.password || url.hash || url.search) throw new Error('Cloud 地址不能包含凭据、查询或片段');
  return url.toString().replace(/\/$/, '');
}
