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
 * Evidence: docs/DIAGNOSTICO_GENERACION_2026-10-22.md, plan F1.
 */
export const MODEL_STATUSES = ['workshop', 'active', 'experimental', 'retired'];
const anthropicSource = 'https://platform.claude.com/docs/en/about-claude/pricing';
const vertexSource = 'https://cloud.google.com/vertex-ai/generative-ai/pricing';
const openaiSource = 'https://developers.openai.com/api/docs/models/compare';
const recraftSource = 'https://www.recraft.ai/docs/api-reference/pricing';

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

export const MODEL_CATALOG = {
  'claude-haiku-4-5-20251001': text('Claude Haiku 4.5', 'claude', [1, 2], 1, 5, anthropicSource, {}, 'workshop'),
  'claude-sonnet-4-6': text('Claude Sonnet 4.6', 'claude', [1, 2, 5], 3, 15, anthropicSource),
  'claude-opus-4-6': text('Claude Opus 4.6', 'claude', [5], 5, 25, anthropicSource),
  // Text Gemini 2.5 retired by Google on 2026-10-20; Pro already returns 404.
  'gemini-2.5-flash': { ...text('Gemini 2.5 Flash', 'gemini', [1, 2, 5], 0.30, 2.50, vertexSource, {}, 'retired'), thinking: { budget: 0 } },
  'gemini-2.5-pro': { ...text('Gemini 2.5 Pro', 'gemini', [1, 2, 5], 1.25, 10, vertexSource, {
    longContext: { aboveInputTokens: 200000, inputUsdPerMillion: 2.50, outputUsdPerMillion: 15 },
  }, 'retired'), thinking: { budget: 128 } },
  'gpt-5.6-luna': text('OpenAI GPT-5.6 Luna', 'openai', [1, 2, 5], 0.20, 1.20, openaiSource, {
    cachedInputUsdPerMillion: 0.02,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 0.40, outputUsdPerMillion: 1.80 },
  }, 'experimental'),
  'gpt-5.6-terra': text('OpenAI GPT-5.6 Terra', 'openai', [1, 2, 5], 2, 12, openaiSource, {
    cachedInputUsdPerMillion: 0.20,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 4, outputUsdPerMillion: 18 },
  }, 'experimental'),
  'gpt-5.6-sol': text('OpenAI GPT-5.6 Sol', 'openai', [1, 2, 5], 4, 20, openaiSource, {
    cachedInputUsdPerMillion: 0.40,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 8, outputUsdPerMillion: 30 },
  }, 'experimental'),
  // Added 2026-10-22 (plan F6) from the diagnosis' direct probes; experimental
  // until they pass the phases they declare through Pictos' own routes.
  'gemini-3.8-flash': { ...text('Gemini 3.8 Flash', 'gemini', [1, 2], 0.75, 3.75,
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
    { scheduledChange: { from: '2027-01-01', inputUsdPerMillion: 1.50, outputUsdPerMillion: 7.50 } }, 'experimental'),
    thinking: { level: 'LOW' }, pricingCheckedAt: '2026-10-22' },
  'gpt-6-luna': { ...text('OpenAI GPT-6 Luna', 'openai', [1, 2], 0.10, 0.50,
    'https://developers.openai.com/api/docs/models/gpt-6-luna', {}, 'experimental'), pricingCheckedAt: '2026-10-22' },
  'gpt-image-2': image('OpenAI GPT Image 2', 'openai', 'bitmap', 0.006,
    'https://developers.openai.com/api/docs/models/gpt-image-2', {
      qualityUsd: { low: 0.006, medium: 0.053, high: 0.211 }, promptCostsExtra: true, size: '1024×1024',
    }),
  'gemini-2.5-flash-image': { ...image('Gemini 2.5 Flash Image', 'gemini', 'bitmap', 0.039, vertexSource,
    { promptCostsExtra: true, size: '1024×1024' }, 'workshop'), vertexBatch: true },
  // 9 of 38 production calls returned no image (2026-10-20); out of batch until diagnosed.
  'gemini-3.1-flash-image': { ...image('Gemini 3.1 Flash Image', 'gemini', 'bitmap', 0.067, vertexSource,
    { promptCostsExtra: true, size: '1K' }, 'experimental'), vertexBatch: true },
  'gemini-3-pro-image': image('Gemini 3 Pro Image', 'gemini', 'bitmap', 0.134, vertexSource,
    { promptCostsExtra: true, size: '1K/2K' }),
  // Added 2026-10-22 (plan F6); experimental until verified through Pictos' routes.
  'gpt-image-2.5-flare': { ...image('OpenAI GPT Image 2.5 Flare', 'openai', 'bitmap', 0.006,
    'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
    { promptCostsExtra: true, size: '1024×1024' }, 'experimental'), pricingCheckedAt: '2026-10-22' },
  'gemini-nano-banana-2.1': { ...image('Gemini Nano Banana 2.1', 'gemini', 'bitmap', 0.034,
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
    { promptCostsExtra: true, size: '1K' }, 'experimental'), pricingCheckedAt: '2026-10-22' },
  'recraftv4_1': image('Recraft V4.1 (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'experimental'),
  // Vector variants verified 2026-10-22: 3 synthetic utterances each generate an SVG that ESTRUCTURAR admits once its C2PA manifest is set aside (svgForStructuring).
  'recraftv4_1_vector': image('Recraft V4.1 (vector)', 'recraft', 'vector', 0.08, recraftSource),
  'recraftv4_1_utility_vector': image('Recraft V4.1 Utility (vector)', 'recraft', 'vector', 0.08, recraftSource, {}, 'active'),
  'recraftv4_1_pro_vector': image('Recraft V4.1 Pro (vector)', 'recraft', 'vector', 0.30, recraftSource, {}, 'active'),
  'recraftv4_1_pro': image('Recraft V4.1 Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }, 'experimental'),
  'recraftv4_1_utility': image('Recraft V4.1 Utility (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'experimental'),
  'recraftv4_1_utility_pro': image('Recraft V4.1 Utility Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }, 'experimental'),
  'recraftv4_1_utility_pro_vector': image('Recraft V4.1 Utility Pro (vector)', 'recraft', 'vector', 0.30, recraftSource, {}, 'active'),
  'recraftv4_styles': { ...image('Recraft V4 Styles (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }, 'experimental'), requiresStyle: true },
  'recraftv4_styles_vector': { ...image('Recraft V4 Styles (vector)', 'recraft', 'vector', 0.05, recraftSource, {}, 'experimental'), requiresStyle: true },
  'recraftv4_styles_pro': { ...image('Recraft V4 Styles Pro (raster)', 'recraft', 'bitmap', 0.10, recraftSource, { size: '2K' }, 'experimental'), requiresStyle: true },
  'recraftv4_styles_pro_vector': { ...image('Recraft V4 Styles Pro (vector)', 'recraft', 'vector', 0.12, recraftSource, {}, 'experimental'), requiresStyle: true },
};

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
