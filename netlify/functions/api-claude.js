/**
 * Netlify Function: Anthropic Claude API Proxy
 * Validates Netlify Identity JWT, enforces daily quota, then forwards the
 * request to Claude with the server-side API key (never exposed to client).
 *
 * Quota:
 *   claude-haiku   (phases 1+2): 0 units  — cheap, not counted
 *   claude-sonnet  (phase 5)   : 0 units  — structuring step, not counted
 *
 * Phases: 1 (COMPRENDER), 2 (COMPONER), 5 (ESTRUCTURAR / vision)
 */

import Anthropic from '@anthropic-ai/sdk';
import { checkAndCharge, logCall } from './_shared/usage.js';
import { connectBlobs } from './_shared/blobs.js';
import { fetchWithRetry } from './_shared/httpRetry.js';
import { providerFailure } from './_shared/providerError.js';

const ALLOWED_ORIGINS = [
  'https://pictos.net',
  'https://next.pictos.net',
  'https://pictos-next.netlify.app',
];

const ALLOWED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
];

// All Claude calls are free-tier in the quota — only Recraft (phase 3) counts.
const UNITS_BY_MODEL = {
  'claude-haiku-4-5-20251001': 0,
  'claude-sonnet-4-6': 0,
  'claude-opus-4-6': 0,
};

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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (isLocalDev && !user) {
    console.log('[api-claude] Local dev mode — skipping JWT validation');
  }

  const email = user?.email ?? 'dev';
  const roles = user?.app_metadata?.roles ?? [];

  // PICTOS_ANTHROPIC_KEY avoids Netlify CLI v24 overriding ANTHROPIC_API_KEY with
  // a Netlify AI Gateway JWT. baseURL is set explicitly below for the same reason.
  const apiKey = process.env.PICTOS_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[api-claude] PICTOS_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) not configured');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let model, max_tokens, system, tools, tool_choice, messages, _requestId;
  try {
    ({ model, max_tokens, system, tools, tool_choice, messages, _requestId } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!model || !messages) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: model, messages' }) };
  }

  if (!ALLOWED_MODELS.includes(model)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Model not allowed: ${model}` }) };
  }

  // Quota check (Sonnet = 1 unit; Haiku = 0 units, always allowed)
  const units = UNITS_BY_MODEL[model] ?? 1;
  const quota = await checkAndCharge(email, units, roles);
  if (!quota.allowed) {
    console.warn(`[api-claude] quota exceeded for ${email} (${quota.units_used}/${quota.limit})`);
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: 'Daily quota exceeded',
        quotaExceeded: true,
        failureSource: 'pictonet_user_quota',
        recoverable: false,
        units_used: quota.units_used,
        limit: quota.limit,
      }),
    };
  }

  console.log(`[api-claude] user=${email} model=${model} units=${units} today=${quota.units_used}/${quota.limit}`);

  const startMs = Date.now();
  const clientRequestId = _requestId || context?.awsRequestId || `claude-${Date.now()}`;
  let response;
  let providerAttempts = 1;

  try {
    // baseURL hardcoded to bypass Netlify CLI v24 ANTHROPIC_BASE_URL injection
    // The SDK's own retries are disabled so quota is charged once and the
    // shared, observable retry policy controls the complete provider call.
    const client = new Anthropic({
      apiKey,
      baseURL: 'https://api.anthropic.com',
      maxRetries: 0,
      fetch: (input, init) => fetchWithRetry(input, init, {
        retries: 2,
        baseDelayMs: 1000,
        retryOn429: true,
        maxTotalMs: 30_000,
        onRetry: (attempt, total, waitMs, status) => {
          providerAttempts = attempt + 1;
          console.warn(`[api-claude] request=${clientRequestId} provider_retry=${attempt}/${total} status=${status} wait_ms=${Math.round(waitMs)}`);
        },
      }),
    });

    const params = {
      model,
      max_tokens: Math.min(max_tokens || 4096, 8192),
      messages,
    };
    if (system) params.system = system;
    if (tools) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;

    response = await client.messages.create(params);
  } catch (error) {
    const details = providerFailure(Object.assign(error, { attempts: providerAttempts }), { provider: 'anthropic', requestId: clientRequestId });
    await logCall({ email, phase: 'claude', model, units_charged: units,
      ms: Date.now() - startMs, tokens_in: error.usage?.input_tokens ?? null,
      tokens_out: error.usage?.output_tokens ?? null, ok: false, error_msg: details.error,
      provider: details.provider, provider_status: details.providerStatus,
      request_id: details.requestId, attempts: providerAttempts, quota_failure_source: details.failureSource });
    return { statusCode: details.providerStatus || 500, headers, body: JSON.stringify({
      ...details, recoverable: details.retryable,
    }) };
  }

  const ms = Date.now() - startMs;
  await logCall({
    email, phase: 'claude', model, units_charged: units,
    ms,
    tokens_in: response.usage?.input_tokens ?? null,
    tokens_out: response.usage?.output_tokens ?? null,
    ok: true,
    provider: 'anthropic', request_id: clientRequestId, attempts: providerAttempts,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      model: response.model,
      content: response.content,
      stop_reason: response.stop_reason,
      usage: response.usage,
      meta: { provider: 'anthropic', requestId: clientRequestId, attempts: providerAttempts },
    }),
  };
}

export const handler = async (event, context) => {
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);
  try {
    return await handleRequest(event, context);
  } catch (err) {
    console.error('[api-claude] unhandled exception:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
