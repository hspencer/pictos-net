/**
 * Netlify Background Function: Recraft V3 SVG Proxy
 * This runs in the background (up to 15 mins) to bypass the 10-second limit
 * on synchronous Netlify functions.
 * It stores the result in Netlify Blobs for the client to poll.
 */

import { checkAndCharge, logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { fetchWithRetry, describeFetchError } from './_shared/httpRetry.js';

const RECRAFT_API_URL = 'https://external.api.recraft.ai/v1/images/generations';

export const handler = async (event, context) => {
  connectBlobs(event);
  let bodyPayload;
  try {
    bodyPayload = JSON.parse(event.body);
  } catch (err) {
    console.error('[api-recraft-worker] Invalid JSON body');
    return;
  }

  const { prompt, colors, jobId, model = 'recraftv4_1_vector', _authToken } = bodyPayload;
  if (!jobId || !prompt) {
    console.error('[api-recraft-worker] Missing jobId or prompt');
    return;
  }

  const store = getStore('recraft-jobs');

  const ALLOWED_MODELS = ['recraftv4_1', 'recraftv4_1_vector'];
  if (!ALLOWED_MODELS.includes(model)) {
    console.error(`[api-recraft-worker] Disallowed model: ${model}`);
    await store.setJSON(jobId, { error: `Model not allowed: ${model}` });
    return;
  }


  // Set initial status to pending so poller knows it started
  await store.setJSON(jobId, { pending: true });

  // Consume the single-use grant deposited by the synchronous api-authorize
  // gate (background functions cannot verify a JWT — see consumeAuthGrant).
  const user = await consumeAuthGrant(jobId);
  if (!user) {
    await store.setJSON(jobId, { error: 'Unauthorized (no valid authorization grant)' });
    return;
  }
  const email = user.email ?? 'dev';
  const roles = user.app_metadata?.roles ?? [];

  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) {
    await store.setJSON(jobId, { error: 'Server configuration error' });
    return;
  }

  if (prompt.length > 10000) {
    await store.setJSON(jobId, { error: 'Prompt too long (max 10000 characters)' });
    return;
  }

  // Quota check
  const quota = await checkAndCharge(email, 1, roles);
  if (!quota.allowed) {
    console.warn(`[api-recraft-worker] quota exceeded for ${email} (${quota.units_used}/${quota.limit})`);
    await store.setJSON(jobId, {
      error: 'Daily quota exceeded',
      quotaExceeded: true,
      units_used: quota.units_used,
      limit: quota.limit,
    });
    return;
  }

  console.log(`[api-recraft-worker] user=${email} model=${model} today=${quota.units_used}/${quota.limit} jobId=${jobId}`);

  const startMs = Date.now();

  try {
    const body = {
      model,
      prompt,
      n: 1,
      size: '1:1',
      ...(Array.isArray(colors) && colors.length > 0 ? {
        controls: {
          colors: colors.slice(0, 10).map(hex => ({
            rgb: [
              parseInt(hex.slice(1, 3), 16),
              parseInt(hex.slice(3, 5), 16),
              parseInt(hex.slice(5, 7), 16),
            ],
          })),
        },
      } : {}),
    };

    // fetchWithRetry absorbs transient "fetch failed" transport errors and
    // upstream 5xx. retryOn429: Recraft rate-limits bursts (parallel cascades)
    // with 429 — retried with exponential backoff like the Gemini worker.
    // Other 4xx are returned unretried and handled below.
    const recraftRes = await fetchWithRetry(RECRAFT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, {
      retries: 4,
      baseDelayMs: 2000,
      retryOn429: true,
      // Terminal result guaranteed before the client's 120s poll window ends.
      maxTotalMs: 90000,
      // Publish retry progress so the UI can narrate the wait instead of
      // showing a mute spinner (api-recraft-poll forwards pending blobs as-is).
      onRetry: (attempt, total, waitMs, status) =>
        store.setJSON(jobId, { pending: true, retrying: { attempt, of: total, waitMs, status } }),
    });

    if (!recraftRes.ok) {
      const errText = await recraftRes.text().catch(() => recraftRes.statusText);
      console.error(`[api-recraft-worker] Recraft error ${recraftRes.status}: ${errText}`);
      await logCall({
        email, phase: 'recraft', model, units_charged: 1,
        ms: Date.now() - startMs,
        tokens_in: 0, tokens_out: 0, ok: false, error_msg: `Recraft ${recraftRes.status}: ${errText}`,
      });
      await store.setJSON(jobId, { error: `Recraft error: ${errText}` });
      return;
    }

    const data = await recraftRes.json();
    const imageUrl = data?.data?.[0]?.url;

    if (!imageUrl) {
      console.error('[api-recraft-worker] No image URL in response');
      await logCall({
        email, phase: 'recraft', model, units_charged: 1,
        ms: Date.now() - startMs,
        tokens_in: 0, tokens_out: 0, ok: false, error_msg: 'No image URL in Recraft response',
      });
      await store.setJSON(jobId, { error: 'Recraft returned no image URL' });
      return;
    }

    const imageRes = await fetchWithRetry(imageUrl, {});
    if (!imageRes.ok) {
      await logCall({
        email, phase: 'recraft', model, units_charged: 1,
        ms: Date.now() - startMs,
        tokens_in: 0, tokens_out: 0, ok: false, error_msg: `CDN fetch failed: ${imageRes.status}`,
      });
      await store.setJSON(jobId, { error: `Failed to fetch image from Recraft CDN: ${imageRes.status}` });
      return;
    }

    const ms = Date.now() - startMs;

    if (model === 'recraftv4_1_vector') {
      // Vector model: fetch and validate SVG text
      const svgContent = await imageRes.text();
      if (!svgContent.trim().startsWith('<') && !svgContent.includes('<svg')) {
        await logCall({
          email, phase: 'recraft', model, units_charged: 1,
          ms, tokens_in: 0, tokens_out: 0, ok: false, error_msg: 'Response not valid SVG',
        });
        await store.setJSON(jobId, { error: 'Recraft response is not valid SVG' });
        return;
      }
      await logCall({
        email, phase: 'recraft', model, units_charged: 1,
        ms, tokens_in: 0, tokens_out: Math.round(svgContent.length / 4), ok: true,
      });
      await store.setJSON(jobId, { svg: svgContent });
    } else {
      // Raster model (recraftv4_1): fetch PNG, convert to base64 data URL
      const arrayBuffer = await imageRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const bitmap = `data:image/png;base64,${base64}`;
      await logCall({
        email, phase: 'recraft', model, units_charged: 1,
        ms, tokens_in: 0, tokens_out: Math.round(base64.length / 4), ok: true,
      });
      await store.setJSON(jobId, { bitmap });
    }

  } catch (error) {
    // describeFetchError preserves error.cause so "fetch failed" is diagnosable.
    const detail = describeFetchError(error);
    console.error(`[api-recraft-worker] Error: ${detail}`);
    await logCall({
      email, phase: 'recraft', model, units_charged: 1,
      ms: Date.now() - startMs,
      tokens_in: 0, tokens_out: 0, ok: false, error_msg: detail,
    });
    await store.setJSON(jobId, { error: detail || 'Recraft service error' });
  }
};
