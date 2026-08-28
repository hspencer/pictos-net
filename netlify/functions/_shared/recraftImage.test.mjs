import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CATALOG } from './modelCatalog.js';
import { recraftImageRequest, generateRecraftImage } from './recraftImage.js';

afterEach(() => mock.restoreAll());

test('every Recraft catalog model has a valid request; Styles requires explicit identity', () => {
  for (const [model, entry] of Object.entries(MODEL_CATALOG).filter(([,m]) => m.provider === 'recraft')) {
    if (entry.requiresStyle) assert.throws(() => recraftImageRequest({ model, prompt: 'beber agua' }), /style_id/);
    const request = recraftImageRequest({ model, prompt: 'beber agua', style_id: '11111111-1111-4111-8111-111111111111' });
    assert.equal(request.model, model);
    assert.equal(request.size, entry.requestSize);
    assert.equal(request.style_id, '11111111-1111-4111-8111-111111111111');
  }
  for (const prompt of ['', {}, 'x'.repeat(10001)]) assert.throws(() => recraftImageRequest({ prompt }));
  assert.equal(recraftImageRequest({ prompt: 'x'.repeat(10000) }).prompt.length, 10000);
  assert.throws(() => recraftImageRequest({ prompt: 'ok', colors: ['not-color'] }));
});

test('vector/raster output follows catalog and style is sent unchanged', async (t) => {
  const previous = process.env.RECRAFT_API_KEY;
  process.env.RECRAFT_API_KEY = 'fake-test-key';
  t.after(() => { if (previous === undefined) delete process.env.RECRAFT_API_KEY; else process.env.RECRAFT_API_KEY = previous; });
  for (const model of ['recraftv4_styles_vector', 'recraftv4_1_utility_pro']) {
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push(url);
      if (calls.length === 1) {
        const body = JSON.parse(options.body);
        assert.equal(body.model, model);
        if (MODEL_CATALOG[model].requiresStyle) assert.equal(body.style_id, '11111111-1111-4111-8111-111111111111');
        return Response.json({ data: [{ url: 'https://cdn.test/image' }] });
      }
      return new Response(MODEL_CATALOG[model].output === 'vector' ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'fake-png', { headers: { 'content-type': 'image/png' } });
    });
    const output = await generateRecraftImage({ model, prompt: 'beber', style_id: '11111111-1111-4111-8111-111111111111' });
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.ok(MODEL_CATALOG[model].output === 'vector' ? output.svg : output.bitmap);
    mock.restoreAll();
  }
});

test('Recraft preserves terminal status and does not replay ambiguous generation transport failures', async (t) => {
  const previous = process.env.RECRAFT_API_KEY;
  process.env.RECRAFT_API_KEY = 'fake-test-key';
  t.after(() => { if (previous === undefined) delete process.env.RECRAFT_API_KEY; else process.env.RECRAFT_API_KEY = previous; });
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'retry-after': '120' } }));
  await assert.rejects(generateRecraftImage({ prompt: 'beber' }, { maxTotalMs: 100 }), error => error.status === 429 && error.provider === 'recraft');
  assert.equal(fetchMock.mock.callCount(), 1);
  mock.restoreAll();
  const transport = mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(generateRecraftImage({ prompt: 'beber' }), /fetch failed/);
  assert.equal(transport.mock.callCount(), 1);
});
