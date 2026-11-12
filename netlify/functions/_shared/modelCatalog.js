/** Public provider capabilities and reference prices; never contains credentials.
 * USD standard API rates checked 2026-08-27, not a promise of account access,
 * semantic quality, quota, or final billed cost. Internal PICTOS units differ.
 */
export const PRICING_CHECKED_AT = '2026-08-27';

/**
 * Lifecycle status, the single source for what each surface may offer:
 *   workshop     — part of the workshop profile; verified end to end
 *   active       — offered and verified, not part of the workshop profile
 *   experimental — offered with a warning; not yet verified in Pictos routes
 *   retired      — never offered and never admitted by any endpoint; kept here
 *                  only so saved configurations and old rows keep their label
 * Evidence: docs/archivo/DIAGNOSTICO_GENERACION_2026-10-22.md, plan F1.
 */
export const MODEL_STATUSES = ['workshop', 'active', 'experimental', 'retired'];
const anthropicSource = 'https://platform.claude.com/docs/en/about-claude/pricing';
const vertexSource = 'https://cloud.google.com/vertex-ai/generative-ai/pricing';
const openaiSource = 'https://developers.openai.com/api/docs/models/compare';
const recraftSource = 'https://www.recraft.ai/docs/api-reference/pricing';
const quiverSource = 'https://docs.quiver.ai/developers/pricing';

const geminiApiSource = 'https://aistudio.google.com/docs/pricing';
const text = (label, provider, phases, input, output, source, extra = {}, status = 'active') => ({
  label, provider, phases, output: 'text', status,
  pricing: { kind: 'tokens', inputUsdPerMillion: input, outputUsdPerMillion: output, ...extra },
  pricingSource: source, pricingCheckedAt: PRICING_CHECKED_AT,
});
const image = (label, provider, output, usd, source, extra = {}, status = 'active') => ({
  label, provider, phases: [3], output, status, requiresStyle: false,
  ...(provider === 'recraft' ? { requestSize: '1:1' } : {}),
  pricing: { kind: 'image', imageUsd: usd, ...extra },
  pricingSource: source, pricingCheckedAt: PRICING_CHECKED_AT,
});

// Claude prompt cache: 5-minute writes cost 1.25x input, reads 0.1x.
const claudeCache = input => ({ cacheWriteUsdPerMillion: input * 1.25, cacheReadUsdPerMillion: input * 0.1 });

export const MODEL_CATALOG = {
  // ── Offered (benchmark 2026-11-01, docs/BENCHMARK_MODELOS_2026-11.md) ──────
  // COMPRENDER + COMPONER: 100% valid on 48+24 synthetic cases, p50 3.7 s / 2.1 s,
  // ~US$0.0009 per pictogram for both phases. Accepts forced tool_choice; rejects
  // non-default temperature (fixedSampling). Cache from 512 tokens (Haiku 4.5: 4096).
  'claude-haiku-5-5': { ...text('Claude Haiku 5.5', 'claude', [1, 2], 0.10, 0.50, anthropicSource, {
    ...claudeCache(0.10), longContext: { aboveInputTokens: 100000, inputUsdPerMillion: 0.50, outputUsdPerMillion: 2.50 },
  }, 'workshop'), pricingCheckedAt: '2026-11-01', fixedSampling: true },
  // Default for phases 1-2 (2026-11-12): 48/48 valid per phase; fewer repairs and
  // lower cost than Haiku. Haiku stays available as the alternative provider.
  'gpt-6-luna': { ...text('OpenAI GPT-6 Luna', 'openai', [1, 2], 0.10, 0.50,
    'https://developers.openai.com/api/docs/models/gpt-6-luna', {
      cachedInputUsdPerMillion: 0.01,
      longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 0.20, outputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.02 },
    }, 'workshop'), pricingCheckedAt: '2026-11-01' },
  // ESTRUCTURAR: only model covering 98% of semantic nodes with ~0 unresolved regions.
  'claude-sonnet-4-6': text('Claude Sonnet 4.6', 'claude', [5], 3, 15, anthropicSource, claudeCache(3), 'workshop'),
  // PRODUCIR default: 8/8 clear pictograms, p50 9.8 s, US$0.006, outside Vertex image quota.
  'gpt-image-2.5-flare': { ...image('OpenAI GPT Image 2.5 Flare', 'openai', 'bitmap', 0.006,
    'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
    { promptCostsExtra: true, size: '1024×1024' }, 'workshop'), pricingCheckedAt: '2026-10-22' },
  // Retired 2026-11-05: 429 RESOURCE_EXHAUSTED under concurrency (Vertex image quota
  // 2 req/min), 6.5x Flare's price; Google retires it 2027-03-15. Vertex batch stays dormant.
  'gemini-2.5-flash-image': { ...image('Gemini 2.5 Flash Image', 'gemini', 'bitmap', 0.039, vertexSource,
    { promptCostsExtra: true, size: '1024×1024' }, 'retired'), vertexBatch: true },
  // Google alternative (benchmark 2026-11-06, 32/32 in four styles): p50 3.4 s, no thinking
  // tokens. ~US$0.0336 from aggregators; not yet on Google's price page. Shares the Vertex
  // image quota (2 req/min per base model) until an increase is granted.
  'gemini-3.1-flash-lite-image': { ...image('Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image)', 'gemini', 'bitmap', 0.0336,
    'https://www.llmreference.com/model/gemini-3.1-flash-lite-image/gcp-vertex-ai',
    { promptCostsExtra: true, size: '1K' }, 'active'), pricingCheckedAt: '2026-11-06' },
  // Native-SVG route; its output enters ESTRUCTURAR once the C2PA manifest is set aside.
  // Recraft V4.1 family restored 2026-11-07 at the user's request: every variant is offered
  // (vector = native SVG; Utility = flatter, front-facing; Pro = higher detail, 3.75x the price).
  'recraftv4_1_vector': image('Recraft V4.1 (vector)', 'recraft', 'vector', 0.08, recraftSource, {}, 'active'),
  'recraftv4_1_utility_vector': image('Recraft V4.1 Utility (vector)', 'recraft', 'vector', 0.08, recraftSource, {}, 'active'),
  'recraftv4_1_pro_vector': image('Recraft V4.1 Pro (vector)', 'recraft', 'vector', 0.30, recraftSource, {}, 'active'),
  'recraftv4_1_utility_pro_vector': image('Recraft V4.1 Utility Pro (vector)', 'recraft', 'vector', 0.30, recraftSource, {}, 'active'),
  'recraftv4_1': image('Recraft V4.1 (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'active'),
  'recraftv4_1_utility': image('Recraft V4.1 Utility (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'active'),
  'recraftv4_1_pro': image('Recraft V4.1 Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }, 'active'),
  'recraftv4_1_utility_pro': image('Recraft V4.1 Utility Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }, 'active'),
  // QuiverAI Arrow 2, native SVG (research/2026-11-10_quiver-arrow2): 8/8 clean pictograms,
  // p50 29 s, no gradients or text with the style in `instructions`. Verified in the app
  // 2026-11-10: PRODUCIR through worker/poll, then ESTRUCTURAR at 0 % fidelity loss. Token-priced
  // ($4 in / $20 out per 1M); US$0.066 median per pictogram, US$1 held per request.
  'arrow-2': { ...image('QuiverAI Arrow 2 (vector)', 'quiver', 'vector', 0.07, quiverSource,
    { promptCostsExtra: true }, 'active'), pricingCheckedAt: '2026-11-10',
    // Server pipeline batch runs rows in sequence inside a 15-min background function.
    batchMaxRows: 10 },

  // ── Retired: never offered or admitted; kept so saved configs and rows keep a label ──
  // 2026-11-01: superseded on cost, latency or quality by an offered model (see report).
  'claude-haiku-4-5-20251001': text('Claude Haiku 4.5', 'claude', [1, 2], 1, 5, anthropicSource, claudeCache(1), 'retired'),
  'claude-opus-4-6': text('Claude Opus 4.6', 'claude', [5], 5, 25, anthropicSource, claudeCache(5), 'retired'),
  'gpt-5.6-luna': text('OpenAI GPT-5.6 Luna', 'openai', [1, 2, 5], 0.20, 1.20, openaiSource, {
    cachedInputUsdPerMillion: 0.02,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 0.40, outputUsdPerMillion: 1.80 },
  }, 'retired'),
  'gpt-5.6-terra': text('OpenAI GPT-5.6 Terra', 'openai', [1, 2, 5], 2, 12, openaiSource, {
    cachedInputUsdPerMillion: 0.20,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 4, outputUsdPerMillion: 18 },
  }, 'retired'),
  'gpt-5.6-sol': text('OpenAI GPT-5.6 Sol', 'openai', [1, 2, 5], 4, 20, openaiSource, {
    cachedInputUsdPerMillion: 0.40,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 8, outputUsdPerMillion: 30 },
  }, 'retired'),
  // Not offered for any pipeline phase (retired from COMPRENDER/COMPONER 2026-11-01). Its only
  // role is entity detection before ESTRUCTURAR ('detect', api-gemini-detect): 90 % of entities
  // in ~3 s (research/2026-11-07_segmentacion-semantica).
  'gemini-3.8-flash': { ...text('Gemini 3.8 Flash', 'gemini', ['detect'], 0.75, 3.75,
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
    { cachedInputUsdPerMillion: 0.075, scheduledChange: { from: '2027-01-01', inputUsdPerMillion: 1.50, outputUsdPerMillion: 7.50 } }, 'active'),
    thinking: { level: 'LOW' }, pricingCheckedAt: '2026-10-22', benchmarkPhases: [1, 2] },
  // Benchmark candidates for COMPRENDER/COMPONER (2026-11-12): no phase, so never offered or
  // admitted; scripts/benchmark-models.mjs reads benchmarkPhases. Prices from the Gemini API
  // page (aistudio.google.com/docs/pricing); the Vertex page renders client-side.
  'gemini-4-argon': { ...text('Gemini 4 Argon', 'gemini', [], 2, 10, geminiApiSource,
    { cachedInputUsdPerMillion: 0.10, scheduledChange: { from: '2026-12-01', inputUsdPerMillion: 4, outputUsdPerMillion: 20 } }, 'experimental'),
    thinking: { level: 'LOW' }, pricingCheckedAt: '2026-11-12', benchmarkPhases: [1, 2] },
  'gemini-4-carbon': { ...text('Gemini 4 Carbon', 'gemini', [], 2, 10, geminiApiSource,
    { cachedInputUsdPerMillion: 0.10, scheduledChange: { from: '2026-12-01', inputUsdPerMillion: 4, outputUsdPerMillion: 20 } }, 'experimental'),
    thinking: { level: 'LOW' }, pricingCheckedAt: '2026-11-12', benchmarkPhases: [1, 2] },
  'gemini-3.5-flash-lite': { ...text('Gemini 3.5 Flash-Lite', 'gemini', [], 0.30, 2.50, geminiApiSource,
    { cachedInputUsdPerMillion: 0.03 }, 'experimental'), thinking: { level: 'LOW' }, pricingCheckedAt: '2026-11-12', benchmarkPhases: [1, 2] },
  'gemini-3.1-flash-lite': { ...text('Gemini 3.1 Flash-Lite', 'gemini', [], 0.25, 1.50, geminiApiSource,
    { cachedInputUsdPerMillion: 0.025 }, 'experimental'), thinking: { level: 'LOW' }, pricingCheckedAt: '2026-11-12', benchmarkPhases: [1, 2] },
  'gpt-image-2': image('OpenAI GPT Image 2', 'openai', 'bitmap', 0.006,
    'https://developers.openai.com/api/docs/models/gpt-image-2', {
      qualityUsd: { low: 0.006, medium: 0.053, high: 0.211 }, promptCostsExtra: true, size: '1024×1024',
    }, 'retired'),
  'gemini-3.1-flash-image': { ...image('Gemini 3.1 Flash Image', 'gemini', 'bitmap', 0.067, vertexSource,
    { promptCostsExtra: true, size: '1K' }, 'retired'), vertexBatch: true },
  'gemini-3-pro-image': image('Gemini 3 Pro Image', 'gemini', 'bitmap', 0.134, vertexSource,
    { promptCostsExtra: true, size: '1K/2K' }, 'retired'),
  'gemini-nano-banana-2.1': { ...image('Gemini Nano Banana 2.1', 'gemini', 'bitmap', 0.034,
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
    { promptCostsExtra: true, size: '1K' }, 'retired'), pricingCheckedAt: '2026-10-22' },
  'recraftv4_styles': { ...image('Recraft V4 Styles (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'retired'), requiresStyle: true },
  'recraftv4_styles_vector': { ...image('Recraft V4 Styles (vector)', 'recraft', 'vector', 0.05, recraftSource, {}, 'retired'), requiresStyle: true },
  'recraftv4_styles_pro': { ...image('Recraft V4 Styles Pro (raster)', 'recraft', 'bitmap', 0.10, recraftSource, { size: '2K' }, 'retired'), requiresStyle: true },
  'recraftv4_styles_pro_vector': { ...image('Recraft V4 Styles Pro (vector)', 'recraft', 'vector', 0.12, recraftSource, {}, 'retired'), requiresStyle: true },
  // Text Gemini 2.5 retired by Google on 2026-10-20; Pro already returns 404.
  'gemini-2.5-flash': { ...text('Gemini 2.5 Flash', 'gemini', [1, 2, 5], 0.30, 2.50, vertexSource, {}, 'retired'), thinking: { budget: 0 } },
  'gemini-2.5-pro': { ...text('Gemini 2.5 Pro', 'gemini', [1, 2, 5], 1.25, 10, vertexSource, {
    longContext: { aboveInputTokens: 200000, inputUsdPerMillion: 2.50, outputUsdPerMillion: 15 },
  }, 'retired'), thinking: { budget: 128 } },
};

/**
 * Default model per phase (5 = ESTRUCTURAR), the only place defaults live.
 * Evidence: docs/BENCHMARK_MODELOS_2026-11.md (text round 2026-11-12).
 */
export const DEFAULT_MODELS = Object.freeze({
  1: 'gpt-6-luna', 2: 'gpt-6-luna', 3: 'gpt-image-2.5-flare', 5: 'claude-sonnet-4-6',
  /** Entity boxes before ESTRUCTURAR (not a user-selectable phase). */
  detect: 'gemini-3.8-flash',
});

/** The model a config selects for a phase; unset fields follow DEFAULT_MODELS. */
export function configuredModelId(config, phase) {
  const field = { 1: config?.comprenderModel, 2: config?.componerModel, 3: config?.generationModel, 5: config?.phase5Model }[phase];
  return field ?? (phase <= 2 ? config?.nluModel : undefined) ?? DEFAULT_MODELS[phase];
}

/** Models a phase may offer and admit: every status except retired. */
export function modelIdsForPhase(phase) {
  return Object.keys(MODEL_CATALOG).filter(id => modelSupportsPhase(id, phase));
}

export function modelStatus(id) {
  return Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id].status : undefined;
}

/** Vertex batch prediction: capable models in the workshop or active profile only. */
export function batchModelIds() {
  return Object.keys(MODEL_CATALOG).filter(id => MODEL_CATALOG[id].vertexBatch
    && ['workshop', 'active'].includes(MODEL_CATALOG[id].status));
}

/**
 * Gemini reasoning configuration, declared per model: Gemini 2.5 takes an
 * integer budget, Gemini 3.x a level (MINIMAL is not accepted by 3.8).
 */
export function geminiThinkingConfig(id) {
  const thinking = Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id].thinking : undefined;
  if (thinking?.level) return { thinkingLevel: thinking.level };
  return { thinkingBudget: thinking?.budget ?? 0 };
}

/** False when the model rejects non-default temperature/top_p/top_k (400). */
export function acceptsSampling(id) {
  return !(Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id].fixedSampling);
}

export function getModelProvider(id) {
  const model = Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : undefined;
  if (!model) throw new Error(`Unsupported model: ${id}`);
  return model.provider;
}

/**
 * Thrown before any provider call when the configured model may not run the
 * phase (retired or unknown). `diagnostic` lets ESTRUCTURAR show it translated.
 */
export class ModelUnavailableError extends Error {
  constructor(model) {
    const label = Object.hasOwn(MODEL_CATALOG, model) ? MODEL_CATALOG[model].label : String(model);
    super(`${label} is no longer available; choose another model in Settings`);
    this.name = 'ModelUnavailableError';
    this.model = model;
    this.label = label;
    this.diagnostic = { key: 'modelUnavailable' };
  }
}

/** Client-side guard shared by every phase entry point; the server checks again. */
export function assertModelAvailable(model, phases) {
  if (!phases.some(phase => modelSupportsPhase(model, phase))) throw new ModelUnavailableError(model);
}

/** Endpoint admission: the model belongs to the provider and may run one of the phases. */
export function modelAllowed(id, provider, phases) {
  return Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id].provider === provider
    && phases.some(phase => modelSupportsPhase(id, phase));
}

/** True when the model may run the phase now; retired models never do. */
export function modelSupportsPhase(id, phase) {
  return Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id].phases.includes(phase)
    && MODEL_CATALOG[id].status !== 'retired';
}
