// Unit tests for alias normalization. Every remote command is routed to the app-server runner.
// Run: node --test libs/cli/agent-bridge/test/agent-aliases-transport.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentCommandAliases, resolveAgentCommandForCommand } from '../lib/agent-aliases.mjs';

const transportFor = (message, config = {}) => resolveAgentCommandForCommand(config, message, { resume: false }).alias.transport;

test('default codex alias is app-server transport', () => {
  const aliases = normalizeAgentCommandAliases({});
  assert.equal(aliases.find((a) => a.key === 'codex').transport, 'app-server');
  assert.equal(aliases.find((a) => a.key === 'codex').command, 'codex app-server');
});

test('command with no alias resolves to app-server', () => {
  assert.equal(transportFor({ payload: {} }), 'app-server');
});

test('selecting the codex-app-server alias routes to app-server', () => {
  const resolved = resolveAgentCommandForCommand({
    agentCommandAliases: [{ key: 'codex-app-server', command: 'codex app-server', enabled: true }],
  }, { payload: { agentAlias: 'codex-app-server' } }, { resume: false });
  assert.equal(resolved.alias.transport, 'app-server');
  assert.equal(resolved.command, 'codex app-server');
});

test('explicit exec transport is ignored', () => {
  assert.equal(transportFor({ payload: { agentAlias: 'codex', transport: 'app-server' } }), 'app-server');
  assert.equal(transportFor({ payload: { agentAlias: 'codex', transport: 'exec' } }), 'app-server');
});

test('transport is inferred from a "codex app-server" command string (safety net)', () => {
  assert.equal(transportFor({ payload: { agentCommand: 'codex app-server' } }), 'app-server');
});

test('transport inferred from an app-server key even without explicit field', () => {
  const aliases = normalizeAgentCommandAliases({
    agentCommandAliases: [{ key: 'codex-app-server-custom', command: 'codex app-server --foo', enabled: true }],
  });
  assert.equal(aliases.find((a) => a.key === 'codex-app-server-custom').transport, 'app-server');
});

test('legacy aliases normalize to codex app-server', () => {
  const resolved = resolveAgentCommandForCommand({
    agentCommandAliases: [
      { key: 'codex', command: 'codex exec --json -', enabled: true },
      { key: 'claude', command: 'claude -p --output-format stream-json', enabled: true, isDefault: true },
    ],
  }, { payload: { agentAlias: 'claude' } }, { resume: true, cliSessionId: 'thread-1' });
  assert.equal(resolved.alias.key, 'codex');
  assert.equal(resolved.alias.transport, 'app-server');
  assert.equal(resolved.command, 'codex app-server');
});
