// 历史会话按需直读：打开一个从本地 Codex 会话索引恢复出来的 session 时，现场重建完整历史
// 并经 runner WS 一次性返回给 broker 转发浏览器。消息属于用户隐私，平台 DB 不落任何消息正文，
// 每次打开会话都从本机重新读取。
//
// 数据源分两层，尽量复用 codex 原生能力（避免重复实现 rollout 解析）：
//   1) `thread/read {includeTurns:true}`：官方历史重建，返回 userMessage / agentMessage /
//      fileChange（带 diff）/ plan / mcpToolCall / webSearch / contextCompaction 等 items，
//      直接过现有 app-server-mapper 得到与在线流完全一致的帧。
//   2) 本地 rollout JSONL 的 `function_call exec_command` + output 配对：codex 官方 rollout
//      策略（rollout/src/policy.rs）不持久化 ExecCommandBegin/End，thread/read 因此没有
//      commandExecution——命令执行历史只能从 JSONL 原始记录补齐，按 passthrough turn_id 归位。
//      加密 reasoning（encrypted_content）两边都不可恢复，跳过。
//
// 历史消息使用负数 sequence 频段（HISTORY_SEQUENCE_BASE + n），保证永远排在 live 事件消息
// 之前，浏览器端按 sequence 合并渲染。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { deriveAppServerTransport, getAppServerClient } from './app-server-client.mjs';
import { createAppServerMapperState, mapMessage } from './app-server-mapper.mjs';

const SRC = 'agent-bridge-cli';
const DEFAULT_CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const HISTORY_SEQUENCE_BASE = -1_000_000;
const EXEC_OUTPUT_CHAR_CAP = 8_000;

const HISTORY_KIND_ROLE = {
  'session.user_message': 'user',
  'session.assistant_message': 'assistant',
  'session.reasoning': 'assistant',
  'session.tool_use': 'tool',
  'session.tool_result': 'tool',
};

export async function readCodexSessionHistory(config, { sessionId, cliSessionId }, { log = console.error } = {}) {
  const threadId = String(cliSessionId || '').trim();
  const id = String(sessionId || '').trim();
  if (!id || !threadId) throw new Error('runner.history 需要 sessionId 和 cliSessionId');

  const client = getAppServerClient({
    cwd: config.workspace,
    env: config.agentEnv,
    transport: deriveAppServerTransport(config),
    socketPath: config.appServerSocketPath,
  });
  await client.ensureStarted();
  const res = await client.request('thread/read', { threadId, includeTurns: true }, 120_000);
  const thread = res?.thread;
  if (!thread) throw new Error(`thread/read 未返回线程：${threadId}`);
  const turns = Array.isArray(thread.turns) ? thread.turns : [];

  const exec = collectExecHistory(config.codexSessionsDir || DEFAULT_CODEX_SESSIONS_DIR, threadId);
  const messages = buildHistoryMessages({
    sessionId: id,
    threadId,
    turns,
    execByTurn: exec.byTurn,
    unassignedExec: exec.unassigned,
  });
  log(`[session-history] ${id}: 读取 ${messages.length} 条历史消息（${turns.length} turns，exec 补充 ${exec.count} 条${exec.jsonlPath ? '' : '，未找到本地 JSONL'}）`);
  return { messages, turns: turns.length, execCount: exec.count };
}

/**
 * thread/read 的 turns + JSONL exec 补充 → 平台消息行。
 * 帧形状对齐 store 的 sessionEventToMessage：payload 平铺进 metadata，eventType = 帧 kind；
 * 用户消息改用 'user.message'（'session.user_message' 会被 web 的 isConversationMessage
 * 当作 CLI 回显隐藏，回合也无法折叠）。native item 没有逐条时间戳：整轮用 turn.startedAt，
 * 最后一帧用 completedAt，exec 帧带自己的 JSONL 时间戳，轮次耗时推导保持正确。
 */
export function buildHistoryMessages({ sessionId, threadId, turns, execByTurn = new Map(), unassignedExec = [] }) {
  const state = createAppServerMapperState();
  const rows = [];
  let n = 0;
  const pushFrame = (frame, createdAt) => {
    const payload = frame.payload || {};
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) return;
    n += 1;
    rows.push({
      id: `${sessionId}-hist-${n}`,
      role: HISTORY_KIND_ROLE[frame.kind] || 'system',
      content,
      sequence: HISTORY_SEQUENCE_BASE + n,
      toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
      source: SRC,
      level: typeof payload.level === 'string' ? payload.level : 'info',
      metadata: {
        ...payload,
        eventType: frame.kind === 'session.user_message' ? 'user.message' : frame.kind,
        historyBackfill: true,
        importedFrom: 'codex-app-server',
      },
      createdAt,
    });
  };

  for (const turn of turns) {
    const startedAt = unixToIso(turn.startedAt);
    const completedAt = unixToIso(turn.completedAt) || startedAt;
    const frames = [];
    for (const item of turn.items || []) {
      frames.push(...mapMessage({ method: 'item/completed', params: { item, threadId, turnId: turn.id } }, state));
    }
    // 命令执行帧插在本轮 userMessage 之后：完成轮次的中间事件在 web 端折叠进「耗时 N 秒」
    // 时间线，帧间精确交错不可见，只需保证轮次归属与命令相互顺序正确。
    let split = 0;
    while (split < frames.length && frames[split].kind === 'session.user_message') split += 1;
    for (const frame of frames.slice(0, split)) pushFrame(frame, startedAt);
    for (const entry of execByTurn.get(turn.id) || []) {
      for (const frame of entry.frames) pushFrame(frame, entry.createdAt || startedAt);
    }
    const tail = frames.slice(split);
    tail.forEach((frame, index) => pushFrame(frame, index === tail.length - 1 ? completedAt : startedAt));
  }
  for (const entry of unassignedExec) {
    for (const frame of entry.frames) pushFrame(frame, entry.createdAt);
  }
  return rows;
}

/**
 * 从本地 rollout JSONL 收集命令执行历史（thread/read 唯一缺失的类别）。
 * 只认 `function_call exec_command` 与其 output 的 call_id 配对；write_stdin / update_plan /
 * update_goal 等其他 function_call 一律跳过（plan 已由 native Plan item 覆盖）。
 */
export function collectExecHistory(sessionsDir, threadId) {
  const empty = { byTurn: new Map(), unassigned: [], count: 0, jsonlPath: null };
  const file = findCodexSessionFileByThreadId(sessionsDir, threadId);
  if (!file) return empty;
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    return empty;
  }

  const pending = new Map(); // call_id -> { cmd, turnId, createdAt } | { skip: true }
  const entries = [];
  const execFrames = (call, callId, output) => {
    const exitCode = parseExitCode(output);
    const meta = { itemId: callId, threadId, ...(call.turnId ? { turnId: call.turnId } : {}) };
    const frames = [{
      kind: 'session.tool_use',
      payload: { content: call.cmd, source: SRC, toolName: 'Bash', metadata: { eventType: 'item/started', ...meta } },
    }];
    if (typeof output === 'string' && output) {
      frames.push({
        kind: 'session.tool_result',
        payload: {
          content: truncate(output, EXEC_OUTPUT_CHAR_CAP),
          source: SRC,
          toolName: 'Bash',
          level: typeof exitCode === 'number' && exitCode !== 0 ? 'error' : 'info',
          metadata: { eventType: 'item/completed', ...(typeof exitCode === 'number' ? { exitCode } : {}), ...meta },
        },
      });
    }
    return frames;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== 'response_item' || !event.payload || typeof event.payload.call_id !== 'string') continue;
    const payload = event.payload;
    if (payload.type === 'function_call') {
      if (payload.name !== 'exec_command') {
        pending.set(payload.call_id, { skip: true });
        continue;
      }
      let cmd = '';
      try {
        cmd = String(JSON.parse(payload.arguments || '{}')?.cmd || '');
      } catch { /* 参数不是 JSON 时退回原文 */ }
      pending.set(payload.call_id, {
        cmd: cmd || String(payload.arguments || '').slice(0, 2_000),
        turnId: typeof payload.internal_chat_message_metadata_passthrough?.turn_id === 'string'
          ? payload.internal_chat_message_metadata_passthrough.turn_id
          : undefined,
        createdAt: typeof event.timestamp === 'string' ? event.timestamp : undefined,
      });
      continue;
    }
    if (payload.type !== 'function_call_output') continue;
    const call = pending.get(payload.call_id);
    pending.delete(payload.call_id);
    if (!call || call.skip || !call.cmd) continue;
    const output = typeof payload.output === 'string' ? payload.output : '';
    entries.push({ turnId: call.turnId, createdAt: call.createdAt, frames: execFrames(call, payload.call_id, output) });
  }
  // 只有调用没有输出（被中断）的命令：保留 tool_use，时间线仍能看到执行了什么。
  for (const [callId, call] of pending) {
    if (call.skip || !call.cmd) continue;
    entries.push({ turnId: call.turnId, createdAt: call.createdAt, frames: execFrames(call, callId, '') });
  }

  const byTurn = new Map();
  const unassigned = [];
  for (const entry of entries) {
    if (!entry.turnId) {
      unassigned.push(entry);
      continue;
    }
    const list = byTurn.get(entry.turnId) ?? [];
    list.push(entry);
    byTurn.set(entry.turnId, list);
  }
  return { byTurn, unassigned, count: entries.length, jsonlPath: file };
}

/** rollout 文件名固定以 `-<threadId>.jsonl` 结尾（rollout-<时间>-<threadId>.jsonl）。 */
export function findCodexSessionFileByThreadId(sessionsDir, threadId) {
  if (!sessionsDir || !threadId || !existsSync(sessionsDir)) return null;
  const suffix = `-${threadId}.jsonl`;
  const stack = [sessionsDir];
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
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(suffix)) return path;
    }
  }
  return null;
}

function parseExitCode(output) {
  const match = /(?:Process exited with code|Exit code:)\s*(-?\d+)/.exec(output || '');
  return match ? Number(match[1]) : undefined;
}

function unixToIso(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
