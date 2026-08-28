import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applySvgSafeUpdate, captureSvgSource, prepareSvgPromotion, observedSvgProvenance, canStructureSVG, canCertifySVG, prepareSvgDraft, svgForEditing, prepareSvgEditorUpdate } from './svgCanonical.ts';
import { assertValidSVG, verifySvgReference } from '../schemas/mf-svg-schema/index.js';
import type { RowData } from '../types';
import { svgStructureDiagnostic, formatSvgStructureError } from './svgStructureDiagnostics.ts';
import { VOCAB } from '../types.ts';
const svg = fs.readFileSync(new URL('../schemas/mf-svg-schema/examples/v2example.svg', import.meta.url), 'utf8');
const metadata = assertValidSVG(svg);
const row = (): RowData => ({ id: 'r', UTTERANCE: metadata.nlu.utterance, NLU: structuredClone(metadata.nlu), ...structuredClone(metadata.composition), rawSvg: '<svg/>', status: 'idle', nluStatus: 'completed', visualStatus: 'completed', bitmapStatus: 'completed' });

test('historical delivery NLU allows draft structuring while explaining blocked certification without changing trace or semantic evidence', () => {
  const library = JSON.parse(fs.readFileSync(new URL('../public/libraries/escena_descriptiva_graph_2026-08-26.json', import.meta.url), 'utf8'));
  const historical = { ...library.rows.find((r: RowData) => r.UTTERANCE === 'Abro la app de delivery en mi teléfono'), rawSvg: '<svg/>' };
  const before = JSON.stringify(historical);
  assert.deepEqual(canStructureSVG(historical), { eligible: true });
  assert.deepEqual(canCertifySVG(historical), { eligible: false, reasonKey: 'nluNeedsReview', fields: [
    '/metadata/speech_act', '/metadata/intent', '/pragmatics/formality', '/pragmatics/expected_response', '/visual_guidelines/temporal',
  ] });
  assert.equal(JSON.stringify(historical), before);
});

test('draft admission and canonical certification have distinct requirements', () => {
  const valid = row();
  assert.deepEqual(canStructureSVG(valid), { eligible: true });
  assert.equal(canStructureSVG({ ...valid, rawSvg: undefined }).reasonKey, 'traceRequired');
  assert.equal(canStructureSVG({ ...valid, rawSvgDiscarded: true }).reasonKey, 'traceRequired');
  assert.equal(canStructureSVG({ ...valid, NLU: undefined, prompt: '' }).eligible, true);
  assert.equal(canStructureSVG({ ...valid, elements: [] }).reasonKey, 'elementsRequired');
  assert.equal(canStructureSVG({ ...valid, elements: [{id: 'a'}, {id: 'a'}] as any }).reasonKey, 'invalidElementTree');
  assert.equal(canCertifySVG({ ...valid, NLU: undefined }).reasonKey, 'nluNeedsReview');
  assert.equal(canCertifySVG({ ...valid, prompt: '' }).reasonKey, 'compositionNeedsReview');
  assert.equal(canCertifySVG({ ...valid, UTTERANCE: 'different utterance' }).reasonKey, 'semanticInputsMismatch');
  for (const locale of ['es-419', 'en-GB']) {
    const messages = JSON.parse(fs.readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'));
    for (const key of ['traceRequired', 'nluNeedsReview', 'compositionNeedsReview', 'semanticInputsMismatch']) assert.ok(messages.svgGenerator[key]);
  }
});

test('every metadata choice offered by the NLU editor satisfies the canonical profile', () => {
  for (const key of ['speech_act', 'intent'] as const) {
    for (const value of VOCAB[key]) {
      const candidate = row();
      candidate.NLU = { ...structuredClone(metadata.nlu), metadata: { ...metadata.nlu.metadata, [key]: value } };
      assert.equal(canCertifySVG(candidate).eligible, true, `${key}: ${value}`);
    }
  }
});

test('canonical promotion validates and hashes exact final bytes, then keeps transient source out of persisted rows', async () => {
  const before = row();
  const update = await prepareSvgPromotion(before, svg);
  const accepted = applySvgSafeUpdate(before, update);
  assert.equal(accepted.structuredSvg, svg);
  assert.equal(await verifySvgReference(accepted.structuredSvg, accepted.svgReference), true);
  assert.equal('svgSourceSnapshot' in accepted, false);
});
test('late generation cannot overwrite changed semantic inputs, geometry or a newer canonical revision', async () => {
  const before = row();
  const update = await prepareSvgPromotion(before, svg);
  for (const changed of [{ ...before, prompt: 'changed' }, { ...before, rawSvg: '<svg>changed</svg>' }, { ...before, structuredSvg: 'newer canonical bytes' }]) assert.equal(applySvgSafeUpdate(changed, update), changed);
  assert.equal(applySvgSafeUpdate(before, { structuredSvg: svg }), before);
});
test('upstream edits invalidate reference while preserving prior canonical SVG bytes', async () => {
  const before = applySvgSafeUpdate(row(), await prepareSvgPromotion(row(), svg));
  const next = applySvgSafeUpdate(before, { prompt: 'changed' });
  assert.equal(next.structuredSvg, before.structuredSvg);
  assert.equal(next.svgReference, undefined);
  assert.equal(next.structuredSvgStatus, 'outdated');
});
test('manual edits create a distinct unreviewed revision and reject malformed candidates', async () => {
  const before = applySvgSafeUpdate(row(), await prepareSvgPromotion(row(), svg));
  const update = await prepareSvgPromotion(before, svg, true);
  const next = applySvgSafeUpdate(before, update);
  assert.notEqual(next.svgReference?.revisionId, before.svgReference?.revisionId);
  assert.equal(assertValidSVG(next.structuredSvg).revision.parentSha256, before.svgReference?.sha256);
  await assert.rejects(prepareSvgPromotion(before, '<svg>', true));
  await assert.rejects(prepareSvgPromotion({ ...before, prompt: 'changed while editor was open' }, svg, true), /differs from current row/);
  assert.equal(captureSvgSource(before), update.svgSourceSnapshot);
});
test('provenance projection never embeds original prompts, request snapshots or arbitrary execution fields', () => {
  const before = row();
  before.phaseExecutions = [{ id: 'e', phase: 1, model: 'observed-model', inputHash: 'hash', inputSnapshot: { privatePrompt: 'never embed' }, arbitrary: 'never embed' } as any];
  const projected = observedSvgProvenance(before);
  assert.deepEqual(projected.phaseExecutions, [{ id: 'e', phase: 1, model: 'observed-model', inputHash: 'hash' }]);
});


test('passive drafts preserve canonical authority and late drafts cannot overwrite current edits', async () => {
  const before = applySvgSafeUpdate(row(), await prepareSvgPromotion(row(), svg));
  const draft = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
  const update = prepareSvgDraft(before, draft, { key: 'bindingsNeedReview' });
  const next = applySvgSafeUpdate(before, update);
  assert.equal(next.structuredSvgDraft, draft);
  assert.equal(next.structuredSvg, before.structuredSvg);
  assert.deepEqual(next.svgReference, before.svgReference);
  const edited = { ...before, prompt: 'changed' };
  assert.equal(applySvgSafeUpdate(edited, update), edited);
  assert.equal(applySvgSafeUpdate(before, { structuredSvgDraft: draft }), before);
  assert.throws(() => prepareSvgDraft(before, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  assert.throws(() => prepareSvgDraft(before, '<svg xmlns="http://www.w3.org/2000/svg"><path onload="alert(1)"/></svg>'));
  await assert.rejects(prepareSvgPromotion(before, draft));
});

test('structuring failures use localized messages instead of raw provider or validator text', () => {
  const errors = [new Error('NLU does not satisfy the complete canonical generation profile'), new Error('Composition prompt omits an element'), new Error('No geometry or supplied implicit binding for composition element: dedo'), new Error('Unauthorized (no valid authorization grant)'), new Error('RESOURCE_EXHAUSTED'), new Error('Malformed SVG XML'), new Error('Invalid mapping groups'), new Error('unrecognized provider response')];
  for (const locale of ['es-419', 'en-GB']) {
    const messages = JSON.parse(fs.readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'));
    for (const error of errors) {
      const diagnostic = svgStructureDiagnostic(error);
      assert.ok(messages.svgGenerator[diagnostic.key]);
      const rendered = formatSvgStructureError(error, key => messages.svgGenerator[key.split('.').at(-1)!]);
      assert.notEqual(rendered, error.message);
      assert.ok(rendered.length > 20);
    }
  }
});

test('draft selection and editing preserve trace and canonical bytes and reject late results', async () => {
  const canonical = applySvgSafeUpdate(row(), await prepareSvgPromotion(row(), svg));
  const original = '<svg xmlns="http://www.w3.org/2000/svg"><g id="draft"><path d="M0 0L1 1"/></g></svg>';
  const before = applySvgSafeUpdate(canonical, prepareSvgDraft(canonical, original, { key: 'structureFailed' }));
  assert.deepEqual(svgForEditing(before, 'draft'), { svg: original, source: 'draft' });
  assert.equal(svgForEditing(canonical, 'draft'), undefined);
  assert.equal(svgForEditing(before, 'raw')?.svg, before.rawSvg);
  assert.equal(svgForEditing(before, 'structured')?.svg, before.structuredSvg);
  const edited = original.replace('M0 0L1 1', 'M0 0L2 2');
  const update = await prepareSvgEditorUpdate(before, 'draft', edited);
  const saved = applySvgSafeUpdate(before, update);
  assert.equal(saved.structuredSvgDraft, edited);
  assert.equal(saved.structuredSvgDraftDiagnostic?.key, 'draftEdited');
  assert.equal(saved.rawSvg, before.rawSvg);
  assert.equal(saved.structuredSvg, before.structuredSvg);
  assert.deepEqual(saved.svgReference, before.svgReference);
  assert.equal(saved.structuredSvgStatus, 'completed');
  assert.equal(applySvgSafeUpdate(saved, update), saved, 'a late result cannot replace an edited draft');
  await assert.rejects(prepareSvgEditorUpdate(before, 'draft', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'));
});

test('known certification failures retain distinct localized diagnoses, including review fields', () => {
  const cases = [
    ['Metadata schema violation: /bindings/0 required; /accessibility/title minLength', 'metadataNeedsReview'],
    ['SVG accessible text differs from embedded evidence', 'accessibilityNeedsReview'],
    ['Semantic group attributes differ from composition', 'groupAttributesNeedReview'],
    ['Semantic group has no geometry', 'bindingsNeedReview'],
    ['Binding must reference a unique real SVG group', 'bindingsNeedReview'],
    ['SVG viewBox must have finite positive dimensions', 'invalidViewBox'],
    ['Unresolved SVG/ARIA reference', 'invalidSvg'],
  ];
  for (const [message, key] of cases) assert.equal(svgStructureDiagnostic(new Error(message)).key, key);
  assert.deepEqual(svgStructureDiagnostic(new Error(cases[0][0])).fields, ['/bindings/0', '/accessibility/title']);
  assert.deepEqual(svgStructureDiagnostic(new Error('No geometry or supplied implicit binding for composition element: olla')).fields, ['olla']);
  // Exercise the actual validator, not only handwritten error strings.
  assert.throws(() => assertValidSVG(svg.replace('role="group"', 'role="img"')), error => {
    assert.equal(svgStructureDiagnostic(error).key, 'groupAttributesNeedReview');
    return true;
  });
  for (const locale of ['es-419', 'en-GB']) {
    const messages = JSON.parse(fs.readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), 'utf8'));
    for (const [, key] of cases) assert.ok(messages.svgGenerator[key]);
  }
});
