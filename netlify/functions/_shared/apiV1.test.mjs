import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import fixture from '../../../schemas/pictos-nlu-schema/tests/generation/valid.json' with { type: 'json' };
import { createV1Handler, createApiAjv, PROCESSES, PROCESS_RUNNERS, API_SCHEMAS } from './apiV1.js';
import { buildNluRequest, buildCompositionRequest } from './pipelineContracts.js';
import { mintServiceToken, credentialRecord, verifyServiceCredential, parseServiceToken } from './serviceCredentials.js';
import { modelIdsForPhase, MODEL_CATALOG } from './modelCatalog.js';

const ajv = createApiAjv();
const COMMON = 'https://pictos.net/schemas/pictos-api/pictos-api-common-1.0.0.schema.json';
const validateError = ajv.getSchema(`${COMMON}#/$defs/ErrorResponse`);
const COMPOSITION = { elements: [{ id: 'persona', concept: 'Agent' }, { id: 'agua', concept: 'Object' }], prompt: "'persona' sostiene un vaso con 'agua' cerca de la boca." };

afterEach(() => mock.restoreAll());

function memoryStore() {
  const map = new Map();
  return {
    map,
    async get(key, options) { if (!map.has(key)) return null; const value = map.get(key); return options?.type === 'json' ? JSON.parse(value) : value; },
    async set(key, value) { map.set(key, String(value)); },
    async setJSON(key, value) { map.set(key, JSON.stringify(value)); },
    async delete(key) { map.delete(key); },
  };
}

async function setup({ scopes, dailyCallLimit = 10, revoked = false } = {}) {
  const credentialStore = memoryStore();
  const minted = mintServiceToken();
  const record = credentialRecord({ ...minted, principal: 'service:vera', label: 'test', dailyCallLimit, ...(scopes ? { scopes } : {}) });
  if (revoked) record.revoked_at = new Date().toISOString();
  await credentialStore.setJSON(`keys/${minted.keyId}`, record);
  const deps = { credentialStore, idempotencyStore: memoryStore(), quotaStore: memoryStore(), logCall: async () => {}, skipBlobsConnect: true, ajv };
  const handlers = {
    comprender: createV1Handler('comprender', PROCESS_RUNNERS.comprender, deps),
    componer: createV1Handler('componer', PROCESS_RUNNERS.componer, deps),
  };
  return { token: minted.token, deps, handlers };
}

function post(token, body, extraHeaders = {}) {
  return { httpMethod: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

/** Anthropic-shaped provider stub: answers each forced tool with the next queued input. */
function mockProvider(outputs) {
  const sent = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    const next = outputs.shift();
    if (next instanceof Response) return next;
    return Response.json({ id: 'msg_test', model: request.model, usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'tool_use', name: request.tool_choice.name, input: next }] });
  });
  return { sent, fetchMock };
}

let savedKey;
function withAnthropicKey() {
  savedKey = process.env.PICTOS_ANTHROPIC_KEY;
  process.env.PICTOS_ANTHROPIC_KEY = 'synthetic-test-key';
}
afterEach(() => {
  if (savedKey === undefined) delete process.env.PICTOS_ANTHROPIC_KEY;
  else process.env.PICTOS_ANTHROPIC_KEY = savedKey;
});

// ── Published contracts ───────────────────────────────────────────────────────

test('every published API schema compiles strictly and declares a versioned pictos.net $id', () => {
  const dir = fileURLToPath(new URL('../../../schemas/pictos-api-schema/', import.meta.url));
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.schema.json')).sort();
  assert.deepEqual(files, API_SCHEMAS.map(schema => schema.$id.split('/').pop()).sort(), 'apiV1 must load every published file');
  for (const schema of API_SCHEMAS) {
    assert.match(schema.$id, /^https:\/\/pictos\.net\/schemas\/pictos-api\/pictos-api-[a-z]+(-[a-z]+)?-\d+\.\d+\.\d+(-draft)?\.schema\.json$/);
  }
  for (const definition of Object.values(PROCESSES)) {
    assert.equal(typeof ajv.getSchema(definition.requestSchema), 'function');
    assert.equal(typeof ajv.getSchema(definition.responseSchema), 'function');
  }
});

// A published request schema is frozen: its enum lists every text model the
// phase offered at 1.0.0, retired ones included. Runtime admission is narrower
// (modelSupportsPhase), so a retired model passes the schema but is refused.
test('request schemas offer exactly the catalog text models for their phase', () => {
  for (const [name, phase] of [['comprender', 1], ['componer', 2]]) {
    const schema = API_SCHEMAS.find(s => s.$id === PROCESSES[name].requestSchema);
    const catalog = Object.keys(MODEL_CATALOG)
      .filter(id => MODEL_CATALOG[id].phases.includes(phase) && MODEL_CATALOG[id].output === 'text');
    assert.deepEqual([...schema.properties.model.enum].sort(), catalog.sort());
    assert.ok(modelIdsForPhase(phase).every(id => schema.properties.model.enum.includes(id)));
    assert.ok(!modelIdsForPhase(phase).includes('gemini-2.5-pro'));
  }
});

test('published examples validate against their schemas', () => {
  const dir = fileURLToPath(new URL('../../../schemas/pictos-api-schema/examples/', import.meta.url));
  const expectations = {
    'comprender.request.json': PROCESSES.comprender.requestSchema,
    'comprender.response.json': PROCESSES.comprender.responseSchema,
    'componer.request.json': PROCESSES.componer.requestSchema,
    'componer.response.json': PROCESSES.componer.responseSchema,
    'error.output-contract-invalid.json': `${COMMON}#/$defs/ErrorResponse`,
    'producir.output.bitmap.json': 'https://pictos.net/schemas/pictos-api/pictos-api-producir-0.1.0-draft.schema.json#/$defs/Artifact',
    'producir.output.svg.json': 'https://pictos.net/schemas/pictos-api/pictos-api-producir-0.1.0-draft.schema.json#/$defs/Artifact',
    'estructurar.output.json': 'https://pictos.net/schemas/pictos-api/pictos-api-estructurar-0.1.0-draft.schema.json#/$defs/Output',
  };
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(expectations).sort());
  for (const [file, id] of Object.entries(expectations)) {
    const validate = ajv.getSchema(id);
    assert.ok(validate(JSON.parse(fs.readFileSync(`${dir}${file}`, 'utf8'))), `${file}: ${JSON.stringify(validate.errors)}`);
  }
});

test('producir boundary is a tagged union whose tag and media type must agree', () => {
  const validate = ajv.getSchema('https://pictos.net/schemas/pictos-api/pictos-api-producir-0.1.0-draft.schema.json#/$defs/Artifact');
  assert.ok(validate({ kind: 'bitmap', mime_type: 'image/png', artifact: 'iVBORw0KGgo=' }));
  assert.ok(validate({ kind: 'svg', mime_type: 'image/svg+xml', artifact: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
  assert.equal(validate({ kind: 'bitmap', mime_type: 'image/svg+xml', artifact: '<svg/>' }), false);
  assert.equal(validate({ kind: 'svg', mime_type: 'image/svg+xml', artifact: '<svg/>', structured: true }), false);
  assert.equal(PROCESSES.producir.implemented, false);
  assert.equal(PROCESSES.estructurar.implemented, false);
  assert.throws(() => createV1Handler('producir', {}), /not implemented/);
});

// ── Machine credentials ───────────────────────────────────────────────────────

test('credentials store only a hash and reject wrong, unknown and revoked keys alike', async () => {
  const store = memoryStore();
  const minted = mintServiceToken();
  assert.deepEqual(parseServiceToken(minted.token), { keyId: minted.keyId, secret: minted.secret });
  const record = credentialRecord({ ...minted, principal: 'service:vera' });
  assert.equal(JSON.stringify(record).includes(minted.secret), false, 'the secret must never be stored');
  await store.setJSON(`keys/${minted.keyId}`, record);
  const ok = await verifyServiceCredential({ Authorization: `Bearer ${minted.token}` }, { store });
  assert.equal(ok.ok, true);
  assert.equal(ok.principal, 'service:vera');
  assert.equal((await verifyServiceCredential({ 'x-pictos-key': minted.token }, { store })).ok, true);
  const forged = `pk_${minted.keyId}_${'A'.repeat(43)}`;
  assert.equal((await verifyServiceCredential({ authorization: `Bearer ${forged}` }, { store })).ok, false);
  assert.equal((await verifyServiceCredential({ authorization: `Bearer ${mintServiceToken().token}` }, { store })).ok, false);
  assert.equal((await verifyServiceCredential({}, { store })).ok, false);
  await store.setJSON(`keys/${minted.keyId}`, { ...record, revoked_at: new Date().toISOString() });
  assert.equal((await verifyServiceCredential({ authorization: `Bearer ${minted.token}` }, { store })).ok, false);
  assert.throws(() => credentialRecord({ ...minted, principal: 'vera@example.com' }), /principal/);
});

test('the local dev token is honoured only under netlify dev', async () => {
  const store = memoryStore();
  const dev = mintServiceToken();
  const saved = { dev: process.env.NETLIFY_DEV, token: process.env.PICTOS_DEV_SERVICE_TOKEN };
  process.env.PICTOS_DEV_SERVICE_TOKEN = dev.token;
  try {
    delete process.env.NETLIFY_DEV;
    assert.equal((await verifyServiceCredential({ authorization: `Bearer ${dev.token}` }, { store })).ok, false);
    process.env.NETLIFY_DEV = 'true';
    const local = await verifyServiceCredential({ authorization: `Bearer ${dev.token}` }, { store });
    assert.equal(local.principal, 'service:dev');
    assert.equal((await verifyServiceCredential({ authorization: `Bearer pk_${dev.keyId}_${'B'.repeat(43)}` }, { store })).ok, false);
  } finally {
    for (const [name, value] of [['NETLIFY_DEV', saved.dev], ['PICTOS_DEV_SERVICE_TOKEN', saved.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('missing or revoked credentials answer 401 before reading the body', async () => {
  const { handlers } = await setup({ revoked: true });
  for (const event of [post(null, 'not json'), post(mintServiceToken().token, 'not json')]) {
    const response = await handlers.comprender(event);
    assert.equal(response.statusCode, 401);
    assert.match(response.headers['WWW-Authenticate'], /^Bearer/);
    assert.ok(validateError(JSON.parse(response.body)));
  }
  const revoked = await setup({ revoked: true });
  assert.equal((await revoked.handlers.comprender(post(revoked.token, {}))).statusCode, 401);
});

test('a credential without the process scope is forbidden', async () => {
  const { token, handlers } = await setup({ scopes: ['comprender'] });
  const response = await handlers.componer(post(token, { nlu: fixture }));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error.code, 'forbidden');
});

// ── Comprender / Componer ─────────────────────────────────────────────────────

test('comprender sends the shared NLU request and returns a validated, attributed envelope', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { sent } = mockProvider([structuredClone(fixture)]);
  const body = { utterance: fixture.utterance, config: { lang: 'es-419', geoContext: { region: 'Chile' }, domainContext: 'hogar' } };
  const response = await handlers.comprender(post(token, body));
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(sent[0], buildNluRequest(body.utterance, body.config), 'prompt and tool schema come from pipelineContracts, not a copy');
  const result = JSON.parse(response.body);
  assert.ok(ajv.getSchema(PROCESSES.comprender.responseSchema)(result), JSON.stringify(ajv.errors));
  assert.equal(result.executor, 'pictos.net');
  assert.equal(result.request_id, response.headers['X-Request-Id']);
  assert.deepEqual(result.process, { name: 'comprender', version: 'nlu-1.1.0' });
  assert.deepEqual(result.schema, { id: 'https://pictos.net/schemas/pictonet-nlu-generation-1.1.0.schema.json', version: '1.1.0' });
  assert.deepEqual(result.model, { requested: 'claude-haiku-4-5-20251001', actual: 'claude-haiku-4-5-20251001', provider: 'anthropic' });
  assert.deepEqual(result.output, fixture);
  assert.equal(result.replayed, false);
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined, 'machine API is not exposed to browsers');
});

test('comprender honours an explicit model and rejects models outside the phase', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { sent } = mockProvider([structuredClone(fixture)]);
  const ok = await handlers.comprender(post(token, { utterance: fixture.utterance, model: 'claude-sonnet-4-6' }));
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(sent[0].model, 'claude-sonnet-4-6');
  const rejected = await handlers.comprender(post(token, { utterance: fixture.utterance, model: 'gemini-3-pro-image' }));
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).error.code, 'invalid_request');
});

test('componer returns the accepted composition with the deterministic root, never the provider shape', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { sent } = mockProvider([structuredClone(COMPOSITION)]);
  const response = await handlers.componer(post(token, { nlu: fixture, config: { domainContext: 'hogar' } }));
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(sent[0], buildCompositionRequest(fixture, { domainContext: 'hogar' }));
  const result = JSON.parse(response.body);
  assert.ok(ajv.getSchema(PROCESSES.componer.responseSchema)(result), JSON.stringify(ajv.errors));
  assert.deepEqual(result.output, { elements: [{ id: 'pictograma', concept: 'Root', children: COMPOSITION.elements }], prompt: COMPOSITION.prompt });
  assert.equal(result.schema.id, 'https://pictos.net/schemas/pictogram-composition-0.1.0.schema.json');
  assert.deepEqual(result.process, { name: 'componer', version: 'composition-0.1.0' });
});

test('invalid model output is rejected once, without repair or a paid retry', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { fetchMock } = mockProvider([{ ...structuredClone(fixture), frames: [] }, { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'gato' duerme." }]);
  for (const [name, body] of [['comprender', { utterance: fixture.utterance }], ['componer', { nlu: fixture }]]) {
    const response = await handlers[name](post(token, body));
    assert.equal(response.statusCode, 502);
    const error = JSON.parse(response.body);
    assert.ok(validateError(error), JSON.stringify(validateError.errors));
    assert.equal(error.error.code, 'output_contract_invalid');
    assert.ok(error.error.issues.length > 0);
    assert.equal(error.output, undefined);
  }
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('componer rejects an invalid NLU as an input contract failure without calling a model', async () => {
  const { token, handlers } = await setup();
  const { fetchMock } = mockProvider([]);
  const response = await handlers.componer(post(token, { nlu: { utterance: 'Beber agua' } }));
  assert.equal(response.statusCode, 422);
  const error = JSON.parse(response.body).error;
  assert.equal(error.code, 'input_contract_invalid');
  assert.ok(error.issues.every(issue => issue.path.startsWith('/nlu')));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('malformed envelopes are invalid requests with structured issues', async () => {
  const { token, handlers } = await setup();
  const response = await handlers.comprender(post(token, { utterance: 'Beber agua', nluModel: 'x' }));
  assert.equal(response.statusCode, 400);
  const error = JSON.parse(response.body).error;
  assert.equal(error.code, 'invalid_request');
  assert.deepEqual(error.issues, [{ path: '/', message: 'must NOT have additional properties: nluModel' }]);
  assert.equal((await handlers.comprender(post(token, '{'))).statusCode, 400);
  const get = await handlers.comprender({ httpMethod: 'GET', headers: {} });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, 'POST');
});

test('provider failures are classified as retryable or not, without provider bodies', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  mockProvider([Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'secret prompt echo' } }, { status: 400 })]);
  const response = await handlers.comprender(post(token, { utterance: fixture.utterance }));
  assert.equal(response.statusCode, 502);
  const error = JSON.parse(response.body).error;
  assert.equal(error.code, 'provider_error');
  assert.equal(error.retryable, false);
  assert.equal(response.body.includes('secret prompt echo'), false);
});

// ── Idempotency and quota ─────────────────────────────────────────────────────

test('an Idempotency-Key replays the stored success and refuses a different body', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { fetchMock } = mockProvider([structuredClone(fixture)]);
  const body = { utterance: fixture.utterance };
  const first = await handlers.comprender(post(token, body, { 'Idempotency-Key': 'vera-block-123:rev-4' }));
  const second = await handlers.comprender(post(token, { ...body }, { 'idempotency-key': 'vera-block-123:rev-4' }));
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(fetchMock.mock.callCount(), 1, 'a replay must not call the model again');
  const [a, b] = [JSON.parse(first.body), JSON.parse(second.body)];
  assert.equal(a.idempotency_key, 'vera-block-123:rev-4');
  assert.equal(b.replayed, true);
  assert.equal(second.headers['Idempotent-Replayed'], 'true');
  assert.deepEqual({ ...b, replayed: false }, a);
  const reused = await handlers.comprender(post(token, { utterance: 'Otra frase' }, { 'Idempotency-Key': 'vera-block-123:rev-4' }));
  assert.equal(reused.statusCode, 422);
  assert.equal(JSON.parse(reused.body).error.code, 'idempotency_key_reused');
  const bad = await handlers.comprender(post(token, body, { 'Idempotency-Key': 'short' }));
  assert.equal(bad.statusCode, 400);
});

test('a failed idempotent request can be retried with the same key', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup();
  const { fetchMock } = mockProvider([{ ...structuredClone(fixture), frames: [] }, structuredClone(fixture)]);
  const event = () => post(token, { utterance: fixture.utterance }, { 'Idempotency-Key': 'retry-after-failure' });
  assert.equal((await handlers.comprender(event())).statusCode, 502);
  assert.equal((await handlers.comprender(event())).statusCode, 200);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('the principal daily call limit is enforced and reported', async () => {
  withAnthropicKey();
  const { token, handlers } = await setup({ dailyCallLimit: 1 });
  mockProvider([structuredClone(fixture)]);
  const first = await handlers.comprender(post(token, { utterance: fixture.utterance }));
  assert.deepEqual(JSON.parse(first.body).quota, { used: 1, limit: 1 });
  const second = await handlers.comprender(post(token, { utterance: fixture.utterance }));
  assert.equal(second.statusCode, 429);
  assert.equal(JSON.parse(second.body).error.code, 'quota_exceeded');
});
