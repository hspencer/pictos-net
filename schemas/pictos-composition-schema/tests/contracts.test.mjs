import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProvider, validateDocument, validateElementTree, providerSchema, documentSchema } from '../index.js';

const child = { id: 'persona', concept: 'Agent', children: [{ id: 'vaso', concept: 'Object' }] };
const provider = { elements: [child], prompt: "'persona' sostiene 'vaso'." };

test('provider and artifact contracts share identical recursive semantic constraints', () => {
  assert.deepEqual(providerSchema.$defs, documentSchema.$defs);
  assert.deepEqual(providerSchema.properties.prompt, documentSchema.properties.prompt);
});

test('provider children and deterministic-root artifact are distinct contracts', () => {
  assert.equal(validateProvider(provider), true);
  assert.equal(validateDocument(provider), false);
  const artifact = { ...provider, elements: [{ id: 'pictograma', concept: 'Root', children: provider.elements }] };
  assert.equal(validateDocument(artifact), true);
  assert.equal(validateProvider(artifact), false);
  assert.equal(validateProvider({ ...provider, prompt: "The person's hand raises 'vaso' beside 'persona'." }), true);
});

test('recursive validation rejects malformed deep nodes, duplicate ids, empty trees and invented references', () => {
  const deep = structuredClone(provider);
  deep.elements[0].children[0].children = [{ id: 'dedo', concept: 'Element', children: [{}] }];
  assert.equal(validateProvider(deep), false);
  assert.equal(validateProvider({ ...provider, elements: [] }), false);
  assert.equal(validateProvider({ ...provider, elements: [child, { id: 'vaso', concept: 'Object' }] }), false);
  assert.equal(validateProvider({ ...provider, prompt: "'persona' sostiene 'vaso' sobre 'mesa'." }), false);
  assert.equal(validateProvider({ ...provider, prompt: "'persona' sostiene algo." }), false);
  assert.equal(validateProvider({ ...provider, prompt: '  ' }), false);
  assert.equal(validateProvider({ ...provider, elements: [{ id: 'pictograma', concept: 'Element' }] }), false);
  assert.equal(validateProvider({ ...provider, elements: [{ id: 'persona' }] }), false);
});

test('prompt regeneration validates the existing rooted tree without inventing a temporary prompt', () => {
  const tree = [{ id: 'pictograma', concept: 'Root', children: provider.elements }];
  assert.equal(validateElementTree(tree), true);
  assert.equal(validateElementTree(provider.elements), false);
  assert.equal(validateElementTree([]), false);
  assert.equal(validateElementTree([{ ...tree[0], children: [child, child] }]), false);
  assert.equal(validateElementTree([{ ...tree[0], children: [{ id: 'pictogram', concept: 'Element' }] }]), false);
});
