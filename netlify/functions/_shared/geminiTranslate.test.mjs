/**
 * Unit tests for the pure Claude→Gemini request translation.
 * Run: node --test netlify/functions/_shared/geminiTranslate.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claudeContentToGeminiParts,
  claudeToolToGeminiFunctionDeclaration,
  buildGeminiRequest,
  thinkingBudgetFor,
  geminiResponseToClaude,
  MAX_OUTPUT_TOKENS_CAP,
} from './geminiTranslate.js';

test('text + image blocks map to Gemini parts (inlineData preserves mime/data)', () => {
  const parts = claudeContentToGeminiParts([
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    { type: 'text', text: 'hola' },
  ]);
  assert.deepEqual(parts, [
    { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
    { text: 'hola' },
  ]);
});

test('a plain string content becomes a single text part', () => {
  assert.deepEqual(claudeContentToGeminiParts('hi'), [{ text: 'hi' }]);
});

test('tool maps to a functionDeclaration with parameters = input_schema', () => {
  const decl = claudeToolToGeminiFunctionDeclaration({
    name: 'redraw_svg',
    description: 'd',
    input_schema: { type: 'object', properties: {} },
  });
  assert.deepEqual(decl, { name: 'redraw_svg', description: 'd', parameters: { type: 'object', properties: {} } });
});

test('output tokens are capped at the shared cap', () => {
  const body = buildGeminiRequest({
    model: 'gemini-2.5-flash',
    max_tokens: 999999,
    messages: [{ content: [{ type: 'text', text: 'x' }] }],
  });
  assert.equal(body.generationConfig.maxOutputTokens, MAX_OUTPUT_TOKENS_CAP);
});

test('thinking is disabled on flash and kept minimal on pro', () => {
  assert.equal(thinkingBudgetFor('gemini-2.5-flash'), 0);
  assert.equal(thinkingBudgetFor('gemini-2.5-pro'), 128);
  const flash = buildGeminiRequest({ model: 'gemini-2.5-flash', messages: [{ content: [] }] });
  assert.equal(flash.generationConfig.thinkingConfig.thinkingBudget, 0);
});

test('tool_choice forces the named function (ANY mode)', () => {
  const body = buildGeminiRequest({
    model: 'gemini-2.5-flash',
    messages: [{ content: [] }],
    tools: [{ name: 'redraw_svg', input_schema: { type: 'object' } }],
    tool_choice: { name: 'redraw_svg' },
  });
  assert.equal(body.tools[0].functionDeclarations[0].name, 'redraw_svg');
  assert.equal(body.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.deepEqual(body.toolConfig.functionCallingConfig.allowedFunctionNames, ['redraw_svg']);
});

test('system string becomes a systemInstruction part', () => {
  const body = buildGeminiRequest({ model: 'gemini-2.5-flash', system: 'reglas', messages: [{ content: [] }] });
  assert.equal(body.systemInstruction.parts[0].text, 'reglas');
});

test('system as content-block array is joined into one instruction', () => {
  const body = buildGeminiRequest({
    model: 'gemini-2.5-flash',
    system: [{ text: 'a' }, { text: 'b' }],
    messages: [{ content: [] }],
  });
  assert.equal(body.systemInstruction.parts[0].text, 'a\nb');
});

test('no tools / no tool_choice → body omits tools and toolConfig', () => {
  const body = buildGeminiRequest({ model: 'gemini-2.5-flash', messages: [{ content: [{ type: 'text', text: 'x' }] }] });
  assert.equal(body.tools, undefined);
  assert.equal(body.toolConfig, undefined);
  assert.equal(body.contents[0].role, 'user');
});

test('geminiResponseToClaude maps a functionCall to a tool_use block', () => {
  const r = geminiResponseToClaude({
    candidates: [{ content: { parts: [{ functionCall: { name: 'redraw_svg', args: { groups: [] } } }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.response.content[0].type, 'tool_use');
  assert.equal(r.response.content[0].name, 'redraw_svg');
  assert.deepEqual(r.response.content[0].input, { groups: [] });
  assert.equal(r.response.usage.input_tokens, 10);
  assert.equal(r.response.usage.output_tokens, 20);
});

test('geminiResponseToClaude reports a clear error when no tool call (e.g. truncation)', () => {
  const r = geminiResponseToClaude({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial…' }] } }],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /did not invoke the tool/);
  assert.match(r.error, /MAX_TOKENS/);
});

test('geminiResponseToClaude tolerates an empty/blocked response', () => {
  const r = geminiResponseToClaude({});
  assert.equal(r.ok, false);
  assert.match(r.error, /did not invoke the tool/);
});
