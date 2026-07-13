import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const USER_AGENT = 'personal-agent-node-installer/0.1';
const DEFAULT_FETCH_TIMEOUT_MILLISECONDS = 10_000;

export async function downloadReleaseAsset(url, {
  fetchImpl = fetch,
  platform = process.platform,
  spawnImpl = spawnSync,
  temporaryRoot = os.tmpdir(),
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MILLISECONDS,
  createTimeoutSignal = (milliseconds) => AbortSignal.timeout(milliseconds),
} = {}) {
  const targetUrl = validateReleaseUrl(url);
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs < 1 || fetchTimeoutMs > 60_000) throw new Error('Release fetch timeout must be between 1 and 60000 milliseconds');
  const signal = createTimeoutSignal(fetchTimeoutMs);
  if (!signal) throw new Error('Release fetch timeout signal is unavailable');
  try {
    const response = await fetchImpl(targetUrl, { redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (fetchError) {
    return downloadWithPlatformClient(targetUrl, { platform, spawnImpl, temporaryRoot, fetchError });
  }
}

export function validateReleaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.hash) {
    throw new Error('Release download URL must be an HTTPS github.com URL without credentials or fragments');
  }
  return url.toString();
}

function downloadWithPlatformClient(url, { platform, spawnImpl, temporaryRoot, fetchError }) {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'personal-agent-download-'));
  const target = path.join(directory, 'asset');
  try {
    const invocation = platform === 'win32' ? powershellInvocation(url, target) : curlInvocation(url, target);
    const result = spawnImpl(invocation.command, invocation.args, {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    if (!result.error && result.status === 0 && fs.existsSync(target)) return fs.readFileSync(target);

    const fallbackDetail = String(result.error?.message || result.stderr || `exit ${result.status}`).trim().slice(0, 300);
    if (platform !== 'win32') {
      try {
        downloadThroughGitHubApi(url, target, directory, spawnImpl);
        return fs.readFileSync(target);
      } catch (apiError) {
        const fetchDetail = fetchError instanceof Error ? fetchError.message : 'unknown fetch failure';
        const apiDetail = apiError instanceof Error ? apiError.message : String(apiError);
        throw new Error(`Release download failed with fetch (${fetchDetail}), ${invocation.label} (${fallbackDetail}), and GitHub API fallback (${apiDetail.slice(0, 300)})`);
      }
    }

    const fetchDetail = fetchError instanceof Error ? fetchError.message : 'unknown fetch failure';
    throw new Error(`Release download failed with fetch (${fetchDetail}) and ${invocation.label} (${fallbackDetail})`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function downloadThroughGitHubApi(url, target, directory, spawnImpl) {
  const coordinates = releaseAssetCoordinates(url);
  const metadataPath = path.join(directory, 'release.json');
  const metadataUrl = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/releases/tags/${encodeURIComponent(coordinates.tag)}`;
  runCurl(spawnImpl, curlInvocation(metadataUrl, metadataPath, {
    headers: ['Accept: application/vnd.github+json', `User-Agent: ${USER_AGENT}`],
  }), 'GitHub release metadata');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const asset = Array.isArray(metadata.assets) ? metadata.assets.find((entry) => entry?.name === coordinates.assetName) : null;
  if (!asset?.url) throw new Error(`GitHub release metadata does not contain ${coordinates.assetName}`);
  const assetUrl = new URL(asset.url);
  const expectedPrefix = `/repos/${coordinates.owner}/${coordinates.repository}/releases/assets/`;
  if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'api.github.com' || !assetUrl.pathname.startsWith(expectedPrefix) || !/^\d+$/.test(assetUrl.pathname.slice(expectedPrefix.length))) {
    throw new Error('GitHub release metadata returned an unsafe asset URL');
  }
  runCurl(spawnImpl, curlInvocation(assetUrl.toString(), target, {
    headers: ['Accept: application/octet-stream', `User-Agent: ${USER_AGENT}`],
  }), 'GitHub release asset');
}

function releaseAssetCoordinates(value) {
  const url = new URL(validateReleaseUrl(value));
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new Error('Release URL does not match the GitHub asset layout');
  const [, owner, repository, encodedTag, encodedAssetName] = match;
  const tag = decodeURIComponent(encodedTag);
  const assetName = decodeURIComponent(encodedAssetName);
  if (![owner, repository, tag, assetName].every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) throw new Error('Release URL contains unsupported path characters');
  return { owner, repository, tag, assetName };
}

function runCurl(spawnImpl, invocation, label) {
  const result = spawnImpl(invocation.command, invocation.args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.error?.message || result.stderr || `exit ${result.status}`).trim().slice(0, 300);
    throw new Error(`${label} failed: ${detail}`);
  }
}

function curlInvocation(url, target, { headers = [] } = {}) {
  return {
    command: 'curl',
    label: 'curl',
    args: [
      '--fail', '--silent', '--show-error', '--location',
      '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2',
      '--ipv4', '--http1.1', '--connect-timeout', '10', '--max-time', '90',
      ...headers.flatMap((header) => ['--header', header]),
      '--output', target, '--', url,
    ],
  };
}

function powershellInvocation(url, target) {
  const scriptPath = path.join(path.dirname(target), 'download.ps1');
  fs.writeFileSync(scriptPath, "param([Parameter(Mandatory=$true)][string]$Uri,[Parameter(Mandatory=$true)][string]$OutFile)\n$ErrorActionPreference='Stop'\n[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12\nInvoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile\n", { mode: 0o600 });
  return {
    command: 'powershell.exe',
    label: 'PowerShell Invoke-WebRequest',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Uri', url, '-OutFile', target],
  };
}
