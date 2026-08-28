import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applySvgSafeUpdate, captureSvgSource, prepareSvgPromotion, observedSvgProvenance } from './svgCanonical.ts';
import { assertValidSVG, verifySvgReference } from '../schemas/mf-svg-schema/index.js';
import type { RowData } from '../types';
const svg = fs.readFileSync(new URL('../schemas/mf-svg-schema/examples/v2example.svg', import.meta.url), 'utf8');
const metadata = assertValidSVG(svg);
const row = (): RowData => ({ id: 'r', UTTERANCE: metadata.nlu.utterance, NLU: structuredClone(metadata.nlu), ...structuredClone(metadata.composition), rawSvg: '<svg/>', status: 'idle', nluStatus: 'completed', visualStatus: 'completed', bitmapStatus: 'completed' });

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
