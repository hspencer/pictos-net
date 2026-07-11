/**
 * Netlify Function: Gemini Text + Function Calling Proxy (Phases 1–2 — COMPRENDER + COMPONER)
 *
 * Accepts a Claude-style request (model, messages, tools, tool_choice, system),
 * translates it to Gemini REST format, calls the Gemini API synchronously,
 * and returns a Claude-compatible response shape for uniform handling in the client.
 *
 * Supported models: gemini-2.5-flash, gemini-2.5-pro
 * Text-only — no vision/image input. Used when GlobalConfig.comprenderModel or
 * GlobalConfig.componerModel is set to a gemini-* value.
 * Quota: 0 units charged (same policy as api-gemini-structure).
 */

import { logCall } from './_shared/usage.js';
import { connectBlobs } from './_shared/blobs.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { buildGeminiRequest, geminiResponseToClaude } from './_shared/geminiTranslate.js';

const ALLOWED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
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
  console.log(`[api-gemini-nlu] user=${email} model=${model}`);

  const geminiBody = buildGeminiRequest({ model, system, tools, tool_choice, messages, max_tokens });

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
      console.error(`[api-gemini-nlu] Gemini error ${geminiRes.status}: ${errText.slice(0, 400)}`);
      ok = false;
      errorMsg = `Gemini ${geminiRes.status}: ${errText.slice(0, 200)}`;

      await logCall({
        email, phase: 'gemini-nlu', model, units_charged: 0,
        ms: Date.now() - startMs,
        tokens_in: 0, tokens_out: 0, ok: false, error_msg: errorMsg,
      });

      return { statusCode: 500, headers, body: JSON.stringify({ error: errorMsg }) };
    }

    geminiData = await geminiRes.json();
  } catch (error) {
    ok = false;
    errorMsg = error.message;
    console.error(`[api-gemini-nlu] fetch error: ${error.message}`);

    await logCall({
      email, phase: 'gemini-nlu', model, units_charged: 0,
      ms: Date.now() - startMs,
      tokens_in: 0, tokens_out: 0, ok: false, error_msg: errorMsg,
    });

    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMsg }) };
  }

  const ms = Date.now() - startMs;
  const parsed = geminiResponseToClaude(geminiData);
  const usage = parsed.usage ?? {};

  if (!parsed.ok) {
    console.error(`[api-gemini-nlu] ${parsed.error}`);
    await logCall({
      email, phase: 'gemini-nlu', model, units_charged: 0,
      ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0,
      ok: false, error_msg: parsed.error.slice(0, 200),
    });
    return { statusCode: 500, headers, body: JSON.stringify({ error: parsed.error }) };
  }

  // Post-process: sanitizeSchemaForGemini converts additionalProperties maps to
  // type:'string' so Gemini can generate arbitrary keys. Parse those strings back
  // to objects here (frame.roles is the main case).
  const responseBody = parsed.response;
  try {
    const toolBlock = responseBody?.content?.find(b => b.type === 'tool_use');
    if (toolBlock?.input?.frames) {
      for (const frame of toolBlock.input.frames) {
        if (typeof frame.roles === 'string') {
          try { frame.roles = JSON.parse(frame.roles); } catch { frame.roles = {}; }
        }
        frame.roles = frame.roles && typeof frame.roles === 'object' ? frame.roles : {};
      }
    }
  } catch (e) {
    console.warn('[api-gemini-nlu] roles post-processing skipped:', e.message);
  }

  await logCall({
    email, phase: 'gemini-nlu', model, units_charged: 0,
    ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0,
    ok: true,
  });

  console.log(`[api-gemini-nlu] user=${email} model=${model} ms=${ms} in=${usage.promptTokenCount ?? '?'} out=${usage.candidatesTokenCount ?? '?'}`);

  return { statusCode: 200, headers, body: JSON.stringify(responseBody) };
}

export const handler = async (event, context) => {
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);
  try {
    return await handleRequest(event, context);
  } catch (err) {
    console.error('[api-gemini-nlu] unhandled error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
};
