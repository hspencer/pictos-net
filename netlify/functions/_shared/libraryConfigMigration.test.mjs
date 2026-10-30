import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLibraryConfig } from './libraryConfigMigration.js';

const BASE = [
  { id: 'k', selectors: ['.k', '.main'], rules: [{ id: '1', property: 'fill', value: '#1a1a1a' }, { id: '2', property: 'stroke', value: '#ffffff' }] },
  { id: 'f', selectors: ['.f', '.w'], rules: [{ id: '3', property: 'fill', value: '#ffffff' }] },
  { id: 'a', selectors: ['.accent'], rules: [{ id: '4', property: 'fill', value: '#e53935' }] },
];
const rule = (defs, selector, property) => defs.find(d => d.selectors.includes(selector))?.rules.find(r => r.property === property)?.value;

test('a retired model is removed so the phase follows the default', () => {
  const { config, changes } = migrateLibraryConfig({ comprenderModel: 'gemini-2.5-flash', componerModel: 'claude-haiku-4-5-20251001', phase5Model: 'claude-opus-4-6' });
  assert.equal(config.comprenderModel, undefined);
  assert.equal(config.componerModel, 'claude-haiku-4-5-20251001');
  assert.equal(config.phase5Model, 'claude-opus-4-6', 'a valid user choice is kept');
  assert.ok(changes.some(c => c.includes('comprenderModel')));
});

test('unknown models and models used outside their phase are removed', () => {
  const { config } = migrateLibraryConfig({ generationModel: 'no-such-model', phase5Model: 'claude-haiku-4-5-20251001' });
  assert.equal(config.generationModel, undefined);
  assert.equal(config.phase5Model, undefined);
});

test('renamed preview ids map to stable ids', () => {
  assert.equal(migrateLibraryConfig({ generationModel: 'gemini-3-pro-image-preview' }).config.generationModel, 'gemini-3-pro-image');
});

test('legacy imageModel maps only when no generationModel is set, then is removed', () => {
  assert.equal(migrateLibraryConfig({ imageModel: 'pro' }).config.generationModel, 'gemini-3-pro-image');
  const both = migrateLibraryConfig({ imageModel: 'pro', generationModel: 'gpt-image-2', aspectRatio: '1:1' }).config;
  assert.equal(both.generationModel, 'gpt-image-2');
  assert.equal(both.imageModel, undefined);
  assert.equal(both.aspectRatio, undefined);
});

test('templates drop every declared model', () => {
  const { config } = migrateLibraryConfig({ imageModel: 'pro', generationModel: 'gemini-3.1-flash-image', phase5Model: 'claude-opus-4-6', lang: 'es' }, { pins: 'drop' });
  assert.deepEqual(Object.keys(config), ['lang']);
});

test('legacy styles keep their colours by role: dark repaints .k, light repaints .f', () => {
  const legacy = { f: { fill: '#000000', stroke: 'none', strokeWidth: 0 }, k: { fill: '#ffffff', stroke: 'none', strokeWidth: 0 } };
  const { config } = migrateLibraryConfig({ svgStyles: legacy }, { baseStyleDefs: BASE });
  assert.equal(config.svgStyles, undefined);
  assert.equal(rule(config.svgStyleDefs, '.k', 'fill'), '#000000');
  assert.equal(rule(config.svgStyleDefs, '.k', 'stroke'), 'none', 'no white outline the legacy style never had');
  assert.equal(rule(config.svgStyleDefs, '.f', 'fill'), '#ffffff');
  assert.equal(rule(config.svgStyleDefs, '.accent', 'fill'), '#e53935', 'other default classes survive');
  assert.equal(rule(BASE, '.k', 'fill'), '#1a1a1a', 'base definitions are not mutated');
});

test('an extra legacy class is added; existing svgStyleDefs win over svgStyles', () => {
  const { config } = migrateLibraryConfig({ svgStyles: { f: { fill: '#000000' }, k: { fill: '#ffffff' }, sky: { fill: '#4fc3f7' } } }, { baseStyleDefs: BASE });
  assert.equal(rule(config.svgStyleDefs, '.sky', 'fill'), '#4fc3f7');
  const kept = migrateLibraryConfig({ svgStyles: { f: { fill: '#000' } }, svgStyleDefs: BASE }, { baseStyleDefs: BASE }).config;
  assert.equal(kept.svgStyleDefs, BASE);
  assert.equal(kept.svgStyles, undefined);
});

test('the input is not mutated', () => {
  const input = { imageModel: 'pro', comprenderModel: 'gemini-2.5-flash' };
  migrateLibraryConfig(input);
  assert.deepEqual(input, { imageModel: 'pro', comprenderModel: 'gemini-2.5-flash' });
});
