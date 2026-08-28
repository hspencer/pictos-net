import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { handler as nlu } from '../api-gemini-nlu.js';
import { handler as structure } from '../api-gemini-structure.js';
import { handler as image } from '../api-gemini-worker-background.js';
import { handler as recraft } from '../api-recraft-worker-background.js';
import { handler as pipeline } from '../api-pipeline-batch-background.js';
import { getBlobStore } from './blobs.js';
const previousCwd = process.cwd();
const keys = ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'PICTOS_ANTHROPIC_KEY', 'RECRAFT_API_KEY'];
const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
let dir;
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-provider-routes-'));
  process.chdir(dir); process.env.NETLIFY_DEV = 'true'; delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"project_id":"test-project"}';
  process.env.PICTOS_ANTHROPIC_KEY = 'test-key'; process.env.RECRAFT_API_KEY = 'test-key';
});
afterEach(() => mock.restoreAll());
after(() => { process.chdir(previousCwd); for (const k of keys) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } fs.rmSync(dir, { recursive: true, force: true }); });
const quota = () => Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429, headers: { 'retry-after': '120', 'x-request-id': 'provider-request' } });
function mockVertex() { mock.method(GoogleAuth.prototype, 'getClient', async () => ({ getAccessToken: async () => ({ token: 'fake-token' }) })); }

test('Gemini sync phases retain terminal status, retry metadata, and no daily-quota invention', async () => {
  mockVertex();
  const upstream = mock.method(globalThis, 'fetch', async () => quota());
  for (const handler of [nlu, structure]) {
    const result = await handler(event({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'synthetic' }] }), {});
    assert.equal(result.statusCode, 429);
    const body = JSON.parse(result.body);
    assert.equal(body.failureSource, 'external_provider_quota');
    assert.equal(body.requestId, 'provider-request'); assert.equal(body.retryAfterMs, 120000);
    assert.equal(body.retryManaged, true); assert.equal(body.attempts, 1);
    assert.doesNotMatch(body.error, /diaria|daily/i);
  }
  assert.equal(upstream.mock.callCount(), 2);
});

test('image terminal 429 and Recraft failed generation refund internal reservation', async () => {
  mockVertex();
  mock.method(globalThis, 'fetch', async () => quota());
  await image(event({ jobId: 'gemini-429', model: 'gemini-2.5-flash-image', prompt: 'synthetic' }), {});
  const result = await getBlobStore('gemini-jobs').get('gemini-429', { type: 'json' });
  assert.equal(result.refundedUnits, 1); assert.equal(result.providerStatus, 429);
  assert.doesNotMatch(result.error, /diaria|daily/i);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'invalid_key' } }, { status: 401 }));
  await recraft(event({ jobId: 'recraft-401', model: 'recraftv4_1', prompt: 'synthetic' }));
  const failed = await getBlobStore('recraft-jobs').get('recraft-401', { type: 'json' });
  assert.equal(failed.refundedUnits, 1); assert.equal(failed.providerStatus, 401); assert.equal(failed.retryable, false);
});

test('terminal quota in Phase 1 stops the batch before any later row or image', async () => {
  const upstream = mock.method(globalThis, 'fetch', async url => {
    assert.match(String(url), /api\.anthropic\.com/);
    return Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'busy' } }, { status: 429, headers: { 'retry-after': '120' } });
  });
  await pipeline(event({ libraryId: 'quota-library', jobId: 'quota-pipeline', rows: [{ rowId: 'first', utterance: 'Beber' }, { rowId: 'later', utterance: 'Comer' }], config: { generationModel: 'recraftv4_1' } }), {});
  assert.equal(upstream.mock.callCount(), 1);
  const store = getBlobStore('pipeline-jobs');
  const failed = await store.get('quota-pipeline/first', { type: 'json' });
  assert.equal(failed.failedPhase, 1); assert.equal(failed.providerStatus, 429); assert.deepEqual(failed.phaseExecutions, []);
  assert.equal((await store.get('quota-pipeline/later', { type: 'json' })).deferred, true);
  const state = await store.get('quota-library/state', { type: 'json' });
  assert.equal(state.state, 'provider_quota_blocked'); assert.equal(state.providerQuotaBlockedPhase, 1);
  assert.equal(state.providerQuotaBlockedProvider, 'claude'); assert.equal(state.refundedGenerationUnits, 2);
});

test('quota in composition or Recraft generation preserves accepted phases and defers the remainder', async () => {
  const validNlu = { utterance: 'Beber agua', lang: 'es-419', metadata: { speech_act: 'directive', intent: 'request' },
    frames: [{ id: 'f1', frame_name: 'Ingestion', lexical_unit: 'beber', roles: { Agent: { type: 'Agent', surface: 'persona' }, Theme: { type: 'Theme', surface: 'agua' } } }],
    nsm_explications: { beber: 'ALGUIEN QUIERE HACER ALGO' }, logical_form: { event: 'beber(persona, agua)', modality: 'want' },
    pragmatics: { politeness: 'neutral', formality: 'neutral', expected_response: 'compliance' },
    visual_guidelines: { focus_actor: 'persona', action_core: 'beber', object_core: 'agua', context: '', temporal: 'immediate' } };
  for (const failurePhase of [2, 3]) {
    let calls = 0;
    mock.method(globalThis, 'fetch', async (url, options) => {
      calls++;
      if (calls === failurePhase) return quota();
      assert.match(String(url), /api\.anthropic\.com/);
      const name = JSON.parse(options.body).tool_choice.name;
      return Response.json({ content: [{ type: 'tool_use', id: 'tool-test', name,
        input: name === 'analyze_utterance' ? validNlu : { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe agua" } }] });
    });
    const jobId = `quota-phase-${failurePhase}`;
    await pipeline(event({ libraryId: jobId, jobId, rows: [{ rowId: 'first', utterance: 'Beber agua' }, { rowId: 'later', utterance: 'Beber agua' }], config: { generationModel: 'recraftv4_1' } }), {});
    assert.equal(calls, failurePhase);
    const store = getBlobStore('pipeline-jobs');
    const failed = await store.get(`${jobId}/first`, { type: 'json' });
    assert.equal(failed.failedPhase, failurePhase);
    assert.deepEqual(failed.nluData, validNlu);
    assert.deepEqual(failed.phaseExecutions.map(e => e.phase), failurePhase === 2 ? [1] : [1, 2]);
    assert.equal((await store.get(`${jobId}/later`, { type: 'json' })).deferred, true);
    assert.equal((await store.get(`${jobId}/state`, { type: 'json' })).refundedGenerationUnits, 2);
    mock.restoreAll();
  }
});

test('batch admission checks the complete requested unit amount without changing the counter on rejection', async () => {
  const { checkAndCharge, DAILY_LIMIT } = await import('./usage.js');
  const email = 'quota-test@example.test';
  const key = `quota/${email}/${new Date().toISOString().slice(0, 10)}`;
  const store = getBlobStore('pictonet-usage');
  await store.setJSON(key, { units: DAILY_LIMIT - 1 });
  assert.equal((await checkAndCharge(email, 25)).allowed, false);
  assert.equal((await store.get(key, { type: 'json' })).units, DAILY_LIMIT - 1);
  assert.equal((await checkAndCharge(email, 1)).allowed, true);
  assert.equal((await store.get(key, { type: 'json' })).units, DAILY_LIMIT);
});

test('Recraft jobs reject traversal and another owner, and unauthorized workers never overwrite', async () => {
  const { handler: poll } = await import('../api-recraft-poll.js');
  const store = getBlobStore('recraft-jobs');
  await store.setJSON('job-private', { owner: 'owner@example.test', svg: '<svg/>' });
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('must not call provider'); });
  // In dev, the worker identity is dev and cannot replace an existing owner.
  await recraft(event({ jobId: 'job-private', prompt: 'synthetic', model: 'recraftv4_1' }));
  assert.equal((await store.get('job-private', { type: 'json' })).owner, 'owner@example.test');
  assert.equal((await poll({ httpMethod: 'GET', queryStringParameters: { jobId: '../escape' } }, {})).statusCode, 400);
  process.env.NETLIFY_DEV = 'false';
  try {
    await recraft(event({ jobId: 'job-private', prompt: 'synthetic', model: 'recraftv4_1' }));
    const query = { httpMethod: 'GET', queryStringParameters: { jobId: 'job-private' } };
    assert.equal((await poll(query, {})).statusCode, 401);
    assert.equal((await poll(query, { clientContext: { user: { email: 'other@example.test' } } })).statusCode, 403);
    const result = await poll(query, { clientContext: { user: { email: 'owner@example.test' } } });
    assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.body), { svg: '<svg/>' });
  } finally { process.env.NETLIFY_DEV = 'true'; }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('Claude proxy keeps hard-billing failures terminal and returns the actual model on success', async () => {
  const { handler } = await import('../api-claude.js');
  const request = event({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'synthetic' }] });
  const failing = mock.method(globalThis, 'fetch', async () => Response.json({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }, { status: 429 }));
  const result = await handler(request, {});
  const failure = JSON.parse(result.body);
  assert.equal(result.statusCode, 429); assert.equal(failure.failureSource, 'external_provider_billing');
  assert.equal(failure.retryable, false); assert.equal(failure.retryManaged, true); assert.equal(failing.mock.callCount(), 1);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ model: 'actual-snapshot', content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } }));
  assert.equal(JSON.parse((await handler(request, {})).body).model, 'actual-snapshot');
});

test('canonical rejection retains known provider usage and returned model for batch accounting', async () => {
  const { runPhase1 } = await import('./pipelineRunner.js');
  mock.method(globalThis, 'fetch', async () => Response.json({ model: 'actual-snapshot', usage: { input_tokens: 30, output_tokens: 12 },
    content: [{ type: 'tool_use', name: 'analyze_utterance', id: 'tool-test', input: {} }] }));
  await assert.rejects(runPhase1('synthetic', {}), error => {
    assert.equal(error.code, 'pipeline_contract_invalid');
    assert.deepEqual(error.usage, { input_tokens: 30, output_tokens: 12 });
    assert.equal(error.actualModel, 'actual-snapshot'); assert.equal(error.provider, 'claude'); assert.equal(error.attempts, 1);
    return true;
  });
});
