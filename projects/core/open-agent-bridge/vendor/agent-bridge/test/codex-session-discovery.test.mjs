import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverCodexSessions, syncCodexSessions } from '../lib/codex-session-discovery.mjs';

function writeJsonl(file, rows) {
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('discovers Codex sessions and derives workspaces from session_meta cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-bridge-codex-sessions-'));
  const workspace = join(root, 'projects', 'demo');
  const day = join(root, 'sessions', '2026', '07', '03');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-demo.jsonl');
  writeJsonl(file, [
    {
      timestamp: '2026-07-03T01:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'thread-1', session_id: 'thread-1', cwd: workspace },
    },
    {
      timestamp: '2026-07-03T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'output_text', text: '# AGENTS.md instructions\nignore preamble' }],
      },
    },
    {
      timestamp: '2026-07-03T01:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'output_text', text: '真实用户任务' }],
      },
    },
    {
      timestamp: '2026-07-03T01:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '已完成' }],
      },
    },
  ]);

  try {
    const result = discoverCodexSessions({ sessionsDir: join(root, 'sessions'), now: Date.parse('2026-07-03T02:00:00.000Z') });
    assert.equal(result.workspaces.length, 1);
    assert.equal(result.workspaces[0].name, 'demo');
    assert.equal(result.workspaces[0].workspaceRoot, workspace);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, 'codex-thread-1');
    assert.equal(result.sessions[0].threadId, 'thread-1');
    assert.equal(result.sessions[0].workspaceName, 'demo');
    assert.equal(result.sessions[0].taskDescription, '真实用户任务');
    assert.equal(Object.hasOwn(result.sessions[0], 'messages'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('syncs Codex sessions over HTTP without registering the launcher cwd as a workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-bridge-codex-sync-'));
  const sessionsDir = join(root, 'sessions');
  const launcherCwd = join(root, 'launcher-cwd');
  const workspaceA = join(root, 'projects', 'alpha');
  const workspaceB = join(root, 'projects', 'beta');
  mkdirSync(join(sessionsDir, '2026', '07', '03'), { recursive: true });
  mkdirSync(launcherCwd, { recursive: true });
  writeJsonl(join(sessionsDir, '2026', '07', '03', 'alpha.jsonl'), [
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'thread-alpha', cwd: workspaceA } },
    { timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'alpha task' }] } },
  ]);
  writeJsonl(join(sessionsDir, '2026', '07', '03', 'beta.jsonl'), [
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'thread-beta', cwd: workspaceB } },
    { timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'beta task' }] } },
  ]);

  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push({ method: request.method, url: request.url, body });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const config = {
      baseUrl: `http://127.0.0.1:${port}`,
      workspace: launcherCwd,
      workspaceProvided: false,
      codexSessionsDir: sessionsDir,
    };
    const result = await syncCodexSessions(config, { log: () => {} });

    assert.equal(result.workspaces, 2);
    assert.equal(result.sessions, 2);
    assert.notEqual(config.workspace, launcherCwd);
    assert.deepEqual(new Set(config.workspaces.map((workspace) => workspace.workspaceRoot)), new Set([workspaceA, workspaceB]));

    const heartbeat = calls.find((call) => call.url === '/api/agent-bridge/heartbeat');
    assert.ok(heartbeat);
    assert.deepEqual(
      new Set(heartbeat.body.workspaces.map((workspace) => workspace.workspaceRoot)),
      new Set([workspaceA, workspaceB]),
    );
    assert.equal(heartbeat.body.workspaces.some((workspace) => workspace.workspaceRoot === launcherCwd), false);

    const sessionCalls = calls.filter((call) => call.url === '/api/agent-bridge/sessions');
    assert.equal(sessionCalls.length, 2);
    assert.deepEqual(new Set(sessionCalls.map((call) => call.body.cliSessionId)), new Set(['thread-alpha', 'thread-beta']));
    assert.equal(sessionCalls.every((call) => !Object.hasOwn(call.body, 'messages')), true);
    assert.equal(sessionCalls.every((call) => !Object.hasOwn(call.body, 'jsonlPath')), true);
    assert.equal(sessionCalls.every((call) => !Object.hasOwn(call.body, 'agentType')), true);
    assert.equal(sessionCalls.every((call) => !Object.hasOwn(call.body, 'agentCommand')), true);
    assert.equal(sessionCalls.every((call) => !Object.hasOwn(call.body, 'machine')), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
