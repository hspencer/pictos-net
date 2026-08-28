import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareBenchmark, executeBenchmark } from './benchmark-models.mjs';
const nlu = { utterance: 'Beber agua', lang: 'es-419', metadata: { speech_act: 'directive', intent: 'request' },
  frames: [{ id: 'f1', frame_name: 'Ingestion', lexical_unit: 'beber', roles: { Agent: { type: 'Agent', surface: 'persona' }, Theme: { type: 'Theme', surface: 'agua' } } }],
  nsm_explications: { beber: 'ALGUIEN QUIERE HACER ALGO' }, logical_form: { event: 'beber(persona, agua)', modality: 'want' },
  pragmatics: { politeness: 'neutral', formality: 'neutral', expected_response: 'compliance' },
  visual_guidelines: { focus_actor: 'persona', action_core: 'beber', object_core: 'agua', context: '', temporal: 'immediate' } };
const cases = { synthetic: true, cases: [{ id: 'beber', utterance: 'Beber agua', nlu }] };
const options = { cases, phase: 1, models: ['gpt-5.6-luna'], budgetUsd: 10, maxCalls: 5 };
afterEach(() => mock.restoreAll());

test('planning is deterministic, uses frozen canonical inputs and never contacts providers', () => {
  const network = mock.method(globalThis, 'fetch', () => { throw new Error('Planning must not use the network'); });
  const plan = prepareBenchmark({ ...options, phase: 2, models: ['gpt-5.6-luna', 'gemini-2.5-flash', 'claude-haiku-4-5-20251001'] });
  assert.equal(plan.plannedCalls, 3);
  assert.equal(new Set(plan.attempts.map(a => a.promptHash)).size, 1);
  assert.ok(plan.attempts.every(a => a.request.messages[0].content.includes('Ingestion')));
  assert.deepEqual(prepareBenchmark(options), prepareBenchmark(options));
  assert.equal(network.mock.callCount(), 0);
  assert.throws(() => prepareBenchmark({ ...options, cases: { ...cases, synthetic: false } }), /synthetic/);
  assert.throws(() => prepareBenchmark({ ...options, phase: 3 }), /phase/);
  assert.throws(() => prepareBenchmark({ ...options, models: ['gpt-image-2'] }), /supported/);
});

test('execution needs authorization, immutable plan, both budget and call cap', async () => {
  const plan = prepareBenchmark(options);
  const callModel = () => { throw new Error('must not call'); };
  await assert.rejects(executeBenchmark(plan, { callModel }), /requires/);
  await assert.rejects(executeBenchmark({ ...plan, phase: 2 }, { authorized: true, callModel }), /modified/);
  await assert.rejects(executeBenchmark(prepareBenchmark({ ...options, budgetUsd: null }), { authorized: true, callModel }), /requires/);
  const stopped = await executeBenchmark(prepareBenchmark({ ...options, budgetUsd: 0.000001 }), { authorized: true, callModel });
  assert.equal(stopped.stopReason, 'estimated_budget');
  assert.equal(stopped.attempts.length, 0);
});

test('records rejected outputs and known usage without semantic retry; obeys the call cap', async () => {
  const records = [];
  let calls = 0;
  const run = await executeBenchmark(prepareBenchmark({ ...options, repetitions: 3, maxCalls: 1 }), { authorized: true,
    record: value => records.push(value), callModel: async (request, limits) => {
      calls++;
      assert.equal(limits.retries, 0); assert.equal(request.max_tokens, 4096);
      assert.equal(records.at(-1).state, 'reserved');
      return { model: 'returned-snapshot', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'tool_use', name: 'analyze_utterance', input: {} }] };
    } });
  assert.equal(calls, 1); assert.equal(run.stopReason, 'call_cap');
  assert.equal(run.attempts[0].canonicalValid, false); assert.equal(run.attempts[0].returnedModel, 'returned-snapshot');
  assert.equal(run.attempts[0].inputTokens, 100); assert.ok(run.attempts[0].estimatedCostUsd > 0);
  assert.deepEqual(run.attempts[0].rawOutput, {});
});

test('unknown usage retains the reservation and stops before another dispatch', async () => {
  let calls = 0;
  const plan = prepareBenchmark({ ...options, repetitions: 2 });
  const run = await executeBenchmark(plan, { authorized: true, callModel: async () => { calls++; throw new Error('provider timeout'); } });
  assert.equal(calls, 1); assert.equal(run.stopReason, 'usage_uncertain');
  assert.equal(run.attempts[0].inputTokens, null); assert.equal(run.attempts[0].estimatedCostUsd, null);
  assert.equal(run.estimatedExposureUsd, plan.attempts[0].reservedUsd);
});

test('successful canonical output preserves all evidence and uses frozen reference rates', async () => {
  const run = await executeBenchmark(prepareBenchmark(options), { authorized: true, callModel: async () => ({
    model: 'gpt-5.6-luna', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', name: 'analyze_utterance', input: nlu }],
  }) });
  assert.equal(run.state, 'completed'); assert.equal(run.attempts[0].canonicalValid, true);
  assert.match(run.attempts[0].outputHash, /^[a-f0-9]{64}$/);
  assert.equal(run.attempts[0].estimatedCostUsd, 0.00008);
});

test('known cached-input rates are applied; unknown cache pricing stops rather than fabricating comparable cost', async () => {
  const cachedResponse = { model: 'gpt-5.6-luna', usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 80 } }, content: [{ type: 'tool_use', name: 'analyze_utterance', input: nlu }] };
  const known = await executeBenchmark(prepareBenchmark(options), { authorized: true, callModel: async () => cachedResponse });
  assert.equal(known.attempts[0].estimatedCostUsd, (20 * 0.2 + 80 * 0.02 + 50 * 1.2) / 1e6);
  for (const usage of [{ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10 }, { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: -1 } }]) {
    const unknown = await executeBenchmark(prepareBenchmark(options), { authorized: true, callModel: async () => ({ ...cachedResponse, usage }) });
    assert.equal(unknown.stopReason, 'usage_uncertain'); assert.equal(unknown.attempts[0].estimatedCostUsd, null);
  }
});
