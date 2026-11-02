import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGeminiImagePrompt, composeRecraftPrompt, plainComposition } from './imagePrompts.js';

const elements = [{ id: 'persona_que_pregunta', children: [{ id: 'signo-pregunta' }] }, { id: 'mamá' }];
const prompt = "'persona_que_pregunta' mira hacia 'mamá', a la derecha.";

test('image prompts carry element names as plain words, never quoted identifiers', () => {
  for (const full of [composeGeminiImagePrompt(elements, prompt, '¿Dónde está mamá?', null, {}),
    composeRecraftPrompt(elements, prompt, '¿Dónde está mamá?', { lang: 'es-419' }, {})]) {
    assert.ok(!full.includes('_') && !full.includes("'"), full);
    assert.match(full, /- persona que pregunta\n {2}- signo pregunta/);
    assert.match(full, /persona que pregunta mira hacia mamá, a la derecha\./);
  }
  assert.equal(plainComposition(undefined), '');
});

test('Recraft prompt follows the NLU language and keeps its 10000-character contract', () => {
  assert.match(composeRecraftPrompt([], 'x', 'Hi', { lang: 'en-GB' }, {}), /^AAC Pictogram: "Hi"/);
  assert.match(composeRecraftPrompt([], 'x', 'Hola', null, { lang: 'es-419' }), /^Pictograma AAC/);
  assert.throws(() => composeRecraftPrompt([], 'x'.repeat(10000), 'test', null, {}), /10000/);
});
