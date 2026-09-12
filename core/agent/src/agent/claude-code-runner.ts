import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

const active = new Map();
const SOURCE = 'personal-agent-claude-code';
const PRODUCT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];

/** Resolve native binaries or the official npm entry without ever executing a shell shim. */
export function resolveClaudeCommand({ command = 'claude', env = process.env, platform = process.platform } = {}) {
  const requested = String(command).trim();
  const directories = path.isAbsolute(requested) ? [''] : String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const candidates = path.isAbsolute(requested) ? [requested] : directories.flatMap((dir) =>
    platform === 'win32' && !/\.(exe|cmd|bat)$/i.test(requested)
      ? [path.join(dir, `${requested}.exe`), path.join(dir, `${requested}.cmd`)] : [path.join(dir, requested)]);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    if (/\.(cmd|bat)$/i.test(candidate)) {
      const packageRoot = path.join(path.dirname(candidate), 'node_modules', '@anthropic-ai', 'claude-code');
      const nativeEntry = path.join(packageRoot, 'bin', 'claude.exe');
      if (fs.existsSync(nativeEntry)) return { command: nativeEntry, args: [] };
      const entry = path.join(packageRoot, 'cli.js');
      if (fs.existsSync(entry)) return { command: process.execPath, args: [entry] };
      continue;
    }
    if (/\.(mjs|cjs|js)$/i.test(candidate)) return { command: process.execPath, args: [candidate] };
    return { command: candidate, args: [] };
  }
  throw Object.assign(new Error('未检测到 Claude Code，请先安装 Claude Code。'), { code: 'CLAUDE_CODE_NOT_INSTALLED' });
}

/** One official print-mode process per turn; only our static policy chooses executable flags. */
export async function runClaudeCodeCommand(config) {
  const sessionId = config.sessionId;
  const turnId = crypto.randomUUID();
  let cliSessionId = config.cliSessionId || '';
  let resultSeen = false;
  let failed = false;
  let finalText = '';
  let uploaded = 0;
  let child;
  let promptFile;
  const state = { cancelled: false, child: null, timer: null };
  const secretValues = [config.runtimeCredential, config.agentEnv?.ANTHROPIC_API_KEY,
    config.agentEnv?.ANTHROPIC_AUTH_TOKEN, config.agentEnv?.CLAUDE_CODE_OAUTH_TOKEN].filter(Boolean);
  const redact = (value) => {
    if (typeof value === 'string') return secretValues.reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
    return value;
  };
  let events = Promise.resolve();
  const emit = (kind, payload) => {
    uploaded++;
    const event = { sessionId, kind, payload: redact({ source: SOURCE, ...(cliSessionId ? { cliSessionId } : {}), ...payload }) };
    events = events.then(() => config.onSessionEvent?.(event));
    // Attach immediately: callback rejection must not become an unhandled rejection while streaming.
    events.catch(() => {});
  };
  const frame = (message) => {
    if (message.type === 'system' && message.subtype === 'init') {
      if (typeof message.session_id === 'string') cliSessionId = message.session_id;
      emit('session.status', { content: 'Claude Code 已开始执行。', metadata: { eventType: 'claude/init', engine: 'claude-code' } });
    }
    if (message.type === 'assistant') {
      if (message.error) { failed = true; return; }
      const id = message.message?.id || turnId;
      for (const item of message.message?.content || []) {
        if (item.type === 'text' && item.text) {
          finalText = item.text;
          emit('session.assistant_message', { content: item.text, role: 'assistant', metadata: { eventType: 'item/completed', itemId: id, streamState: 'completed' } });
        }
        if (item.type === 'tool_use') emit('session.tool_use', { content: JSON.stringify(item.input || {}), toolName: item.name,
          metadata: { eventType: 'item/started', itemId: item.id } });
      }
    }
    if (message.type === 'user') {
      for (const item of message.message?.content || []) if (item.type === 'tool_result') {
        emit('session.tool_result', { content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content || []),
          level: item.is_error ? 'error' : 'info', metadata: { eventType: 'item/completed', itemId: item.tool_use_id } });
      }
    }
    if (message.type === 'result') {
      resultSeen = true;
      failed ||= message.is_error === true || message.subtype !== 'success';
      if (!cliSessionId && typeof message.session_id === 'string') cliSessionId = message.session_id;
      if (message.usage) {
        const u = message.usage;
        const inputTokens = Number(u.input_tokens || 0) + Number(u.cache_creation_input_tokens || 0) + Number(u.cache_read_input_tokens || 0);
        const outputTokens = Number(u.output_tokens || 0);
        const last = { inputTokens, cachedInputTokens: Number(u.cache_read_input_tokens || 0), outputTokens,
          reasoningOutputTokens: 0, totalTokens: inputTokens + outputTokens };
        const tokenUsage = { last, total: last, modelContextWindow: null };
        // Claude reports invocation totals, unlike Codex's cumulative thread totals. Give each
        // invocation its own usage key so resumed turns are added rather than overwritten.
        const usageId = `claude:${cliSessionId}:${turnId}`;
        emit('session.token_usage', { content: '', threadId: usageId, turnId, tokenUsage,
          metadata: { eventType: 'thread/tokenUsage/updated', threadId: usageId, turnId, tokenUsage } });
      }
      if (failed) emit('session.error', { content: 'Claude Code 执行失败，请检查授权、模型和工具权限。', level: 'error',
        metadata: { eventType: 'claude/result', code: 'CLAUDE_CODE_TURN_FAILED' } });
      else if (message.result && message.result !== finalText) emit('session.assistant_message', {
        content: message.result, role: 'assistant', metadata: { eventType: 'item/completed', itemId: `${turnId}-result`, streamState: 'completed' } });
    }
  };
  active.set(sessionId, state);
  emit('session.started', { content: 'Claude Code 执行已启动。', agentType: 'claude-code', agentAlias: 'claude-code' });
  emit('session.user_message', { content: String(config.stdin || ''), source: 'agent-bridge-ui' });
  try {
    const executable = resolveClaudeCommand({ command: config.claudeCommand || 'claude', env: config.agentEnv });
    const tools = config.claudeTools || PRODUCT_TOOLS;
    const args = [...executable.args, '-p', '--output-format', 'stream-json', '--verbose',
      '--input-format', 'text', '--permission-mode', 'dontAsk', '--tools', tools.join(','),
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', ''];
    // Product authorization is server-owned. Confirm mode denies writes/commands in headless execution.
    const allowed = config.appServerApprovalPolicy === 'never' ? tools : tools.filter((tool) => ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(tool));
    if (allowed.length) args.push('--allowedTools', allowed.join(','));
    if (config.appServerModel) args.push('--model', config.appServerModel);
    if (config.claudeNoSessionPersistence) args.push('--no-session-persistence');
    if (config.appServerReasoningEffort) args.push('--effort', config.appServerReasoningEffort);
    if (cliSessionId) args.push('--resume', cliSessionId);
    else if (config.allowCreateThread === false) throw Object.assign(new Error('Claude Code 会话不可恢复。'), { code: 'CLAUDE_SESSION_MISSING' });
    if (config.harnessRoot) {
      const harness = fs.readFileSync(path.join(config.harnessRoot, 'AGENTS.md'), 'utf8');
      const directory = path.join(config.runtimeStateRoot || config.workspace, 'runtime', 'claude-turns');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      promptFile = path.join(directory, `${turnId}.txt`);
      // Public Harness only. Per-turn Activity/Memory capabilities never enter argv or a prompt file.
      fs.writeFileSync(promptFile, harness, { mode: 0o600 });
      args.push('--append-system-prompt-file', promptFile);
    }
    child = spawn(executable.command, args, { cwd: config.workspace, env: config.agentEnv || process.env,
      windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    state.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (line.length > 4 * 1024 * 1024) { failed = true; stopClaudeCodeCommand(sessionId); return; }
      try { frame(JSON.parse(line)); } catch { /* Non-protocol banners are never user events. */ }
    });
    child.stderr.resume(); // Drain diagnostics without exposing credential-bearing provider errors.
    child.stdin.on('error', () => {});
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => { lines.close(); resolve(code); });
    });
    const context = config.appServerDeveloperInstructions ? `[Personal Agent runtime context]\n${config.appServerDeveloperInstructions}\n[/Personal Agent runtime context]\n\n` : '';
    child.stdin.end(`${context}${String(config.stdin || '')}`);
    const timeout = Math.max(1000, Number(config.claudeTimeoutMs) || 30 * 60 * 1000);
    state.timer = setTimeout(() => stopClaudeCodeCommand(sessionId), timeout);
    state.timer.unref?.();
    const code = await closed;
    failed ||= code !== 0 || !resultSeen;
  } catch (error) {
    failed = true;
    emit('session.error', { content: error.code === 'CLAUDE_CODE_NOT_INSTALLED' ? error.message : 'Claude Code 无法启动或连接，请检查运行环境配置。',
      level: 'error', metadata: { code: error.code === 'CLAUDE_CODE_NOT_INSTALLED' ? error.code : 'CLAUDE_CODE_START_FAILED' } });
  } finally {
    clearTimeout(state.timer);
    active.delete(sessionId);
    if (promptFile) { try { fs.unlinkSync(promptFile); } catch {} }
  }
  const status = state.cancelled ? 'interrupted' : failed ? 'failed' : 'completed';
  emit('session.complete', { success: status === 'completed', idle: status === 'completed', status,
    content: status === 'completed' ? 'Agent turn completed.' : 'Agent turn stopped.' });
  await events;
  return { sessionId, uploaded, status, success: status === 'completed' };
}

export function stopClaudeCodeCommand(sessionId) {
  const state = active.get(sessionId);
  if (!state) return false;
  state.cancelled = true;
  if (!state.child?.pid) return true;
  if (process.platform === 'win32') {
    const kill = spawn('taskkill.exe', ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    kill.on('error', () => { try { state.child.kill(); } catch {} });
  } else {
    try { process.kill(-state.child.pid, 'SIGKILL'); } catch { try { state.child.kill('SIGKILL'); } catch {} }
  }
  return true;
}
