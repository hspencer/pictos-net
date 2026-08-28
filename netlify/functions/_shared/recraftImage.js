import { MODEL_CATALOG } from './modelCatalog.js';
import { fetchWithRetry } from './httpRetry.js';
import { providerHttpError } from './providerError.js';

export function recraftImageRequest({ model = 'recraftv4_1_vector', prompt, colors, style_id }) {
  const entry = Object.hasOwn(MODEL_CATALOG, model) ? MODEL_CATALOG[model] : null;
  if (entry?.provider !== 'recraft' || !entry.phases.includes(3)) throw new Error('Unsupported Recraft model');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000) throw new Error('Recraft prompt must contain 1–10000 characters');
  if (entry.requiresStyle && (typeof style_id !== 'string' || !style_id.trim())) throw new Error('Recraft Styles requires an existing style_id');
  if (style_id != null && (typeof style_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(style_id))) throw new Error('Invalid Recraft style_id');
  if (colors != null && (!Array.isArray(colors) || colors.some(color => !/^#[0-9a-fA-F]{6}$/.test(color)))) throw new Error('Invalid Recraft palette');
  return {
    model, prompt, n: 1, size: entry.requestSize,
    ...(style_id ? { style_id } : {}),
    ...(colors?.length ? { controls: { colors: colors.slice(0, 10).map(hex => ({ rgb: [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)) })) } } : {}),
  };
}

/** Shared individual/batch generator, with one deadline across generation and CDN. */
export async function generateRecraftImage(params, { maxTotalMs = 90000, onRetry } = {}) {
  const body = recraftImageRequest(params);
  const key = process.env.RECRAFT_API_KEY;
  if (!key) throw new Error('RECRAFT_API_KEY not configured');
  const startedAt = Date.now();
  const response = await fetchWithRetry('https://external.api.recraft.ai/v1/images/generations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  }, { retries: 3, baseDelayMs: 2000, retryOn429: true, maxTotalMs, onRetry });
  if (!response.ok) throw await providerHttpError(response, 'recraft');
  const data = await response.json();
  const imageUrl = data.data?.[0]?.url;
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) throw new Error('Recraft returned no HTTPS image URL');
  const remainingMs = maxTotalMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new DOMException('Recraft download deadline exceeded', 'TimeoutError');
  const image = await fetchWithRetry(imageUrl, {}, { maxTotalMs: remainingMs });
  // CDN errors do not indicate the generation API's account quota.
  if (!image.ok) throw Object.assign(new Error(`Recraft CDN ${image.status}`), { provider: 'recraft-cdn', status: image.status, attempts: image.attempts });
  if (MODEL_CATALOG[body.model].output === 'vector') {
    const svg = await image.text();
    if (!/<svg(?:\s|>)/i.test(svg)) throw new Error('Recraft response is not SVG');
    return { svg };
  }
  const bytes = await image.arrayBuffer();
  return { bitmap: `data:${image.headers.get('content-type')?.split(';')[0] || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}` };
}
