import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelList, resolveDefaultModel } from '../lib/app-server-runner.mjs';

// Live model/list entry shape (codex 0.142.5): id/model, displayName, description, hidden,
// supportedReasoningEfforts as [{reasoningEffort, description}], defaultReasoningEffort.
const LIVE_ENTRY = {
  id: 'gpt-5.5',
  model: 'gpt-5.5',
  displayName: 'GPT-5.5',
  description: 'Frontier model for complex coding, research, and real-world work.',
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
    { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
    { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems' },
    { reasoningEffort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
  ],
  defaultReasoningEffort: 'medium',
  isDefault: true,
};

test('normalizeModelList maps live model/list entries to AgentModelOption shape', () => {
  assert.deepEqual(normalizeModelList([LIVE_ENTRY]), [{
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'Frontier model for complex coding, research, and real-world work.',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
  }]);
});

test('normalizeModelList drops hidden entries and entries without an id', () => {
  assert.deepEqual(normalizeModelList([
    { ...LIVE_ENTRY, hidden: true },
    { displayName: 'no id' },
    null,
    'not-an-object',
  ]), []);
});

test('normalizeModelList tolerates minimal entries and non-array input', () => {
  assert.deepEqual(normalizeModelList([{ model: 'gpt-x' }]), [{ id: 'gpt-x' }]);
  // string-form reasoning efforts are accepted too
  assert.deepEqual(
    normalizeModelList([{ id: 'm', supportedReasoningEfforts: ['low', { reasoningEffort: 'high' }, {}] }]),
    [{ id: 'm', efforts: ['low', 'high'] }],
  );
  assert.deepEqual(normalizeModelList(undefined), []);
  assert.deepEqual(normalizeModelList({ data: [] }), []);
});

const CATALOG = [
  { id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true },
  { id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4' },
];

test('resolveDefaultModel falls back to the catalog isDefault entry when config.model is unset', () => {
  assert.deepEqual(resolveDefaultModel(CATALOG, null), { id: 'gpt-5.5', label: 'GPT-5.5' });
  assert.deepEqual(resolveDefaultModel(CATALOG, ''), { id: 'gpt-5.5', label: 'GPT-5.5' });
  assert.deepEqual(resolveDefaultModel(CATALOG, undefined), { id: 'gpt-5.5', label: 'GPT-5.5' });
});

test('resolveDefaultModel: an explicit config.model wins over the catalog default', () => {
  // configured model is in the catalog → resolves its display label
  assert.deepEqual(resolveDefaultModel(CATALOG, 'gpt-5.4'), { id: 'gpt-5.4', label: 'GPT-5.4' });
  // configured model not in the catalog (e.g. hidden) → id only, no label
  assert.deepEqual(resolveDefaultModel(CATALOG, 'gpt-5.3-codex'), { id: 'gpt-5.3-codex' });
});

test('resolveDefaultModel returns null when neither config.model nor a catalog default yields an id', () => {
  assert.equal(resolveDefaultModel([{ id: 'a' }, { id: 'b' }], null), null);
  assert.equal(resolveDefaultModel([], null), null);
  assert.equal(resolveDefaultModel(undefined, null), null);
});
