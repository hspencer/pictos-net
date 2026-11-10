import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { quiverImageRequest, cleanQuiverSvg, generateQuiverImage } from './quiverImage.js';
import { providerFailure } from './providerError.js';
import { composeQuiverRequest } from './imagePrompts.js';

test('request carries the library style apart, a fixed view box and the measured sampling', () => {
  const { prompt, instructions } = composeQuiverRequest([{ id: 'vaso_de_agua' }], "'vaso_de_agua' al centro", 'Quiero agua', null, { visualStylePrompt: 'Siluetas negras.' });
  assert.match(prompt, /vaso de agua al centro/);
  assert.doesNotMatch(prompt, /Siluetas negras/);
  assert.match(instructions, /^Siluetas negras\./);
  const body = quiverImageRequest({ model: 'arrow-2', prompt, instructions });
  assert.deepEqual(body.attributes.viewBox, { minX: 0, minY: 0, width: 512, height: 512 });
  assert.equal(body.temperature, 0.4);
  assert.equal(body.stream, false);
});

test('only catalog Quiver models are admitted', () => {
  assert.throws(() => quiverImageRequest({ model: 'recraftv4_1_vector', prompt: 'p' }), /Unsupported Quiver model/);
  assert.throws(() => quiverImageRequest({ model: 'arrow-2-telos', prompt: 'p' }), /Unsupported Quiver model/);
  assert.throws(() => quiverImageRequest({ model: 'arrow-2', prompt: ' ' }), /1–10000/);
});

test('cleaning drops the credit comment and the white canvas rects, keeps the drawing', () => {
  const raw = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n<rect x="0" y="0" width="512" height="512" fill="#FFFFFF" stroke="none" /><!-- SVG created with Arrow -->\n  <rect width="512" height="512" fill="#fff" fill-opacity=".65" />\n  <rect width="40" height="40" fill="#fff"/><path d="M0 0h10" fill="#000"/></svg>';
  const clean = cleanQuiverSvg(raw);
  assert.doesNotMatch(clean, /<!--|width="512" height="512" fill/);
  assert.match(clean, /<rect width="40" height="40" fill="#fff"\/><path/);
});

test('generation returns the cleaned SVG; an empty balance is a billing failure', async () => {
  process.env.QUIVER_API_KEY = 'test-quiver-not-real';
  const svg = '<svg viewBox="0 0 512 512"><!-- by Quiver --><path d="M0 0"/></svg>';
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.quiver.ai/v1/svgs/generations');
    assert.equal(JSON.parse(init.body).model, 'arrow-2');
    return Response.json({ id: 'q1', data: [{ mime_type: 'image/svg+xml', svg }], usage: { input_tokens: 10, output_tokens: 20 } });
  });
  const ok = await generateQuiverImage({ model: 'arrow-2', prompt: 'p', instructions: 'i' });
  assert.doesNotMatch(ok.svg, /Quiver/);
  assert.equal(ok.requestId, 'q1');
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ status: 402, code: 'insufficient_credits', message: 'x' }, { status: 402 }));
  const error = await generateQuiverImage({ model: 'arrow-2', prompt: 'p' }).catch(e => e);
  assert.equal(providerFailure(error, { provider: 'quiver' }).failureSource, 'external_provider_billing');
  mock.restoreAll();
  delete process.env.QUIVER_API_KEY;
});
