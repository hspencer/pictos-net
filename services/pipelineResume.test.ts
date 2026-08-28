import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRetryPhase3Only } from './pipelineResume.ts';

const coherent = {
  id: 'row-1',
  UTTERANCE: 'Necesito ayuda',
  status: 'error',
  nluStatus: 'completed',
  visualStatus: 'completed',
  bitmapStatus: 'error',
  NLU: { utterance: 'Necesito ayuda' },
  elements: [{ id: 'persona' }],
  prompt: "'persona' al centro",
} as any;

test('permits Phase 3-only retry for a coherent failed snapshot', () => {
  assert.equal(canRetryPhase3Only(coherent), true);
});

test('requires all completed upstream artifacts', () => {
  assert.equal(canRetryPhase3Only({ ...coherent, NLU: undefined }), false);
  assert.equal(canRetryPhase3Only({ ...coherent, elements: [] }), false);
  assert.equal(canRetryPhase3Only({ ...coherent, visualStatus: 'error' }), false);
});

test('a normal completed row still runs the full cascade', () => {
  assert.equal(canRetryPhase3Only({ ...coherent, bitmapStatus: 'completed' }), false);
});
