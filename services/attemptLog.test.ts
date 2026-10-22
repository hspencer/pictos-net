import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttempt, recordAttempt, getAttempts, exportAttempts } from './attemptLog.ts';
import { QuotaExceededError, ExternalProviderQuotaError, ProviderRequestError } from './providerErrors.ts';
import { ModelUnavailableError } from '../netlify/functions/_shared/modelCatalog.js';

test('each failure type maps to its outcome, keeping references but never messages', () => {
  assert.equal(classifyAttempt(new ModelUnavailableError('gemini-2.5-pro')).outcome, 'model_unavailable');
  assert.equal(classifyAttempt(new QuotaExceededError(50, 50)).outcome, 'pictos_quota');
  assert.deepEqual(classifyAttempt(new ExternalProviderQuotaError('gemini', 'm', 'ref-1', null, 2)),
    { outcome: 'provider_quota', requestId: 'ref-1', attempts: 2 });
  const noImage = classifyAttempt(new ProviderRequestError('Gemini returned no image (finishReason=IMAGE_SAFETY)', 'gemini', null, 'job-1', true, null, 1, 'no_image'));
  assert.equal(noImage.outcome, 'no_image');
  assert.equal(noImage.requestId, 'job-1');
  assert.equal(classifyAttempt(new ProviderRequestError('boom', 'openai', 500, 'r', false)).outcome, 'provider_error');
  const contract = classifyAttempt(Object.assign(new Error('Phase 1 contract validation failed: SECRET'), {
    code: 'pipeline_contract_invalid', issues: [{ instancePath: '/visual_guidelines/temporal', keyword: 'enum', params: { allowedValues: ['x'] } }],
  }));
  assert.deepEqual(contract, { outcome: 'contract_invalid', contractIssues: ['/visual_guidelines/temporal enum'] });
  assert.deepEqual(classifyAttempt(Object.assign(new Error('x'), { diagnostic: { key: 'invalidSvg' } })), { outcome: 'structure_rejected', diagnostic: 'invalidSvg' });
  const local = classifyAttempt(new TypeError('quiero agua'));
  assert.deepEqual(local, { outcome: 'local_error', errorName: 'TypeError' });
  assert.doesNotMatch(JSON.stringify([contract, local]), /SECRET|quiero/);
});

test('the log is a capped ring and survives a broken or missing store', () => {
  const memory = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
  for (let i = 0; i < 510; i++) recordAttempt({ rowId: `r${i}`, phase: 1, model: 'claude-haiku-4-5-20251001', outcome: 'ok', durationMs: i });
  const entries = getAttempts();
  assert.equal(entries.length, 500);
  assert.equal(entries[0].rowId, 'r10');
  assert.equal(entries[0].phaseName, 'COMPRENDER');
  assert.equal(JSON.parse(exportAttempts('2.6.3')).entries.length, 500);
  memory.set('pictos_attempt_log', '{broken');
  assert.deepEqual(getAttempts(), []);
  (globalThis as any).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => recordAttempt({ rowId: 'x', phase: 3, model: 'm', outcome: 'ok', durationMs: 1 }));
  delete (globalThis as any).localStorage;
});
