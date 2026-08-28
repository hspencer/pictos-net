#!/usr/bin/env node
/** Local text benchmark. Default invocation plans only; never selects a library. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { MODEL_CATALOG, getModelProvider, modelSupportsPhase } from '../netlify/functions/_shared/modelCatalog.js';
import { buildNluRequest, buildCompositionRequest, acceptNlu, acceptComposition, canonicalJson, NLU_VERSION, COMPOSITION_VERSION } from '../netlify/functions/_shared/pipelineContracts.js';
import { callTextModel } from '../netlify/functions/_shared/pipelineRunner.js';
import { buildOpenAITextRequest } from '../netlify/functions/_shared/openaiText.js';
import { buildGeminiRequest } from '../netlify/functions/_shared/geminiTranslate.js';

const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const positive = value => Number.isFinite(value) && value > 0;
const integer = value => Number.isInteger(value) && value > 0;
const tokenCount = value => Number.isInteger(value) && value >= 0;
const warning = 'Costs are estimates, not invoice ceilings. Structural validation does not establish semantic or AAC effectiveness.';

function wireRequest(request) {
  const provider = getModelProvider(request.model);
  if (provider === 'openai') return buildOpenAITextRequest(request);
  if (provider === 'gemini') return buildGeminiRequest(request);
  return request;
}

function ratesFor(price, inputTokens) {
  if (price?.kind !== 'tokens') throw new Error('A known text price is required');
  const rates = price.longContext && inputTokens > price.longContext.aboveInputTokens ? price.longContext : price;
  if (!positive(rates.inputUsdPerMillion) || !positive(rates.outputUsdPerMillion)) throw new Error('Unknown token rates');
  return rates;
}

export function prepareBenchmark({ cases, phase, models, repetitions = 1, maxOutputTokens = 4096, budgetUsd = null, maxCalls = null, seed = 'pictonet-benchmark-1' }) {
  if (cases?.synthetic !== true || !Array.isArray(cases.cases) || !cases.cases.length) throw new Error('Explicit synthetic case file required');
  if (![1, 2].includes(phase) || !integer(repetitions) || !integer(maxOutputTokens) || maxOutputTokens > 32768) throw new Error('Invalid phase, repetitions or output cap');
  if (!Array.isArray(models) || !models.length || new Set(models).size !== models.length || models.some(model => !modelSupportsPhase(model, phase))) throw new Error('Select distinct supported text models');
  if ((budgetUsd !== null && !positive(budgetUsd)) || (maxCalls !== null && !integer(maxCalls))) throw new Error('Invalid execution limits');
  if (cases.cases.length * models.length * repetitions > 1000) throw new Error('Plan exceeds 1000 attempts; split the experiment explicitly');
  const ids = new Set();
  const attempts = [];
  for (const item of cases.cases) {
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) || typeof item.utterance !== 'string' || !item.utterance.trim()) throw new Error('Each synthetic case needs a unique id and utterance');
    ids.add(item.id);
    // Phase 2 always receives the same validated, frozen NLU, never another run's output.
    const nlu = phase === 2 ? acceptNlu(item.nlu, item.utterance) : null;
    for (const model of models) for (let repetition = 0; repetition < repetitions; repetition++) {
      const config = { ...(cases.config || {}), [phase === 1 ? 'comprenderModel' : 'componerModel']: model };
      const request = phase === 1 ? buildNluRequest(item.utterance, config) : buildCompositionRequest(nlu, config);
      request.max_tokens = maxOutputTokens;
      const wire = wireRequest(request);
      // Deliberately conservative text-only reservation: 2 tokens per UTF-8
      // request byte plus 8192 framing tokens. This is an admission estimate,
      // not a provider tokenizer guarantee or a hard monetary invoice cap.
      const inputBound = Buffer.byteLength(canonicalJson(wire), 'utf8') * 2 + 8192;
      const outputBound = maxOutputTokens + (wire.generationConfig?.thinkingConfig?.thinkingBudget || 0);
      const rates = ratesFor(MODEL_CATALOG[model].pricing, inputBound);
      const reservedUsd = (inputBound * rates.inputUsdPerMillion + outputBound * rates.outputUsdPerMillion) / 1e6;
      attempts.push({ caseId: item.id, utterance: item.utterance, lang: nlu?.lang || config.lang || 'es-419', model, repetition, request, requestHash: sha(request), wireHash: sha(wire),
        inputBound, outputBound, reservedUsd, pricing: structuredClone(MODEL_CATALOG[model].pricing), pricingCheckedAt: MODEL_CATALOG[model].pricingCheckedAt,
        pricingSource: MODEL_CATALOG[model].pricingSource, contractHash: sha(request.tools[0].input_schema),
        promptHash: sha(request.system), reasoning: wire.reasoning || wire.generationConfig?.thinkingConfig || null,
        orderKey: sha({ seed, caseId: item.id, model, repetition }) });
    }
  }
  attempts.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const plan = { version: 1, phase, seed, caseHash: sha(cases), configHash: sha(cases.config || {}), contractVersion: phase === 1 ? NLU_VERSION : COMPOSITION_VERSION,
    promptVersion: phase === 1 ? 'nlu-1.1.0' : 'composition-0.1.0', limits: { maxOutputTokens, budgetUsd, maxCalls },
    plannedCalls: attempts.length, totalReservedEstimateUsd: attempts.reduce((n, a) => n + a.reservedUsd, 0), warning, attempts };
  return { ...plan, planHash: sha(plan) };
}

function usageCost(price, usage) {
  if (!usage || !tokenCount(usage.input_tokens) || !tokenCount(usage.output_tokens)) return null;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (![cacheWrite, cacheRead, cached].every(tokenCount)) return null;
  // Claude cache-write duration and Vertex cached tariffs are not in this
  // catalog. Unknown cache prices must stop, not distort the comparison.
  if (cacheWrite > 0 || cacheRead > 0) return null;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const rates = ratesFor(price, input);
  if (cached > input || (cached > 0 && (!positive(rates.cachedInputUsdPerMillion)))) return null;
  return { inputTokens: input, outputTokens: output, estimatedCostUsd: ((input - cached) * rates.inputUsdPerMillion + cached * (rates.cachedInputUsdPerMillion ?? 0) + output * rates.outputUsdPerMillion) / 1e6 };
}

export async function executeBenchmark(plan, { authorized = false, callModel = callTextModel, record = () => {} } = {}) {
  const { planHash, ...frozen } = plan;
  if (sha(frozen) !== planHash) throw new Error('Benchmark plan was modified');
  if (!authorized || !positive(plan.limits.budgetUsd) || !integer(plan.limits.maxCalls)) throw new Error('Execution requires --run, positive --budget-usd and --max-calls');
  const run = { planHash, state: 'running', estimatedExposureUsd: 0, attempts: [], warning };
  for (const attempt of plan.attempts) {
    if (run.attempts.length >= plan.limits.maxCalls) { run.state = 'stopped'; run.stopReason = 'call_cap'; break; }
    if (run.estimatedExposureUsd + attempt.reservedUsd > plan.limits.budgetUsd) { run.state = 'stopped'; run.stopReason = 'estimated_budget'; break; }
    run.estimatedExposureUsd += attempt.reservedUsd;
    const startedAt = Date.now();
    let response, output, error;
    // Record reservation before dispatch; a crash leaves the pending cost visible.
    await record({ state: 'reserved', requestHash: attempt.requestHash, reservedUsd: attempt.reservedUsd, model: attempt.model });
    try {
      response = await callModel(attempt.request, { retries: 0, maxTotalMs: 75000 });
      const block = response.content?.find(b => b.type === 'tool_use' && b.name === attempt.request.tool_choice.name);
      if (!block) throw new Error('Requested semantic tool was not returned');
      output = plan.phase === 1 ? acceptNlu(block.input, attempt.utterance) : acceptComposition(block.input, attempt.lang);
    } catch (caught) { error = caught; }
    const usage = response?.usage ?? error?.usage ?? null;
    const cost = usageCost(attempt.pricing, usage);
    const result = { state: 'recorded', caseId: attempt.caseId, requestedModel: attempt.model, returnedModel: response?.model ?? error?.actualModel ?? null,
      phase: plan.phase, repetition: attempt.repetition, requestHash: attempt.requestHash, milliseconds: Date.now() - startedAt,
      usage, inputTokens: cost?.inputTokens ?? null, outputTokens: cost?.outputTokens ?? null,
      estimatedCostUsd: cost?.estimatedCostUsd ?? null, reservedUsd: attempt.reservedUsd,
      canonicalValid: !error, failure: error?.message || null, diagnostics: error?.issues || error?.errors || null,
      output: output ?? null, rawResponse: response ?? error?.rawResponse ?? null, rawOutput: error?.rawOutput ?? null, outputHash: output ? sha(output) : null };
    run.attempts.push(result);
    await record(result);
    if (!cost) { run.state = 'stopped'; run.stopReason = 'usage_uncertain'; break; }
    run.estimatedExposureUsd += cost.estimatedCostUsd - attempt.reservedUsd;
    if (cost.inputTokens > attempt.inputBound || cost.outputTokens > attempt.outputBound) { run.state = 'stopped'; run.stopReason = 'reservation_bound_exceeded'; break; }
    if (error?.status === 401 || error?.status === 403 || error?.status === 429) { run.state = 'stopped'; run.stopReason = 'provider_rejected'; break; }
    if (run.estimatedExposureUsd >= plan.limits.budgetUsd) { run.state = 'stopped'; run.stopReason = 'estimated_budget'; break; }
  }
  if (run.state === 'running') run.state = 'completed';
  return run;
}

async function main() {
  const { values } = parseArgs({ options: {
    cases: { type: 'string' }, phase: { type: 'string' }, models: { type: 'string' }, repetitions: { type: 'string' },
    'max-output-tokens': { type: 'string' }, 'max-calls': { type: 'string' }, 'budget-usd': { type: 'string' },
    seed: { type: 'string' }, run: { type: 'boolean', default: false }, out: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log('node scripts/benchmark-models.mjs --cases research/cases.json --phase 1|2 --models model-a,model-b [--repetitions 3] [--max-output-tokens 4096]\nDefault: plan only, no network. Paid execution additionally requires --run --max-calls N --budget-usd N --max-output-tokens N. Results stay in research/.'); return; }
  if (!values.cases || !values.phase || !values.models) throw new Error('Specify --cases, --phase and --models; use --help');
  if (values.run && (!values['max-output-tokens'] || !values['budget-usd'] || !values['max-calls'])) throw new Error('Paid execution needs explicit --max-output-tokens, --max-calls and --budget-usd');
  const plan = prepareBenchmark({ cases: JSON.parse(fs.readFileSync(values.cases, 'utf8')), phase: Number(values.phase), models: values.models.split(','),
    repetitions: values.repetitions ? Number(values.repetitions) : 1, maxOutputTokens: values['max-output-tokens'] ? Number(values['max-output-tokens']) : 4096,
    budgetUsd: values['budget-usd'] ? Number(values['budget-usd']) : null, maxCalls: values['max-calls'] ? Number(values['max-calls']) : null, seed: values.seed });
  if (!values.run) { console.log(JSON.stringify({ state: 'planned', ...plan }, null, 2)); return; }
  const research = fs.realpathSync(path.resolve('research'));
  const directory = path.resolve(values.out || path.join(research, `benchmark-${Date.now()}`));
  if (!directory.startsWith(research + path.sep) || fs.existsSync(directory) || fs.realpathSync(path.dirname(directory)) !== research) throw new Error('Output must be a new direct directory inside research/');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  const run = await executeBenchmark(plan, { authorized: true, record: item => fs.appendFileSync(path.join(directory, 'attempts.jsonl'), JSON.stringify(item) + '\n') });
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(run, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ directory, state: run.state, attempts: run.attempts.length, estimatedExposureUsd: run.estimatedExposureUsd, stopReason: run.stopReason, warning }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
