import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatModelPrice, modelPriceNotes } from './modelPricing.ts';
import { MODEL_CATALOG, modelIdsForPhase, getModelProvider, modelSupportsPhase } from '../netlify/functions/_shared/modelCatalog.js';
import { migrateGenerationModel, getModelFamily, DEFAULT_GENERATION_MODEL, DEFAULT_NLU_MODEL, DEFAULT_PHASE5_MODEL } from '../types.ts';

const en = JSON.parse(readFileSync(new URL('../locales/en-GB.json', import.meta.url), 'utf8'));
const t = (key: string, vars: Record<string, string | number> = {}) =>
  key.split('.').reduce((value, part) => value[part], en).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`);

test('selectors and preserved model migration use the shared capability catalog', () => {
  assert.equal(DEFAULT_GENERATION_MODEL, 'gemini-2.5-flash-image');
  assert.equal(DEFAULT_NLU_MODEL, 'claude-haiku-4-5-20251001');
  assert.equal(DEFAULT_PHASE5_MODEL, 'claude-sonnet-4-6');
  assert.deepEqual(modelIdsForPhase(1), modelIdsForPhase(2));
  for (const model of modelIdsForPhase(3)) {
    assert.equal(migrateGenerationModel(model), model);
    assert.equal(getModelFamily(model as any), MODEL_CATALOG[model].output);
  }
  assert.equal(modelIdsForPhase(3).filter(id => getModelProvider(id) === 'recraft').length, 12);
  assert.equal(modelSupportsPhase('gpt-image-2', 2), false);
  assert.equal(modelSupportsPhase('gpt-5.6-luna', 5), true);
  assert.equal(modelSupportsPhase('constructor', 1), false);
  assert.throws(() => getModelProvider('unknown-model'), /Unsupported/);
});

test('prices distinguish token rates from images and retain conditional bounds', () => {
  assert.match(formatModelPrice('gpt-5.6-luna', t), /US\$0.20 input \/ US\$1.20 output per 1M tokens/);
  assert.match(formatModelPrice('gpt-image-2', t, 'medium'), /0.053.*image/);
  assert.match(formatModelPrice('recraftv4_styles_vector', t), /0.05.*image/);
  assert.match(formatModelPrice('gpt-image-2', t, 'high'), /0.211.*image/);
  assert.match(formatModelPrice('gemini-3-pro-image', t), /0.134.*image/);
  assert.match(modelPriceNotes('gemini-2.5-pro', t).join(' '), /200000.*US\$2.50.*US\$15.00/);
  assert.match(modelPriceNotes('gpt-5.6-terra', t).join(' '), /272000.*US\$4.00.*US\$18.00/);
  assert.match(modelPriceNotes('recraftv4_styles', t).join(' '), /existing Recraft style ID/);
  for (const value of Object.values(MODEL_CATALOG)) {
    assert.match(value.pricingSource, /^https:\/\//);
    assert.equal(value.pricingCheckedAt, '2026-08-27');
  }
});
