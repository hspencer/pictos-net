// Every endpoint admits exactly the models the catalog allows for its phase
// (plan F1). Retired models are never admitted; experimental ones are.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_CATALOG, modelAllowed, modelIdsForPhase, batchModelIds } from './modelCatalog.js';
import { handler as claude } from '../api-claude.js';
import { handler as geminiNlu } from '../api-gemini-nlu.js';
import { handler as geminiStructure } from '../api-gemini-structure.js';
import { handler as batchCreate } from '../api-batch-create.js';

const ids = Object.keys(MODEL_CATALOG);
const keys = ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'PICTOS_ANTHROPIC_KEY'];
const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const previousCwd = process.cwd();
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-model-admission-'));
  process.chdir(dir); process.env.NETLIFY_DEV = 'true'; delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"project_id":"test-project"}';
  process.env.PICTOS_ANTHROPIC_KEY = 'test-key';
  // Nothing leaves the process: an admitted model fails later, at the provider.
  mock.method(globalThis, 'fetch', async () => { throw new Error('network disabled in test'); });
});
after(() => {
  mock.restoreAll(); process.chdir(previousCwd); fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const rejectedByModel = async (handler, body) => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }, {});
  return res.statusCode === 400 && /not allowed/i.test(JSON.parse(res.body).error ?? '');
};

const expectAdmission = async (handler, makeBody, admitted) => {
  for (const id of ids) {
    assert.equal(await rejectedByModel(handler, makeBody(id)), !admitted(id), `${id}`);
  }
};

const text = (provider, phases) => id => modelAllowed(id, provider, phases);

test('catalog: retired models are offered by no phase and admitted by no endpoint', () => {
  const retired = ids.filter(id => MODEL_CATALOG[id].status === 'retired');
  assert.ok(retired.includes('gemini-2.5-pro'));
  for (const id of retired) {
    for (const phase of [1, 2, 3, 5]) assert.ok(!modelIdsForPhase(phase).includes(id), `${id} phase ${phase}`);
    for (const provider of ['claude', 'gemini', 'openai', 'recraft']) assert.ok(!modelAllowed(id, provider, [1, 2, 3, 5]));
  }
});

test('catalog: batch admits only batch-capable workshop or active models', () => {
  assert.deepEqual(batchModelIds(), ['gemini-2.5-flash-image']);
  assert.ok(!batchModelIds().includes('gemini-3.1-flash-image'));
});

test('api-claude admits the Claude models of phases 1, 2 and 5', () =>
  expectAdmission(claude, model => ({ model, messages: [{ role: 'user', content: 'x' }] }), text('claude', [1, 2, 5])));

test('api-gemini-nlu admits the Gemini text models of phases 1 and 2', () =>
  expectAdmission(geminiNlu, model => ({ model, messages: [{ role: 'user', content: 'x' }] }), text('gemini', [1, 2])));

test('api-gemini-structure admits the Gemini models of phase 5', () =>
  expectAdmission(geminiStructure, model => ({ model, messages: [{ role: 'user', content: 'x' }] }), text('gemini', [5])));

test('api-batch-create admits only the batch models', () =>
  expectAdmission(batchCreate, model => ({ libraryId: 'lib', model, rows: [{ rowId: 'r', prompt: 'x' }] }),
    id => batchModelIds().includes(id)));

test('background workers use the same catalog predicate', () => {
  for (const [file, provider, phases] of [
    ['api-gemini-worker-background.js', 'gemini', '[3]'],
    ['api-gemini-structure-background.js', 'gemini', '[5]'],
  ]) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, new RegExp(`modelAllowed\\(model, '${provider}', \\${phases.slice(0, -1)}\\]\\)`), file);
  }
});

test('no endpoint declares its own list of model ids', () => {
  const functions = new URL('../', import.meta.url);
  for (const file of fs.readdirSync(functions).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(new URL(file, functions), 'utf8');
    assert.doesNotMatch(src, /ALLOWED_MODELS\s*=\s*\[|_MODELS\s*=\s*\[\s*'(?:claude|gemini|gpt|recraft)/, file);
  }
});
