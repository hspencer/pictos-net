import { MODEL_CATALOG } from '../netlify/functions/_shared/modelCatalog.js';

type Translate = (key: string, values?: Record<string, string | number>) => string;
const usd = (n: number) => `US$${n.toFixed(n * 100 % 1 === 0 ? 2 : 3)}`;

/** Only reference rates: actual token counts, output size, and billing determine cost. */
export function formatModelPrice(id: string, t: Translate, quality = 'low'): string {
  const model = Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : undefined;
  if (!model) return t('config.priceUnknown');
  const p = model.pricing;
  if (p.kind === 'tokens') return t('config.tokenPrice', {
    input: usd(p.inputUsdPerMillion), output: usd(p.outputUsdPerMillion),
  });
  const imageUsd = p.qualityUsd?.[quality] ?? p.imageUsd;
  return t('config.imagePrice', { price: usd(imageUsd) });
}

export function modelPriceNotes(id: string, t: Translate): string[] {
  const model = Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : undefined;
  if (!model) return [];
  const p = model.pricing;
  const notes = [t(p.kind === 'tokens' ? 'config.tokenCostNote' : 'config.imageCostNote')];
  if (p.longContext) notes.push(t('config.longContextPrice', {
    threshold: p.longContext.aboveInputTokens,
    input: usd(p.longContext.inputUsdPerMillion), output: usd(p.longContext.outputUsdPerMillion),
  }));
  if (p.size) notes.push(t('config.imagePriceSize', { size: p.size }));
  if (p.promptCostsExtra) notes.push(t('config.imagePromptExtra'));
  if (model.provider === 'openai' && p.kind === 'tokens') notes.push(t('config.openaiReasoningNote'));
  if (model.provider === 'recraft') notes.push(t('config.recraftCreditsNote'));
  if (model.requiresStyle) notes.push(t('config.recraftStyleRequired'));
  return notes;
}
