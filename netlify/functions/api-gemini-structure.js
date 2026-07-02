/**
 * Netlify Function: Gemini Vision + Function Calling Proxy (Phase 5 — ESTRUCTURAR)
 *
 * Accepts a Claude-style request (model, messages, tools, tool_choice, system),
 * translates it to Gemini REST format, calls the Gemini API synchronously,
 * and returns a Claude-compatible response shape for uniform handling in the client.
 *
 * Supported models: gemini-2.5-pro, gemini-2.5-flash
 * (gemini-2.0-flash removed 2026-06-13 — returns 404 in pictos-vertex.)
 * Phase 5 calls are free-tier in the quota (0 units charged).
 */

import { logCall } from './_shared/usage.js';
import { connectBlobs } from './_shared/blobs.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { buildGeminiRequest, geminiResponseToClaude } from './_shared/geminiTranslate.js';

const ALLOWED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
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

  let model, max_tokens, system, tools, tool_choice, messages;
  try {
    ({ model, max_tokens, system, tools, tool_choice, messages } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!model || !messages) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: model, messages' }) };
  }

  if (!ALLOWED_MODELS.includes(model)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Model not allowed: ${model}` }) };
  }

  const email = user?.email ?? 'dev';

  // Phase 5 Gemini calls are free-tier (0 units)
  console.log(`[api-gemini-structure] user=${email} model=${model}`);

  // ── Translate to Gemini format (pure — see _shared/geminiTranslate.js) ─────
  // Output cap lifted and Gemini "thinking" disabled so geometry-authoring
  // calls (redraw) don't truncate or blow past the 90s function timeout.
  const geminiBody = buildGeminiRequest({ model, system, tools, tool_choice, messages, max_tokens });

  // ── Call Gemini via Vertex AI (service-account OAuth, no static API key) ──

  const startMs = Date.now();
  let geminiData, ok = true, errorMsg;

  try {
    const accessToken = await getVertexAccessToken();
    const url = vertexModelUrl(model);
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => geminiRes.statusText);
      console.error(`[api-gemini-structure] Gemini error ${geminiRes.status}: ${errText.slice(0, 400)}`);
      ok = false;
      errorMsg = `Gemini ${geminiRes.status}: ${errText.slice(0, 200)}`;

      await logCall({
        email, phase: 'gemini-structure', model, units_charged: 0,
        ms: Date.now() - startMs,
        tokens_in: 0, tokens_out: 0, ok: false, error_msg: errorMsg,
      });

      return { statusCode: 500, headers, body: JSON.stringify({ error: errorMsg }) };
    }

    geminiData = await geminiRes.json();
  } catch (error) {
    ok = false;
    errorMsg = error.message;
    console.error(`[api-gemini-structure] fetch error: ${error.message}`);

    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms: Date.now() - startMs,
      tokens_in: 0, tokens_out: 0, ok: false, error_msg: errorMsg,
    });

    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMsg }) };
  }

  const ms = Date.now() - startMs;

  // ── Translate Gemini response to Claude format (pure — tested) ────────────
  const parsed = geminiResponseToClaude(geminiData);
  const usage = parsed.usage ?? {};

  if (!parsed.ok) {
    console.error(`[api-gemini-structure] ${parsed.error}`);
    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0,
      ok: false, error_msg: parsed.error.slice(0, 200),
    });
    return { statusCode: 500, headers, body: JSON.stringify({ error: parsed.error }) };
  }

  await logCall({
    email, phase: 'gemini-structure', model, units_charged: 0,
    ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0,
    ok: true,
  });

  console.log(`[api-gemini-structure] user=${email} model=${model} ms=${ms} in=${usage.promptTokenCount ?? '?'} out=${usage.candidatesTokenCount ?? '?'}`);

  return { statusCode: 200, headers, body: JSON.stringify(parsed.response) };
}

export const handler = async (event, context) => {
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);
  try {
    return await handleRequest(event, context);
  } catch (err) {
    console.error('[api-gemini-structure] unhandled exception:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
