#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { deriveProjectStatus } from './status-logic.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const registry = readJson(path.join(root, 'registry', 'projects.json'));
const panelConfig = readJson(path.join(root, 'registry', 'admin-panel.json'));

const args = parseArgs(process.argv.slice(2));
const format = args.format || args._[0] || 'html';
const requestHostHeader = String(args.host || process.env.HTTP_HOST || '');
const { hostname: requestHost, port: requestPort } = parseHostHeader(requestHostHeader);
const localMode = args.local || requestHost.endsWith(`.${panelConfig.localBaseDomain}`) || requestHost === panelConfig.localBaseDomain;
const adminPanelPort = Number(process.env.ADMIN_PANEL_PORT || registry.workspace?.adminPanel?.port || 8791);
const localHttpPort = Number(
  process.env.LOCAL_NGINX_HTTP_PORT
  || (localMode && Number(requestPort) && Number(requestPort) !== adminPanelPort ? requestPort : 80),
);
const checkEntryRoutes = localMode || os.platform() === 'linux' || args.checkEntries;
const now = new Date();

const projects = await collectProjectStatuses();

if (format === 'json') {
  process.stdout.write(`${JSON.stringify({ generatedAt: now.toISOString(), localMode, localHttpPort: localMode ? localHttpPort : undefined, projects }, null, 2)}\n`);
} else if (format === 'html') {
  process.stdout.write(renderHtml(projects));
} else {
  console.error('Usage: project-status.mjs [html|json] [--host <host>] [--local]');
  process.exit(2);
}

async function collectProjectStatuses() {
  const configByName = new Map((panelConfig.projects || []).map((item) => [item.name, item]));
  const registryByName = new Map(registry.projects.map((item) => [item.name, item]));
  const orderedNames = [
    ...(panelConfig.projects || []).map((item) => item.name),
    ...registry.projects.map((item) => item.name),
  ];
  const uniqueNames = [...new Set(orderedNames)].filter((name) => registryByName.has(name));

  const projectChecks = uniqueNames.map(async (name) => {
    const project = registryByName.get(name);
    const config = configByName.get(name) || {};
    const runtime = applyRuntimeOverrides(project.name, project.runtime || {});
    const pathStatus = checkPath(project.path);
    const domains = project.domains || [];
    const entries = domains.map((domain) => ({
      domain,
      localDomain: toLocalDomain(domain),
      url: toEntryUrl(domain),
    }));
    if (project.status === 'retired') {
      return {
        name: project.name,
        label: config.label || project.name,
        group: config.group || project.kind,
        kind: project.kind,
        description: project.description,
        path: project.path,
        domains,
        entries,
        commands: project.commands || {},
        runtime,
        statusHint: config.statusHint || '',
        status: { state: 'retired', tone: 'muted', label: 'Retired' },
        checks: {
          path: pathStatus,
          systemd: { state: 'not-checked', detail: 'retired project' },
          port: { state: 'not-checked', detail: 'retired project' },
          entry: { state: 'not-configured', detail: '', results: [] },
        },
      };
    }
    const [systemdStatus, portStatus, entryStatus] = await Promise.all([
      checkSystemd(runtime.systemd, panelConfig.statusTimeoutMs),
      checkPort(runtime.host, runtime.port, panelConfig.statusTimeoutMs),
      checkEntries(entries, panelConfig.statusTimeoutMs, project.name === 'workspace-admin-panel' ? '/healthz' : '/'),
    ]);
    const status = deriveProjectStatus({ project, pathStatus, systemdStatus, portStatus, entryStatus });

    return {
      name: project.name,
      label: config.label || project.name,
      group: config.group || project.kind,
      kind: project.kind,
      description: project.description,
      path: project.path,
      domains,
      entries,
      commands: project.commands || {},
      runtime,
      statusHint: config.statusHint || '',
      status,
      checks: {
        path: pathStatus,
        systemd: systemdStatus,
        port: portStatus,
        entry: entryStatus,
      },
    };
  });

  return Promise.all(projectChecks);
}

function applyRuntimeOverrides(name, runtime) {
  const effective = { ...runtime };
  if (name === 'private-site-node') {
    if (process.env.PRIVATE_SITE_GATEWAY_HOST) effective.host = process.env.PRIVATE_SITE_GATEWAY_HOST;
    if (process.env.PRIVATE_SITE_GATEWAY_PORT) effective.port = Number(process.env.PRIVATE_SITE_GATEWAY_PORT);
  }
  if (name === 'workspace-admin-panel') {
    if (process.env.ADMIN_PANEL_HOST) effective.host = process.env.ADMIN_PANEL_HOST;
    if (process.env.ADMIN_PANEL_PORT) effective.port = Number(process.env.ADMIN_PANEL_PORT);
  }
  if (name === 'open-agent-bridge') {
    if (process.env.OPEN_AGENT_BRIDGE_HOST) effective.host = process.env.OPEN_AGENT_BRIDGE_HOST;
    if (process.env.OPEN_AGENT_BRIDGE_PORT) effective.port = Number(process.env.OPEN_AGENT_BRIDGE_PORT);
  }
  if (name === 'lmt_tools') {
    if (process.env.LMT_TOOLS_HOST) effective.host = process.env.LMT_TOOLS_HOST;
    if (process.env.LMT_TOOLS_PORT || process.env.PORT) {
      effective.port = Number(process.env.LMT_TOOLS_PORT || process.env.PORT);
    }
  }
  return effective;
}

function checkPath(relPath) {
  if (!relPath) return { ok: false, state: 'missing', detail: 'missing path' };
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) return { ok: false, state: 'missing', detail: relPath };
  return { ok: true, state: 'present', detail: relPath };
}

async function checkSystemd(systemdPath, timeoutMs = 1200) {
  if (!systemdPath) return { state: 'not-configured', detail: '' };
  const unit = path.basename(systemdPath);
  if (os.platform() !== 'linux') {
    return { state: 'unavailable', detail: `${unit}; systemctl not available on ${os.platform()}` };
  }
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', unit], { timeout: timeoutMs });
    const state = stdout.trim() || 'unknown';
    return { state, detail: unit };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'unavailable', detail: 'systemctl not found' };
    const state = String(error.stdout || '').trim() || 'inactive';
    return { state, detail: unit };
  }
}

async function checkPort(host, port, timeoutMs = 1200) {
  if (!host || !port) return { state: 'not-configured', detail: '' };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (state, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ state, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish('open', `${host}:${port}`));
    socket.on('timeout', () => finish('timeout', `${host}:${port}`));
    socket.on('error', () => finish('closed', `${host}:${port}`));
  });
}

async function checkEntries(entries, timeoutMs = 1200, requestPath = '/') {
  if (!entries.length) return { state: 'not-configured', detail: '', results: [] };
  if (!checkEntryRoutes) {
    return { state: 'not-checked', detail: 'entry checks require a local profile or Linux reverse proxy', results: [] };
  }

  const results = await Promise.all(
    entries.map(async (entry) => ({
      ...await checkLocalHttpEntry(entry.localDomain, localHttpPort, timeoutMs, requestPath),
      domain: entry.domain,
    })),
  );
  const reachable = results.filter((result) => result.ok);
  if (reachable.length === results.length) {
    return { state: 'open', detail: `${reachable.length}/${results.length} entries reachable`, results };
  }
  if (reachable.length > 0) {
    return { state: 'partial', detail: `${reachable.length}/${results.length} entries reachable`, results };
  }
  return { state: 'closed', detail: `0/${results.length} entries reachable`, results };
}

function checkLocalHttpEntry(hostname, port, timeoutMs = 1200, requestPath = '/') {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'HEAD',
      path: requestPath,
      headers: { Host: hostname },
      timeout: timeoutMs,
    }, (response) => {
      response.resume();
      const statusCode = response.statusCode || 0;
      const ok = statusCode > 0 && statusCode < 500;
      resolve({
        hostname,
        ok,
        state: ok ? 'open' : `http-${statusCode || 'unknown'}`,
        statusCode,
        detail: `${hostname}${requestPath} -> HTTP ${statusCode || 'unknown'}`,
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolve({
        hostname,
        ok: false,
        state: 'timeout',
        detail: `${hostname}${requestPath} timed out`,
      });
    });
    request.on('error', (error) => {
      resolve({
        hostname,
        ok: false,
        state: 'closed',
        detail: `${hostname}${requestPath} ${error.code || 'connection error'}`,
      });
    });
    request.end();
  });
}

function toLocalDomain(domain) {
  const base = panelConfig.baseDomain;
  const localBase = panelConfig.localBaseDomain;
  if (domain === base) return localBase;
  if (domain.endsWith(`.${base}`)) return `${domain.slice(0, -base.length)}${localBase}`;
  return domain;
}

function formatLocalHost(hostname) {
  return localHttpPort && localHttpPort !== 80 ? `${hostname}:${localHttpPort}` : hostname;
}

function toEntryUrl(domain) {
  if (localMode) return `http://${formatLocalHost(toLocalDomain(domain))}`;
  return `https://${domain}`;
}

function renderHtml(items) {
  const counts = items.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status.state] = (acc[item.status.state] || 0) + 1;
    return acc;
  }, { total: 0 });
  const primaryHost = localMode ? formatLocalHost(panelConfig.localDomain) : panelConfig.primaryDomain;
  const refreshSeconds = Number(panelConfig.refreshSeconds) || 20;
  const availableCount = (counts.running || 0) + (counts.ready || 0);
  const attentionCount = (counts.stopped || 0) + (counts.failed || 0) + (counts.missing || 0) + (counts.unreachable || 0) + (counts.degraded || 0);
  const projectCards = items.map(renderProjectCard).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(panelConfig.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --background: #fafafa;
      --foreground: #09090b;
      --card: #ffffff;
      --card-foreground: #09090b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --border: #e4e4e7;
      --input: #e4e4e7;
      --primary: #18181b;
      --primary-foreground: #fafafa;
      --secondary: #f4f4f5;
      --secondary-foreground: #18181b;
      --accent: #f4f4f5;
      --accent-foreground: #18181b;
      --ring: #a1a1aa;
      --success: #15803d;
      --success-bg: #f0fdf4;
      --success-border: #bbf7d0;
      --warning: #b45309;
      --warning-bg: #fffbeb;
      --warning-border: #fde68a;
      --destructive: #b91c1c;
      --destructive-bg: #fef2f2;
      --destructive-border: #fecaca;
      --info: #1d4ed8;
      --info-bg: #eff6ff;
      --info-border: #bfdbfe;
      --radius: 8px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
      --shadow-md: 0 10px 30px rgba(24, 24, 27, 0.06);
    }
    * {
      box-sizing: border-box;
    }
    html {
      min-height: 100%;
      background: var(--background);
    }
    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(244, 244, 245, 0.65), rgba(250, 250, 250, 0) 320px),
        var(--background);
      color: var(--foreground);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
    }
    a {
      color: inherit;
    }
    code {
      max-width: 100%;
      color: #3f3f46;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .shell {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 28px 20px 44px;
    }
    .page-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
      margin-bottom: 18px;
    }
    .title-stack {
      min-width: 0;
    }
    .profile-row {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .profile-badge,
    .host-pill,
    .refresh-pill {
      display: inline-flex;
      min-height: 26px;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--card);
      padding: 4px 10px;
      color: var(--muted-foreground);
      font-size: 12px;
      font-weight: 600;
      box-shadow: var(--shadow-sm);
      max-width: 100%;
    }
    .profile-badge {
      color: var(--foreground);
    }
    h1 {
      margin: 0;
      color: var(--foreground);
      font-size: clamp(24px, 3vw, 32px);
      font-weight: 700;
      letter-spacing: 0;
      line-height: 1.15;
    }
    .lead {
      max-width: 680px;
      margin: 8px 0 0;
      color: var(--muted-foreground);
      font-size: 14px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .button {
      display: inline-flex;
      min-height: 36px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--input);
      border-radius: var(--radius);
      background: var(--card);
      padding: 8px 12px;
      color: var(--foreground);
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      text-decoration: none;
      box-shadow: var(--shadow-sm);
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      cursor: pointer;
    }
    .button:hover {
      border-color: var(--ring);
      background: var(--accent);
      color: var(--accent-foreground);
    }
    .button[disabled] {
      cursor: progress;
      opacity: 0.65;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0;
    }
    .metric {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      padding: 14px;
      box-shadow: var(--shadow-sm);
    }
    .metric-label {
      color: var(--muted-foreground);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
    }
    .metric-value {
      display: block;
      margin-top: 10px;
      color: var(--foreground);
      font-size: 26px;
      font-weight: 750;
      line-height: 1;
    }
    .metric-note {
      margin-top: 8px;
      color: var(--muted-foreground);
      font-size: 12px;
    }
    .panel {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      box-shadow: var(--shadow-md);
    }
    .wechat-panel {
      margin: 18px 0;
    }
    .wechat-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
      gap: 16px;
      padding: 16px 18px 18px;
    }
    .wechat-status,
    .wechat-qr {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      padding: 14px;
    }
    .wechat-title-row {
      display: flex;
      min-width: 0;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .wechat-title {
      margin: 0;
      color: var(--foreground);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
    }
    .wechat-detail {
      margin: 10px 0 0;
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .wechat-meta {
      display: grid;
      gap: 6px;
      margin-top: 12px;
      color: var(--muted-foreground);
      font-size: 12px;
      line-height: 1.4;
    }
    .service-readiness {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .service-readiness article {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      padding: 14px;
      box-shadow: var(--shadow-sm);
    }
    .service-readiness span,
    .service-readiness small {
      display: block;
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
    .service-readiness strong { display: block; margin: 7px 0 4px; color: var(--foreground); }
    .wechat-qr {
      display: grid;
      gap: 12px;
      justify-items: center;
      text-align: center;
    }
    .wechat-qr[hidden] {
      display: none;
    }
    .qr-box {
      display: grid;
      min-height: 260px;
      width: min(100%, 280px);
      place-items: center;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #fff;
      padding: 10px;
    }
    .qr-box svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 260px;
    }
    .qr-fallback {
      max-width: 100%;
      color: #18181b;
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .wechat-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
    }
    .panel-title {
      margin: 0;
      color: var(--card-foreground);
      font-size: 16px;
      font-weight: 650;
      letter-spacing: 0;
      line-height: 1.2;
    }
    .panel-description {
      margin: 4px 0 0;
      color: var(--muted-foreground);
      font-size: 13px;
    }
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
      gap: 14px;
      padding: 14px;
    }
    .project-card {
      display: flex;
      min-width: 0;
      min-height: 260px;
      flex-direction: column;
      gap: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      padding: 16px;
      box-shadow: var(--shadow-sm);
    }
    .project-card-head,
    .project-title-block {
      min-width: 0;
    }
    .project-title-row {
      display: flex;
      min-width: 0;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .project-description {
      min-height: 40px;
      margin: 0;
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.5;
    }
    .project-card-body {
      display: grid;
      gap: 12px;
    }
    .card-section {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .card-label {
      color: var(--muted-foreground);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
    }
    .project-name {
      color: var(--foreground);
      font-weight: 650;
      line-height: 1.25;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .project-meta,
    .detail {
      margin-top: 4px;
      color: var(--muted-foreground);
      font-size: 12px;
      line-height: 1.45;
    }
    .status-badge {
      display: inline-flex;
      min-height: 24px;
      align-items: center;
      gap: 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 9px;
      background: var(--secondary);
      color: var(--secondary-foreground);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: currentColor;
    }
    .status-badge.tone-good {
      border-color: var(--success-border);
      background: var(--success-bg);
      color: var(--success);
    }
    .status-badge.tone-warn {
      border-color: var(--warning-border);
      background: var(--warning-bg);
      color: var(--warning);
    }
    .status-badge.tone-bad {
      border-color: var(--destructive-border);
      background: var(--destructive-bg);
      color: var(--destructive);
    }
    .status-badge.tone-muted {
      color: var(--muted-foreground);
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .check-pill {
      display: inline-flex;
      min-height: 22px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--background);
      padding: 2px 8px;
      color: var(--muted-foreground);
      font-size: 12px;
      font-weight: 550;
      white-space: nowrap;
    }
    .entries {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .entry {
      display: inline-flex;
      min-width: 0;
      min-height: 34px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid var(--input);
      border-radius: var(--radius);
      background: var(--card);
      padding: 7px 10px;
      color: var(--foreground);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.1;
      text-decoration: none;
      box-shadow: var(--shadow-sm);
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    .entry:hover {
      border-color: var(--ring);
      background: var(--accent);
    }
    .entry-domain {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .no-entry {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      color: var(--muted-foreground);
      font-size: 13px;
    }
    .runtime-list {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      gap: 7px;
    }
    .runtime-pill {
      display: inline-flex;
      min-height: 28px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--secondary);
      padding: 4px 9px;
      color: var(--secondary-foreground);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.1;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --background: #09090b;
        --foreground: #fafafa;
        --card: #111113;
        --card-foreground: #fafafa;
        --muted: #18181b;
        --muted-foreground: #a1a1aa;
        --border: #27272a;
        --input: #3f3f46;
        --primary: #fafafa;
        --primary-foreground: #18181b;
        --secondary: #18181b;
        --secondary-foreground: #fafafa;
        --accent: #27272a;
        --accent-foreground: #fafafa;
        --ring: #71717a;
        --success: #86efac;
        --success-bg: rgba(22, 101, 52, 0.22);
        --success-border: rgba(34, 197, 94, 0.32);
        --warning: #fcd34d;
        --warning-bg: rgba(146, 64, 14, 0.22);
        --warning-border: rgba(245, 158, 11, 0.34);
        --destructive: #fca5a5;
        --destructive-bg: rgba(127, 29, 29, 0.24);
        --destructive-border: rgba(248, 113, 113, 0.34);
        --info: #93c5fd;
        --info-bg: rgba(30, 64, 175, 0.24);
        --info-border: rgba(96, 165, 250, 0.34);
      }
      body {
        background:
          linear-gradient(180deg, rgba(39, 39, 42, 0.55), rgba(9, 9, 11, 0) 320px),
          var(--background);
      }
      code {
        color: #d4d4d8;
      }
    }
    @media (max-width: 860px) {
      .shell {
        padding: 20px 12px 34px;
      }
      .page-header {
        grid-template-columns: 1fr;
      }
      .actions {
        justify-content: flex-start;
      }
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .panel-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .wechat-grid {
        grid-template-columns: 1fr;
      }
      .service-readiness { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .projects-grid {
        grid-template-columns: 1fr;
      }
      .entry {
        max-width: 100%;
      }
      .entry-domain {
        white-space: normal;
        overflow-wrap: anywhere;
      }
    }
    @media (max-width: 520px) {
      .summary-grid {
        grid-template-columns: 1fr;
      }
      .actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(86px, auto);
        width: 100%;
      }
      .button,
      .refresh-pill {
        width: 100%;
      }
      .projects-grid {
        padding: 10px;
        gap: 10px;
      }
      .project-card {
        min-height: auto;
        padding: 14px;
      }
      .project-title-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .entries,
      .entry {
        width: 100%;
      }
      .entry {
        justify-content: space-between;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="page-header">
      <div class="title-stack">
        <div class="profile-row">
          <span class="profile-badge">${localMode ? 'Local profile' : 'Server profile'}</span>
          <code class="host-pill">${escapeHtml(primaryHost)}</code>
        </div>
        <h1>${escapeHtml(panelConfig.title)}</h1>
        <p class="lead">Registered workspace services, public entries, and runtime checks.</p>
      </div>
      <div class="actions">
        <span class="refresh-pill">Generated once</span>
        <a class="button" href="/api/projects">JSON</a>
        <button class="button" type="button" data-refresh>Refresh</button>
      </div>
    </header>
    <section class="summary-grid" aria-label="Project status summary">
      ${renderMetric('Total projects', counts.total, 'Registered in workspace metadata')}
      ${renderMetric('Available', availableCount, 'Running services and ready static entries')}
      ${renderMetric('Needs attention', attentionCount, 'Stopped, failed, or missing checks')}
      ${renderMetric('Unknown', counts.unknown || 0, 'Checks that cannot be resolved here')}
    </section>
    <section class="service-readiness" aria-label="Managed service readiness" data-service-readiness>
      <article><span>Public domain</span><strong data-service-domain>Checking</strong><small data-service-domain-detail>Waiting for local detection.</small></article>
      <article><span>Agent mail</span><strong data-service-mail>Checking</strong><small data-service-mail-detail>Waiting for local detection.</small></article>
      <article><span>Mail service</span><strong data-service-mail-enabled>Checking</strong><small>Disabled until both prerequisites pass.</small></article>
      <article><span>Configuration service</span><strong data-service-config-enabled>Checking</strong><small>Disabled until both prerequisites pass.</small></article>
    </section>
    <section class="panel wechat-panel" aria-labelledby="wechat-status-title">
      <div class="panel-header">
        <div>
          <h2 class="panel-title" id="wechat-status-title">WeChat bridge</h2>
          <p class="panel-description">Login state, daemon state, and QR login for the Codex channel.</p>
        </div>
      </div>
      <div class="wechat-grid">
        <div class="wechat-status">
          <div class="wechat-title-row">
            <h3 class="wechat-title">Connection</h3>
            <div class="status-badge tone-muted" data-wechat-badge><span class="status-dot" aria-hidden="true"></span>Checking</div>
          </div>
          <p class="wechat-detail" data-wechat-detail>Loading WeChat bridge status...</p>
          <div class="wechat-meta" data-wechat-meta></div>
          <div class="wechat-actions">
            <button class="button" type="button" data-wechat-refresh>Refresh status</button>
            <button class="button" type="button" data-wechat-start>New QR</button>
          </div>
        </div>
        <div class="wechat-qr" data-wechat-qr hidden>
          <div class="qr-box" data-qr-box><span class="qr-fallback">QR loading...</span></div>
          <p class="wechat-detail" data-qr-detail>Scan with WeChat, then confirm on the phone.</p>
        </div>
      </div>
    </section>
    <section class="panel" aria-labelledby="project-list-title">
      <div class="panel-header">
        <div>
          <h2 class="panel-title" id="project-list-title">Projects</h2>
          <p class="panel-description">Generated ${escapeHtml(formatGeneratedAt(now))}</p>
        </div>
      </div>
      <div class="projects-grid">
${projectCards}
      </div>
    </section>
  </main>
  <script>
    const wechat = {
      badge: document.querySelector('[data-wechat-badge]'),
      detail: document.querySelector('[data-wechat-detail]'),
      meta: document.querySelector('[data-wechat-meta]'),
      qrPanel: document.querySelector('[data-wechat-qr]'),
      qrBox: document.querySelector('[data-qr-box]'),
      qrDetail: document.querySelector('[data-qr-detail]'),
      refreshButton: document.querySelector('[data-wechat-refresh]'),
      startButton: document.querySelector('[data-wechat-start]'),
      pageRefreshButton: document.querySelector('[data-refresh]'),
      session: '',
      pollTimer: 0,
    };
    const services = {
      domain: document.querySelector('[data-service-domain]'),
      domainDetail: document.querySelector('[data-service-domain-detail]'),
      mail: document.querySelector('[data-service-mail]'),
      mailDetail: document.querySelector('[data-service-mail-detail]'),
      mailEnabled: document.querySelector('[data-service-mail-enabled]'),
      configEnabled: document.querySelector('[data-service-config-enabled]'),
    };

    function setBadge(label, tone) {
      wechat.badge.className = 'status-badge tone-' + tone;
      wechat.badge.innerHTML = '<span class="status-dot" aria-hidden="true"></span>' + escapeHtml(label);
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function stopQrPolling() {
      if (wechat.pollTimer) {
        window.clearTimeout(wechat.pollTimer);
        wechat.pollTimer = 0;
      }
    }

    async function readJson(response) {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text.trim() || 'HTTP ' + response.status);
      }
      return JSON.parse(text);
    }

    async function loadWechatStatus(options = {}) {
      try {
        const data = await readJson(await fetch('/api/wechat/status', { cache: 'no-store' }));
        renderWechatStatus(data);
        if (!data.loggedIn && options.autoQr !== false) {
          await startWechatLogin();
        }
      } catch (error) {
        setBadge('Error', 'bad');
        wechat.detail.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    async function loadServiceReadiness() {
      try {
        const data = await readJson(await fetch('/api/onboarding/status', { cache: 'no-store' }));
        const state = data.services || {};
        services.domain.textContent = state.publicDomain?.ready ? 'Ready' : 'Not detected';
        services.domainDetail.textContent = state.publicDomain?.value || 'A public DNS domain is required.';
        services.mail.textContent = state.agentMail?.ready ? 'Ready' : 'Not detected';
        services.mailDetail.textContent = state.agentMail?.value || 'A matching Agent mailbox is required.';
        services.mailEnabled.textContent = state.managedMail?.enabled ? 'Enabled' : 'Disabled';
        services.configEnabled.textContent = state.managedConfiguration?.enabled ? 'Enabled' : 'Disabled';
      } catch (error) {
        for (const node of [services.domain, services.mail, services.mailEnabled, services.configEnabled]) node.textContent = 'Unavailable';
        services.domainDetail.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    function renderWechatStatus(data) {
      const daemon = data.daemon || {};
      if (data.loggedIn && daemon.connected) {
        setBadge('Connected', 'good');
        stopQrPolling();
        wechat.qrPanel.hidden = true;
      } else if (data.loggedIn) {
        setBadge('Login ready', 'warn');
      } else {
        setBadge('Login required', 'bad');
      }

      const active = daemon.status?.activeAdapter || '(none)';
      const reason = data.reason ? ' Login: ' + data.reason : '';
      wechat.detail.textContent = data.loggedIn
        ? 'WeChat credentials are saved. Daemon state: ' + (daemon.state || 'unknown') + ', active adapter: ' + active + '.'
        : 'WeChat is not connected.' + reason;

      const account = data.account || {};
      const slots = Array.isArray(daemon.status?.slots) ? daemon.status.slots : [];
      wechat.meta.innerHTML = [
        account.accountId ? '<div>account: <code>' + escapeHtml(account.accountId) + '</code></div>' : '',
        account.savedAt ? '<div>saved: <code>' + escapeHtml(account.savedAt) + '</code></div>' : '',
        daemon.pid ? '<div>daemon pid: <code>' + escapeHtml(daemon.pid) + '</code></div>' : '',
        daemon.cwd ? '<div>cwd: <code>' + escapeHtml(daemon.cwd) + '</code></div>' : '',
        slots.length ? '<div>slots: <code>' + escapeHtml(slots.map((slot) => slot.adapter + ':' + slot.status).join(', ')) + '</code></div>' : '',
      ].filter(Boolean).join('');
    }

    async function startWechatLogin() {
      stopQrPolling();
      wechat.startButton.disabled = true;
      try {
        const data = await readJson(await fetch('/api/wechat/login/start', {
          method: 'POST',
          cache: 'no-store',
        }));
        wechat.session = data.session || '';
        wechat.qrPanel.hidden = false;
        wechat.qrBox.innerHTML = data.qrSvg
          ? data.qrSvg
          : '<span class="qr-fallback">' + escapeHtml(data.qrContent || 'QR content unavailable') + '</span>';
        wechat.qrDetail.textContent = 'Scan with WeChat, then confirm on the phone.';
        pollWechatLogin();
      } catch (error) {
        wechat.qrPanel.hidden = false;
        wechat.qrBox.innerHTML = '<span class="qr-fallback">' + escapeHtml(error instanceof Error ? error.message : String(error)) + '</span>';
        wechat.qrDetail.textContent = 'QR login could not start.';
      } finally {
        wechat.startButton.disabled = false;
      }
    }

    async function pollWechatLogin() {
      if (!wechat.session) {
        return;
      }
      try {
        const data = await readJson(await fetch('/api/wechat/login/status?session=' + encodeURIComponent(wechat.session), { cache: 'no-store' }));
        if (data.connected || data.status === 'confirmed') {
          wechat.qrDetail.textContent = 'WeChat login confirmed.';
          stopQrPolling();
          await loadWechatStatus({ autoQr: false });
          return;
        }
        if (data.status === 'scaned') {
          wechat.qrDetail.textContent = 'Scanned. Confirm the login on the phone.';
        } else if (data.status === 'expired' || data.status === 'missing') {
          wechat.qrDetail.textContent = 'QR expired. Generate a new QR.';
          stopQrPolling();
          return;
        } else {
          wechat.qrDetail.textContent = 'Waiting for WeChat scan...';
        }
      } catch (error) {
        wechat.qrDetail.textContent = error instanceof Error ? error.message : String(error);
      }
      wechat.pollTimer = window.setTimeout(pollWechatLogin, 1800);
    }

    wechat.refreshButton?.addEventListener('click', () => loadWechatStatus({ autoQr: false }));
    wechat.startButton?.addEventListener('click', startWechatLogin);
    wechat.pageRefreshButton?.addEventListener('click', () => window.location.reload());
    loadWechatStatus();
    loadServiceReadiness();
  </script>
</body>
</html>`;
}

function renderProjectCard(item) {
  const entries = renderProjectEntries(item);
  const runtime = renderRuntime(item);
  return `        <article class="project-card">
          <div class="project-card-head">
            <div class="project-title-block">
              <div class="project-title-row">
                <h3 class="project-name">${escapeHtml(item.label)}</h3>
                <div class="status-badge tone-${escapeAttr(item.status.tone)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(item.status.label)}</div>
              </div>
              <div class="project-meta">${escapeHtml(item.name)} &middot; ${escapeHtml(item.kind)}</div>
            </div>
          </div>
          <p class="project-description">${escapeHtml(item.description || '')}</p>
          <div class="project-card-body">
            <section class="card-section" aria-label="Project entries">
              <div class="card-label">Entry</div>
              ${entries}
            </section>
            <section class="card-section" aria-label="Runtime">
              <div class="card-label">Runtime</div>
              ${runtime}
            </section>
          </div>
          ${renderCheckPills(item)}
        </article>`;
}

function renderMetric(label, value, note) {
  return `<article class="metric"><div class="metric-label">${escapeHtml(label)}</div><strong class="metric-value">${Number(value) || 0}</strong><div class="metric-note">${escapeHtml(note)}</div></article>`;
}

function renderProjectEntries(item) {
  if (!item.entries.length) {
    return '<span class="no-entry">No public HTTP entry</span>';
  }
  return `<div class="entries">${item.entries.map((entry) => {
    const label = localMode ? formatLocalHost(entry.localDomain) : entry.domain;
    return `<a class="entry" href="${escapeAttr(entry.url)}" target="_blank" rel="noreferrer"><span class="entry-domain">${escapeHtml(label)}</span></a>`;
  }).join('')}</div>`;
}

function renderRuntime(item) {
  const lines = [
    item.runtime.type || 'static',
    item.runtime.systemd ? path.basename(item.runtime.systemd) : '',
  ].filter(Boolean);
  return `<div class="runtime-list">${lines.map((line) => `<span class="runtime-pill">${escapeHtml(line)}</span>`).join('')}</div>`;
}

function renderCheckPills(item) {
  const parts = [];
  if (!['not-configured', 'not-checked'].includes(item.checks.entry.state)) {
    parts.push({ label: `entry ${item.checks.entry.state}`, detail: entryCheckDetail(item.checks.entry) });
  }
  if (item.checks.systemd.state !== 'not-configured') {
    parts.push({ label: `systemd ${item.checks.systemd.state}`, detail: item.checks.systemd.detail });
  }
  if (item.checks.port.state !== 'not-configured') {
    parts.push({ label: `service ${item.checks.port.state}`, detail: serviceCheckDetail(item.checks.port.state) });
  }
  return `<div class="checks">${parts.map((part) => `<span class="check-pill" title="${escapeAttr(part.detail)}">${escapeHtml(part.label)}</span>`).join('')}</div>`;
}

function entryCheckDetail(entryStatus) {
  const resultDetails = (entryStatus.results || [])
    .map((result) => result.detail)
    .filter(Boolean)
    .join('; ');
  return [entryStatus.detail, resultDetails].filter(Boolean).join(' | ');
}

function serviceCheckDetail(state) {
  if (state === 'open') return 'runtime listener is reachable';
  if (state === 'closed') return 'runtime listener is not reachable';
  if (state === 'timeout') return 'runtime listener timed out';
  return `runtime listener ${state}`;
}

function formatGeneratedAt(date) {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function titleCase(value) {
  const text = String(value || 'unknown');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHostHeader(value) {
  const text = String(value || '').trim();
  if (!text) return { hostname: '', port: '' };
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    const hostname = end >= 0 ? text.slice(1, end) : text;
    const rest = end >= 0 ? text.slice(end + 1) : '';
    const port = rest.startsWith(':') ? rest.slice(1) : '';
    return { hostname: hostname.toLowerCase(), port: /^\d+$/.test(port) ? port : '' };
  }
  const parts = text.split(':');
  const port = parts.length === 2 && /^\d+$/.test(parts[1]) ? parts[1] : '';
  return { hostname: parts[0].toLowerCase(), port };
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format') parsed.format = argv[++i];
    else if (arg === '--host') parsed.host = argv[++i];
    else if (arg === '--local') parsed.local = true;
    else if (arg === '--check-entries') parsed.checkEntries = true;
    else parsed._.push(arg);
  }
  return parsed;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
