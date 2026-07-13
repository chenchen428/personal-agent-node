import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { postJson } from './http.mjs';
import { sendHeartbeat } from './heartbeat.mjs';

const DEFAULT_CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGES = 80;
const AGENT_ALIAS = 'codex';

export function discoverCodexSessions({
  sessionsDir = DEFAULT_CODEX_SESSIONS_DIR,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxFiles = DEFAULT_MAX_FILES,
  maxMessages = DEFAULT_MAX_MESSAGES,
} = {}) {
  const files = findRecentJsonlFiles(sessionsDir, { now, maxAgeMs, maxFiles });
  const discovered = [];
  for (const file of files) {
    const parsed = parseCodexSessionFile(file, { maxMessages });
    if (parsed) discovered.push(parsed);
  }
  return assignWorkspaceNames(discovered);
}

export async function syncCodexSessions(config, { log = console.error } = {}) {
  if (config.codexSessionSync === false) return { workspaces: 0, sessions: 0 };
  const discovered = discoverCodexSessions({
    sessionsDir: config.codexSessionsDir,
    maxAgeMs: config.codexSessionMaxAgeMs,
    maxFiles: config.codexSessionMaxFiles,
    maxMessages: config.codexSessionMaxMessages,
  });
  if (discovered.sessions.length === 0) return { workspaces: 0, sessions: 0 };

  config.workspaces = mergeWorkspaceEntries(config.workspaces, discovered.workspaces);
  if (config.workspaceProvided !== true && discovered.workspaces[0]?.workspaceRoot) {
    config.workspace = discovered.workspaces[0].workspaceRoot;
    config.workspaceName = discovered.workspaces[0].name;
  }
  await sendHeartbeat(config);

  const seen = config.__codexSessionSyncSeen instanceof Map
    ? config.__codexSessionSyncSeen
    : (config.__codexSessionSyncSeen = new Map());
  let uploaded = 0;
  for (const session of discovered.sessions) {
    if (seen.get(session.jsonlPath) === session.updatedAt) continue;
    try {
      await postJson(config.baseUrl, '/api/agent-bridge/sessions', {
        id: session.id,
        workspaceName: session.workspaceName,
        agentAlias: AGENT_ALIAS,
        status: 'idle',
        cliSessionId: session.threadId,
        taskDescription: session.taskDescription,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
      seen.set(session.jsonlPath, session.updatedAt);
      uploaded += 1;
    } catch (error) {
      log(`[codex-session-sync] upload failed ${session.jsonlPath}: ${error.message}`);
    }
  }
  return { workspaces: discovered.workspaces.length, sessions: uploaded };
}

export function startCodexSessionSync(config, { log = console.error } = {}) {
  if (config.codexSessionSync === false) return { stop() {} };
  let stopped = false;
  let inflight = null;
  const intervalMs = normalizeInterval(config.codexSessionScanIntervalMs);

  const tick = async () => {
    if (stopped || inflight) return;
    inflight = syncCodexSessions(config, { log })
      .then((result) => {
        if (result.sessions > 0) log(`[codex-session-sync] synced ${result.sessions} sessions across ${result.workspaces} workspaces`);
      })
      .catch((error) => log(`[codex-session-sync] failed: ${error.message}`))
      .finally(() => { inflight = null; });
    await inflight;
  };

  const timer = setInterval(tick, intervalMs);
  const initialTimer = setTimeout(tick, 0);
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof initialTimer.unref === 'function') initialTimer.unref();

  return {
    stop() {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(timer);
    },
  };
}

function findRecentJsonlFiles(root, { now, maxAgeMs, maxFiles }) {
  if (!root || !existsSync(root)) return [];
  const cutoff = now - maxAgeMs;
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const stat = statSync(path);
        if (stat.mtimeMs >= cutoff) out.push({ path, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return out
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.path);
}

function parseCodexSessionFile(file, { maxMessages }) {
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return null;
  }

  let threadId = '';
  let cwd = '';
  let createdAt = '';
  let updatedAt = '';
  let taskDescription = '';
  let inspectedMessages = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const event = safeJson(line);
    if (!event || typeof event !== 'object') continue;
    const timestamp = stringValue(event.timestamp);
    if (timestamp) {
      if (!createdAt) createdAt = timestamp;
      updatedAt = timestamp;
    }

    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.type === 'session_meta') {
      threadId = stringValue(payload.id) || stringValue(payload.session_id) || threadId;
      cwd = stringValue(payload.cwd) || cwd;
      continue;
    }
    if (event.type === 'turn_context') {
      cwd = stringValue(payload.cwd) || cwd;
      continue;
    }
    if (event.type !== 'response_item' || taskDescription || inspectedMessages >= maxMessages) continue;
    inspectedMessages += 1;
    const message = normalizeResponseMessage(payload, lineIndex + 1, timestamp);
    if (message?.role === 'user') taskDescription = message.content;
  }

  if (!threadId || !cwd) return null;
  return {
    id: `codex-${threadId}`,
    threadId,
    workspaceRoot: cwd,
    jsonlPath: file,
    taskDescription: (taskDescription || `Codex session ${shortId(threadId)}`).slice(0, 200),
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || createdAt || new Date().toISOString(),
  };
}

function normalizeResponseMessage(payload, sequence, timestamp) {
  if (payload.type !== 'message') return null;
  const role = stringValue(payload.role);
  if (role !== 'user' && role !== 'assistant') return null;
  const content = messageText(payload.content);
  if (!content || shouldSkipMessage(role, content)) return null;
  return {
    role,
    content: truncate(content, 12_000),
    sequence,
    source: 'codex-jsonl',
    createdAt: timestamp || undefined,
    metadata: { importedFrom: 'codex-jsonl' },
  };
}

function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      return stringValue(entry.text) || stringValue(entry.content) || '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function shouldSkipMessage(role, content) {
  if (role !== 'user') return false;
  const trimmed = content.trim();
  return trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('<INSTRUCTIONS>')
    || trimmed.includes('Knowledge cutoff:')
    || trimmed.includes('You are Codex, a coding agent');
}

function assignWorkspaceNames(sessions) {
  const roots = Array.from(new Set(sessions.map((session) => session.workspaceRoot)));
  const baseCounts = new Map();
  for (const root of roots) {
    const base = basename(root) || 'workspace';
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  }
  const nameByRoot = new Map();
  for (const root of roots) {
    const base = basename(root) || 'workspace';
    const name = baseCounts.get(base) > 1 ? `${basename(dirname(root)) || base}-${base}` : base;
    nameByRoot.set(root, name);
  }
  const workspaces = roots.map((root) => ({
    name: nameByRoot.get(root),
    workspaceRoot: root,
    routingTags: [nameByRoot.get(root), 'agent-bridge-cli', 'codex-auto-discovered'],
    contextSummary: 'Auto-discovered from local Codex sessions.',
  }));
  return {
    workspaces,
    sessions: sessions.map((session) => ({ ...session, workspaceName: nameByRoot.get(session.workspaceRoot) })),
  };
}

function mergeWorkspaceEntries(existing, discovered) {
  const byKey = new Map();
  for (const entry of [...(Array.isArray(existing) ? existing : []), ...discovered]) {
    if (!entry || typeof entry !== 'object') continue;
    const name = stringValue(entry.name) || stringValue(entry.workspaceName);
    const workspaceRoot = stringValue(entry.workspaceRoot) || stringValue(entry.root);
    const key = name || workspaceRoot;
    if (!key) continue;
    byKey.set(key, { ...entry, name: name || key, workspaceRoot });
  }
  return Array.from(byKey.values());
}

function normalizeInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 5_000) return DEFAULT_SCAN_INTERVAL_MS;
  return interval;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function shortId(value) {
  return String(value || '').slice(0, 8);
}
