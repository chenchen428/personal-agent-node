import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initializeSite, mergeSecretEnv, resolveNodeConfig, writeJsonAtomic } from './config.mjs';
import { installManagedWireGuardTunnel, prepareManagedWireGuardIdentity } from './identity.mjs';
import { setProvider } from './providers.mjs';

export async function enrollWithCloud({ email, authorizationCode, slug, cloudUrl = 'https://personal-agent.cn', dataRoot, fetchImpl = fetch, wireGuardExecutor } = {}) {
  const baseUrl = normalizeCloudUrl(cloudUrl);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const code = String(authorizationCode || '').trim();
  const selectedSlug = String(slug || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('请输入有效邮箱');
  if (code.length < 4 || code.length > 256) throw new Error('授权码格式无效');
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(selectedSlug)) throw new Error('slug 必须为 3-32 位小写字母、数字或连字符');
  const preliminary = resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: dataRoot || process.env.PRIVATE_SITE_DATA_ROOT });
  const pendingPath = path.join(preliminary.dataRoot, 'secrets', 'applications', 'cloud-enrollment-pending.json');
  let pending = readPendingEnrollment(pendingPath, { baseUrl, normalizedEmail, selectedSlug });
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
  const { enrolled, activationSite } = pending;
  const config = initializeSite({ domain: activationSite.managedHost, dataRoot, edgeMode: 'managed' }).config;
  const tunnel = installManagedWireGuardTunnel(config, enrolled.tunnel, { ...(wireGuardExecutor ? { executor: wireGuardExecutor } : {}) });
  const localPassword = crypto.randomBytes(18).toString('base64url');
  mergeSecretEnv(config.envPath, { PERSONAL_AGENT_CLOUD_TOKEN: enrolled.nodeToken, PERSONAL_AGENT_AUTH_PASSWORD: localPassword }, ['PERSONAL_AGENT_CLOUD_TOKEN', 'PERSONAL_AGENT_AUTH_PASSWORD']);
  setProvider(resolveNodeConfig({ ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot }), { kind: 'tunnel', provider: 'personal-agent-cloud', endpoint: `${baseUrl}/${selectedSlug}`, credentialEnv: 'PERSONAL_AGENT_CLOUD_TOKEN' });
  const heartbeat = await requestJson(fetchImpl, `${baseUrl}/api/node/heartbeat`, undefined, { authorization: `Bearer ${enrolled.nodeToken}` });
  const metadata = { schemaVersion: 1, cloudUrl: baseUrl, email: normalizedEmail, slug: selectedSlug, managedHost: activationSite.managedHost, siteId: enrolled.site.id, plan: activationSite.plan || 'free', status: heartbeat.status || enrolled.site.status, tunnel: { address: enrolled.tunnel.address, endpoint: enrolled.tunnel.endpoint, generation: heartbeat.tunnelGeneration || 1 }, enrolledAt: new Date().toISOString() };
  writeJsonAtomic(path.join(config.configDir, 'cloud.json'), metadata, 0o600);
  fs.rmSync(pendingPath, { force: true });
  return { ok: true, site: metadata, tunnel, dataRoot: config.dataRoot, localPassword, managedUrl: `https://${metadata.managedHost}` };
}

function readPendingEnrollment(pendingPath, expected) {
  if (!fs.existsSync(pendingPath)) return null;
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  if (pending.schemaVersion !== 1 || pending.baseUrl !== expected.baseUrl || pending.email !== expected.normalizedEmail || pending.slug !== expected.selectedSlug) {
    throw new Error('本机存在另一个未完成的 Cloud 接入，请使用原邮箱和专属前缀恢复');
  }
  if (!pending.enrolled?.nodeToken || !pending.enrolled?.tunnel || !pending.activationSite?.managedHost) throw new Error('本机 Cloud 接入恢复状态无效');
  return pending;
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
