/** Server-only QuiverAI adapter (Arrow 2, native SVG), shared by individual and pipeline jobs. */
import { modelAllowed } from './modelCatalog.js';
import { fetchWithRetry } from './httpRetry.js';
import { providerHttpError } from './providerError.js';
import { QUIVER_VIEWBOX } from './imagePrompts.js';

/** Settings measured in research/2026-11-10_quiver-arrow2 (variant B). */
const QUIVER_SAMPLING = { temperature: 0.4, reasoning_effort: 'low' };

export function quiverImageRequest({ model, prompt, instructions }) {
  if (!modelAllowed(model, 'quiver', [3])) throw new Error('Unsupported Quiver model');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000) throw new Error('Quiver prompt must contain 1–10000 characters');
  if (instructions != null && (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 10000)) {
    throw new Error('Quiver instructions must contain 1–10000 characters');
  }
  return { model, prompt, ...(instructions ? { instructions } : {}), n: 1, stream: false,
    attributes: { viewBox: QUIVER_VIEWBOX }, ...QUIVER_SAMPLING };
}

export function quiverApiKey() {
  const key = process.env.QUIVER_API_KEY;
  if (!key) throw new Error('QUIVER_API_KEY not configured');
  return key;
}

/**
 * Arrow writes a credit comment and paints the canvas white with full-size
 * rects before the drawing. Both would reach ESTRUCTURAR as content.
 */
export function cleanQuiverSvg(svg) {
  let out = svg.replace(/<!--[\s\S]*?-->/g, '');
  const full = /^\s*<rect\b(?=[^>]*\bwidth="(?:512|100%)")(?=[^>]*\bheight="(?:512|100%)")(?=[^>]*\bfill="#(?:fff|ffffff)")[^>]*\/>\s*/i;
  out = out.replace(/(<svg\b[^>]*>)([\s\S]*)/, (_, open, body) => {
    while (full.test(body)) body = body.replace(full, '');
    return open + '\n' + body;
  });
  return out;
}

export async function generateQuiverImage(params, { maxTotalMs = 180000, onRetry } = {}) {
  const body = quiverImageRequest(params);
  // Retries only 429/5xx, which Quiver does not bill; ambiguous transport failures are not replayed.
  const response = await fetchWithRetry('https://api.quiver.ai/v1/svgs/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${quiverApiKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { retries: 2, baseDelayMs: 3000, retryOn429: true, maxTotalMs, onRetry });
  if (!response.ok) throw await providerHttpError(response, 'quiver');
  const data = await response.json();
  const svg = data.data?.[0]?.svg;
  if (typeof svg !== 'string' || !/<svg(?:\s|>)/i.test(svg)) {
    throw Object.assign(new Error('Quiver returned no SVG'), { failureSource: 'no_image', usage: data.usage ?? null });
  }
  return { svg: cleanQuiverSvg(svg), usage: data.usage ?? null, requestId: data.id ?? null };
}
