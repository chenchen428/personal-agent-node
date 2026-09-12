import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeStore } from '../src/store/store.js';
import { SessionOrchestrator } from '../src/server/orchestrator.js';

function setup(t, runner, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-runtime-orchestrator-'));
  const store = new BridgeStore({ dataDir, consoleBaseUrl: 'https://agent.example.test' });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: dataDir });
  const orchestrator = new SessionOrchestrator({ store, hub: { broadcast() {} }, channels: {},
    siteDataRoot: dataDir, runner, progressTimerEnabled: false, ...extra });
  t.after(() => { orchestrator.stop(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, main, orchestrator };
}
const snapshot = (engine, model = '') => ({ engine, revision: 1, credential: '', profile: { mode: 'account', model, reasoningEffort: '' } });
async function finish(config, cliSessionId) {
  await config.onSessionEvent({ sessionId: config.sessionId, kind: 'session.assistant_message',
    payload: { cliSessionId, content: `${config.agentType} reply`, metadata: { streamState: 'completed' } } });
  await config.onSessionEvent({ sessionId: config.sessionId, kind: 'session.complete', payload: { cliSessionId, success: true, idle: true } });
  return { success: true };
}
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('condition timed out');
}

test('main conversation switches engines with isolated resumable IDs and bounded visible context', async (t) => {
  const calls = [];
  let execution = snapshot('codex', 'codex-model');
  const { store, main, orchestrator } = setup(t, {
    runAppServerCommand: async config => { calls.push(config); return finish(config, config.cliSessionId || `${config.agentType}-thread`); },
    stopAppServerCommand: () => false,
  }, { runtimeExecutionSettings: () => execution });
  store.updateSession(main.id, { cliSessionId: 'legacy-codex-thread' });
  await orchestrator.runTurn(main.id, 'first question');
  execution = snapshot('claude-code', 'claude-model');
  await orchestrator.runTurn(main.id, 'second question', { allowCreateThread: false });
  await orchestrator.runTurn(main.id, 'third question');
  execution = snapshot('codex', 'new-codex-model');
  await orchestrator.runTurn(main.id, 'fourth question');
  assert.deepEqual(calls.map(c => c.cliSessionId), ['legacy-codex-thread', undefined, 'claude-code-thread', 'legacy-codex-thread']);
  assert.equal(calls[1].allowCreateThread, true);
  assert.equal(calls[1].appServerModel, 'claude-model');
  assert.equal(calls[3].appServerModel, 'new-codex-model');
  assert.match(calls[1].appServerDeveloperInstructions, /codex reply/);
  assert.match(calls[3].appServerDeveloperInstructions, /claude-code reply/);
  assert.deepEqual(store.getSessionRecord(main.id).metadata.runtimeSessions, { codex: 'legacy-codex-thread', 'claude-code': 'claude-code-thread' });
});

test('a running turn keeps its engine/model snapshot and queued input reads new settings', async (t) => {
  const calls = [];
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const execution = snapshot('codex', 'original-model');
  const { main, orchestrator } = setup(t, {
    runAppServerCommand: async config => { calls.push(config); if (calls.length === 1) await hold; return finish(config, `${config.agentType}-thread`); },
    steerActiveTurn: async () => false,
    stopAppServerCommand: () => false,
  }, { runtimeExecutionSettings: () => execution });
  const first = orchestrator.runTurn(main.id, 'first input');
  await waitFor(() => calls.length === 1);
  execution.engine = 'claude-code'; execution.profile.model = 'next-model';
  assert.equal((await orchestrator.runTurn(main.id, 'second input', { steerIfRunning: true })).queued, true);
  assert.equal(calls[0].runtimeExecution.engine, 'codex');
  assert.equal(calls[0].runtimeExecution.profile.model, 'original-model');
  release(); await first;
  await waitFor(() => calls.length === 2 && !orchestrator.running.size);
  assert.equal(calls[1].runtimeExecution.engine, 'claude-code');
  assert.equal(calls[1].runtimeExecution.profile.model, 'next-model');
  assert.equal(calls[1].cliSessionId, undefined);
});

test('Claude worker recovery resumes its own session and completion returns through main Agent', async (t) => {
  const calls = [];
  const { dataDir, store, main, orchestrator } = setup(t, {
    runAppServerCommand: async config => { calls.push(config); return finish(config, config.cliSessionId || 'main-claude-session'); },
    stopAppServerCommand: () => false,
  }, { runtimeExecutionSettings: () => snapshot('claude-code') });
  const worker = store.createSession({ parentSessionId: main.id, status: 'running', title: '恢复文档',
    taskDescription: '继续编辑文档', workspaceRoot: dataDir, cliSessionId: 'worker-claude-session',
    metadata: { runtimeEngine: 'claude-code', runtimeSessions: { codex: 'old-worker-codex', 'claude-code': 'worker-claude-session' } } });
  const result = await orchestrator.recoverInterruptedWorkers();
  await waitFor(() => calls.length === 2 && !orchestrator.running.size);
  assert.equal(result.completed, 1);
  assert.equal(calls[0].sessionId, worker.id);
  assert.equal(calls[0].agentType, 'claude-code');
  assert.equal(calls[0].cliSessionId, 'worker-claude-session');
  assert.match(calls[0].appServerDeveloperInstructions, /你不是主 Agent/);
  assert.match(calls[0].stdin, /worker-recovery:continue/);
  assert.equal(calls[1].sessionId, main.id);
  assert.equal(calls[1].cliSessionId, undefined);
  assert.match(calls[1].stdin, /worker-hook:completed/);
  assert.equal(store.getSessionRecord(worker.id).metadata.runtimeSessions.codex, 'old-worker-codex');
});

test('worker engine changes preserve task identity and stop routes to the active execution', async (t) => {
  const calls = [];
  let execution = snapshot('codex');
  let release;
  const stopped = [];
  const { dataDir, store, orchestrator } = setup(t, {
    runAppServerCommand: async config => { calls.push(config); if (calls.length === 2) await new Promise(resolve => { release = resolve; });
      return finish(config, config.cliSessionId || `${config.agentType}-worker`); },
    stopAppServerCommand: id => { stopped.push(id); release?.(); return true; },
  }, { runtimeExecutionSettings: () => execution });
  const worker = store.createSession({ title: '分析附件', taskDescription: '检查同一份附件', workspaceRoot: dataDir });
  await orchestrator.runTurn(worker.id, 'work phase one');
  execution = snapshot('claude-code');
  const run = orchestrator.runTurn(worker.id, 'work phase two');
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].cliSessionId, undefined);
  assert.equal(calls[1].sessionId, calls[0].sessionId);
  assert.match(calls[1].taskDescription, /检查同一份附件/);
  assert.equal(orchestrator.stopSession(worker.id), true);
  await run;
  assert.deepEqual(stopped, [worker.id]);
});

test('runtime readiness receipt requires a successful reply and binds the actual engine revision', async (t) => {
  let success = false;
  const { dataDir, main, orchestrator } = setup(t, {
    runAppServerCommand: async config => { await finish(config, 'claude-receipt'); return { success }; },
    stopAppServerCommand: () => false,
  }, { runtimeExecutionSettings: () => ({ ...snapshot('claude-code'), revision: 7 }) });
  const receipt = path.join(dataDir, 'runtime', 'setup', 'web-conversation.json');
  await orchestrator.runTurn(main.id, 'fails after a partial reply');
  assert.equal(fs.existsSync(receipt), false);
  success = true;
  await orchestrator.runTurn(main.id, 'successful reply');
  const value = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(value.engine, 'claude-code');
  assert.equal(value.revision, 7);
  assert.equal(value.spaceId, 'default');
});
