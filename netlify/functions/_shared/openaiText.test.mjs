import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOpenAITextRequest, openAIResponseToClaude, generateOpenAIText } from './openaiText.js';
import { buildNluRequest, buildCompositionRequest } from './pipelineContracts.js';
import { runPhase1, runPhase2, composeRecraftPrompt } from './pipelineRunner.js';
import { handler as proxy } from '../api-openai-text.js';
import { handler as worker } from '../api-openai-text-background.js';
import { handler as stage } from '../api-structure-stage.js';
import { handler as geminiWorker } from '../api-gemini-structure-background.js';
import { handler as geminiPoll } from '../api-gemini-structure-poll.js';
import { GoogleAuth } from 'google-auth-library';
import { handler as poll } from '../api-openai-text-poll.js';
import { handler as check } from '../api-check.js';
import { getBlobStore } from './blobs.js';

const nlu = { utterance: 'Beber agua', lang: 'es-419', metadata: { speech_act: 'directive', intent: 'request' }, frames: [{ id: 'f1', frame_name: 'Ingestion', lexical_unit: 'beber', roles: { Agent: { type: 'Agent', surface: 'persona' } } }], nsm_explications: { beber: 'ALGUIEN QUIERE HACER ALGO' }, logical_form: { event: 'beber(persona, agua)', modality: 'want' }, pragmatics: { politeness: 'neutral', formality: 'neutral', expected_response: 'compliance' }, visual_guidelines: { focus_actor: 'persona', action_core: 'beber', object_core: 'agua', context: '', temporal: 'immediate' } };
const composition = { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe agua" };
const params = buildNluRequest(nlu.utterance, { comprenderModel: 'gpt-5.6-luna' });
const reply = (name, args, extra = {}) => ({ status: 'completed', model: 'gpt-5.6-luna-observed',
  output: [{ type: 'function_call', name, arguments: JSON.stringify(args), status: 'completed' }],
  usage: { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 10 } }, ...extra });
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });
const originalCwd = process.cwd();
const envNames = ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'OPENAI_API_KEY', 'PICTOS_OPENAI_KEY', 'RECRAFT_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'];
const originalEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-openai-text-'));
  process.chdir(dir);
  process.env.NETLIFY_DEV = 'true';
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  process.env.RECRAFT_API_KEY = 'test-recraft-not-real';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"project_id":"test-project"}';
  delete process.env.PICTOS_OPENAI_KEY;
});
afterEach(() => mock.restoreAll());
after(() => {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Responses preserves full schema and text, forces one function, fixes low effort and disables storage', () => {
  const body = buildOpenAITextRequest(params);
  assert.deepEqual(body.tools[0].parameters, params.tools[0].input_schema);
  assert.equal(body.tools[0].strict, false);
  assert.deepEqual(body.tool_choice, { type: 'function', name: 'analyze_utterance' });
  assert.equal(body.store, false);
  assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.deepEqual(body.input[0].content, [{ type: 'input_text', text: params.messages[0].content }]);
  assert.equal('temperature' in body, false);
  for (const invalid of [{ model: 'gpt-image-2' }, { max_tokens: 32769 }, { max_tokens: 0 }, { messages: [] }, { tools: [] }]) {
    assert.throws(() => buildOpenAITextRequest({ ...params, ...invalid }));
  }
});

test('Phase 5 translates supported base64 vision and rejects unsupported blocks instead of dropping them', () => {
  const p5 = { ...params, tool_choice: { type: 'tool', name: 'redraw_svg' }, tools: [{ name: 'redraw_svg', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }, { type: 'text', text: 'semantics' }] }] };
  assert.equal(buildOpenAITextRequest(p5).input[0].content[0].image_url, 'data:image/png;base64,QUJD');
  assert.throws(() => buildOpenAITextRequest({ ...p5, messages: [{ role: 'user', content: [{ type: 'audio' }] }] }));
});

test('incomplete, refused, missing and malformed function outputs fail without repair', () => {
  for (const data of [reply('analyze_utterance', nlu, { status: 'incomplete' }), reply('other', nlu),
    reply('analyze_utterance', nlu, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private text' }] }] }),
    reply('analyze_utterance', nlu, { output: [{ type: 'function_call', name: 'analyze_utterance', arguments: '{bad' }] }),
    reply('analyze_utterance', [])]) assert.throws(() => openAIResponseToClaude(data, 'analyze_utterance'));
  assert.deepEqual(openAIResponseToClaude(reply('analyze_utterance', nlu), 'analyze_utterance').content[0].input, nlu);
});

test('all three OpenAI candidates run the canonical phase 1/2 orchestration with observed provenance', async () => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    return Response.json(reply(body.tool_choice.name, body.tool_choice.name === 'analyze_utterance' ? nlu : composition,
      { model: `${body.model}-observed` }), { headers: { 'x-request-id': 'text-observed' } });
  });
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
    const executions = [];
    const config = { comprenderModel: model, componerModel: model };
    const understanding = await runPhase1(nlu.utterance, config, value => executions.push(value));
    const visual = await runPhase2(understanding, config, value => executions.push(value));
    assert.equal(visual.elements[0].concept, 'Root');
    assert.equal(visual.prompt, composition.prompt);
    assert.deepEqual(executions.map(e => e.phase), [1, 2]);
    for (const execution of executions) {
      assert.equal(execution.provider, 'openai');
      assert.equal(execution.model, model);
      assert.equal(execution.actualModel, `${model}-observed`);
      assert.equal(execution.reasoningEffort, 'low');
      assert.equal(execution.usage.output_tokens, 50);
      assert.equal(execution.providerRequestId, 'text-observed');
      assert.doesNotMatch(JSON.stringify(execution), /test-key-not-real/);
    }
  }
});

test('billing fails without retries and rejected output preserves actual usage and request correlation', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'insufficient_quota', message: 'private provider echo' } }, { status: 429 }));
  await assert.rejects(generateOpenAIText(params), error => error.code === 'insufficient_quota' && !error.message.includes('private'));
  assert.equal(fetchMock.mock.callCount(), 1);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json(reply('analyze_utterance', nlu, { status: 'incomplete' }), { headers: { 'x-request-id': 'incomplete-id' } }));
  await assert.rejects(generateOpenAIText(params), error => error.usage.output_tokens === 50 &&
    error.actualModel === 'gpt-5.6-luna-observed' && error.request_id === 'incomplete-id' && error.attempts === 1);
});

test('proxy and background enforce authentication, phase capability, and owner-scoped poll', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    return Response.json(reply(body.tool_choice.name, { description: 'test', groups: [] }));
  });
  assert.equal((await proxy(event({ ...params, model: 'gpt-image-2' }), {})).statusCode, 400);
  assert.equal(fetchMock.mock.callCount(), 0);
  const p5 = { ...params, tool_choice: { type: 'tool', name: 'redraw_svg' }, tools: [{ name: 'redraw_svg', input_schema: { type: 'object' } }] };
  await getBlobStore('openai-text-jobs').setJSON('openai-struct-owned', { owner: 'other@example.test', response: { marker: 'preserve' } });
  await worker(event({ ...p5, jobId: 'openai-struct-owned' }));
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal((await getBlobStore('openai-text-jobs').get('openai-struct-owned', { type: 'json' })).response.marker, 'preserve');
  const staged = await stage(event(p5), {});
  assert.equal(staged.statusCode, 200);
  const { jobId } = JSON.parse(staged.body);
  await worker(event({ jobId }));
  const response = await poll({ httpMethod: 'GET', queryStringParameters: { jobId } }, {});
  assert.equal(JSON.parse(response.body).response.model, 'gpt-5.6-luna-observed');
  assert.equal(await getBlobStore('structure-inputs').get(jobId, { type: 'json' }), null);
  await worker(event({ jobId }));
  assert.equal(fetchMock.mock.callCount(), 1);
  await getBlobStore('openai-text-jobs').setJSON('openai-struct-private', { owner: 'owner@example.test', response: {} });
  process.env.NETLIFY_DEV = 'false';
  try {
    assert.equal((await proxy(event(params), {})).statusCode, 401);
    assert.equal((await stage(event(p5), {})).statusCode, 401);
    assert.equal((await poll({ httpMethod: 'GET', queryStringParameters: { jobId: 'openai-struct-private' } }, { clientContext: { user: { email: 'other@example.test' } } })).statusCode, 403);
    assert.ok(await getBlobStore('openai-text-jobs').get('openai-struct-private', { type: 'json' }));
  } finally { process.env.NETLIFY_DEV = 'true'; }
});

test('vision staging accepts images above the background limit and workers receive only an owner-bound job ID', async () => {
  mock.method(GoogleAuth.prototype, 'getClient', async () => ({ getAccessToken: async () => ({ token: 'fake-token' }) }));
  const upstream = mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).includes('openai.com')) return Response.json(reply(body.tool_choice.name, { groups: [] }));
    assert.equal(body.contents[0].parts[0].inlineData.data.length, 300000);
    return Response.json({ modelVersion: 'gemini-observed', candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'redraw_svg', args: { groups: [] } } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  });
  const request = { ...params, tool_choice: { type: 'tool', name: 'redraw_svg' }, tools: [{ name: 'redraw_svg', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(300000) } }] }] };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) > 256000);
  assert.equal((await stage(event(params), {})).statusCode, 400);
  assert.equal((await stage({ httpMethod: 'POST', body: ' '.repeat(5_000_001) }, {})).statusCode, 413);
  for (const model of ['gpt-5.6-luna', 'gemini-2.5-flash']) {
    const created = await stage(event({ ...request, model, jobId: 'attacker-selected', _authToken: 'must-not-store' }), {});
    assert.equal(created.statusCode, 200);
    const { jobId } = JSON.parse(created.body);
    assert.notEqual(jobId, 'attacker-selected');
    const stored = await getBlobStore('structure-inputs').get(jobId, { type: 'json' });
    assert.doesNotMatch(JSON.stringify(stored), /must-not-store|attacker-selected/);
    const background = event({ jobId });
    assert.ok(Buffer.byteLength(background.body) < 256);
    const run = model.startsWith('gemini') ? geminiWorker : worker;
    const read = model.startsWith('gemini') ? geminiPoll : poll;
    await run(background, {});
    const result = JSON.parse((await read({ httpMethod: 'GET', queryStringParameters: { jobId } }, {})).body);
    assert.ok(result.response);
    assert.equal(await getBlobStore('structure-inputs').get(jobId, { type: 'json' }), null);
  }
  assert.equal(upstream.mock.callCount(), 2);
});

test('staged requests cannot be consumed by another owner/provider or after expiration', async () => {
  const inputs = getBlobStore('structure-inputs');
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('must not call provider'); });
  for (const provider of ['openai', 'gemini']) {
    const jobId = `${provider === 'openai' ? 'openai-struct' : 'struct'}-rejected`;
    const run = provider === 'openai' ? worker : geminiWorker;
    const model = provider === 'openai' ? 'gpt-5.6-luna' : 'gemini-2.5-flash';
    const value = { owner: 'other@example.test', provider, expiresAt: Date.now() + 10000, params: { ...params, model } };
    await inputs.setJSON(jobId, value);
    await run(event({ jobId }), {});
    assert.equal((await inputs.get(jobId, { type: 'json' })).owner, value.owner);
    await inputs.setJSON(jobId, { ...value, owner: 'dev', provider: 'other' });
    await run(event({ jobId }), {});
    assert.ok(await inputs.get(jobId, { type: 'json' }));
    await inputs.setJSON(jobId, { ...value, owner: 'dev', expiresAt: 1 });
    await run(event({ jobId }), {});
    assert.equal(await inputs.get(jobId, { type: 'json' }), null);
    const store = getBlobStore(provider === 'openai' ? 'openai-text-jobs' : 'gemini-structure-jobs');
    assert.match((await store.get(jobId, { type: 'json' })).error, /expired/);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('the staging gate binds signed identity to its grant and Gemini polling never consumes another owner result', async () => {
  const p5 = { ...params, model: 'gemini-2.5-flash', tool_choice: { type: 'tool', name: 'redraw_svg' }, tools: [{ name: 'redraw_svg', input_schema: { type: 'object' } }] };
  process.env.NETLIFY_DEV = 'false';
  try {
    const context = { clientContext: { user: { email: 'owner@example.test' } } };
    const created = await stage(event(p5), context);
    assert.equal(created.statusCode, 200);
    const { jobId } = JSON.parse(created.body);
    const grant = await getBlobStore('auth-grants').get(jobId, { type: 'json' });
    const stored = await getBlobStore('structure-inputs').get(jobId, { type: 'json' });
    assert.equal(grant.email, 'owner@example.test');
    assert.equal(stored.owner, grant.email);
    assert.equal(stored.expiresAt, grant.exp);
    const results = getBlobStore('gemini-structure-jobs');
    await results.setJSON(jobId, { owner: grant.email, response: { marker: 'keep' } });
    const query = { httpMethod: 'GET', queryStringParameters: { jobId } };
    assert.equal((await geminiPoll(query, {})).statusCode, 401);
    assert.equal((await geminiPoll(query, { clientContext: { user: { email: 'other@example.test' } } })).statusCode, 403);
    assert.ok(await results.get(jobId, { type: 'json' }));
    assert.deepEqual(JSON.parse((await geminiPoll(query, context)).body), { response: { marker: 'keep' } });
  } finally { process.env.NETLIFY_DEV = 'true'; }
});

test('OpenAI checks selected metadata and Recraft only exposes numeric credits, never profile data', async () => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, undefined);
    if (url.includes('openai')) {
      assert.match(url, /\/models\/gpt-5.6-terra$/);
      return Response.json({ id: 'gpt-5.6-terra' });
    }
    assert.equal(url, 'https://external.api.recraft.ai/v1/users/me');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ credits: 1234, email: 'private@example.test', id: 'private-id' });
  });
  const openai = JSON.parse((await check(event({ service: 'openai', model: 'gpt-5.6-terra' }), {})).body);
  assert.equal(openai.checkScope, 'model_metadata_access');
  assert.equal(openai.generationVerified, false);
  const recraft = JSON.parse((await check(event({ service: 'recraft', model: 'recraftv4_styles_vector' }), {})).body);
  assert.equal(recraft.credits, 1234);
  assert.equal(recraft.checkScope, 'credentials_and_credit_balance');
  assert.doesNotMatch(JSON.stringify(recraft), /private/);
});

test('failed connection checks never forward provider profile/credential echoes', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: 'private@example.test test-recraft-not-real' }, { status: 401 }));
  const result = await check(event({ service: 'recraft', model: 'recraftv4_1' }), {});
  assert.equal(JSON.parse(result.body).ok, false);
  assert.doesNotMatch(result.body, /private@example|test-recraft-not-real/);
  assert.match(result.body, /HTTP 401/);
});

test('Recraft composition keeps more than 2000 characters and rejects over 10000 without truncating', () => {
  const prompt = 'x'.repeat(2500);
  assert.ok(composeRecraftPrompt([], prompt, 'test', null, {}).includes(prompt));
  assert.throws(() => composeRecraftPrompt([], 'x'.repeat(10000), 'test', null, {}), /10000/);
});
