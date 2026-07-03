/**
 * Unit tests for the pure helpers in vertexBatch.js (no network).
 * Run with: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchJsonl, promptHash, mapVertexState, isActiveBatchState } from './vertexBatch.js';

test('buildBatchJsonl produces one valid generateContent line per row', () => {
  const rows = [
    { rowId: 'r1', prompt: 'AAC pictogram: "Sí."' },
    { rowId: 'r2', prompt: 'AAC pictogram: "No."' },
  ];
  const { jsonl, items } = buildBatchJsonl(rows);
  const lines = jsonl.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(items.length, 2);

  const first = JSON.parse(lines[0]);
  assert.equal(first.request.contents[0].role, 'user');
  assert.equal(first.request.contents[0].parts[0].text, rows[0].prompt);
  assert.deepEqual(first.request.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(first.request.generationConfig.imageConfig.aspectRatio, '1:1');

  // Manifest hashes the exact prompt text (the correlation key).
  assert.equal(items[0].promptHash, promptHash(rows[0].prompt));
  assert.notEqual(items[0].promptHash, items[1].promptHash);
});

test('buildBatchJsonl includes the reference image on every line when given', () => {
  const { jsonl } = buildBatchJsonl(
    [{ rowId: 'r1', prompt: 'p' }],
    'gs://bucket/batch/input/job/reference.png',
  );
  const line = JSON.parse(jsonl);
  const parts = line.request.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[1].fileData.fileUri, 'gs://bucket/batch/input/job/reference.png');
  assert.equal(parts[1].fileData.mimeType, 'image/png');
});

test('promptHash is deterministic and utf8-safe', () => {
  const a = promptHash('¿Cuál fue el último curso que usted aprobó en el colegio?');
  const b = promptHash('¿Cuál fue el último curso que usted aprobó en el colegio?');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('mapVertexState maps terminal states to collecting', () => {
  assert.equal(mapVertexState('JOB_STATE_PENDING'), 'queued');
  assert.equal(mapVertexState('JOB_STATE_RUNNING'), 'running');
  assert.equal(mapVertexState('JOB_STATE_SUCCEEDED'), 'collecting');
  assert.equal(mapVertexState('JOB_STATE_FAILED'), 'collecting');
  assert.equal(mapVertexState('JOB_STATE_CANCELLED'), 'collecting');
});

test('isActiveBatchState matches the spec lifecycle', () => {
  for (const s of ['submitted', 'queued', 'running', 'collecting']) {
    assert.equal(isActiveBatchState(s), true, s);
  }
  for (const s of ['completed', 'failed', 'expired']) {
    assert.equal(isActiveBatchState(s), false, s);
  }
});
