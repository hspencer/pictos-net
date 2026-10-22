/**
 * Netlify Background Function: Gemini Image Generation Proxy (Vertex AI)
 *
 * Generates an image via Vertex AI (service-account OAuth, no static API key)
 * and stores the result in Netlify Blobs for the client to poll via
 * api-gemini-poll. Auth: Identity JWT verified against GoTrue (_shared/identity.js).
 */

import { checkAndCharge, refundUnitsOnce, logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { fetchWithRetry } from './_shared/httpRetry.js';
import { providerHttpError, providerFailure } from './_shared/providerError.js';
import { modelAllowed } from './_shared/modelCatalog.js';

// Admission comes from the model catalog (lifecycle status per phase).
const isAllowedModel = model => modelAllowed(model, 'gemini', [3]);

/**
 * Why a Gemini response carried no image, without keeping any of its content:
 * finish and block reasons, and the kinds of parts received (e.g. ["text"]).
 * The provider's finishMessage is an explanation, not user content; it is
 * truncated anyway.
 */
export function geminiNoImageDiagnosis(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return {
    finish_reason: candidate?.finishReason ?? null,
    finish_message: typeof candidate?.finishMessage === 'string' ? candidate.finishMessage.slice(0, 200) : null,
    block_reason: data?.promptFeedback?.blockReason ?? null,
    candidate_count: data?.candidates?.length ?? 0,
    part_kinds: parts.map(part => Object.keys(part).filter(k => k !== 'thought' && k !== 'thoughtSignature').join('+') || 'empty'),
  };
}

export const handler = async (event, context) => {
  connectBlobs(event);

  let bodyPayload;
  try {
    bodyPayload = JSON.parse(event.body);
  } catch (err) {
    console.error('[api-gemini-worker] Invalid JSON body');
    return;
  }

  const { prompt, model, jobId, _authToken } = bodyPayload;
  if (!jobId || !prompt || !model) {
    console.error('[api-gemini-worker] Missing jobId, prompt, or model');
    return;
  }

  if (!isAllowedModel(model)) {
    console.error(`[api-gemini-worker] Disallowed model: ${model}`);
    return;
  }

  const store = getStore('gemini-jobs');
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

  // Quota check — 1 unit per image generation call (usage-enforcement.allium)
  const quota = await checkAndCharge(email, 1, roles);
  if (!quota.allowed) {
    console.warn(`[api-gemini-worker] quota exceeded for ${email} (${quota.units_used}/${quota.limit})`);
    await store.setJSON(jobId, {
      error: 'Daily quota exceeded',
      quotaExceeded: true,
      units_used: quota.units_used,
      limit: quota.limit,
    });
    return;
  }

  console.log(`[api-gemini-worker] user=${email} model=${model} today=${quota.units_used}/${quota.limit} jobId=${jobId}`);

  const startMs = Date.now();

  try {
    // Vertex AI: short-lived OAuth token instead of a static API key.
    const accessToken = await getVertexAccessToken();
    const url = vertexModelUrl(model);
    // fetchWithRetry absorbs transient "fetch failed" transport errors (DNS,
    // IPv6, dead keep-alive socket) that otherwise reach the user as an opaque
    // failure. retryOn429: Vertex image models run on dynamic shared quota and
    // return transient 429 RESOURCE_EXHAUSTED under burst/congestion — retried
    // with exponential backoff (2s/4s/8s/16s + jitter, ~30s worst case, well
    // inside the client's 120s poll window). Other 4xx handled below unretried.
    const geminiRes = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      }),
    }, {
      retries: 4,
      baseDelayMs: 2000,
      retryOn429: true,
      // Bound provider work to leave room within the client polling window.
      maxTotalMs: 90000,
      // Publish retry progress so the UI can narrate the wait instead of
      // showing a mute spinner (api-gemini-poll forwards pending blobs as-is).
      onRetry: (attempt, total, waitMs, status) =>
        store.setJSON(jobId, { pending: true, retrying: { attempt, of: total, waitMs, status } }),
    });

    if (!geminiRes.ok) throw await providerHttpError(geminiRes, 'gemini', jobId);

    const data = await geminiRes.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData?.data) {
      // Transport succeeded but nothing usable came back. Nothing was delivered,
      // so the unit is returned (idempotent per job).
      const diagnosis = geminiNoImageDiagnosis(data);
      const refunded = await refundUnitsOnce(email, 1, `gemini:${jobId}`, 'no_image');
      console.error(`[api-gemini-worker] No image: ${JSON.stringify(diagnosis)}`);
      await logCall({
        email, phase: 'gemini', model, units_charged: refunded ? 0 : 1,
        ms: Date.now() - startMs,
        tokens_in: data?.usageMetadata?.promptTokenCount ?? null,
        tokens_out: data?.usageMetadata?.candidatesTokenCount ?? null, ok: false,
        error_msg: 'No image data in Gemini response', provider: 'gemini', request_id: jobId,
        failure_source: 'no_image', ...diagnosis, refunded_units: refunded ? 1 : 0,
      });
      await store.setJSON(jobId, {
        error: `Gemini returned no image (finishReason=${diagnosis.finish_reason ?? 'none'}`
          + `${diagnosis.block_reason ? `, blockReason=${diagnosis.block_reason}` : ''})`,
        provider: 'gemini', failureSource: 'no_image', retryable: true, recoverable: true,
        finishReason: diagnosis.finish_reason, blockReason: diagnosis.block_reason,
        refundedUnits: refunded ? 1 : 0,
      });
      return;
    }

    const mimeType = imagePart.inlineData.mimeType;
    const base64Data = imagePart.inlineData.data;
    const bitmap = `data:${mimeType};base64,${base64Data}`;

    const ms = Date.now() - startMs;
    await logCall({
      email, phase: 'gemini', model, units_charged: 1,
      ms, tokens_in: 0, tokens_out: Math.round(base64Data.length / 4), ok: true,
    });

    await store.setJSON(jobId, { bitmap });

  } catch (error) {
    const failure = providerFailure(error, { provider: 'gemini', requestId: jobId });
    // A terminal 429 may be rate/capacity or billing; never call it a daily limit.
    const providerQuota = failure.providerStatus === 429;
    const refunded = providerQuota
      ? await refundUnitsOnce(email, 1, `gemini:${jobId}`, failure.failureSource)
      : false;
    console.error(`[api-gemini-worker] Error: ${failure.error}`);
    await logCall({
      email, phase: 'gemini', model, units_charged: providerQuota ? 0 : 1,
      ms: Date.now() - startMs, tokens_in: null, tokens_out: null, ok: false,
      error_msg: failure.error, provider: 'gemini', provider_status: failure.providerStatus,
      request_id: failure.requestId, attempts: failure.attempts,
      quota_failure_source: providerQuota ? failure.failureSource : null, refunded_units: refunded ? 1 : 0,
    });
    await store.setJSON(jobId, { ...failure, recoverable: failure.retryable, refundedUnits: refunded ? 1 : 0 });
  }
};
