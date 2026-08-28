import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fixture from '../../../schemas/nlu-schema/tests/generation/valid.json' with { type: 'json' };
import {
  acceptNlu, acceptComposition, decodeNluMaps, buildNluRequest,
  buildCompositionRequest, projectProviderSchema, createPhaseExecution, canonicalJson,
  NLU_TOOL_SCHEMA, COMPOSE_TOOL_SCHEMA, PipelineContractError,
  buildSpatialPromptRequest, requestSpatialPrompt,
} from './pipelineContracts.js';
import { runPhase1, runPhase2 } from './pipelineRunner.js';
import { buildGeminiRequest } from './geminiTranslate.js';

afterEach(() => mock.restoreAll());

test('all three runtime products work without string code generation required by strict CSP', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const script = `
    import { acceptNlu, acceptComposition, buildSpatialPromptRequest } from './netlify/functions/_shared/pipelineContracts.js';
    import fixture from './schemas/nlu-schema/tests/generation/valid.json' with { type: 'json' };
    import { parseSVG } from './schemas/mf-svg-schema/index.js';
    const nlu = acceptNlu(fixture, fixture.utterance);
    const composition = acceptComposition({ elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe." }, 'es-419');
    buildSpatialPromptRequest(nlu, composition.elements);
    parseSVG('<svg xmlns="http://www.w3.org/2000/svg"/>');
    console.log('strict-CSP runtime passed');
  `;
  const output = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.match(output, /strict-CSP runtime passed/);
});

test('independent packages ship one identical portable validator generator engine', () => {
  const engines = ['nlu-schema', 'pictogram-composition-schema', 'mf-svg-schema'].map(product =>
    fs.readFileSync(new URL(`../../../schemas/${product}/scripts/standalone-code.js`, import.meta.url), 'utf8'));
  assert.equal(engines[0], engines[1]);
  assert.equal(engines[0], engines[2]);
});

test('fresh NLU decodes all dynamic maps reversibly and retains raw invalid evidence', () => {
  const encoded = structuredClone(fixture);
  encoded.frames[0].roles = JSON.stringify(encoded.frames[0].roles);
  encoded.nsm_explications = JSON.stringify(encoded.nsm_explications);
  encoded.visual_guidelines.salience = '{"f1":0.8}';
  const data = acceptNlu(encoded, fixture.utterance);
  assert.deepEqual(data.frames, fixture.frames);
  assert.deepEqual(data.nsm_explications, fixture.nsm_explications);
  assert.deepEqual(data.visual_guidelines.salience, { f1: 0.8 });
  assert.equal(typeof encoded.frames[0].roles, 'string');
  for (const bad of ['invalid JSON', '[]', 'null', '42']) {
    const broken = { ...encoded, nsm_explications: bad };
    assert.throws(() => acceptNlu(broken), error => error instanceof PipelineContractError && error.rawOutput === broken && error.issues[0].instancePath === '/nsm_explications');
  }
  assert.throws(() => acceptNlu(fixture, 'Different intention'), /exact input utterance/);
  assert.throws(() => acceptNlu({ ...fixture, frames: [] }), /contract validation failed/);
  assert.throws(() => acceptNlu({ ...fixture, metadata: { ...fixture.metadata, speaker_id: 'invented' } }), /contract validation failed/);
});

test('both provider projections resolve local refs without weakening deep elements', () => {
  assert.equal(JSON.stringify(NLU_TOOL_SCHEMA).includes('"$ref"'), false);
  assert.equal(JSON.stringify(COMPOSE_TOOL_SCHEMA).includes('"$ref"'), false);
  assert.equal(NLU_TOOL_SCHEMA.properties.frames.items.properties.roles.additionalProperties.required[0], 'type');
  let element = COMPOSE_TOOL_SCHEMA.properties.elements.items;
  let depth = 1;
  while (element.properties.children) { element = element.properties.children.items; depth++; }
  assert.equal(depth, 6);
  assert.deepEqual(element.required, ['id', 'concept']);
  assert.equal(element.additionalProperties, false);
  assert.throws(() => projectProviderSchema({ $ref: '#/missing' }), /Unresolved/);
  assert.throws(() => projectProviderSchema({ $ref: 'https://external.test/schema' }), /external/);
});

test('Gemini maps retain their actual value schema and salience decodes as a numeric map', () => {
  const params = buildGeminiRequest(buildNluRequest(fixture.utterance, { comprenderModel: 'gemini-2.5-flash' }));
  const schema = params.tools[0].functionDeclarations[0].parameters;
  const roles = schema.properties.frames.items.properties.roles;
  const nsm = schema.properties.nsm_explications;
  assert.equal(roles.type, 'string');
  assert.match(roles.description, /ref_frame/);
  assert.equal(nsm.type, 'string');
  assert.match(nsm.description, /"type":"string"/);
  assert.doesNotMatch(nsm.description, /mapping role names/);
  assert.deepEqual(decodeNluMaps({ visual_guidelines: { salience: '{"f1":0.5}' } }), { visual_guidelines: { salience: { f1: 0.5 } } });
});

test('composition receives every NLU field and deterministic roots do not mutate evidence', () => {
  const request = buildCompositionRequest(fixture, { domainContext: 'Synthetic fixture' });
  const sent = JSON.parse(request.messages[0].content.replace('NLU Semantics: ', ''));
  assert.deepEqual(sent, fixture);
  const raw = { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe agua." };
  const accepted = acceptComposition(raw, 'es-419');
  assert.equal(accepted.elements[0].id, 'pictograma');
  assert.deepEqual(accepted.elements[0].children, raw.elements);
  assert.notEqual(accepted.elements[0].children, raw.elements);
  assert.equal(acceptComposition(raw, 'en-GB').elements[0].id, 'pictogram');
  assert.throws(() => acceptComposition({ ...raw, elements: [{ children: [] }] }, 'es'), /contract validation failed/);
  assert.throws(() => acceptComposition({ ...raw, prompt: "'persona' junto a 'unknown'." }, 'es'), /unknown element/);
});

test('accepted execution hashes capture actual complete request and output without modifying either', async () => {
  const request = buildNluRequest(fixture.utterance, { lang: 'es-419', domainContext: 'water' });
  const execution = await createPhaseExecution(1, request, fixture);
  const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
  assert.equal(execution.inputHash, sha(request));
  assert.equal(execution.outputHash, sha(fixture));
  assert.equal(execution.promptHash, sha(request.system));
  assert.match(execution.contractHash, /^[0-9a-f]{64}$/);
  assert.equal(execution.validated, true);
  assert.equal(execution.contractVersion, '1.1.0');
  assert.deepEqual(execution.inputSnapshot, request);
  request.messages[0].content = 'changed afterwards';
  assert.notEqual(execution.inputSnapshot.messages[0].content, request.messages[0].content);
  assert.equal(fixture.execution, undefined);
});

test('batch sends the shared request, validates results, and emits evidence only after acceptance', async () => {
  const oldKey = process.env.PICTOS_ANTHROPIC_KEY;
  process.env.PICTOS_ANTHROPIC_KEY = 'synthetic-test-key';
  const outputs = [fixture, { elements: [{ id: 'persona', concept: 'Agent' }], prompt: "'persona' bebe agua." }, { ...fixture, frames: [] }];
  const sent = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    return Response.json({ content: [{ type: 'tool_use', name: request.tool_choice.name, input: outputs.shift() }] });
  });
  try {
    const evidence = [];
    const config = { lang: 'es-419' };
    const nlu = await runPhase1(fixture.utterance, config, e => evidence.push(e));
    const composition = await runPhase2(nlu, config, e => evidence.push(e));
    assert.deepEqual(sent[0], buildNluRequest(fixture.utterance, config));
    assert.deepEqual(sent[1], buildCompositionRequest(nlu, config));
    assert.equal(composition.elements[0].concept, 'Root');
    assert.equal(evidence.length, 2);
    await assert.rejects(runPhase1(fixture.utterance, config, e => evidence.push(e)), PipelineContractError);
    assert.equal(evidence.length, 2);
    assert.equal(fetchMock.mock.callCount(), 3, 'malformed fresh output must not trigger a paid replay');
  } finally {
    if (oldKey === undefined) delete process.env.PICTOS_ANTHROPIC_KEY;
    else process.env.PICTOS_ANTHROPIC_KEY = oldKey;
  }
});

test('actual spatial route sends full NLU through a forced tool and records distinct accepted phase 2 evidence', async () => {
  const elements = [{ id: 'pictograma', concept: 'Root', children: [{ id: 'persona', concept: 'Agent' }] }];
  const original = structuredClone(elements);
  const evidence = [];
  let calls = 0;
  const prompt = await requestSpatialPrompt(fixture, elements, { componerModel: 'gemini-2.5-flash' }, async (model, request) => {
    calls++;
    assert.equal(model, 'gemini-2.5-flash');
    assert.deepEqual(JSON.parse(request.messages[0].content), { nlu: fixture, elements });
    const gemini = buildGeminiRequest(request);
    assert.deepEqual(gemini.toolConfig.functionCallingConfig.allowedFunctionNames, ['regenerate_spatial_prompt']);
    return { content: [{ type: 'tool_use', name: 'regenerate_spatial_prompt', input: { prompt: "'persona' se sitúa dentro de 'pictograma'." } }] };
  }, execution => evidence.push(execution));
  assert.equal(calls, 1);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].phase, 2);
  assert.equal(evidence[0].promptVersion, 'spatial-regeneration-0.1.0');
  assert.equal(evidence[0].outputHash, createHash('sha256').update(canonicalJson({ elements, prompt })).digest('hex'));
  assert.deepEqual(elements, original);
});

test('spatial route rejects invalid output once and emits no accepted evidence or fabricated replacement', async () => {
  const elements = [{ id: 'pictograma', concept: 'Root', children: [{ id: 'persona', concept: 'Agent' }] }];
  const original = structuredClone(elements);
  for (const raw of [{ prompt: '' }, { prompt: '   ' }, { prompt: "'pictograma' está aquí." }, { prompt: "'persona' junto a 'unknown'." }, { prompt: "'persona' aquí.", elements: [] }]) {
    let calls = 0;
    const evidence = [];
    await assert.rejects(requestSpatialPrompt(fixture, elements, {}, async () => {
      calls++;
      return { content: [{ type: 'tool_use', name: 'regenerate_spatial_prompt', input: raw }] };
    }, execution => evidence.push(execution)), error => error instanceof PipelineContractError && error.rawOutput === raw);
    assert.equal(calls, 1);
    assert.equal(evidence.length, 0);
    assert.deepEqual(elements, original);
  }
  const absentTool = { content: [{ type: 'text', text: "'persona' aquí." }] };
  await assert.rejects(requestSpatialPrompt(fixture, elements, {}, async () => absentTool), error => error.rawOutput === absentTool);
  let invalidInputCalls = 0;
  await assert.rejects(requestSpatialPrompt(fixture, [{ id: 'incomplete' }], {}, async () => { invalidInputCalls++; }), PipelineContractError);
  assert.equal(invalidInputCalls, 0);
  assert.throws(() => buildSpatialPromptRequest({ ...fixture, lang: null }, elements), PipelineContractError);
});
