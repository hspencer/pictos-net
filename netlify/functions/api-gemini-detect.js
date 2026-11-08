/**
 * Netlify Function: entity detection before ESTRUCTURAR.
 *
 * Input: { bitmap: data URL, utterance, labels: composition element ids }.
 * Output: { detections: [{ label, box: [x, y, w, h] normalized 0..1 }], model }.
 * One Gemini call (DEFAULT_MODELS.detect) through Vertex; 0 quota units, like
 * every text/vision call. Entities that are not drawn are simply absent.
 */
import { logCall } from './_shared/usage.js';
import { fetchWithRetry } from './_shared/httpRetry.js';
import { providerHttpError, providerFailure } from './_shared/providerError.js';
import { connectBlobs } from './_shared/blobs.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { DEFAULT_MODELS, modelAllowed } from './_shared/modelCatalog.js';
import { buildDetectionRequest, parseDetections, MAX_LABELS } from './_shared/entityDetection.js';

const ALLOWED_ORIGINS = ['https://pictos.net', 'https://next.pictos.net', 'https://pictos-next.netlify.app'];
const MAX_BITMAP_CHARS = 12_000_000;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export async function handler(event, context) {
  connectBlobs(event);
  const headers = corsHeaders(event.headers?.origin || '');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const { user } = context.clientContext || {};
  if (process.env.NETLIFY_DEV !== 'true' && !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  let bitmap, utterance, labels, _requestId;
  try { ({ bitmap, utterance, labels, _requestId } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const match = typeof bitmap === 'string' && bitmap.length <= MAX_BITMAP_CHARS && bitmap.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  const validLabels = Array.isArray(labels) && labels.length > 0 && labels.length <= MAX_LABELS
    && labels.every(l => typeof l === 'string' && /^[\p{L}\p{N}_ -]{1,80}$/u.test(l));
  if (!match || !validLabels || typeof utterance !== 'string' || utterance.length > 2000) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Expected a PNG/JPEG/WebP data URL, an utterance and 1-40 entity ids' }) };
  }

  const model = DEFAULT_MODELS.detect;
  if (!modelAllowed(model, 'gemini', ['detect'])) return { statusCode: 400, headers, body: JSON.stringify({ error: `Model not allowed: ${model}` }) };
  const email = user?.email ?? 'dev';
  const startMs = Date.now();
  try {
    const res = await fetchWithRetry(vertexModelUrl(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getVertexAccessToken()}` },
      body: JSON.stringify(buildDetectionRequest({ utterance, labels, mimeType: match[1], base64: match[2] })),
    }, { retries: 1, baseDelayMs: 1000, retryOn429: true, maxTotalMs: 25000 });
    if (!res.ok) throw await providerHttpError(res, 'gemini', _requestId);
    const data = await res.json();
    const detections = parseDetections(data, labels);
    const usage = data.usageMetadata ?? {};
    await logCall({ email, phase: 'gemini-detect', model, units_charged: 0, ms: Date.now() - startMs,
      tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0, ok: true });
    return { statusCode: 200, headers, body: JSON.stringify({ detections, model }) };
  } catch (error) {
    const failure = providerFailure(error, { provider: 'gemini', requestId: _requestId });
    await logCall({ email, phase: 'gemini-detect', model, units_charged: 0, ms: Date.now() - startMs,
      tokens_in: null, tokens_out: null, ok: false, error_msg: failure.error, provider: 'gemini',
      provider_status: failure.providerStatus, request_id: failure.requestId, attempts: failure.attempts });
    return { statusCode: failure.providerStatus || 502, headers, body: JSON.stringify(failure) };
  }
}
