import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRow, appendPhaseExecutions, migrateLibraryJson } from './rowSerialization.ts';
import type { PhaseExecution } from '../types';

const complete = {
  id: 'row-1', UTTERANCE: 'Quiero agua', status: 'completed', nluStatus: 'completed',
  visualStatus: 'outdated', bitmapStatus: 'completed', structuredSvgStatus: 'review',
  NLU: { schemaVersion: 'future-99', unknownSemanticField: { data: 'preserve' } },
  elements: [{ id: 'legacy', future: true }], prompt: 'historical prompt',
  bitmap: 'data:image/png;base64,AA', rawSvg: '<svg/>', structuredSvg: '<svg/>',
  generationModel: 'gpt-image-2', generationQuality: 'high',
  bitmapDiscarded: true, rawSvgDiscarded: false, structuredSvgDiscarded: true,
  audio: 'data:audio/wav;base64,AA', phase5Mapping: { unknown: true },
  phaseExecutions: [{ id: 'future-execution', contractVersion: '99', unknown: true }],
  extensions: { futureContract: { version: '99', other: [1, 2] } },
  interventionLog: { future: true, sessions: [{ startedAt: '2026-01-01', endedAt: '2026-01-02', extra: 'kept', events: [{ id: 'event-1', unknown: true }] }] },
};

test('roundtrip preserves all row fields including unknown future schemas without relabelling them', () => {
  const before = structuredClone(complete);
  const loaded = sanitizeRow(complete);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), before);
  assert.deepEqual(sanitizeRow(JSON.parse(JSON.stringify(loaded))), loaded);
  assert.deepEqual(complete, before);
});

test('legacy UI defaults preserve malformed originals while NLU stays inspectable', () => {
  const raw = { id: 'old', UTTERANCE: 42, NLU: '{broken json', elements: { unexpected: true }, status: 'future-status', nluStatus: 'reviewed', bitmap: { uri: 'not a string' }, importOriginalValues: { earlierDiagnostic: 'retained' } };
  const before = structuredClone(raw);
  const loaded = sanitizeRow(raw);
  assert.equal(loaded.UTTERANCE, '');
  assert.equal(loaded.status, 'idle');
  assert.equal(loaded.NLU, '{broken json');
  assert.equal(loaded.elements, undefined);
  assert.deepEqual(loaded.importOriginalValues, {
    ...before.importOriginalValues, UTTERANCE: 42, elements: before.elements,
    status: 'future-status', nluStatus: 'reviewed', bitmap: before.bitmap,
  });
  assert.equal(loaded.phaseExecutions, undefined);
  assert.deepEqual(raw, before);
});

test('legacy log hydration is immutable and retains original evidence and extensions', () => {
  const log = { future: true, sessions: [{ startedAt: '2020-01-01', note: 'kept', events: [{ context: { modelId: 'old-model', consent: 'unknown' }, extension: 1 }] }, { malformed: true }] };
  const before = structuredClone(log);
  const row = sanitizeRow({ id: 'r', UTTERANCE: '', interventionLog: log });
  const event = row.interventionLog!.sessions[0].events[0] as any;
  assert.deepEqual(log, before);
  assert.deepEqual(row.importOriginalValues?.interventionLog, before);
  assert.deepEqual(event.context, before.sessions[0].events![0].context);
  assert.equal(event.modelId, 'old-model');
  assert.ok(event.id);
  assert.deepEqual(sanitizeRow(row), row);
});

test('accepted execution append is idempotent without replacing prior evidence', () => {
  const first = { id: 'accepted-1', phase: 1 } as PhaseExecution;
  const second = { id: 'accepted-2', phase: 2 } as PhaseExecution;
  const previous = [first];
  assert.deepEqual(appendPhaseExecutions(previous, [second, first]), [first, second]);
  assert.deepEqual(previous, [first]);
  assert.deepEqual(appendPhaseExecutions(undefined, []), []);
});

test('actual v1 library migration preserves event context before ordinary row hydration', () => {
  const raw = {
    schemaVersion: 1, svgs: '[{"id":"old-svg"}]', extra: { research: true },
    rows: [{ id: 'legacy-row', UTTERANCE: 'Quiero agua', NLU: '{historical}', interventionLog: {
      sessions: [{ startedAt: '2020-01-01', events: [{ context: { modelId: 'historical-model', consent: 'unknown', geography: 'original-context' }, unknown: 'preserve' }] }],
    } }],
  };
  const original = structuredClone(raw);
  const migrated = migrateLibraryJson(raw, 3);
  const loaded = sanitizeRow(migrated.rows[0]);
  const event = loaded.interventionLog!.sessions[0].events[0] as any;
  assert.deepEqual(raw, original);
  assert.deepEqual(event.context, original.rows[0].interventionLog.sessions[0].events[0].context);
  assert.equal(event.modelId, 'historical-model');
  assert.ok(event.id);
  assert.deepEqual(loaded.importOriginalValues?.interventionLog, original.rows[0].interventionLog);
  assert.equal(loaded.NLU, original.rows[0].NLU);
  assert.deepEqual(migrated.svgs, [{ id: 'old-svg' }]);
  assert.deepEqual(migrated.boards, []);
  assert.deepEqual(migrateLibraryJson(migrated, 3), migrated);
  assert.equal(loaded.phaseExecutions, undefined);
});

test('library migration retains malformed SVG evidence and does not rewrite future or legacy-array containers', () => {
  const broken = { schemaVersion: 1, svgs: '{broken', rows: [] };
  assert.equal(migrateLibraryJson(broken, 3).svgs, '{broken');
  assert.deepEqual(broken, { schemaVersion: 1, svgs: '{broken', rows: [] });
  const future = { schemaVersion: 99, extension: true };
  const legacyArray = [complete];
  assert.equal(migrateLibraryJson(future, 3), future);
  assert.equal(migrateLibraryJson(legacyArray, 3), legacyArray);
});
