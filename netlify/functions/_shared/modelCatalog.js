/** Public provider capabilities and reference prices; never contains credentials.
 * USD standard API rates checked 2026-08-27, not a promise of account access,
 * semantic quality, quota, or final billed cost. Internal PictoNet units differ.
 */
export const PRICING_CHECKED_AT = '2026-08-27';
const anthropicSource = 'https://platform.claude.com/docs/en/about-claude/pricing';
const vertexSource = 'https://cloud.google.com/vertex-ai/generative-ai/pricing';
const openaiSource = 'https://developers.openai.com/api/docs/models/compare';
const recraftSource = 'https://www.recraft.ai/docs/api-reference/pricing';

const text = (label, provider, phases, input, output, source, extra = {}) => ({
  label, provider, phases, output: 'text',
  pricing: { kind: 'tokens', inputUsdPerMillion: input, outputUsdPerMillion: output, ...extra },
  pricingSource: source, pricingCheckedAt: PRICING_CHECKED_AT,
});
const image = (label, provider, output, usd, source, extra = {}) => ({
  label, provider, phases: [3], output, requiresStyle: false,
  ...(provider === 'recraft' ? { requestSize: '1:1' } : {}),
  pricing: { kind: 'image', imageUsd: usd, ...extra },
  pricingSource: source, pricingCheckedAt: PRICING_CHECKED_AT,
});

export const MODEL_CATALOG = {
  'claude-haiku-4-5-20251001': text('Claude Haiku 4.5', 'claude', [1, 2], 1, 5, anthropicSource),
  'claude-sonnet-4-6': text('Claude Sonnet 4.6', 'claude', [1, 2, 5], 3, 15, anthropicSource),
  'claude-opus-4-6': text('Claude Opus 4.6', 'claude', [5], 5, 25, anthropicSource),
  'gemini-2.5-flash': text('Gemini 2.5 Flash', 'gemini', [1, 2, 5], 0.30, 2.50, vertexSource),
  'gemini-2.5-pro': text('Gemini 2.5 Pro', 'gemini', [1, 2, 5], 1.25, 10, vertexSource, {
    longContext: { aboveInputTokens: 200000, inputUsdPerMillion: 2.50, outputUsdPerMillion: 15 },
  }),
  'gpt-5.6-luna': text('OpenAI GPT-5.6 Luna', 'openai', [1, 2, 5], 0.20, 1.20, openaiSource, {
    cachedInputUsdPerMillion: 0.02,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 0.40, outputUsdPerMillion: 1.80 },
  }),
  'gpt-5.6-terra': text('OpenAI GPT-5.6 Terra', 'openai', [1, 2, 5], 2, 12, openaiSource, {
    cachedInputUsdPerMillion: 0.20,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 4, outputUsdPerMillion: 18 },
  }),
  'gpt-5.6-sol': text('OpenAI GPT-5.6 Sol', 'openai', [1, 2, 5], 4, 20, openaiSource, {
    cachedInputUsdPerMillion: 0.40,
    longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 8, outputUsdPerMillion: 30 },
  }),
  'gpt-image-2': image('OpenAI GPT Image 2', 'openai', 'bitmap', 0.006,
    'https://developers.openai.com/api/docs/models/gpt-image-2', {
      qualityUsd: { low: 0.006, medium: 0.053, high: 0.211 }, promptCostsExtra: true, size: '1024×1024',
    }),
  'gemini-2.5-flash-image': image('Gemini 2.5 Flash Image', 'gemini', 'bitmap', 0.039, vertexSource,
    { promptCostsExtra: true, size: '1024×1024' }),
  'gemini-3.1-flash-image': image('Gemini 3.1 Flash Image', 'gemini', 'bitmap', 0.067, vertexSource,
    { promptCostsExtra: true, size: '1K' }),
  'gemini-3-pro-image': image('Gemini 3 Pro Image', 'gemini', 'bitmap', 0.134, vertexSource,
    { promptCostsExtra: true, size: '1K/2K' }),
  'recraftv4_1': image('Recraft V4.1 (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }),
  'recraftv4_1_vector': image('Recraft V4.1 (vector)', 'recraft', 'vector', 0.08, recraftSource),
  'recraftv4_1_utility_vector': image('Recraft V4.1 Utility (vector)', 'recraft', 'vector', 0.08, recraftSource),
  'recraftv4_1_pro_vector': image('Recraft V4.1 Pro (vector)', 'recraft', 'vector', 0.30, recraftSource),
  'recraftv4_1_pro': image('Recraft V4.1 Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }),
  'recraftv4_1_utility': image('Recraft V4.1 Utility (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }),
  'recraftv4_1_utility_pro': image('Recraft V4.1 Utility Pro (raster)', 'recraft', 'bitmap', 0.21, recraftSource, { size: '2K' }),
  'recraftv4_1_utility_pro_vector': image('Recraft V4.1 Utility Pro (vector)', 'recraft', 'vector', 0.30, recraftSource),
  'recraftv4_styles': { ...image('Recraft V4 Styles (raster)', 'recraft', 'bitmap', 0.035, recraftSource, { size: '1K' }), requiresStyle: true },
  'recraftv4_styles_vector': { ...image('Recraft V4 Styles (vector)', 'recraft', 'vector', 0.05, recraftSource), requiresStyle: true },
  'recraftv4_styles_pro': { ...image('Recraft V4 Styles Pro (raster)', 'recraft', 'bitmap', 0.10, recraftSource, { size: '2K' }), requiresStyle: true },
  'recraftv4_styles_pro_vector': { ...image('Recraft V4 Styles Pro (vector)', 'recraft', 'vector', 0.12, recraftSource), requiresStyle: true },
};

export function modelIdsForPhase(phase) {
  return Object.keys(MODEL_CATALOG).filter(id => MODEL_CATALOG[id].phases.includes(phase));
}

export function getModelProvider(id) {
  const model = Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : undefined;
  if (!model) throw new Error(`Unsupported model: ${id}`);
  return model.provider;
}

export function modelSupportsPhase(id, phase) {
  return Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id].phases.includes(phase);
}
