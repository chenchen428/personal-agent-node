// E2E for `abg session start --task`: runs the real bin against a mock platform HTTP server and
// asserts the create-then-dispatch contract (action:'new' creates the record, the follow-up
// action:'send' carries the task as the first message; offline dispatch keeps the session).
// Run: node --test libs/cli/agent-bridge/test/session-start-dispatch.e2e.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/agent-bridge.mjs', import.meta.url));
const SESSION_ID = 'sess-e2e-1';

// Mock platform: records every request; actions response is configurable per test.
function startMockPlatform({ actionsStatus = 200 } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/agent-bridge/sessions') {
        res.end(JSON.stringify({ ok: true, session: { id: SESSION_ID, workspaceName: json?.workspaceName, status: 'start' } }));
        return;
      }
      if (req.method === 'POST' && req.url === `/api/agent-bridge/sessions/${SESSION_ID}/actions`) {
        if (actionsStatus !== 200) {
          res.statusCode = actionsStatus;
          res.end(JSON.stringify({ ok: false, error: '当前无法连接本地 runner，请先确认 Agent Bridge 后台服务在线。' }));
          return;
        }
        res.end(JSON.stringify({ ok: true, command: { id: 'cmd-e2e-1', status: 'queued' }, session: { id: SESSION_ID, status: 'running' } }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: `unexpected ${req.method} ${req.url}` }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ requests, server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const startArgs = (url, extra = []) => [
  'session', 'start',
  '--service-url', url,
  '--workspace-name', 'ws-e2e',
  '--agent', 'codex',
  ...extra,
];

test('session start --task creates the session then dispatches the task as first send', async () => {
  const { requests, server, url } = await startMockPlatform();
  try {
    const { code, stdout } = await runCli(startArgs(url, ['--task', '用一句话介绍这个仓库']));
    assert.equal(code, 0);

    const create = requests.find((r) => r.url === '/api/agent-bridge/sessions');
    assert.ok(create, 'expected POST /sessions');
    assert.equal(create.body.action, 'new');
    assert.equal(create.body.workspaceName, 'ws-e2e');
    assert.equal(create.body.taskDescription, '用一句话介绍这个仓库');
    assert.equal(Object.hasOwn(create.body, 'machine'), false);

    const send = requests.find((r) => r.url === `/api/agent-bridge/sessions/${SESSION_ID}/actions`);
    assert.ok(send, 'expected follow-up POST /sessions/:id/actions');
    assert.equal(send.body.action, 'send');
    assert.equal(send.body.content, '用一句话介绍这个仓库');

    // Single-machine mode does not add identity-scoped auth headers.
    for (const request of [create, send]) {
      assert.equal(request.headers.authorization, undefined);
    }

    // dispatch happens strictly after creation
    assert.ok(requests.indexOf(create) < requests.indexOf(send));

    const printed = JSON.parse(stdout);
    assert.equal(printed.id, SESSION_ID);
  } finally {
    server.close();
  }
});

test('session start without --task only creates the session record', async () => {
  const { requests, server, url } = await startMockPlatform();
  try {
    const { code, stdout } = await runCli(startArgs(url));
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/agent-bridge/sessions');
    assert.equal(JSON.parse(stdout).id, SESSION_ID);
  } finally {
    server.close();
  }
});

test('dispatch failure (runner offline) keeps the session, hints a retry, exits non-zero', async () => {
  const { requests, server, url } = await startMockPlatform({ actionsStatus: 409 });
  try {
    const { code, stdout, stderr } = await runCli(startArgs(url, ['--task', 'say hi']));
    assert.equal(code, 1);
    assert.ok(requests.some((r) => r.url === `/api/agent-bridge/sessions/${SESSION_ID}/actions`));
    // the created session is still printed so the caller can retry with session input
    assert.equal(JSON.parse(stdout).id, SESSION_ID);
    assert.match(stderr, /已创建，但任务派发失败/);
    assert.match(stderr, new RegExp(`abg session input --session ${SESSION_ID}`));
  } finally {
    server.close();
  }
});
