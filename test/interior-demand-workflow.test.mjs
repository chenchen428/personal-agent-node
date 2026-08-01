import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  advanceDemandWorkflow,
  createDemandWorkflow,
  DEMAND_WORKFLOW_STAGES,
  validateDemandWorkflow,
} from '../skills/interior-design/scripts/demand-workflow-v1.mjs';

const exampleRoot = path.resolve(import.meta.dirname, '../skills/interior-design/examples/professional-agent-example');
const seed = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'seed.json'), 'utf8'));
const events = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'workflow-events.json'), 'utf8'));

test('demand workflow rejects skipped stages and unresolved required questions', () => {
  const workflow = createDemandWorkflow({
    openQuestions: [{ questionId: 'question-household', stage: 'intake', prompt: '谁会长期居住？', required: true, status: 'open' }],
  });
  assert.throws(() => advanceDemandWorkflow(workflow, {
    targetStage: 'layout-review',
    confirmation: { scope: ['确认'] },
  }, { currentRevision: 1 }), (error) => error.code === 'WORKFLOW_STAGE_SKIP');
  assert.throws(() => advanceDemandWorkflow(workflow, {
    targetStage: 'functional-discovery',
    confirmation: { scope: ['确认'] },
  }, { currentRevision: 1 }), (error) => error.code === 'WORKFLOW_QUESTIONS_OPEN');
});

test('legacy representative events remain reproducible but are not the current workflow contract', () => {
  let workflow = createDemandWorkflow(seed.demandWorkflow);
  const requirementIds = new Set(seed.brief.requirements.map((entry) => entry.requirementId));
  const evidenceIds = new Set(seed.evidence.map((entry) => entry.evidenceId));
  events.forEach((event, index) => {
    workflow = advanceDemandWorkflow(workflow, event, {
      currentRevision: index + 1,
      requirementIds,
      evidenceIds,
      now: () => `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
  });
  assert.equal(workflow.stage, 'delivered');
  assert.equal(workflow.status, 'user-visual-acceptance-pending');
  assert.equal(workflow.transitions.length, DEMAND_WORKFLOW_STAGES.length - 1);
  assert.equal(workflow.confirmations.length, 7);
  assert.equal(workflow.renderSet.filter((entry) => entry.status === 'selected').length, 4);
  assert.deepEqual(validateDemandWorkflow(workflow, { requirementIds, evidenceIds }), []);
});
