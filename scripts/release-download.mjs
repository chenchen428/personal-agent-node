import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const USER_AGENT = 'personal-agent-node-installer/0.1';

export async function downloadReleaseAsset(url, {
  fetchImpl = fetch,
  platform = process.platform,
  spawnImpl = spawnSync,
  temporaryRoot = os.tmpdir(),
} = {}) {
  const targetUrl = validateReleaseUrl(url);
  try {
    const response = await fetchImpl(targetUrl, { redirect: 'follow', headers: { 'user-agent': USER_AGENT } });
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
    if (result.error || result.status !== 0 || !fs.existsSync(target)) {
      const fetchDetail = fetchError instanceof Error ? fetchError.message : 'unknown fetch failure';
      const fallbackDetail = String(result.error?.message || result.stderr || `exit ${result.status}`).trim().slice(0, 300);
      throw new Error(`Release download failed with fetch (${fetchDetail}) and ${invocation.label} (${fallbackDetail})`);
    }
    return fs.readFileSync(target);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function curlInvocation(url, target) {
  return {
    command: 'curl',
    label: 'curl',
    args: ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--output', target, '--', url],
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
