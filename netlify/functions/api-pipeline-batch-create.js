/**
 * Netlify Function: create a full-pipeline batch job.
 *
 * Unlike the Vertex batch (api-batch-create, Phase 3 only), this accepts raw
 * utterances and runs Phase 1→2→3 server-side via a Background Function. Works
 * with any provider configuration (Claude/Gemini for NLU, Recraft/Gemini for
 * image generation). Maximum 25 rows per job.
 *
 * Flow:
 *   1. Verify user via clientContext (sync function — reliable auth).
 *   2. Charge quota upfront (1 unit per row for Phase 3; Phase 1+2 are free).
 *   3. Deposit single-use auth grant for the background function.
 *   4. Kick api-pipeline-batch-background and await the 202.
 *   5. Return { jobId, rowCount } — client polls via api-pipeline-batch-poll.
 */

import { checkAndCharge, logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';

const MAX_ROWS = 25;
const GRANT_TTL_MS = 120_000; // 2 min — sufficient for background cold start

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

export const handler = async (event, context) => {
  connectBlobs(event);
  const headers = corsHeaders(event.headers?.origin || '');

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const email = user?.email ?? 'dev';
  const roles = user?.app_metadata?.roles ?? [];

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { libraryId, rows, config } = body ?? {};

  if (!libraryId || !Array.isArray(rows)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing libraryId or rows' }) };
  }
  if (rows.length < 1 || rows.length > MAX_ROWS) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: `Row count must be 1–${MAX_ROWS} (got ${rows.length})` }),
    };
  }
  if (!rows.every(r => r?.rowId && typeof r.utterance === 'string' && r.utterance.trim())) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: 'Every row needs rowId and a non-empty utterance' }),
    };
  }

  const quota = await checkAndCharge(email, rows.length, roles);
  if (!quota.allowed) {
    return {
      statusCode: 429, headers,
      body: JSON.stringify({
        error: 'Daily quota exceeded',
        quotaExceeded: true,
        units_used: quota.units_used,
        limit: quota.limit,
      }),
    };
  }

  const jobId = `pb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Deposit single-use grant for the background function (which cannot verify
  // a JWT itself — the Authorization header is stripped by Netlify edge).
  const grants = getStore('auth-grants');
  await grants.setJSON(`pipeline-${jobId}`, { email, roles, exp: Date.now() + GRANT_TTL_MS });

  // Determine the base URL to kick the background function. Use DEPLOY_PRIME_URL
  // on deploys (not URL which may point at production from a branch deploy) and
  // derive from the Host header in local dev (where DEPLOY_PRIME_URL is unset).
  const host = event.headers?.host || '';
  const base = isLocalDev && host
    ? `http://${host}`
    : (process.env.DEPLOY_PRIME_URL || process.env.URL || '');

  if (!base) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error (no base URL)' }) };
  }

  const startMs = Date.now();
  let kickOk = false;
  try {
    const kickRes = await fetch(`${base}/.netlify/functions/api-pipeline-batch-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryId, jobId, rows, config }),
    });
    kickOk = kickRes.ok || kickRes.status === 202;
  } catch (err) {
    console.warn(`[api-pipeline-batch-create] kick failed: ${err.message}`);
  }

  if (!kickOk) {
    // Clean up the grant so it doesn't linger.
    await grants.delete(`pipeline-${jobId}`).catch(() => {});
    return {
      statusCode: 502, headers,
      body: JSON.stringify({ error: 'Failed to start pipeline batch worker' }),
    };
  }

  await logCall({
    email, phase: 'pipeline-batch-create', model: config?.generationModel ?? 'unknown',
    units_charged: rows.length, ms: Date.now() - startMs, tokens_in: 0, tokens_out: 0, ok: true,
  });
  console.log(`[api-pipeline-batch-create] user=${email} rows=${rows.length} job=${jobId}`);

  return { statusCode: 200, headers, body: JSON.stringify({ jobId, rowCount: rows.length }) };
};
