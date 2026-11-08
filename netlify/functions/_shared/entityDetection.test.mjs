import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDetectionRequest, parseDetections } from './entityDetection.js';

const reply = items => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] });

test('detections are normalized to x, y, w, h and keep only requested, well-formed entries', () => {
  const out = parseDetections(reply([
    { label: 'knife', box_2d: [519, 504, 881, 588] },
    { label: 'knife', box_2d: [100, 100, 200, 150] },   // second part of the same entity
    { label: 'kitchen', box_2d: [0, 0, 10, 10] },       // not requested
    { label: 'onion', box_2d: [600, 300, 500, 800] },   // inverted box
    { label: 'person' },                                 // no box
  ]), ['knife', 'onion', 'person']);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].box.map(v => +v.toFixed(3)), [0.504, 0.519, 0.084, 0.362]);
});

test('fenced replies parse; unreadable replies are null, never "nothing drawn"', () => {
  const fenced = { candidates: [{ content: { parts: [{ text: '```json\n[{"label":"a","box_2d":[0,0,500,500]}]\n```' }] } }] };
  assert.equal(parseDetections(fenced, ['a']).length, 1);
  assert.equal(parseDetections({ candidates: [{ content: { parts: [{ text: '[{"label":' }] } }] }, ['a']), null);
  assert.equal(parseDetections({ candidates: [{ content: { parts: [{ text: '{"label":"a"}' }] } }] }, ['a']), null);
  assert.deepEqual(parseDetections(reply([]), ['a']), []);
});

test('the request carries the image, every label verbatim and a bounded JSON answer', () => {
  const body = buildDetectionRequest({ utterance: 'slice the onion ', labels: ['person', 'slicing_motion'], mimeType: 'image/png', base64: 'AAAA' });
  assert.equal(body.contents[0].parts[0].inlineData.data, 'AAAA');
  assert.match(body.contents[0].parts[1].text, /"slice the onion".*person, slicing_motion/s);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.maxOutputTokens <= 4096);
});
