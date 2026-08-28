import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openaiImageRequest, generateOpenAIImage } from './openaiImage.js';
import { handler as worker } from '../api-openai-worker-background.js';
import { handler as poll } from '../api-openai-poll.js';
import { handler as check } from '../api-check.js';
import { handler as pipeline } from '../api-pipeline-batch-background.js';
import { getBlobStore } from './blobs.js';

const originalCwd = process.cwd();
const envKeys = ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'OPENAI_API_KEY', 'PICTOS_OPENAI_KEY', 'PICTOS_ANTHROPIC_KEY'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let testDir;
const params = { model: 'gpt-image-2', prompt: 'AAC pictogram: "Beber agua"\n- persona\n  - vaso\nNo text.' };
const png = 'iVBORw0KGgo=';
const event = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });
const readResult = async jobId => JSON.parse((await poll({ httpMethod: 'GET', queryStringParameters: { jobId } }, {})).body);

before(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-openai-test-'));
  process.chdir(testDir);
  process.env.NETLIFY_DEV = 'true';
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  delete process.env.PICTOS_OPENAI_KEY;
  process.env.PICTOS_ANTHROPIC_KEY = 'test-anthropic-key';
});
afterEach(() => mock.restoreAll());
after(() => {
  process.chdir(originalCwd);
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('sends the complete prompt unchanged, economical defaults and only Image API parameters', () => {
  assert.deepEqual(openaiImageRequest(params), {
    ...params, quality: 'low', n: 1, size: '1024x1024', output_format: 'png', background: 'opaque',
  });
  for (const quality of ['low', 'medium', 'high']) {
    assert.equal(openaiImageRequest({ ...params, quality }).quality, quality);
  }
  for (const bad of [{ model: 'gpt-4o' }, { quality: 'auto' }, { prompt: '' }, { prompt: 'x'.repeat(32001) }, { prompt: {} }]) {
    assert.throws(() => openaiImageRequest({ ...params, ...bad }));
  }
  assert.equal(openaiImageRequest({ ...params, prompt: 'x'.repeat(32000) }).prompt.length, 32000);
});

test('returns a bitmap, chosen quality and real provider token usage', async () => {
  const usage = { input_tokens: 100, output_tokens: 196 };
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer test-key-not-real');
    assert.equal(JSON.parse(options.body).prompt, params.prompt);
    assert.ok(options.signal);
    return Response.json({ data: [{ b64_json: png }], usage }, { headers: { 'x-request-id': 'req-test' } });
  });
  assert.deepEqual(await generateOpenAIImage({ ...params, quality: 'medium' }), {
    bitmap: `data:image/png;base64,${png}`, generationQuality: 'medium', usage, requestId: 'req-test',
  });
});

test('keeps quota, authentication and moderation failures explicit, without replaying or leaking provider messages', async () => {
  for (const [status, code] of [[429, 'insufficient_quota'], [401, 'invalid_api_key'], [400, 'moderation_blocked']]) {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      error: { code, message: 'secret provider echo test-key-not-real' },
    }, { status, headers: { 'x-request-id': 'req-failure', 'retry-after': '2' } }));
    await assert.rejects(generateOpenAIImage(params), e => {
      assert.equal(e.status, status);
      assert.equal(e.request_id, 'req-failure');
      assert.equal(e.message, `OpenAI ${status}: ${code}`);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test('missing image and ambiguous transport failure do not become successes or automatic paid retries', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
  await assert.rejects(generateOpenAIImage(params), /no image data/);
  mock.restoreAll();
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('fetch failed'); });
  await assert.rejects(generateOpenAIImage(params), /fetch failed/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('worker and poll preserve bitmap and quality, and consume the finished result', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ b64_json: png }], usage: { input_tokens: 20, output_tokens: 196 } }));
  await worker(event({ ...params, quality: 'high', jobId: 'openai-success' }));
  assert.deepEqual(await readResult('openai-success'), { bitmap: `data:image/png;base64,${png}`, generationQuality: 'high' });
  assert.deepEqual(await readResult('openai-success'), { pending: true });
});

test('worker returns terminal validation/config errors before contacting provider', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  await worker(event({ ...params, model: 'gpt-4o', jobId: 'openai-invalid' }));
  assert.match((await readResult('openai-invalid')).error, /Unsupported/);
  delete process.env.OPENAI_API_KEY;
  try {
    await worker(event({ ...params, jobId: 'openai-no-key' }));
    assert.match((await readResult('openai-no-key')).error, /not configured/);
  } finally { process.env.OPENAI_API_KEY = 'test-key-not-real'; }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('worker 429 is external quota, preserves correlation and reports its refund', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, {
    status: 429, headers: { 'x-request-id': 'req-quota', 'retry-after': '3' },
  }));
  await worker(event({ ...params, jobId: 'openai-quota' }));
  const result = await readResult('openai-quota');
  assert.equal(result.failureSource, 'external_provider_quota');
  assert.equal(result.provider, 'openai');
  assert.equal(result.providerStatus, 429);
  assert.equal(result.requestId, 'req-quota');
  assert.equal(result.retryAfterMs, 3000);
  assert.equal(result.refundedUnits, 1);
  assert.equal(result.quotaExceeded, undefined);
});

test('image billing failure is not recoverable and another owner cannot replace an existing job', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }));
  await worker(event({ ...params, jobId: 'openai-billing' }));
  const failure = await readResult('openai-billing');
  assert.equal(failure.failureSource, 'external_provider_billing');
  assert.equal(failure.retryable, false);
  assert.equal(failure.recoverable, false);
  await getBlobStore('openai-jobs').setJSON('openai-other-owner', { owner: 'other@example.test', bitmap: 'preserve' });
  await worker(event({ ...params, jobId: 'openai-other-owner' }));
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal((await getBlobStore('openai-jobs').get('openai-other-owner', { type: 'json' })).bitmap, 'preserve');
});

const validNlu = {"utterance": "Beber agua", "lang": "es-419", "metadata": {"speech_act": "directive", "intent": "request"}, "frames": [{"id": "f1", "frame_name": "Ingestion", "lexical_unit": "beber", "roles": {"Agent": {"type": "Agent", "surface": "persona"}, "Theme": {"type": "Theme", "surface": "agua"}}}], "nsm_explications": {"beber": "ALGUIEN QUIERE HACER ALGO"}, "logical_form": {"event": "beber(persona, agua)", "modality": "want"}, "pragmatics": {"politeness": "neutral", "formality": "neutral", "expected_response": "compliance"}, "visual_guidelines": {"focus_actor": "persona", "action_core": "beber", "object_core": "agua", "context": "", "temporal": "immediate"}};

test('full pipeline preserves semantic artifacts and quality; stops on OpenAI quota without trying later rows', async () => {
  const nlu = validNlu;
  let imageCalls = 0;
  let nluCalls = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('api.anthropic.com')) {
      nluCalls++;
      const body = JSON.parse(options.body);
      const name = body.tool_choice.name;
      const input = name === 'analyze_utterance' ? nlu : { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe agua" };
      return Response.json({ content: [{ type: 'tool_use', id: 'tool-test', name, input }] });
    }
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    const body = JSON.parse(options.body);
    assert.match(body.prompt, /Semantic context: persona — beber — agua/);
    assert.match(body.prompt, /'persona' bebe agua/);
    assert.equal(body.quality, 'medium');
    imageCalls++;
    return imageCalls === 1
      ? Response.json({ data: [{ b64_json: png }] })
      : Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 });
  });
  await pipeline(event({
    libraryId: 'test-library', jobId: 'test-pipeline',
    rows: [{ rowId: 'done', utterance: 'Beber agua' }, { rowId: 'quota', utterance: 'Beber agua' }, { rowId: 'later', utterance: 'Beber agua' }],
    config: { generationModel: 'gpt-image-2', openaiImageQuality: 'medium' },
  }), {});
  const store = getBlobStore('pipeline-jobs');
  const completed = await store.get('test-pipeline/done', { type: 'json' });
  assert.equal(completed.generationQuality, 'medium');
  assert.deepEqual(completed.phaseExecutions.map(execution => execution.phase), [1, 2]);
  assert.deepEqual(completed.phaseExecutions.map(execution => execution.contractVersion), ['1.1.0', '0.1.0']);
  assert.ok(completed.phaseExecutions.every(execution => execution.validated && /^[a-f0-9]{64}$/.test(execution.contractHash)));
  assert.doesNotMatch(JSON.stringify(completed.phaseExecutions), /test-anthropic-key|test-key-not-real/);
  const failed = await store.get('test-pipeline/quota', { type: 'json' });
  assert.deepEqual(failed.nluData, nlu);
  assert.equal(failed.rowState, 'phase3_error');
  assert.deepEqual(failed.phaseExecutions.map(execution => execution.phase), [1, 2]);
  assert.equal(failed.failureSource, 'external_provider_quota');
  const deferred = await store.get('test-pipeline/later', { type: 'json' });
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.phaseExecutions, undefined);
  const state = await store.get('test-library/state', { type: 'json' });
  assert.equal(state.state, 'provider_quota_blocked');
  assert.equal(state.refundedGenerationUnits, 2);
  assert.equal(imageCalls, 2);
  assert.equal(nluCalls, 4);
});

test('a composition contract failure retains accepted NLU provenance without inventing a phase 2 execution', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /api\.anthropic\.com/);
    calls++;
    const name = JSON.parse(options.body).tool_choice.name;
    return Response.json({ content: [{ type: 'tool_use', id: 'tool-test', name,
      input: name === 'analyze_utterance' ? validNlu : { elements: [], prompt: 'invalid empty tree' },
    }] });
  });
  await pipeline(event({
    libraryId: 'partial-library', jobId: 'partial-pipeline',
    rows: [{ rowId: 'partial', utterance: 'Beber agua' }],
    config: { generationModel: 'gpt-image-2' },
  }), {});
  const result = await getBlobStore('pipeline-jobs').get('partial-pipeline/partial', { type: 'json' });
  assert.deepEqual(result.nluData, validNlu);
  assert.deepEqual(result.phaseExecutions.map(execution => execution.phase), [1]);
  assert.match(result.error, /Phase 2 contract validation failed/);
  assert.equal(result.elements, undefined);
  assert.equal(calls, 2);
});

test('poll rejects path traversal, anonymous access, and another owner without consuming the result', async () => {
  assert.equal((await poll({ httpMethod: 'GET', queryStringParameters: { jobId: '../escape' } }, {})).statusCode, 400);
  await getBlobStore('openai-jobs').setJSON('openai-private', { owner: 'owner@example.test', bitmap: png });
  process.env.NETLIFY_DEV = 'false';
  try {
    const query = { httpMethod: 'GET', queryStringParameters: { jobId: 'openai-private' } };
    assert.equal((await poll(query, {})).statusCode, 401);
    assert.equal((await poll(query, { clientContext: { user: { email: 'other@example.test' } } })).statusCode, 403);
    assert.equal((await poll(query, { clientContext: { user: { email: 'owner@example.test' } } })).statusCode, 200);
  } finally { process.env.NETLIFY_DEV = 'true'; }
});

test('connection check only reads the model, never creates an image', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models/gpt-image-2');
    assert.equal(options.method, undefined);
    return Response.json({ id: 'gpt-image-2' });
  });
  const result = await check(event({ service: 'openai' }), {});
  assert.equal(JSON.parse(result.body).ok, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});
