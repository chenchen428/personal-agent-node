import assert from 'node:assert/strict';
import test from 'node:test';
import { toSandboxObject, turnOverrides } from '../lib/app-server-runner.mjs';

test('toSandboxObject maps codex sandbox names to the turn/start object form (not the thread/start string)', () => {
  assert.deepEqual(toSandboxObject('read-only'), { type: 'readOnly' });
  assert.deepEqual(toSandboxObject('danger-full-access'), { type: 'dangerFullAccess' });
  assert.deepEqual(toSandboxObject('workspace-write', '/w'), { type: 'workspaceWrite', writableRoots: ['/w'], networkAccess: true });
  // unknown / undefined falls back to workspace-write
  assert.deepEqual(toSandboxObject(undefined, '/w'), { type: 'workspaceWrite', writableRoots: ['/w'], networkAccess: true });
  assert.deepEqual(toSandboxObject('workspace-write'), { type: 'workspaceWrite', writableRoots: [], networkAccess: true });
});

test('turnOverrides emits per-turn model/effort/approval/sandboxPolicy only when set', () => {
  assert.deepEqual(turnOverrides({}), {});
  assert.deepEqual(turnOverrides(null), {});
  assert.deepEqual(turnOverrides(undefined), {});
  assert.deepEqual(
    turnOverrides({
      appServerModel: 'gpt-x',
      appServerReasoningEffort: 'high',
      appServerApprovalPolicy: 'never',
      appServerSandbox: 'danger-full-access',
      workspace: '/w',
    }),
    { model: 'gpt-x', effort: 'high', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } },
  );
  // partial config: only the fields that are set are emitted
  assert.deepEqual(turnOverrides({ appServerReasoningEffort: 'low' }), { effort: 'low' });
  assert.deepEqual(turnOverrides({ appServerModel: 'm' }), { model: 'm' });
});

test('turnOverrides builds collaborationMode from the picked model + effort (plan mode)', () => {
  const out = turnOverrides({ appServerCollaborationMode: 'plan', appServerModel: 'gpt-x', appServerReasoningEffort: 'low' });
  assert.deepEqual(out.collaborationMode, {
    mode: 'plan',
    // developer_instructions:null -> server injects its builtin plan template
    settings: { model: 'gpt-x', reasoning_effort: 'low', developer_instructions: null },
  });
  // explicit exit back to default mode
  const exit = turnOverrides({ appServerCollaborationMode: 'default', appServerModel: 'gpt-x' });
  assert.equal(exit.collaborationMode.mode, 'default');
  assert.equal(exit.collaborationMode.settings.reasoning_effort, null);
});

test('turnOverrides falls back to the resolved default model for collaborationMode.settings.model', () => {
  const out = turnOverrides({ appServerCollaborationMode: 'plan' }, { defaultModel: 'gpt-default' });
  assert.equal(out.collaborationMode.settings.model, 'gpt-default');
  // settings.model is required on the wire: without any model the override is omitted entirely
  assert.deepEqual(turnOverrides({ appServerCollaborationMode: 'plan' }), {});
  // unknown mode values are ignored
  assert.deepEqual(turnOverrides({ appServerCollaborationMode: 'weird', appServerModel: 'm' }), { model: 'm' });
});
