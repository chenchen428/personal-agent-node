// Translate codex `app-server` v2 messages into Agent Bridge `session.delta` frames.
//
// The app-server v2 protocol uses slash methods, camelCase item types, and item data in
// `params.item`, so this mapper keeps the Agent Bridge `session.delta` contract explicit.
//
// Wire facts (verified against `codex app-server generate-json-schema`, codex 0.142.5):
//   notifications: `item/started` | `item/completed` params = {item, threadId, turnId, ...};
//     item.type is camelCase (userMessage, agentMessage, reasoning, commandExecution, mcpToolCall,
//     fileChange, plan, webSearch, contextCompaction, ...); commandExecution fields are
//     aggregatedOutput/exitCode/status (camelCase).
//   `turn/completed` params = {threadId, turn:{status}}; TurnStatus ∈ completed|interrupted|failed|inProgress.
//   `error` params = {error, threadId, turnId, willRetry}. `thread/compacted` params = {threadId, turnId}.
//   approval is a server→client REQUEST (`item/commandExecution/requestApproval` |
//     `item/fileChange/requestApproval`), answered with {id, result:{decision}}.
//
// Output payload:
//   { content, role?, source, level?, toolName?, metadata, cliSessionId? }.

const SRC = 'agent-bridge-appserver';

export function createAppServerMapperState() {
  return { agentMessageTextByKey: new Map() };
}

/** Map one incoming app-server message to zero or more session.delta frames. */
export function mapMessage(msg, state = null) {
  if (!msg || typeof msg !== 'object') return [];
  const method = msg.method;
  if (!method) return []; // JSON-RPC responses are handled by the transport layer, not here.

  // --- server -> client approval REQUEST (has both method and id) ---
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    const p = msg.params || {};
    const isCmd = method.includes('commandExecution');
    return [{
      kind: 'authorization.request',
      payload: {
        content: isCmd && p.command ? `Approve command: ${p.command}` : `Approve ${isCmd ? 'command' : 'file change'}`,
        source: SRC,
        level: 'warn',
        toolName: isCmd ? 'Bash' : 'apply_patch',
        // requestId MUST be top-level AND a string: store.ts spreads payload into message.metadata,
        // and the web (session-detail-client.tsx) both reads `message.metadata.requestId` to route the
        // decision back AND gates the "already resolved" check on `typeof requestId === 'string'` — a
        // numeric id would leave the approval card stuck on screen after the decision.
        requestId: String(msg.id),
        metadata: {
          eventType: 'authorization.request',
          approvalRequestId: msg.id,
          approvalId: p.approvalId ?? null,
          approvalKind: isCmd ? 'commandExecution' : 'fileChange',
          itemId: p.itemId, turnId: p.turnId, threadId: p.threadId,
          command: p.command ?? null,
        },
      },
    }];
  }

  // --- server -> client request_user_input REQUEST (plan mode asks 1-3 structured questions) ---
  // Reuses the authorization.request/authorization.decide envelope end-to-end: same held-request pool
  // worker-side, same pending-card resolution web-side. metadata.questions marks it as a Q&A card.
  if (method === 'item/tool/requestUserInput') {
    const p = msg.params || {};
    const questions = normalizeUserInputQuestions(p.questions);
    if (!questions.length) return [];
    return [{
      kind: 'authorization.request',
      payload: {
        content: questions.map((q) => q.question).join('\n'),
        source: SRC,
        level: 'warn',
        toolName: 'request_user_input',
        requestId: String(msg.id),
        metadata: {
          eventType: 'authorization.request',
          approvalRequestId: msg.id,
          approvalKind: 'userInput',
          itemId: p.itemId, turnId: p.turnId, threadId: p.threadId,
          questions,
        },
      },
    }];
  }

  // --- notifications ---
  // turn/completed is a CONTROL signal, not a frame: the runner watches it to resolve the in-flight
  // turn and emits exactly one session.complete per command. Mapping it
  // here too would double-emit when a slash command (e.g. /compact) runs a turn internally.
  if (method === 'turn/completed') return [];
  if (method === 'error') {
    const err = msg.params?.error;
    const text = (err && (err.message || err.reason)) || (typeof err === 'string' ? err : 'Agent error');
    return [{
      kind: 'session.error',
      payload: {
        content: String(text),
        source: SRC,
        level: 'error',
        metadata: { eventType: 'error', threadId: msg.params?.threadId, turnId: msg.params?.turnId, willRetry: msg.params?.willRetry === true },
      },
    }];
  }
  if (method === 'thread/compacted') {
    return [{
      kind: 'session.status',
      payload: {
        content: 'Context compacted.',
        source: SRC,
        level: 'info',
        metadata: { eventType: 'thread/compacted', threadId: msg.params?.threadId, turnId: msg.params?.turnId },
      },
    }];
  }
  if (method === 'item/started' || method === 'item/completed') {
    return mapItem(method, msg.params?.item || {}, msg.params || {}, state);
  }
  if (method === 'item/agentMessage/delta') return mapAgentMessageDelta(msg.params || {}, state);
  if (method === 'thread/tokenUsage/updated') {
    const params = msg.params || {};
    const tokenUsage = normalizeTokenUsage(params.tokenUsage);
    if (!params.threadId || !tokenUsage) return [];
    return [{
      kind: 'session.token_usage',
      payload: {
        content: '',
        source: SRC,
        threadId: params.threadId,
        turnId: params.turnId,
        tokenUsage,
        metadata: {
          eventType: method,
          threadId: params.threadId,
          turnId: params.turnId,
          tokenUsage,
        },
      },
    }];
  }
  // update_plan todo/checklist tool (any mode, not plan mode): full step list on every update.
  if (method === 'turn/plan/updated') {
    const steps = (Array.isArray(msg.params?.plan) ? msg.params.plan : [])
      .filter((s) => s && typeof s.step === 'string' && s.step)
      .map((s) => ({ step: s.step, status: s.status }));
    if (!steps.length) return [];
    return [{
      kind: 'session.status',
      payload: {
        content: steps.map((s) => `- ${s.step} [${s.status}]`).join('\n'),
        source: SRC,
        level: 'info',
        metadata: {
          eventType: 'turn/plan/updated',
          threadId: msg.params?.threadId,
          turnId: msg.params?.turnId,
          explanation: msg.params?.explanation ?? null,
          plan: steps,
        },
      },
    }];
  }
  // Collaboration mode is a persistent thread setting; surface changes so the web can restore the
  // plan-mode toggle after a reload. Rendered as a lightweight status line, not a chat bubble.
  if (method === 'thread/settings/updated') {
    const mode = msg.params?.threadSettings?.collaborationMode?.mode;
    if (mode !== 'plan' && mode !== 'default') return [];
    return [{
      kind: 'session.status',
      payload: {
        content: mode === 'plan' ? '已进入计划模式。' : '已退出计划模式。',
        source: SRC,
        level: 'info',
        metadata: { eventType: 'thread/settings/updated', threadId: msg.params?.threadId, collaborationMode: mode },
      },
    }];
  }
  // Summary/plan/diff deltas: still ignored. Agent text deltas are handled above and share the
  // completed item's persisted message id, so the final item overwrites the in-flight bubble.
  if (method.endsWith('/delta') || method.endsWith('Delta') || method.endsWith('/textDelta')) return [];
  // Everything else (thread/status/changed, hooks, realtime, moderation) is not part
  // of the session.delta contract and is intentionally dropped.
  return [];
}

function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    last: normalizeTokenBreakdown(value.last),
    total: normalizeTokenBreakdown(value.total),
    ...(finiteTokenCount(value.modelContextWindow, null) == null ? {} : { modelContextWindow: finiteTokenCount(value.modelContextWindow) }),
  };
}

function normalizeTokenBreakdown(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    cachedInputTokens: finiteTokenCount(input.cachedInputTokens),
    inputTokens: finiteTokenCount(input.inputTokens),
    outputTokens: finiteTokenCount(input.outputTokens),
    reasoningOutputTokens: finiteTokenCount(input.reasoningOutputTokens),
    totalTokens: finiteTokenCount(input.totalTokens),
  };
}

function finiteTokenCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function mapItem(method, item, params, state = null) {
  const completed = method === 'item/completed';
  const meta = (extra) => ({ eventType: method, itemId: item.id, threadId: params.threadId, turnId: params.turnId, ...extra });
  const frame = (kind, content, extra = {}) => ({ kind, payload: { content, source: SRC, ...extra, metadata: meta(extra.metadata) } });

  switch (item.type) {
    case 'userMessage': {
      // emit once, on completion (the item arrives as both item/started and item/completed).
      if (!completed) return [];
      const text = (item.content || []).filter(c => c && c.type === 'text').map(c => c.text).join('\n').trim();
      return text ? [frame('session.user_message', text)] : [];
    }
    case 'agentMessage': {
      const text = typeof item.text === 'string' ? item.text : '';
      if (!completed || !text) return [];
      const key = agentMessageKey(params.threadId, params.turnId, item.id);
      state?.agentMessageTextByKey?.delete(key);
      return [frame('session.assistant_message', text, {
        persistedMessageId: agentMessagePersistedMessageId(params.threadId, params.turnId, item.id),
        metadata: { streamState: 'completed' },
      })];
    }
    case 'reasoning': {
      const content = [...(item.summary || []), ...(item.content || [])].join('\n').trim();
      return completed && content ? [frame('session.reasoning', content, { level: 'debug' })] : [];
    }
    case 'plan': {
      // Plan-mode proposal (<proposed_plan> block parsed out of the agent reply): {id, text}, the
      // item/completed text is authoritative. itemType stays top-level so the web can render the
      // message as a plan card (message.metadata.itemType === 'plan').
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      return completed && text ? [frame('session.assistant_message', text, { itemType: 'plan' })] : [];
    }
    case 'commandExecution':
      if (!completed) return [frame('session.tool_use', item.command || '', { toolName: 'Bash' })];
      return [frame('session.tool_result', item.aggregatedOutput || '', {
        toolName: 'Bash', level: item.status === 'failed' ? 'error' : 'info',
        metadata: { exitCode: item.exitCode ?? null, status: item.status },
      })];
    case 'mcpToolCall': {
      const toolName = `mcp:${item.server || 'unknown'}.${item.tool || 'tool'}`;
      if (!completed) return [frame('session.tool_use', safeJson(item.arguments), { toolName })];
      const err = item.error?.message || item.error;
      return [frame('session.tool_result', err ? String(err) : safeJson(item.result), {
        toolName, level: err || item.status === 'failed' ? 'error' : 'info',
      })];
    }
    case 'fileChange': {
      if (!completed) return [frame('session.tool_use', `${(item.changes || []).length} file change(s)`, { toolName: 'apply_patch' })];
      // Per-file line counts feed the web's session-level "N 个文件 +X −Y" summary pill, and the
      // capped diff text feeds the file sheet's per-hunk rendering; both capped so a huge patch
      // can't bloat message metadata. On the wire `kind` is an object:
      // {type:'add'|'delete', content} | {type:'update', unifiedDiff, ...}.
      let diffBudget = DIFF_TOTAL_CHAR_CAP;
      const changes = (Array.isArray(item.changes) ? item.changes : []).slice(0, 50).map((change) => {
        const kind = change?.kind;
        const kindType = typeof kind === 'string' ? kind : (kind && typeof kind === 'object' ? kind.type ?? null : null);
        const entry = {
          path: typeof change?.path === 'string' ? change.path : '',
          kind: kindType,
          ...changeLineCounts(change),
        };
        const diff = changeDiffText(change);
        if (diff && diffBudget > 0) {
          const capped = diff.slice(0, Math.min(DIFF_FILE_CHAR_CAP, diffBudget));
          entry.diff = capped;
          if (capped.length < diff.length) entry.diffTruncated = true;
          diffBudget -= capped.length;
        }
        return entry;
      });
      return [frame('session.tool_result', `status=${item.status}`, {
        toolName: 'apply_patch', level: item.status === 'failed' ? 'error' : 'info',
        metadata: { status: item.status, changes },
      })];
    }
    case 'collabAgentToolCall':
    case 'collabToolCall': { // legacy singular-field variant kept for older codex builds
      const collab = normalizeCollabItem(item);
      // Emit on started AND completed: the web card flips 创建中→已创建, and receiverThreadIds /
      // agentsStates only populate on the completed item. itemType stays top-level (plan-item
      // precedent) so the web can branch on message.metadata.itemType.
      const label = collab.receiverThreadIds.length > 1 ? ` (${collab.receiverThreadIds.length} agents)` : '';
      return [frame(completed ? 'session.tool_result' : 'session.tool_use', `${collab.tool}${label}`, {
        toolName: 'collab',
        itemType: 'collabAgentToolCall',
        level: completed && collab.status === 'failed' ? 'error' : 'info',
        metadata: { collab },
      })];
    }
    case 'subAgentActivity':
      return []; // registration signal consumed by the runner from the raw notification
    case 'webSearch':
      return completed ? [frame('session.tool_result', item.query || item.action || '', { toolName: 'web_search' })] : [];
    case 'contextCompaction':
      return completed ? [frame('session.status', 'Context compacted.', { level: 'info' })] : [];
    default:
      return []; // unknown item types are dropped (not misrendered); deltas keep the stream lean.
  }
}

function safeJson(v) { try { return JSON.stringify(v ?? {}); } catch { return String(v); } }

function mapAgentMessageDelta(params, state) {
  const itemId = stringParam(params.itemId) || stringParam(params.item_id);
  const delta = typeof params.delta === 'string' ? params.delta : '';
  if (!itemId || !delta) return [];
  const key = agentMessageKey(params.threadId, params.turnId, itemId);
  const next = `${state?.agentMessageTextByKey?.get(key) || ''}${delta}`;
  state?.agentMessageTextByKey?.set(key, next);
  return [{
    kind: 'session.assistant_message',
    payload: {
      content: next,
      source: SRC,
      persistedMessageId: agentMessagePersistedMessageId(params.threadId, params.turnId, itemId),
      metadata: {
        eventType: 'item/agentMessage/delta',
        itemId,
        threadId: params.threadId,
        turnId: params.turnId,
        streamState: 'streaming',
      },
    },
  }];
}

function agentMessageKey(threadId, turnId, itemId) {
  return `${stringParam(threadId) || 'thread'}:${stringParam(turnId) || 'turn'}:${stringParam(itemId) || 'item'}`;
}

function agentMessagePersistedMessageId(threadId, turnId, itemId) {
  return `appserver-agent-message:${agentMessageKey(threadId, turnId, itemId)}`;
}

function stringParam(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Protocol allows 1-3 questions; caps are defensive so a misbehaving tool call can't bloat metadata.
function normalizeUserInputQuestions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((q) => q && typeof q === 'object' && typeof q.id === 'string' && typeof q.question === 'string' && q.question.trim())
    .slice(0, 4)
    .map((q) => ({
      id: q.id,
      header: typeof q.header === 'string' ? q.header.slice(0, 60) : '',
      question: q.question.slice(0, 500),
      isOther: q.isOther === true,
      isSecret: q.isSecret === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o) => o && typeof o.label === 'string' && o.label.trim())
        .slice(0, 6)
        .map((o) => ({
          label: o.label.slice(0, 120),
          description: typeof o.description === 'string' ? o.description.slice(0, 300) : '',
        })),
    }));
}

/** Child thread ids named by a collab item: receiverThreadIds[] (v2 wire) with legacy singular fallbacks. */
export function collabReceiverThreadIds(item) {
  const ids = Array.isArray(item?.receiverThreadIds) ? item.receiverThreadIds
    : [item?.newThreadId, item?.receiverThreadId];
  const states = item?.agentsStates && typeof item.agentsStates === 'object' ? Object.keys(item.agentsStates) : [];
  return [...new Set([...ids, ...states].filter((id) => typeof id === 'string' && id.trim()))];
}

// Caps are defensive: prompt/message text is model-generated and agentsStates is unbounded on the wire.
function normalizeCollabItem(item) {
  const agentsStates = {};
  const rawStates = item?.agentsStates && typeof item.agentsStates === 'object' ? item.agentsStates : {};
  for (const [threadId, state] of Object.entries(rawStates).slice(0, 16)) {
    agentsStates[threadId] = {
      status: typeof state?.status === 'string' ? state.status : null,
      ...(typeof state?.message === 'string' && state.message ? { message: state.message.slice(0, 300) } : {}),
    };
  }
  return {
    tool: typeof item?.tool === 'string' ? item.tool : 'unknown',
    status: typeof item?.status === 'string' ? item.status : null,
    senderThreadId: typeof item?.senderThreadId === 'string' ? item.senderThreadId : null,
    receiverThreadIds: collabReceiverThreadIds(item),
    prompt: typeof item?.prompt === 'string' && item.prompt ? item.prompt.slice(0, 2_000) : null,
    model: typeof item?.model === 'string' && item.model ? item.model : null,
    agentsStates,
  };
}

function diffLineCounts(diff) {
  if (typeof diff !== 'string' || !diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

const DIFF_FILE_CHAR_CAP = 4_000;
const DIFF_TOTAL_CHAR_CAP = 60_000;

// Diff text for a single change, normalized to +/- prefixed lines: updates carry a unified diff;
// add/delete kinds only carry raw content, so synthesize an all-added/all-removed pseudo-diff.
function changeDiffText(change) {
  if (typeof change?.diff === 'string' && change.diff) return change.diff;
  const kind = change?.kind;
  if (!kind || typeof kind !== 'object') return '';
  if (typeof kind.unifiedDiff === 'string' && kind.unifiedDiff) return kind.unifiedDiff;
  if (typeof kind.diff === 'string' && kind.diff) return kind.diff;
  if (typeof kind.content === 'string' && kind.content) {
    const prefix = kind.type === 'delete' ? '-' : '+';
    return kind.content.replace(/\n$/, '').split('\n').map((line) => prefix + line).join('\n');
  }
  return '';
}

function changeLineCounts(change) {
  if (typeof change?.diff === 'string' && change.diff) return diffLineCounts(change.diff);
  const kind = change?.kind;
  if (kind && typeof kind === 'object') {
    if (typeof kind.unifiedDiff === 'string' && kind.unifiedDiff) return diffLineCounts(kind.unifiedDiff);
    if (typeof kind.diff === 'string' && kind.diff) return diffLineCounts(kind.diff);
    if (typeof kind.content === 'string') {
      const lines = kind.content ? kind.content.replace(/\n$/, '').split('\n').length : 0;
      return kind.type === 'delete' ? { added: 0, removed: lines } : { added: lines, removed: 0 };
    }
  }
  return { added: 0, removed: 0 };
}

/** Extract the thread id (-> cliSessionId) from a thread/start | thread/resume RESPONSE result. */
export function threadIdFromResult(result) {
  return result && result.thread && typeof result.thread.id === 'string' ? result.thread.id : null;
}

/** Extract the turn id from a turn/start RESPONSE result (for steer/interrupt correlation). */
export function turnIdFromResult(result) {
  return result && result.turn && typeof result.turn.id === 'string' ? result.turn.id : null;
}

/**
 * Build the single session.complete payload from a TurnStatus (or a synthetic status for method
 * commands). store.ts sessionStatusFromEvent: aborted===true || success===false -> paused, else done.
 * TurnStatus ∈ completed | interrupted | failed | inProgress.
 */
export function completionPayload(status, threadId) {
  const success = status == null || status === 'completed';
  const aborted = status === 'interrupted';
  return {
    content: `Turn ${status ?? 'completed'}`,
    source: SRC,
    level: success ? 'info' : 'error',
    success,
    aborted,
    metadata: { eventType: 'turn/completed', status: status ?? 'completed', threadId },
  };
}
