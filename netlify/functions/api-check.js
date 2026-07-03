/**
 * Netlify Function: AI provider connectivity check
 *
 * Lightweight ping for each AI provider — does NOT consume quota units.
 * Body: { service: 'claude' | 'gemini' | 'recraft', model?: string }
 * Returns: { ok: boolean, latency: number, error?: string }
 *
 * Claude: 1-token completion to verify API key + model access.
 * Gemini: 1-token text generation via Vertex AI (same credentials as image models).
 * Recraft: GET /v1/styles (read-only, no credits consumed).
 */

import Anthropic from '@anthropic-ai/sdk';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { connectBlobs } from './_shared/blobs.js';

const ALLOWED_CLAUDE_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
];

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
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' });
  const t0 = Date.now();
  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
  return Date.now() - t0;
}

async function checkGemini() {
  // Use gemini-2.5-flash (text) to verify Vertex AI credentials.
  // The same service account covers all Gemini models including image variants.
  const t0 = Date.now();
  const token = await getVertexAccessToken();
  const url = vertexModelUrl('gemini-2.5-flash');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 200)}`);
  }
  return Date.now() - t0;
}

async function checkRecraft() {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error('Recraft API key not configured');
  const t0 = Date.now();
  const res = await fetch('https://external.api.recraft.ai/v1/styles', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Recraft ${res.status}: ${txt.slice(0, 200)}`);
  }
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
    let latency;
    if (service === 'claude') {
      if (!model || !ALLOWED_CLAUDE_MODELS.includes(model)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Modelo Claude no permitido: ${model}` }) };
      }
      latency = await checkClaude(model);
    } else if (service === 'gemini') {
      latency = await checkGemini();
    } else if (service === 'recraft') {
      latency = await checkRecraft();
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Servicio desconocido: ${service}` }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, latency }) };
  } catch (err) {
    console.error(`[api-check] ${service} check failed: ${err.message}`);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: err.message, latency: 0 }) };
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
