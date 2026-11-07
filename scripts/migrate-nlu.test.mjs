import { test } from 'node:test';
import assert from 'node:assert/strict';
import nlu from '../schemas/pictos-nlu-schema/tests/generation/valid.json' with { type: 'json' };
import { resolveValue, migrateLibrary, proposeTable } from './migrate-nlu.mjs';

const TEMPORAL = ['immediate', 'near_future', 'future', 'past', 'habitual', 'unspecified'];
const legacy = () => ({
  ...structuredClone(nlu),
  metadata: { ...nlu.metadata, speech_act: 'Directive' },
  visual_guidelines: { ...nlu.visual_guidelines, temporal: 'AHORA' },
});

test('case differences resolve on their own; anything else needs an approved entry', () => {
  assert.deepEqual(resolveValue('/metadata/speech_act', 'Directive', ['directive', 'assertive']), ['directive', 'case']);
  assert.equal(resolveValue('/visual_guidelines/temporal', 'AHORA', TEMPORAL, []), null);
  // The approved table (shared with the app) already covers it.
  assert.deepEqual(resolveValue('/visual_guidelines/temporal', 'AHORA', TEMPORAL), ['immediate', 'approved']);
  const approved = [{ path: '/visual_guidelines/temporal', from: 'ahora', to: 'immediate' }];
  assert.deepEqual(resolveValue('/visual_guidelines/temporal', 'AHORA', TEMPORAL, approved), ['immediate', 'approved']);
  // An approved target outside the contract is ignored, never written.
  assert.equal(resolveValue('/visual_guidelines/temporal', 'AHORA', TEMPORAL, [{ ...approved[0], to: 'ya' }]), null);
});

test('migration writes a copy, records every original and leaves the rest of the row alone', () => {
  const library = { config: { name: 'x' }, rows: [
    { id: 'R1', UTTERANCE: 'quiero agua', bitmap: 'data:image/jpeg;base64,AAA', NLU: legacy() },
    { id: 'R2', UTTERANCE: 'ya válida', NLU: structuredClone(nlu) },
    { id: 'R3', UTTERANCE: 'codificada', NLU: JSON.stringify(legacy()) },
  ] };
  const before = JSON.stringify(library);
  const { library: out, report } = migrateLibrary(library, [{ path: '/visual_guidelines/temporal', from: 'ahora', to: 'immediate' }], 'T');
  assert.equal(JSON.stringify(library), before);                                   // input untouched
  assert.deepEqual([report.validBefore, report.validAfter], [1, 3]);
  assert.deepEqual(report.changes, { case: 2, approved: 2 });
  const [r1, r2, r3] = out.rows;
  assert.equal(r1.NLU.visual_guidelines.temporal, 'immediate');
  assert.deepEqual(r1.nluMigration.changes, [
    { path: '/metadata/speech_act', from: 'Directive', to: 'directive', rule: 'case' },
    { path: '/visual_guidelines/temporal', from: 'AHORA', to: 'immediate', rule: 'approved' },
  ]);
  assert.equal(r1.bitmap, 'data:image/jpeg;base64,AAA');
  assert.equal(r1.id, 'R1');
  assert.equal(r2.nluMigration, undefined);                                         // valid rows are not touched
  assert.equal(typeof r3.NLU, 'string');                                            // encoding preserved
  assert.equal(JSON.parse(r3.NLU).visual_guidelines.temporal, 'immediate');
});

test('proposals count free text without printing it', () => {
  const row = { id: 'R', NLU: { ...legacy(), metadata: { ...nlu.metadata, intent: 'Solicitar PRIVADO un vaso de agua' } } };
  const table = proposeTable([{ rows: [row] }]);
  assert.equal(table.paths['/metadata/intent'].freeText, 1);
  assert.doesNotMatch(JSON.stringify(table), /PRIVADO/);
  assert.equal(table.paths['/visual_guidelines/temporal'].values.AHORA.status, 'pending');
});

test('an empty optional string is removed as a lossless repair, keeping its original', async () => {
  const { repairNlu } = await import('../netlify/functions/_shared/nluMigration.js');
  const { validateGeneration: validateDocument } = await import('../schemas/pictos-nlu-schema/index.js');
  const doc = structuredClone(nlu);
  const role = doc.frames[0].roles.Agent;
  Object.assign(role, { ref: 'YO', surface: '' });
  assert.equal(validateDocument(doc), false);
  const changes = repairNlu(doc);
  assert.ok(changes.some(c => c.rule === 'empty' && c.from === ''));
  assert.equal('surface' in role, false);
  assert.equal(validateDocument(doc), true);
});
