import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuth } from 'google-auth-library';
import { setEnvironmentContext } from '@netlify/blobs';
import { connectBlobs, getBlobStore } from './blobs.js';
import { consumeAuthGrant } from './identity.js';
import { handler as authorize } from '../api-authorize.js';
import { handler as generate } from '../api-gemini-worker-background.js';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const user = { email: 'owner@example.test', app_metadata: { roles: [] } };
const event = (body = {}, uncached = true) => ({
  httpMethod: 'POST', body: JSON.stringify(body),
  headers: { 'x-nf-site-id': 'test-site', 'x-nf-deploy-id': 'test-deploy' },
  blobs: encode({ url: 'https://cached.example.test', token: 'synthetic-token',
    ...(uncached ? { url_uncached: 'https://origin.example.test' } : {}) }),
});
let previous, entries, requests;
beforeEach(() => {
  previous = { env: { ...process.env }, context: globalThis.netlifyBlobsContext };
  delete process.env.NETLIFY_DEV;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  delete globalThis.netlifyBlobsContext;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"project_id":"test-project"}';
  entries = new Map(); requests = [];
  mock.method(console, 'warn', () => {});
  mock.method(GoogleAuth.prototype, 'getClient', async () => ({ getAccessToken: async () => ({ token: 'synthetic-vertex-token' }) }));
  mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    const method = (options.method || 'GET').toUpperCase();
    requests.push({ host: url.host, path: url.pathname, method });
    if (url.host.endsWith('aiplatform.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }] });
    }
    assert.ok(['cached.example.test', 'origin.example.test'].includes(url.host), 'unexpected network destination');
    assert.ok(url.pathname.startsWith('/test-site/site:'), 'store must stay site-scoped');
    if (method === 'PUT') { entries.set(url.pathname, options.body); return new Response(null, { status: 200 }); }
    if (method === 'DELETE') { entries.delete(url.pathname); return new Response(null, { status: 204 }); }
    assert.equal(method, 'GET');
    return entries.has(url.pathname)
      ? new Response(entries.get(url.pathname), { headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 404 });
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const key of ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
    if (previous.env[key] === undefined) delete process.env[key]; else process.env[key] = previous.env[key];
  }
  if (previous.context === undefined) delete globalThis.netlifyBlobsContext;
  else globalThis.netlifyBlobsContext = previous.context;
});

test('real Blobs SDK carries signed authorization from the sync gate into the Gemini worker', async () => {
  const jobId = 'gemini-auth-regression';
  assert.equal((await authorize(event({ jobId }), { clientContext: { user } })).statusCode, 200);
  await generate(event({ jobId, model: 'gemini-2.5-flash-image', prompt: 'synthetic test' }), {});
  assert.deepEqual(JSON.parse(entries.get(`/test-site/site:gemini-jobs/${jobId}`)), { bitmap: 'data:image/png;base64,AA==' });
  assert.ok(requests.some(r => r.host === 'origin.example.test' && r.path.endsWith(`auth-grants/${jobId}`) && r.method === 'GET'));
  assert.equal(requests.filter(r => r.host.endsWith('aiplatform.googleapis.com')).length, 1);
  assert.equal(await consumeAuthGrant(jobId), null, 'consumed grant cannot be reused');
});

test('strong reads also work for staging and result stores after Lambda initialization', async () => {
  connectBlobs(event());
  for (const name of ['structure-inputs', 'openai-text-jobs', 'recraft-jobs']) {
    const store = getBlobStore(name);
    await store.setJSON('test-job', { owner: user.email });
    assert.deepEqual(await store.get('test-job', { type: 'json', consistency: 'strong' }), { owner: user.email });
  }
  assert.ok(requests.filter(r => r.method === 'GET').every(r => r.host === 'origin.example.test'));
});

test('missing and expired grants reject background generation before any provider call or charge', async () => {
  connectBlobs(event());
  await getBlobStore('auth-grants').setJSON('expired', { email: user.email, roles: [], exp: Date.now() - 1 });
  for (const jobId of ['missing', 'expired']) {
    await generate(event({ jobId, model: 'gemini-2.5-flash-image', prompt: 'synthetic test' }), {});
    assert.match(JSON.parse(entries.get(`/test-site/site:gemini-jobs/${jobId}`)).error, /Unauthorized/);
  }
  assert.equal(requests.filter(r => r.host.endsWith('aiplatform.googleapis.com') || r.path.includes('pictonet-usage')).length, 0);
});

test('a missing uncached endpoint fails closed instead of silently using cached authorization', async () => {
  connectBlobs(event({}, false));
  assert.equal(await consumeAuthGrant('missing-origin'), null);
  assert.equal(requests.length, 0);
});

test('synchronous invocations without event.blobs preserve the platform storage context', async () => {
  setEnvironmentContext({ siteID: 'test-site', token: 'synthetic-token', edgeURL: 'https://cached.example.test', uncachedEdgeURL: 'https://origin.example.test' });
  connectBlobs({ headers: {} });
  assert.equal(await getBlobStore('auth-grants').get('missing', { consistency: 'strong' }), null);
  assert.equal(requests[0].host, 'origin.example.test');
});
