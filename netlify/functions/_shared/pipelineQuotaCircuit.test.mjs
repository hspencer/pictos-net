import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openProviderQuotaCircuit } from './pipelineQuotaCircuit.js';

test('opens the circuit, refunds current plus deferred rows, and stops after the failed row', () => {
  const rows = [
    { rowId: 'done' },
    { rowId: 'quota' },
    { rowId: 'later-1' },
    { rowId: 'later-2' },
  ];
  const result = openProviderQuotaCircuit({
    state: 'running', rowCount: 4, succeededCount: 1, failedCount: 0,
  }, rows, 1, true);

  assert.deepEqual(result.deferredRows.map(row => row.rowId), ['later-1', 'later-2']);
  assert.equal(result.refundableUnits, 3);
  assert.equal(result.state.state, 'provider_quota_blocked');
  assert.equal(result.state.providerQuotaBlockedAtRowId, 'quota');
  assert.equal(result.state.refundedGenerationUnits, 3);
  assert.equal(result.state.failedCount, 3);
});

test('preserves refunds from earlier failed OpenAI rows when the quota circuit opens', () => {
  const result = openProviderQuotaCircuit({ rowCount: 3, succeededCount: 0, refundedGenerationUnits: 1 },
    [{ rowId: 'earlier-error' }, { rowId: 'quota' }, { rowId: 'deferred' }], 1, true);
  assert.equal(result.state.refundedGenerationUnits, 3);
});
