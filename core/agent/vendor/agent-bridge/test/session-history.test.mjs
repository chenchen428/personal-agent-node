import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildHistoryMessages,
  collectExecHistory,
  findCodexSessionFileByThreadId,
} from '../lib/session-history.mjs';

const THREAD_ID = '019f0000-aaaa-bbbb-cccc-000000000001';
const TURN_ID = 'turn-1';

function writeJsonl(file, rows) {
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function makeSessionsDir(rows) {
  const root = mkdtempSync(join(tmpdir(), 'agent-bridge-session-history-'));
  const day = join(root, '2026', '07', '03');
  mkdirSync(day, { recursive: true });
  writeJsonl(join(day, `rollout-2026-07-03T10-00-00-${THREAD_ID}.jsonl`), rows);
  return root;
}

const EXEC_ROWS = [
  { timestamp: '2026-07-03T10:00:00.000Z', type: 'session_meta', payload: { id: THREAD_ID, cwd: '/tmp/demo' } },
  {
    timestamp: '2026-07-03T10:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call-1',
      arguments: JSON.stringify({ cmd: 'ls -la', workdir: '/tmp/demo' }),
      internal_chat_message_metadata_passthrough: { turn_id: TURN_ID },
    },
  },
  {
    timestamp: '2026-07-03T10:00:02.000Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call-1', output: 'Process exited with code 0\ntotal 8' },
  },
  // write_stdin 调用与输出都应被跳过
  {
    timestamp: '2026-07-03T10:00:03.000Z',
    type: 'response_item',
    payload: { type: 'function_call', name: 'write_stdin', call_id: 'call-2', arguments: '{"chars":""}' },
  },
  {
    timestamp: '2026-07-03T10:00:04.000Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call-2', output: 'ignored' },
  },
  // 失败命令：exitCode 非 0 → level error
  {
    timestamp: '2026-07-03T10:00:05.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call-3',
      arguments: JSON.stringify({ cmd: 'false' }),
      internal_chat_message_metadata_passthrough: { turn_id: TURN_ID },
    },
  },
  {
    timestamp: '2026-07-03T10:00:06.000Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call-3', output: 'Process exited with code 1\n' },
  },
];

test('findCodexSessionFileByThreadId matches rollout filename suffix', () => {
  const root = makeSessionsDir(EXEC_ROWS);
  const file = findCodexSessionFileByThreadId(root, THREAD_ID);
  assert.ok(file?.endsWith(`-${THREAD_ID}.jsonl`));
  assert.equal(findCodexSessionFileByThreadId(root, 'missing-thread'), null);
});

test('collectExecHistory pairs exec_command calls with outputs by call_id and turn', () => {
  const root = makeSessionsDir(EXEC_ROWS);
  const exec = collectExecHistory(root, THREAD_ID);
  assert.equal(exec.count, 2);
  assert.equal(exec.unassigned.length, 0);
  const entries = exec.byTurn.get(TURN_ID);
  assert.equal(entries.length, 2);

  const [ok, failed] = entries;
  assert.equal(ok.frames[0].kind, 'session.tool_use');
  assert.equal(ok.frames[0].payload.content, 'ls -la');
  assert.equal(ok.frames[0].payload.toolName, 'Bash');
  assert.equal(ok.frames[0].payload.metadata.itemId, 'call-1');
  assert.equal(ok.frames[1].kind, 'session.tool_result');
  assert.equal(ok.frames[1].payload.metadata.exitCode, 0);
  assert.equal(ok.frames[1].payload.level, 'info');

  assert.equal(failed.frames[1].payload.metadata.exitCode, 1);
  assert.equal(failed.frames[1].payload.level, 'error');
});

test('buildHistoryMessages maps native turns through the app-server mapper and splices exec frames', () => {
  const root = makeSessionsDir(EXEC_ROWS);
  const exec = collectExecHistory(root, THREAD_ID);
  const turns = [{
    id: TURN_ID,
    status: 'completed',
    startedAt: 1_780_000_000,
    completedAt: 1_780_000_060,
    items: [
      { type: 'userMessage', id: 'item-1', content: [{ type: 'text', text: '帮我看下目录' }] },
      {
        type: 'fileChange',
        id: 'item-2',
        status: 'completed',
        changes: [{ path: '/tmp/demo/a.ts', kind: { type: 'update', unifiedDiff: '+new\n-old' } }],
      },
      { type: 'agentMessage', id: 'item-3', text: '目录看完了。' },
    ],
  }];

  const rows = buildHistoryMessages({
    sessionId: 'codex-test',
    threadId: THREAD_ID,
    turns,
    execByTurn: exec.byTurn,
    unassignedExec: exec.unassigned,
  });

  // 顺序：user → exec(2 对) → fileChange tool_result → agentMessage
  const kinds = rows.map((row) => row.metadata.eventType);
  assert.deepEqual(kinds, [
    'user.message',
    'session.tool_use', 'session.tool_result',
    'session.tool_use', 'session.tool_result',
    'session.tool_result',
    'session.assistant_message',
  ]);

  // 负数 sequence 频段：永远排在 live 事件消息（seq >= 1）之前
  assert.ok(rows.every((row) => row.sequence < 0));
  assert.ok(rows.every((row) => row.metadata.historyBackfill === true));
  assert.ok(rows.every((row) => row.id.startsWith('codex-test-hist-')));

  // 用户消息用 'user.message'，web 端才会当作对话气泡并开启回合折叠
  const user = rows[0];
  assert.equal(user.role, 'user');
  assert.equal(user.content, '帮我看下目录');

  // fileChange 走现有 mapper：changes 在嵌套 metadata 里，供 web 的文件摘要/文件面板使用
  const patch = rows[5];
  assert.equal(patch.toolName, 'apply_patch');
  assert.equal(patch.metadata.metadata.changes[0].path, '/tmp/demo/a.ts');

  // 轮次最后一帧使用 completedAt，web 推导的轮次耗时才正确
  assert.equal(rows.at(-1)?.createdAt, new Date(1_780_000_060 * 1000).toISOString());
  // exec 帧带 JSONL 自己的时间戳
  assert.equal(rows[1].createdAt, '2026-07-03T10:00:01.000Z');
});
