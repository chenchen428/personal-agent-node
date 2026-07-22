// The app-server RUNNER: drives codex threads/turns over the JSON-RPC client and translates the
// resulting v2 events into Agent Bridge `session.delta` events.
//
// One codex app-server child (app-server-client singleton) holds every session as a live thread:
//   session.start  -> thread/start + turn/start        (or a slash command, see parseInput)
//   session.input  -> turn/steer (active turn) | turn/start (idle thread)
//   session.stop   -> turn/interrupt
//   authorization  -> JSON-RPC response to the held server approval request
//
// Slash commands map to first-class app-server methods (codex's native CLI features):
//   /compact -> thread/compact/start   /review -> review/start      /goal -> thread/goal/*
//   /fork -> thread/fork               /rollback -> thread/rollback  !cmd|/shell -> thread/shellCommand
//   /model -> model/list               /skills -> skills/list        /<name> -> run skill by name

import { setTimeout as delay } from 'node:timers/promises';
import { deriveAppServerTransport, getAppServerClient } from './app-server-client.ts';
import { createAppServerMapperState, mapMessage, threadIdFromResult, turnIdFromResult, completionPayload, collabReceiverThreadIds } from './app-server-mapper.ts';

const SRC = 'agent-bridge-appserver';

const sessions = new Map();     // sessionId -> session
const threadIndex = new Map();  // threadId -> sessionId
const subThreadIndex = new Map(); // sub-agent threadId -> { sessionId, name } (parent session + nickname)
let wired = false;

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Start (or resume) a thread and run one turn / slash command to completion. */
export async function runAppServerCommand(config) {
  const sessionId = config.sessionId || `codex-${Date.now()}`;
  const onSessionEvent = typeof config.onSessionEvent === 'function' ? config.onSessionEvent : () => {};
  const client = getAppServerClient(appServerClientOptions(config));
  wire(client);

  const session = ensureSession(sessionId, { config, onSessionEvent });
  session.config = config;
  session.onSessionEvent = onSessionEvent;

  session.emit('session.started', {
    content: `Agent command started: ${config.command || 'codex app-server'}`,
    command: config.command,
    agentAlias: config.agentAlias,
    agentType: config.agentType || 'codex',
    taskDescription: config.taskDescription || config.command,
  });

  const content = typeof config.stdin === 'string' && config.stdin.length ? config.stdin
    : (config.taskDescription || '');

  let status = 'completed';
  try {
    try {
      await ensureThread(session, config);
    } catch (error) {
      throw new Error(`thread setup failed: ${error?.message || error}`, { cause: error });
    }
    if (content.trim()) {
      try {
        status = (await dispatchInput(session, content, config)) || 'completed';
      } catch (error) {
        throw new Error(`turn dispatch failed: ${error?.message || error}`, { cause: error });
      }
    }
  } catch (error) {
    session.emit('session.error', { content: String(error?.message || error), source: SRC, level: 'error' });
    status = 'failed';
  }
  const completion = completionPayload(status, session.threadId);
  // app-server threads are persistent: a finished turn leaves the session live & continuable ("idle").
  // Aborted/failed turns still fall through to paused.
  if (completion.success) completion.idle = true;
  session.emit('session.complete', completion);
  return {
    sessionId,
    uploaded: session.uploaded,
    status,
    success: completion.success,
  };
}

/**
 * If a turn is currently active for the session, steer it (inject the input mid-turn) and return
 * true. Otherwise return false so the caller starts a fresh turn via runAppServerCommand (which owns
 * the command.running/command.result lifecycle envelope in command-channel).
 */
export async function steerActiveTurn(sessionId, content, onSessionEvent, options = {}) {
  const session = sessions.get(sessionId);
  if (!session || !session.currentTurnId || !session.turnWaiter) return false;
  if (onSessionEvent) session.onSessionEvent = onSessionEvent;
  if (options.emitUserMessage !== false) {
    session.emit('session.user_message', { content, source: 'agent-bridge-ui' });
  }
  await steer(session, content);
  return true;
}

/** turn/interrupt the active turn. */
export function stopAppServerCommand(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.threadId || !session.currentTurnId) return false;
  getAppServerClient().request('turn/interrupt', { threadId: session.threadId, turnId: session.currentTurnId })
    .catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// message queue: hold user inputs while a turn is active, run them serially
// ---------------------------------------------------------------------------

/** Append a user input to the session's queue. Returns the current queue snapshot for display. */
export function enqueueSessionInput(sessionId, item) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.queuedInputs.push(item);
  return queuedInputsSnapshot(sessionId);
}

/** Remove and return the next queued input (FIFO), or null when the queue is empty. */
export function takeNextQueuedInput(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.queuedInputs.length) return null;
  return session.queuedInputs.shift();
}

/**
 * Flush-all-on-stop: collapse the whole queue into a single merged input so the normal
 * finally-flush picks it up as ONE turn. Returns the merged item (or null if the queue was empty).
 */
export function collapseQueuedInputs(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.queuedInputs.length) return null;
  const items = session.queuedInputs.splice(0);
  const merged = {
    id: `merged-${items[0].id}`,
    content: items.map((i) => i.content).filter(Boolean).join('\n\n'),
    message: items[items.length - 1].message,
    commandId: null, // internal flush: no 1:1 command lifecycle
  };
  session.queuedInputs.push(merged);
  return merged;
}

export function hasQueuedInput(sessionId) {
  const session = sessions.get(sessionId);
  return !!session && session.queuedInputs.length > 0;
}

/** Compact queue snapshot for the web's "排队中" display: [{ id, preview }]. */
export function queuedInputsSnapshot(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.queuedInputs.map((item) => ({ id: item.id, preview: String(item.content || '').slice(0, 200) }));
}

/** Respond to a held approval / request_user_input server-request with the human decision from the web. */
export function decideAppServerApproval(sessionId, payload) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const key = String(payload?.requestId ?? '');
  const requestId = session.pendingApprovals.get(key);
  if (requestId == null) return false;
  session.pendingApprovals.delete(key);

  // request_user_input answers: respond {answers} instead of {decision}. Missing question ids count
  // as skipped (the server treats them as unanswered).
  if (payload?.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)) {
    const answers = {};
    for (const [questionId, values] of Object.entries(payload.answers)) {
      const list = (Array.isArray(values) ? values : [values]).filter((v) => typeof v === 'string' && v.trim());
      if (list.length) answers[questionId] = { answers: list };
    }
    const ok = getAppServerClient().respondToServerRequest(requestId, { answers });
    session.emit('authorization.decision', {
      content: (typeof payload.answersText === 'string' && payload.answersText.trim()) || (Object.keys(answers).length ? '已提交回答' : '已跳过提问'),
      source: 'agent-bridge-ui',
      level: 'info',
      allow: true,
      toolName: 'request_user_input',
      requestId: key,
      metadata: { eventType: 'authorization.decision', decision: 'userInput', approvalRequestId: requestId, answers },
    });
    return ok;
  }

  const decision = decisionFromPayload(payload);
  const ok = getAppServerClient().respondToServerRequest(requestId, { decision });
  session.emit('authorization.decision', {
    content: `Authorization ${decision}`,
    source: 'agent-bridge-ui',
    level: decision === 'decline' ? 'warn' : 'info',
    allow: decision !== 'decline',
    scope: payload?.scope,
    toolName: payload?.toolName,
    requestId: key,
    metadata: { eventType: 'authorization.decision', decision, approvalRequestId: requestId },
  });
  return ok;
}

export function hasAppServerSession(sessionId) { return sessions.has(sessionId); }

export async function probeAppServerSessions(config, candidates = []) {
  const client = getAppServerClient(appServerClientOptions(config));
  await client.ensureStarted();
  const loaded = await loadedThreadIds(client);
  const results = [];
  for (const candidate of candidates) {
    const sessionId = String(candidate.sessionId || '').trim();
    const cliSessionId = String(candidate.cliSessionId || '').trim();
    if (!sessionId || !cliSessionId) continue;
    if (loaded.has(cliSessionId)) {
      results.push({ sessionId, cliSessionId, state: 'loaded_active' });
      continue;
    }
    try {
      await client.request('thread/read', { threadId: cliSessionId }, 30_000);
      results.push({ sessionId, cliSessionId, state: 'persisted_idle' });
    } catch (error) {
      // 只有 app-server 明确答复该 thread 读取失败才算 missing。超时、传输失败或方法不存在
      // （-32601，旧版 codex）说明探测本身失败：跳过该会话，避免把可恢复会话误标“不可恢复”。
      if (error.isRpcError && error.rpcCode !== -32601) {
        results.push({ sessionId, cliSessionId, state: 'missing', error: error.message });
      }
    }
  }
  return results;
}

export async function listLoadedAppServerThreadIds(config) {
  const client = getAppServerClient(appServerClientOptions(config));
  await client.ensureStarted();
  return Array.from(await loadedThreadIds(client));
}

function appServerClientOptions(config) {
  const appServerCommand = normalizeAppServerCommand(config.command);
  return {
    command: config.appServerCommand || appServerCommand.command,
    args: Array.isArray(config.appServerArgs) && config.appServerArgs.length ? config.appServerArgs : appServerCommand.args,
    cwd: config.workspace,
    env: config.agentEnv,
    transport: deriveAppServerTransport(config),
    socketPath: config.appServerSocketPath,
  };
}

export function normalizeAppServerCommand(command) {
  const parts = String(command || 'codex').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { command: 'codex', args: undefined };
  return {
    command: parts[0],
    args: parts.length > 1 ? parts.slice(1) : undefined,
  };
}

async function loadedThreadIds(client) {
  try {
    const result = await client.request('thread/loaded/list', {}, 30_000);
    const threads = Array.isArray(result?.threads) ? result.threads
      : Array.isArray(result?.threadIds) ? result.threadIds
        : Array.isArray(result) ? result
          : [];
    return new Set(threads.flatMap((thread) => {
      if (typeof thread === 'string') return [thread];
      if (thread && typeof thread.id === 'string') return [thread.id];
      if (thread && typeof thread.threadId === 'string') return [thread.threadId];
      return [];
    }));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// client wiring: notifications + server requests routed by threadId to sessions
// ---------------------------------------------------------------------------

function wire(client) {
  if (wired) return;
  wired = true;
  client.onNotify(onNotify);
  client.onServerRequest(onServerRequest);
  client.onClose(() => {
    for (const session of sessions.values()) {
      session.threadReady = false;
      session.currentTurnId = null;
      rejectTurn(session, new Error('app-server connection closed'));
    }
  });
}

function onNotify(msg) {
  const threadId = msg.params?.threadId;
  const session = sessionForThread(threadId);
  if (session) {
    registerCollabAgents(session, msg);
    if (msg.method === 'turn/started') {
      session.currentTurnId = msg.params?.turn?.id ?? session.currentTurnId;
    }
    for (const frame of mapMessage(msg, session.mapperState)) session.emit(frame.kind, frame.payload);
    if (msg.method === 'turn/completed') {
      session.currentTurnId = null;
      resolveTurn(session, msg.params?.turn?.status);
    }
    return;
  }
  // Sub-agent thread events arrive on the same connection (app-server auto-attaches a listener to
  // spawned threads) tagged with the CHILD threadId. They ride the parent session stream marked
  // with payload.subAgent so the web can group them into the per-agent sheet, and they must never
  // touch the parent's turn control state (currentTurnId / turnWaiter).
  const sub = subThreadIndex.get(threadId);
  const parent = sub ? sessions.get(sub.sessionId) : null;
  if (!parent) return;
  const tag = { threadId, ...(sub.name ? { name: sub.name } : {}) };
  for (const frame of mapMessage(msg, parent.mapperState)) {
    // session.error would flip the PARENT session to paused (store sessionStatusFromEvent); a
    // sub-agent failure is its own business — keep the error payload but ride a neutral kind.
    const kind = frame.kind === 'session.error' ? 'session.status' : frame.kind;
    parent.emit(kind, { ...frame.payload, subAgent: tag });
  }
  if (msg.method === 'turn/completed') {
    parent.emit('session.status', {
      content: `子代理 ${sub.name || shortThreadId(threadId)} 回合结束（${msg.params?.turn?.status || 'completed'}）`,
      source: SRC, level: 'debug', subAgent: tag,
      metadata: { eventType: 'collab.turn_completed', threadId, status: msg.params?.turn?.status ?? null },
    });
  }
}

/** Learn spawned sub-agent thread ids from parent-side collab / subAgentActivity items. */
function registerCollabAgents(session, msg) {
  if (msg.method !== 'item/started' && msg.method !== 'item/completed') return;
  const item = msg.params?.item;
  const ids = item?.type === 'collabAgentToolCall' || item?.type === 'collabToolCall'
    ? collabReceiverThreadIds(item)
    : item?.type === 'subAgentActivity' && typeof item.agentThreadId === 'string' ? [item.agentThreadId]
      : [];
  for (const id of ids) {
    if (!id || id === session.threadId || subThreadIndex.has(id) || threadIndex.has(id)) continue;
    const sub = { sessionId: session.sessionId, name: null };
    subThreadIndex.set(id, sub);
    resolveAgentNickname(session, id, sub);
  }
}

// Nicknames (e.g. "Nietzsche") are server-generated and live on the Thread object, not on the collab
// item — fetch best-effort via thread/read (doesn't load/subscribe the thread). The read races the
// child rollout hitting disk at spawn time, so retry with backoff; the registration frame is emitted
// immediately (unnamed) and re-emitted once the nickname resolves so the web registry can upgrade it.
async function resolveAgentNickname(session, threadId, sub) {
  const read = async () => {
    try {
      const res = await getAppServerClient().request('thread/read', { threadId }, 30_000);
      return res?.thread?.agentNickname || res?.thread?.name || null;
    } catch { return null; }
  };
  const emitRegistration = () => session.emit('session.status', {
    content: `子代理 ${sub.name || shortThreadId(threadId)} 已创建`,
    source: SRC, level: 'info',
    subAgent: { threadId, ...(sub.name ? { name: sub.name } : {}) },
    metadata: { eventType: 'collab.agent', threadId, name: sub.name, parentThreadId: session.threadId },
  });
  sub.name = await read();
  emitRegistration();
  for (let attempt = 1; !sub.name && attempt <= 3; attempt++) {
    await delay(1_500 * attempt);
    sub.name = await read();
    if (sub.name) emitRegistration();
  }
}

function shortThreadId(threadId) { return String(threadId || '').slice(0, 8); }

function onServerRequest(msg) {
  const client = getAppServerClient();
  const threadId = msg.params?.threadId;
  const sub = subThreadIndex.get(threadId);
  const session = sessionForThread(threadId) || (sub ? sessions.get(sub.sessionId) : null);
  const isHumanRequest = msg.method === 'item/commandExecution/requestApproval'
    || msg.method === 'item/fileChange/requestApproval'
    || msg.method === 'item/tool/requestUserInput';
  const frames = session && isHumanRequest ? mapMessage(msg, session.mapperState) : [];
  if (!session || frames.length === 0) {
    // Not a human request we model (e.g. dynamic tool call): fail closed so the turn does not hang
    // forever. For request_user_input the server falls back to submitting empty answers.
    client.errorToServerRequest(msg.id, `unsupported server request: ${msg.method}`);
    return;
  }
  session.pendingApprovals.set(String(msg.id), msg.id);
  for (const frame of frames) {
    // Sub-agent approvals stay untagged at the top level so the web keeps them in the main flow
    // (blocking panel); the nested context only labels the card ("来自子代理 …").
    if (sub) frame.payload.metadata = { ...frame.payload.metadata, subAgentContext: { threadId, name: sub.name } };
    session.emit(frame.kind, frame.payload);
  }
}

// ---------------------------------------------------------------------------
// thread lifecycle
// ---------------------------------------------------------------------------

async function ensureThread(session, config) {
  const client = getAppServerClient();
  await client.ensureStarted();
  if (session.threadId && session.threadReady) return;
  if (session.threadId) { // known thread but not live in the current child -> resume from disk rollout
    const res = await client.request('thread/resume', threadResumeParams(session.threadId, config));
    bindThread(session, threadIdFromResult(res) || session.threadId);
    return;
  }
  const known = typeof config.cliSessionId === 'string' && config.cliSessionId.trim() ? config.cliSessionId.trim() : null;
  if (known) {
    try {
      const res = await client.request('thread/resume', threadResumeParams(known, config));
      bindThread(session, threadIdFromResult(res) || known);
      return;
    } catch (error) {
      if (config.allowCreateThread !== true) {
        throw new Error(`本地 Codex 会话不可恢复：${error.message}`);
      }
    }
  }
  if (config.allowCreateThread === false) {
    throw new Error('本地 Codex 会话不可恢复，且当前命令不允许创建新 thread');
  }
  const res = await client.request('thread/start', threadStartParams(config));
  bindThread(session, threadIdFromResult(res));
}

export function threadStartParams(config) {
  const params = {
    cwd: config.workspace,
    approvalPolicy: config.appServerApprovalPolicy || 'on-request',
    sandbox: config.appServerSandbox || 'workspace-write',
  };
  if (config.appServerModel) params.model = config.appServerModel;
  if (config.appServerDeveloperInstructions) params.developerInstructions = config.appServerDeveloperInstructions;
  return params;
}

export function threadResumeParams(threadId, config) {
  const params = { threadId, cwd: config.workspace };
  if (config.appServerDeveloperInstructions) params.developerInstructions = config.appServerDeveloperInstructions;
  return params;
}

// Per-turn overrides for model / reasoning effort / approval / sandbox. turn/start overrides "become
// the defaults for later turns", so this is the authoritative path: thread/start settings freeze after
// the first turn and turn/steer ignores overrides. `effort` is only valid on turn/start, and the
// sandbox here uses the object `sandboxPolicy` form (thread/start takes a plain string instead).
export function turnOverrides(config, { defaultModel } = {}) {
  const out = {};
  if (!config) return out;
  if (config.appServerModel) out.model = config.appServerModel;
  if (config.appServerReasoningEffort) out.effort = config.appServerReasoningEffort;
  if (config.appServerApprovalPolicy) out.approvalPolicy = config.appServerApprovalPolicy;
  if (config.appServerSandbox) out.sandboxPolicy = toSandboxObject(config.appServerSandbox, config.workspace);
  // Plan/default collaboration mode is a persistent thread setting: sending {mode:'plan'} keeps every
  // later turn in plan mode until an explicit {mode:'default'} exits it. settings.model is required by
  // the wire schema; developer_instructions:null tells the server to inject its builtin mode template.
  const mode = collaborationModeKind(config.appServerCollaborationMode);
  if (mode) {
    const model = config.appServerModel || defaultModel;
    if (model) {
      out.collaborationMode = {
        mode,
        settings: {
          model,
          reasoning_effort: config.appServerReasoningEffort || null,
          developer_instructions: null,
        },
      };
    }
  }
  return out;
}

export function collaborationModeKind(value) {
  return value === 'plan' || value === 'default' ? value : null;
}

export function toSandboxObject(sandbox, cwd) {
  switch (sandbox) {
    case 'read-only':
    case 'readOnly':
      return { type: 'readOnly' };
    case 'danger-full-access':
    case 'dangerFullAccess':
      return { type: 'dangerFullAccess' };
    case 'workspace-write':
    case 'workspaceWrite':
    default:
      return { type: 'workspaceWrite', writableRoots: cwd ? [cwd] : [], networkAccess: true };
  }
}

function bindThread(session, threadId) {
  if (!threadId) throw new Error('thread/start returned no thread id');
  if (session.threadId && session.threadId !== threadId) threadIndex.delete(session.threadId);
  session.threadId = threadId;
  session.threadReady = true;
  threadIndex.set(threadId, session.sessionId);
}

// ---------------------------------------------------------------------------
// input dispatch: turns, steer, and slash commands
// ---------------------------------------------------------------------------

async function dispatchInput(session, content, config) {
  const parsed = parseInput(content);
  const client = getAppServerClient();
  switch (parsed.kind) {
    case 'compact':
      session.emit('session.status', { content: 'Compacting context…', source: SRC, level: 'info' });
      await client.request('thread/compact/start', { threadId: session.threadId });
      return 'completed';
    case 'review':
      return startTurn(session, { review: parsed.instructions });
    case 'goal':
      await runGoal(session, parsed.rest);
      return 'completed';
    case 'fork': {
      const res = await client.request('thread/fork', { threadId: session.threadId });
      const forked = threadIdFromResult(res);
      session.emit('session.status', { content: `Forked thread → ${forked || '(unknown)'}`, source: SRC, level: 'info', metadata: { eventType: 'thread/fork', forkedThreadId: forked } });
      return 'completed';
    }
    case 'rollback':
      await client.request('thread/rollback', { threadId: session.threadId, numTurns: parsed.numTurns });
      session.emit('session.status', { content: `Rolled back ${parsed.numTurns} turn(s).`, source: SRC, level: 'info', metadata: { eventType: 'thread/rollback' } });
      return 'completed';
    case 'shell':
      await runShell(session, parsed.command);
      return 'completed';
    case 'model':
      await runModelList(session);
      return 'completed';
    case 'skills':
      await runSkillsList(session, config);
      return 'completed';
    case 'skill':
      return startTurn(session, { skill: parsed, config });
    default:
      return startTurn(session, { text: content });
  }
}

/** Start a turn (text | skill | review) and await its completion; returns the TurnStatus. */
async function startTurn(session, { text, skill, review, config }) {
  const client = getAppServerClient();
  const waiter = deferred();
  session.turnWaiter = waiter;
  let res;
  if (review !== undefined) {
    const target = review ? { type: 'custom', instructions: review } : { type: 'uncommittedChanges' };
    session.emit('session.status', { content: `Starting review (${review ? 'custom' : 'uncommitted changes'})…`, source: SRC, level: 'info' });
    res = await client.request('review/start', { threadId: session.threadId, target, delivery: 'inline' });
  } else {
    const input = skill ? await skillInput(session, skill, config) : [{ type: 'text', text: text ?? '' }];
    const defaultModel = collaborationModeKind(session.config?.appServerCollaborationMode) && !session.config?.appServerModel
      ? await resolveDefaultModelId()
      : undefined;
    res = await client.request('turn/start', { threadId: session.threadId, input, ...turnOverrides(session.config, { defaultModel }) });
  }
  session.currentTurnId = turnIdFromResult(res) || session.currentTurnId;
  return waiter.promise; // resolved (with TurnStatus) by onNotify on turn/completed
}

async function steer(session, content) {
  await getAppServerClient().request('turn/steer', {
    threadId: session.threadId,
    expectedTurnId: session.currentTurnId,
    input: [{ type: 'text', text: content }],
  });
}

async function runGoal(session, rest) {
  const client = getAppServerClient();
  if (!rest) {
    const res = await client.request('thread/goal/get', { threadId: session.threadId });
    const objective = res?.goal?.objective ?? res?.objective ?? null;
    session.emit('session.status', { content: `Current goal: ${objective || '(none)'}`, source: SRC, level: 'info', metadata: { eventType: 'thread/goal/get' } });
    return;
  }
  if (rest.toLowerCase() === 'clear') {
    await client.request('thread/goal/clear', { threadId: session.threadId });
    session.emit('session.status', { content: 'Goal cleared.', source: SRC, level: 'info', metadata: { eventType: 'thread/goal/clear' } });
    return;
  }
  await client.request('thread/goal/set', { threadId: session.threadId, objective: rest });
  session.emit('session.status', { content: `Goal set: ${rest}`, source: SRC, level: 'info', metadata: { eventType: 'thread/goal/set' } });
}

async function runShell(session, command) {
  if (!command) { session.emit('session.status', { content: 'Empty shell command.', source: SRC, level: 'warn' }); return; }
  session.emit('session.tool_use', { content: command, source: SRC, toolName: 'shell', metadata: { eventType: 'thread/shellCommand' } });
  const res = await getAppServerClient().request('thread/shellCommand', { threadId: session.threadId, command });
  const out = res?.output ?? res?.aggregatedOutput ?? res?.stdout ?? '';
  const exitCode = res?.exitCode ?? res?.exit_code ?? null;
  session.emit('session.tool_result', {
    content: typeof out === 'string' ? out : safeJson(out),
    source: SRC, toolName: 'shell',
    level: exitCode ? 'error' : 'info',
    metadata: { eventType: 'thread/shellCommand', exitCode },
  });
}

// collaborationMode.settings.model is required on the wire; when the user picked no model, fall back
// to the server's default (isDefault entry from model/list). Cached: the child's catalog is static.
let cachedDefaultModelId;
async function resolveDefaultModelId() {
  if (cachedDefaultModelId !== undefined) return cachedDefaultModelId;
  try {
    const res = await getAppServerClient().call('model/list', {});
    const data = Array.isArray(res?.data) ? res.data : [];
    const entry = data.find((m) => m && m.isDefault) || data[0];
    cachedDefaultModelId = (entry && (entry.id || entry.model)) || null;
  } catch {
    cachedDefaultModelId = null;
  }
  return cachedDefaultModelId;
}

async function runModelList(session) {
  // .call (not .request): auto-starts the child so /model also works before the first turn.
  const res = await getAppServerClient().call('model/list', {});
  const models = (res?.data || []).map((m) => m.id || m.slug || m.name || m.model).filter(Boolean);
  session.emit('session.status', {
    content: `Available models:\n${models.map((m) => `- ${m}`).join('\n') || '(none)'}`,
    source: SRC, level: 'info', metadata: { eventType: 'model/list', models },
  });
}

async function runSkillsList(session, config) {
  const skills = await listSkills(config);
  const lines = skills.map((s) => `- /${s.name}${s.description ? ` — ${s.description}` : ''}`);
  session.emit('session.status', {
    content: `Available skills:\n${lines.join('\n') || '(none)'}`,
    source: SRC, level: 'info', metadata: { eventType: 'skills/list', skills: skills.map((s) => s.name) },
  });
}

/** Resolve a skill invocation (/<name> [args]) into turn/start input items. */
async function skillInput(session, parsed, config) {
  const skills = await listSkills(config);
  const match = skills.find((s) => String(s.name).toLowerCase() === parsed.name);
  if (!match) {
    // unknown slash command: fall back to sending the literal text so the model still sees it
    return [{ type: 'text', text: `/${parsed.name}${parsed.rest ? ` ${parsed.rest}` : ''}` }];
  }
  const input = [{ type: 'skill', name: match.name, path: match.path }];
  if (parsed.rest) input.push({ type: 'text', text: parsed.rest });
  session.emit('session.status', { content: `Running skill: ${match.name}`, source: SRC, level: 'info', metadata: { eventType: 'skill/run', skill: match.name } });
  return input;
}

/** Discover workspace skills for upstream reporting (runner capabilities -> web slash palette). */
export async function discoverAppServerSkills(config) {
  const skills = await listSkills(config);
  return skills
    .filter((skill) => skill && typeof skill.name === 'string' && skill.name.trim())
    .slice(0, 100)
    .map((skill) => ({
      name: skill.name.trim(),
      ...(typeof skill.description === 'string' && skill.description.trim() ? { description: skill.description.trim() } : {}),
    }));
}

/** Discover selectable models for upstream reporting (runner capabilities -> web model picker). */
export async function discoverAppServerModels(config) {
  const res = await getAppServerClient(appServerClientOptions(config || {})).call('model/list', {});
  return normalizeModelList(res?.data);
}

/**
 * Resolve the effective default model from a raw model/list catalog plus the configured config.model,
 * mirroring codex core get_default_model: an explicit config.toml `model` wins, otherwise the catalog
 * entry flagged `isDefault`. Returns `{ id, label? }` or null when neither yields an id.
 */
export function resolveDefaultModel(rawModels, configModel) {
  const raw = Array.isArray(rawModels) ? rawModels : [];
  const configured = typeof configModel === 'string' && configModel.trim() ? configModel.trim() : null;
  const catalogDefault = raw.find((m) => m && typeof m === 'object' && m.isDefault === true);
  const effectiveId = configured || (catalogDefault ? (catalogDefault.id || catalogDefault.model) : null);
  if (!effectiveId) return null;
  const match = raw.find((m) => m && typeof m === 'object' && (m.id === effectiveId || m.model === effectiveId));
  const label = match && typeof match.displayName === 'string' && match.displayName.trim()
    ? match.displayName.trim()
    : undefined;
  return { id: String(effectiveId), ...(label ? { label } : {}) };
}

/**
 * Discover the runner's effective default model so the web can show
 * the concrete model instead of a generic「默认」. Best-effort — any failure resolves to null and the
 * web simply omits the concrete name (config/read is optional; falls back to the catalog default).
 */
export async function discoverAppServerDefaultModel(config) {
  const client = getAppServerClient(appServerClientOptions(config || {}));
  const [modelsRes, configRes] = await Promise.all([
    client.call('model/list', {}),
    client.call('config/read', { includeLayers: false }).catch(() => null),
  ]);
  return resolveDefaultModel(modelsRes?.data, configRes?.config?.model);
}

/** Map raw model/list entries to the web's AgentModelOption shape ({id, label?, description?, efforts?, defaultEffort?}). */
export function normalizeModelList(data) {
  return (Array.isArray(data) ? data : [])
    .filter((m) => m && typeof m === 'object' && !m.hidden && (typeof m.id === 'string' || typeof m.model === 'string'))
    .slice(0, 20)
    .map((m) => {
      const efforts = (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
        .map((e) => (typeof e === 'string' ? e : e?.reasoningEffort))
        .filter((e) => typeof e === 'string' && e);
      return {
        id: m.id || m.model,
        ...(typeof m.displayName === 'string' && m.displayName ? { label: m.displayName } : {}),
        ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
        ...(efforts.length > 0 ? { efforts } : {}),
        ...(typeof m.defaultReasoningEffort === 'string' && m.defaultReasoningEffort ? { defaultEffort: m.defaultReasoningEffort } : {}),
      };
    });
}

async function listSkills(config) {
  // .call (not .request): auto-starts the app-server child, so skills discovery also works
  // before the first turn (worker startup reporting).
  const res = await getAppServerClient({ cwd: config?.workspace, env: config?.agentEnv }).call('skills/list', {
    cwds: config?.workspace ? [config.workspace] : [],
    forceReload: false,
  });
  const out = [];
  for (const entry of res?.data || []) for (const skill of entry.skills || []) out.push(skill);
  return out;
}

// ---------------------------------------------------------------------------
// parsing + helpers
// ---------------------------------------------------------------------------

/** Classify a user input string: shell (! or /shell), a known slash command, a skill, or plain text. */
export function parseInput(raw) {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  if (trimmed.startsWith('!')) return { kind: 'shell', command: trimmed.slice(1).trim() };
  if (!trimmed.startsWith('/')) return { kind: 'turn', input: text };
  const m = trimmed.match(/^\/(\S+)\s*([\s\S]*)$/);
  const name = (m?.[1] || '').toLowerCase();
  const rest = (m?.[2] || '').trim();
  switch (name) {
    case 'compact': return { kind: 'compact' };
    case 'review': return { kind: 'review', instructions: rest };
    case 'goal': return { kind: 'goal', rest };
    case 'fork': return { kind: 'fork' };
    case 'rollback': return { kind: 'rollback', numTurns: Math.max(1, parseInt(rest, 10) || 1) };
    case 'shell': case 'sh': case 'bash': return { kind: 'shell', command: rest };
    case 'model': case 'models': return { kind: 'model' };
    case 'skills': return { kind: 'skills' };
    default: return { kind: 'skill', name, rest }; // treat any other /<name> as a skill invocation
  }
}

function decisionFromPayload(p) {
  if (!p || p.allow === false) return 'decline';
  if (p.scope === 'remember' || p.scope === 'session' || p.scope === 'always') return 'acceptForSession';
  return 'accept';
}

function ensureSession(sessionId, { config, onSessionEvent }) {
  let session = sessions.get(sessionId);
  if (session) return session;
  session = {
    sessionId, threadId: null, threadReady: false, currentTurnId: null,
    config, onSessionEvent,
    // Per-session FIFO of user inputs received while a turn was active. Drained one-at-a-time as fresh
    // turns after each turn completes (serial execution). See enqueueSessionInput / takeNextQueuedInput.
    queuedInputs: [],
    pendingApprovals: new Map(), turnWaiter: null, uploaded: 0, mapperState: createAppServerMapperState(),
    emit(kind, payload) {
      this.uploaded++;
      const withCli = { ...payload };
      if (this.threadId && withCli.cliSessionId === undefined) withCli.cliSessionId = this.threadId;
      try { Promise.resolve(this.onSessionEvent({ sessionId: this.sessionId, kind, payload: withCli })).catch(() => {}); } catch {}
    },
  };
  sessions.set(sessionId, session);
  return session;
}

function sessionForThread(threadId) {
  if (!threadId) return null;
  const sessionId = threadIndex.get(threadId);
  return sessionId ? sessions.get(sessionId) : null;
}

function resolveTurn(session, status) {
  const w = session.turnWaiter; session.turnWaiter = null;
  if (w) w.resolve(status);
}
function rejectTurn(session, error) {
  const w = session.turnWaiter; session.turnWaiter = null;
  if (w) w.reject(error);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function safeJson(v) { try { return JSON.stringify(v ?? {}); } catch { return String(v); } }

/** Test hook: drop all in-memory session state. */
export function _resetAppServerSessions() { sessions.clear(); threadIndex.clear(); subThreadIndex.clear(); wired = false; cachedDefaultModelId = undefined; }
