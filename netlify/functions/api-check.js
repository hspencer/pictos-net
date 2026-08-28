import { MODEL_CATALOG, getModelProvider, } from './_shared/modelCatalog.js';
/**
 * Netlify Function: AI provider connectivity check
 *
 * Lightweight ping for each AI provider — does NOT consume quota units.
 * Body: { service: 'claude' | 'gemini' | 'recraft', model?: string }
 * Returns: { ok: boolean, latency: number, error?: string }
 *
 * Claude: 1-token completion to verify API key + model access.
 * Gemini: 1-token text generation via Vertex AI (same credentials as image models).
 * Recraft: GET /v1/users/me (read-only; only credits leave the server).
 * OpenAI: GET model metadata; no generation is performed.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { connectBlobs } from './_shared/blobs.js';
import { openaiApiKey, OPENAI_IMAGE_MODEL } from './_shared/openaiImage.js';



const ALLOWED_ORIGINS = [
  'https://pictos.net',
  'https://next.pictos.net',
  'https://pictos-next.netlify.app',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

async function checkClaude(model) {
  const apiKey = process.env.PICTOS_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key not configured');
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 10000 });
  const t0 = Date.now();
  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
  return Date.now() - t0;
}

async function checkGemini(model) {
  // A text ping verifies this text model only; it does not prove image capacity.
  const t0 = Date.now();
  const token = await getVertexAccessToken();
  const url = vertexModelUrl(model);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new Error(`Gemini check failed: HTTP ${res.status}`), { status: res.status });
  }
  return Date.now() - t0;
}

async function checkRecraft() {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error('Recraft API key not configured');
  const t0 = Date.now();
  const res = await fetch('https://external.api.recraft.ai/v1/users/me', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new Error(`Recraft check failed: HTTP ${res.status}`), { status: res.status });
  }
  const data = await res.json();
  return { latency: Date.now() - t0, credits: Number.isFinite(data.credits) ? data.credits : null };
}

async function checkOpenAI(model) {
  const t0 = Date.now();
  const res = await fetch(`https://api.openai.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${openaiApiKey()}` },
    signal: AbortSignal.timeout(10000),
  });
  // A read-only model lookup checks credentials/access, not image generation permissions.
  if (!res.ok) throw new Error(`OpenAI model access: HTTP ${res.status}`);
  return Date.now() - t0;
}

async function handleRequest(event, context) {
  connectBlobs(event);
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let service, model;
  try {
    ({ service, model } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    const selectedModel = model ?? (service === 'openai' ? OPENAI_IMAGE_MODEL
      : service === 'gemini' ? 'gemini-2.5-flash' : service === 'recraft' ? 'recraftv4_1_vector' : undefined);
    if (!selectedModel || !Object.hasOwn(MODEL_CATALOG, selectedModel) || getModelProvider(selectedModel) !== service) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported provider/model selection' }) };
    }
    let latency, checkScope, checkedModel = selectedModel, credits;
    if (service === 'claude') {
      latency = await checkClaude(selectedModel);
      checkScope = 'minimal_text_response';
    } else if (service === 'gemini') {
      // Image models cannot answer the text ping. State its actual scope explicitly.
      checkedModel = MODEL_CATALOG[selectedModel].output === 'text' ? selectedModel : 'gemini-2.5-flash';
      latency = await checkGemini(checkedModel);
      checkScope = checkedModel === selectedModel ? 'minimal_text_response' : 'credentials_via_text_model';
    } else if (service === 'recraft') {
      ({ latency, credits } = await checkRecraft());
      checkScope = 'credentials_and_credit_balance';
    } else if (service === 'openai') {
      latency = await checkOpenAI(selectedModel);
      checkScope = 'model_metadata_access';
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, latency, checkedModel, checkScope,
      ...(credits !== undefined ? { credits } : {}), generationVerified: false }) };
  } catch (err) {
    const error = `Provider connection check failed${Number.isInteger(err.status) ? ` (HTTP ${err.status})` : ''}`;
    console.error(`[api-check] ${service}: ${error}`);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error, latency: 0 }) };
  }
}

export const handler = async (event, context) => {
  try {
    return await handleRequest(event, context);
  } catch (err) {
    console.error('[api-check] Unhandled error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Error interno del servidor' }) };
  }
};
