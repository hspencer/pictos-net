import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateDocument, validateGeneration, documentSchema, generationSchema } from '../index.js';
import { generationProfile } from '../scripts/generation-profile.js';
import fixture from './generation/valid.json' with { type: 'json' };
import frozenSchema from '../pictonet-nlu-1.0.1.schema.json' with { type: 'json' };

test('portable generation profile is deterministically derived from the canonical document', () => {
  assert.deepEqual(generationSchema, generationProfile(documentSchema));
});

test('1.1.0 document preserves every 1.0.1 constraint except its optional explicit version field', () => {
  const comparable = schema => {
    const { $id, title, description, ...constraints } = structuredClone(schema);
    delete constraints.properties.schemaVersion;
    return constraints;
  };
  assert.deepEqual(comparable(documentSchema), comparable(frozenSchema));
});

test('historical 1.0.1 is frozen and its examples remain valid documents', () => {
  const expected = JSON.parse(fs.readFileSync(new URL('../FROZEN_RELEASES.json', import.meta.url)));
  for (const [filename, digest] of Object.entries(expected)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../' + filename, import.meta.url))).digest('hex'), digest);
  }
  for (const filename of fs.readdirSync(new URL('./valid/', import.meta.url))) {
    assert.equal(validateDocument(JSON.parse(fs.readFileSync(new URL('./valid/' + filename, import.meta.url)))), true, filename);
  }
});

test('generation profile requires current semantic fields but preserves optional historical document fields', () => {
  assert.equal(validateGeneration(fixture), true);
  const historical = structuredClone(fixture);
  delete historical.nsm_explications;
  assert.equal(validateDocument(historical), true);
  assert.equal(validateGeneration(historical), false);
  for (const [field, bad] of [['frames', []], ['nsm_explications', {}], ['utterance', '   ']]) {
    assert.equal(validateGeneration({ ...fixture, [field]: bad }), false, field);
  }
  assert.equal(validateGeneration({ ...fixture, invented: true }), false);
});

test('role evidence, unique frame ids and ref_frame targets are enforced', () => {
  const bad = structuredClone(fixture);
  bad.frames[0].roles.Agent = { type: 'Agent' };
  assert.equal(validateGeneration(bad), false);
  bad.frames[0].roles.Agent = { type: 'Agent', surface: '  ' };
  assert.equal(validateGeneration(bad), false);
  bad.frames[0].roles.Agent = { type: 'Event', ref_frame: 'f1' };
  assert.equal(validateGeneration(bad), true);
  bad.frames[0].roles.Agent.ref_frame = 'Ingestion';
  assert.equal(validateGeneration(bad), false);
  bad.frames = [...fixture.frames, ...fixture.frames];
  assert.equal(validateGeneration(bad), false);
});
