// Unit tests for the app-server v2 -> session.delta mapper. Pure, no network/model.
// Run: node --test libs/cli/agent-bridge/test/app-server-mapper.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServerMapperState, mapMessage, threadIdFromResult, turnIdFromResult, completionPayload, collabReceiverThreadIds } from '../lib/app-server-mapper.mjs';

const SRC = 'agent-bridge-appserver';
// itemMsg builds an item/* notification with the real v2 params envelope.
const itemMsg = (method, item, extra = {}) => ({ method, params: { item, threadId: 'thr_1', turnId: 'turn_1', startedAtMs: 1, ...extra } });
const one = (msg, state) => { const f = mapMessage(msg, state); assert.equal(f.length, 1, `expected 1 frame, got ${f.length}`); return f[0]; };

test('userMessage -> session.user_message', () => {
  const f = one(itemMsg('item/completed', { type: 'userMessage', id: 'i1', content: [{ type: 'text', text: 'hello' }] }));
  assert.equal(f.kind, 'session.user_message');
  assert.equal(f.payload.content, 'hello');
  assert.equal(f.payload.source, SRC);
});

test('agentMessage completed -> assistant_message', () => {
  const f = one(itemMsg('item/completed', { type: 'agentMessage', id: 'i2', text: 'PONG' }));
  assert.equal(f.kind, 'session.assistant_message');
  assert.equal(f.payload.content, 'PONG');
  assert.equal(f.payload.persistedMessageId, 'appserver-agent-message:thr_1:turn_1:i2');
  assert.equal(f.payload.metadata.itemId, 'i2');
  assert.equal(f.payload.metadata.streamState, 'completed');
});

test('agentMessage started -> [] (only emit on completed)', () => {
  assert.deepEqual(mapMessage(itemMsg('item/started', { type: 'agentMessage', id: 'i2', text: '' })), []);
});

test('userMessage started -> [] (emit once on completed, no duplicate echo)', () => {
  assert.deepEqual(mapMessage(itemMsg('item/started', { type: 'userMessage', id: 'i1', content: [{ type: 'text', text: 'hello' }] })), []);
});

test('reasoning -> session.reasoning (debug)', () => {
  const f = one(itemMsg('item/completed', { type: 'reasoning', id: 'i3', summary: ['thinking'], content: ['deep'] }));
  assert.equal(f.kind, 'session.reasoning');
  assert.equal(f.payload.level, 'debug');
  assert.equal(f.payload.content, 'thinking\ndeep');
});

test('commandExecution started -> tool_use', () => {
  const f = one(itemMsg('item/started', { type: 'commandExecution', id: 'i4', command: 'printf OK', cwd: '/x', status: 'inProgress' }));
  assert.equal(f.kind, 'session.tool_use');
  assert.equal(f.payload.content, 'printf OK');
  assert.equal(f.payload.toolName, 'Bash');
});

test('commandExecution completed(ok) -> tool_result info + exitCode (camelCase)', () => {
  const f = one(itemMsg('item/completed', { type: 'commandExecution', id: 'i4', command: 'printf OK', status: 'completed', aggregatedOutput: 'OK', exitCode: 0 }));
  assert.equal(f.kind, 'session.tool_result');
  assert.equal(f.payload.content, 'OK');
  assert.equal(f.payload.level, 'info');
  assert.equal(f.payload.metadata.exitCode, 0);
  assert.equal(f.payload.toolName, 'Bash');
});

test('commandExecution completed(failed) -> tool_result error', () => {
  const f = one(itemMsg('item/completed', { type: 'commandExecution', id: 'i5', command: 'false', status: 'failed', aggregatedOutput: 'boom', exitCode: 1 }));
  assert.equal(f.payload.level, 'error');
  assert.equal(f.payload.metadata.exitCode, 1);
});

test('mcpToolCall completed -> tool_result mcp:server.tool', () => {
  const f = one(itemMsg('item/completed', { type: 'mcpToolCall', id: 'i6', server: 'gh', tool: 'list', arguments: {}, status: 'completed', result: { ok: true } }));
  assert.equal(f.payload.toolName, 'mcp:gh.list');
});

test('fileChange completed -> tool_result apply_patch', () => {
  const f = one(itemMsg('item/completed', { type: 'fileChange', id: 'i7', changes: [{ path: 'a', kind: 'add' }], status: 'completed' }));
  assert.equal(f.payload.toolName, 'apply_patch');
});

test('fileChange completed -> metadata.changes carries per-file diff line counts', () => {
  const diff = '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n-old line\n+new line\n+added line\n context';
  const f = one(itemMsg('item/completed', {
    type: 'fileChange',
    id: 'i7',
    changes: [{ path: 'a.ts', kind: 'update', diff }, { path: 'b.ts', kind: 'add' }],
    status: 'completed',
  }));
  assert.deepEqual(f.payload.metadata.changes, [
    { path: 'a.ts', kind: 'update', added: 2, removed: 1, diff },
    { path: 'b.ts', kind: 'add', added: 0, removed: 0 },
  ]);
});

test('fileChange kind objects ({type, content|unifiedDiff}) -> per-file counts', () => {
  const f = one(itemMsg('item/completed', {
    type: 'fileChange',
    id: 'i7',
    changes: [
      { path: '/ws/new.md', kind: { type: 'add', content: 'line1\nline2\nline3\n' } },
      { path: '/ws/mod.ts', kind: { type: 'update', unifiedDiff: '@@ -1 +1,2 @@\n-a\n+b\n+c' } },
      { path: '/ws/gone.ts', kind: { type: 'delete', content: 'x\ny\n' } },
    ],
    status: 'completed',
  }));
  assert.deepEqual(f.payload.metadata.changes, [
    { path: '/ws/new.md', kind: 'add', added: 3, removed: 0, diff: '+line1\n+line2\n+line3' },
    { path: '/ws/mod.ts', kind: 'update', added: 2, removed: 1, diff: '@@ -1 +1,2 @@\n-a\n+b\n+c' },
    { path: '/ws/gone.ts', kind: 'delete', added: 0, removed: 2, diff: '-x\n-y' },
  ]);
});

test('fileChange diff text is capped per file with diffTruncated flag', () => {
  const hugeDiff = `@@ -1 +1,2 @@\n${'+x'.repeat(5000)}`;
  const f = one(itemMsg('item/completed', {
    type: 'fileChange',
    id: 'i7',
    changes: [{ path: 'big.ts', kind: 'update', diff: hugeDiff }],
    status: 'completed',
  }));
  const [change] = f.payload.metadata.changes;
  assert.equal(change.diff.length, 4000);
  assert.equal(change.diffTruncated, true);
  assert.equal(change.diff, hugeDiff.slice(0, 4000));
});

test('plan item completed -> assistant_message flagged itemType plan', () => {
  const f = one(itemMsg('item/completed', { type: 'plan', id: 'i8', text: '## Plan\n1. do X\n2. do Y' }));
  assert.equal(f.kind, 'session.assistant_message');
  assert.equal(f.payload.content, '## Plan\n1. do X\n2. do Y');
  assert.equal(f.payload.itemType, 'plan');
});

test('turn/plan/updated -> session.status with structured plan metadata', () => {
  const f = one({
    method: 'turn/plan/updated',
    params: {
      threadId: 'thr_1',
      turnId: 'turn_1',
      explanation: 'need plan',
      plan: [
        { step: 'first', status: 'completed' },
        { step: 'second', status: 'inProgress' },
        { step: 'third', status: 'pending' },
      ],
    },
  });
  assert.equal(f.kind, 'session.status');
  assert.equal(f.payload.content, '- first [completed]\n- second [inProgress]\n- third [pending]');
  assert.equal(f.payload.metadata.eventType, 'turn/plan/updated');
  assert.equal(f.payload.metadata.explanation, 'need plan');
  assert.deepEqual(f.payload.metadata.plan, [
    { step: 'first', status: 'completed' },
    { step: 'second', status: 'inProgress' },
    { step: 'third', status: 'pending' },
  ]);
});

test('turn/plan/updated with empty or invalid plan -> []', () => {
  assert.deepEqual(mapMessage({ method: 'turn/plan/updated', params: { threadId: 'thr_1', turnId: 'turn_1', explanation: null, plan: [] } }), []);
  assert.deepEqual(mapMessage({ method: 'turn/plan/updated', params: { threadId: 'thr_1', turnId: 'turn_1', plan: [{ status: 'pending' }, null] } }), []);
});

test('thread/settings/updated -> session.status carrying collaborationMode (plan-mode restore signal)', () => {
  const f = one({ method: 'thread/settings/updated', params: { threadId: 'thr_1', threadSettings: { collaborationMode: { mode: 'plan', settings: { model: 'm' } } } } });
  assert.equal(f.kind, 'session.status');
  assert.equal(f.payload.metadata.eventType, 'thread/settings/updated');
  assert.equal(f.payload.metadata.collaborationMode, 'plan');
  const g = one({ method: 'thread/settings/updated', params: { threadId: 'thr_1', threadSettings: { collaborationMode: { mode: 'default', settings: { model: 'm' } } } } });
  assert.equal(g.payload.metadata.collaborationMode, 'default');
});

test('thread/settings/updated without a known collaborationMode -> []', () => {
  assert.deepEqual(mapMessage({ method: 'thread/settings/updated', params: { threadId: 'thr_1', threadSettings: { model: 'm' } } }), []);
});

test('item/tool/requestUserInput -> authorization.request carrying normalized questions', () => {
  const f = one({
    id: 55,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thr_1', turnId: 'turn_1', itemId: 'i10',
      questions: [{
        id: 'q1', header: '计划类型', question: '这个测试计划更想模拟哪类真实任务?', isOther: true, isSecret: false,
        options: [
          { label: '后端接口 (Recommended)', description: '会让计划更偏向 API、参数校验和单元测试。' },
          { label: '前端页面', description: '会让计划更偏向 UI 状态、交互和截图验证。' },
        ],
      }],
    },
  });
  assert.equal(f.kind, 'authorization.request');
  assert.equal(f.payload.requestId, '55'); // top-level STRING, same contract as approvals
  assert.equal(f.payload.toolName, 'request_user_input');
  assert.equal(f.payload.metadata.approvalKind, 'userInput');
  assert.equal(f.payload.metadata.questions.length, 1);
  assert.equal(f.payload.metadata.questions[0].id, 'q1');
  assert.equal(f.payload.metadata.questions[0].isOther, true);
  assert.equal(f.payload.metadata.questions[0].options.length, 2);
});

test('item/tool/requestUserInput without valid questions -> [] (runner fails the request closed)', () => {
  assert.deepEqual(mapMessage({ id: 56, method: 'item/tool/requestUserInput', params: { threadId: 'thr_1', questions: [] } }), []);
  assert.deepEqual(mapMessage({ id: 57, method: 'item/tool/requestUserInput', params: { threadId: 'thr_1', questions: [{ id: 'q', question: '' }] } }), []);
});

test('turn/completed -> [] (control signal owned by the runner, not a frame)', () => {
  assert.deepEqual(mapMessage({ method: 'turn/completed', params: { threadId: 'thr_1', turn: { id: 'turn_1', status: 'completed' } } }), []);
});

test('completionPayload(completed) -> success=true (=> done)', () => {
  const p = completionPayload('completed', 'thr_1');
  assert.equal(p.success, true);
  assert.equal(p.aborted, false);
});

test('completionPayload(interrupted) -> aborted=true (=> paused)', () => {
  const p = completionPayload('interrupted', 'thr_1');
  assert.equal(p.aborted, true);
  assert.equal(p.success, false);
});

test('completionPayload(failed) -> success=false, level=error (=> paused)', () => {
  const p = completionPayload('failed', 'thr_1');
  assert.equal(p.success, false);
  assert.equal(p.level, 'error');
});

test('error notification -> session.error', () => {
  const f = one({ method: 'error', params: { error: { message: 'kaboom' }, threadId: 'thr_1', turnId: 'turn_1', willRetry: false } });
  assert.equal(f.kind, 'session.error');
  assert.equal(f.payload.content, 'kaboom');
  assert.equal(f.payload.level, 'error');
});

test('thread/compacted -> session.status', () => {
  const f = one({ method: 'thread/compacted', params: { threadId: 'thr_1', turnId: 'turn_1' } });
  assert.equal(f.kind, 'session.status');
  assert.match(f.payload.content, /compacted/i);
});

test('item/agentMessage/delta -> accumulated assistant_message with stable persistedMessageId', () => {
  const state = createAppServerMapperState();
  const first = one({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'i2', delta: 'PO' } }, state);
  const second = one({ method: 'item/agentMessage/delta', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'i2', delta: 'NG' } }, state);
  const completed = one(itemMsg('item/completed', { type: 'agentMessage', id: 'i2', text: 'PONG' }), state);
  assert.equal(first.kind, 'session.assistant_message');
  assert.equal(first.payload.content, 'PO');
  assert.equal(first.payload.persistedMessageId, 'appserver-agent-message:thr_1:turn_1:i2');
  assert.equal(first.payload.metadata.streamState, 'streaming');
  assert.equal(second.payload.content, 'PONG');
  assert.equal(second.payload.persistedMessageId, first.payload.persistedMessageId);
  assert.equal(completed.payload.content, 'PONG');
  assert.equal(completed.payload.persistedMessageId, first.payload.persistedMessageId);
  assert.equal(completed.payload.metadata.streamState, 'completed');
});

test('commandExecution requestApproval -> authorization.request carrying id + command', () => {
  const f = one({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'i4', command: 'printf OK > f', approvalId: null } });
  assert.equal(f.kind, 'authorization.request');
  assert.equal(f.payload.requestId, '42'); // top-level STRING: web gates resolved-check on typeof === 'string'
  assert.equal(f.payload.metadata.approvalRequestId, 42);
  assert.equal(f.payload.metadata.command, 'printf OK > f');
  assert.equal(f.payload.toolName, 'Bash');
  assert.equal(f.payload.level, 'warn');
});

test('fileChange requestApproval -> authorization.request(apply_patch)', () => {
  const f = one({ id: 7, method: 'item/fileChange/requestApproval', params: { threadId: 'thr_1', turnId: 'turn_1', itemId: 'i7' } });
  assert.equal(f.payload.toolName, 'apply_patch');
  assert.equal(f.payload.metadata.approvalRequestId, 7);
});

test('collabAgentToolCall started -> tool_use(collab) with itemType + normalized collab metadata', () => {
  const f = one(itemMsg('item/started', {
    type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', status: 'inProgress',
    senderThreadId: 'thr_1', receiverThreadIds: [], prompt: 'do X', model: null, agentsStates: {},
  }));
  assert.equal(f.kind, 'session.tool_use');
  assert.equal(f.payload.toolName, 'collab');
  assert.equal(f.payload.itemType, 'collabAgentToolCall'); // top-level, plan-item precedent
  assert.equal(f.payload.metadata.collab.tool, 'spawnAgent');
  assert.equal(f.payload.metadata.collab.prompt, 'do X');
  assert.deepEqual(f.payload.metadata.collab.receiverThreadIds, []);
});

test('collabAgentToolCall completed -> tool_result with receiver ids + agentsStates', () => {
  const f = one(itemMsg('item/completed', {
    type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', status: 'completed',
    senderThreadId: 'thr_1', receiverThreadIds: ['thr_sub1'], prompt: 'do X',
    agentsStates: { thr_sub1: { status: 'running', message: null } },
  }));
  assert.equal(f.kind, 'session.tool_result');
  assert.deepEqual(f.payload.metadata.collab.receiverThreadIds, ['thr_sub1']);
  assert.equal(f.payload.metadata.collab.agentsStates.thr_sub1.status, 'running');
  assert.equal(f.payload.level, 'info');
});

test('collabAgentToolCall failed -> level error; legacy collabToolCall singular ids normalized', () => {
  const failed = one(itemMsg('item/completed', { type: 'collabAgentToolCall', id: 'c2', tool: 'wait', status: 'failed' }));
  assert.equal(failed.payload.level, 'error');
  const legacy = one(itemMsg('item/completed', { type: 'collabToolCall', id: 'c3', tool: 'spawnAgent', status: 'completed', newThreadId: 'thr_new' }));
  assert.deepEqual(legacy.payload.metadata.collab.receiverThreadIds, ['thr_new']);
});

test('collabReceiverThreadIds merges receiver ids and agentsStates keys', () => {
  assert.deepEqual(
    collabReceiverThreadIds({ receiverThreadIds: ['a'], agentsStates: { a: {}, b: {} } }),
    ['a', 'b'],
  );
  assert.deepEqual(collabReceiverThreadIds({ newThreadId: 'n' }), ['n']);
  assert.deepEqual(collabReceiverThreadIds({}), []);
});

test('subAgentActivity -> [] (runner-side registration signal)', () => {
  assert.deepEqual(mapMessage(itemMsg('item/started', { type: 'subAgentActivity', id: 's1', kind: 'started', agentThreadId: 'thr_sub1', agentPath: 'root/1' })), []);
});

test('unknown item type -> []', () => {
  assert.deepEqual(mapMessage(itemMsg('item/completed', { type: 'somethingNew', id: 'i9' })), []);
});

test('thread/tokenUsage/updated -> session.token_usage snapshot', () => {
  const frame = one({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 'thr_1',
      turnId: 'turn_1',
      tokenUsage: {
        last: { inputTokens: 10, cachedInputTokens: 3, outputTokens: 4, reasoningOutputTokens: 2, totalTokens: 14 },
        total: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 40, reasoningOutputTokens: 20, totalTokens: 140 },
        modelContextWindow: 200000,
      },
    },
  });
  assert.equal(frame.kind, 'session.token_usage');
  assert.equal(frame.payload.threadId, 'thr_1');
  assert.equal(frame.payload.tokenUsage.total.totalTokens, 140);
  assert.equal(frame.payload.tokenUsage.modelContextWindow, 200000);
});

test('noise notifications -> []', () => {
  assert.deepEqual(mapMessage({ method: 'turn/started', params: { turn: { id: 't' } } }), []);
  assert.deepEqual(mapMessage({ method: 'thread/tokenUsage/updated', params: {} }), []);
  assert.deepEqual(mapMessage({ method: 'thread/status/changed', params: {} }), []);
});

test('threadIdFromResult / turnIdFromResult', () => {
  assert.equal(threadIdFromResult({ thread: { id: 'thr_9' } }), 'thr_9');
  assert.equal(threadIdFromResult({}), null);
  assert.equal(turnIdFromResult({ turn: { id: 'turn_9' } }), 'turn_9');
  assert.equal(turnIdFromResult({}), null);
});
