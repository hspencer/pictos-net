/** Recraft Phase 3 background job; shared validation/generation with full batches. */
import { checkAndCharge, refundUnitsOnce, logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { recraftImageRequest, generateRecraftImage } from './_shared/recraftImage.js';
import { providerFailure } from './_shared/providerError.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return;
  connectBlobs(event);
  let payload;
  try { payload = JSON.parse(event.body); } catch { return; }
  const { jobId, model = 'recraftv4_1_vector' } = payload;
  if (typeof jobId !== 'string' || !/^(job|recraft)-[a-zA-Z0-9-]{1,100}$/.test(jobId)) return;
  const store = getStore('recraft-jobs');
  const user = await consumeAuthGrant(jobId);
  if (!user) return; // An unauthorized caller cannot overwrite a job.
  const email = user.email ?? 'dev';
  const existing = await store.get(jobId, { type: 'json' });
  if (existing?.owner && existing.owner !== email) return;
  const save = payload => store.setJSON(jobId, { ...payload, owner: email });
  let request;
  try {
    request = recraftImageRequest(payload);
    if (!process.env.RECRAFT_API_KEY) throw new Error('RECRAFT_API_KEY not configured');
  } catch (error) {
    await save(providerFailure(error, { provider: 'recraft', requestId: jobId }));
    return;
  }
  const quota = await checkAndCharge(email, 1, user.app_metadata?.roles ?? []);
  if (!quota.allowed) {
    await save({ error: 'Daily quota exceeded', quotaExceeded: true, units_used: quota.units_used, limit: quota.limit });
    return;
  }
  await save({ pending: true });
  const startMs = Date.now();
  try {
    const result = await generateRecraftImage({ ...payload, model: request.model }, {
      maxTotalMs: 90000,
      onRetry: (attempt, of, waitMs, status) => save({ pending: true, retrying: { attempt, of, waitMs, status } }),
    });
    await logCall({ email, phase: 'recraft', model, style_id: request.style_id ?? null, units_charged: 1, ms: Date.now() - startMs, tokens_in: null, tokens_out: null, ok: true });
    await save(result);
  } catch (error) {
    const failure = providerFailure(error, { provider: error.provider || 'recraft', requestId: jobId });
    const refunded = await refundUnitsOnce(email, 1, `recraft:${jobId}`, 'recraft_generation_failed');
    await logCall({ email, phase: 'recraft', model, style_id: request.style_id ?? null, units_charged: refunded ? 0 : 1, ms: Date.now() - startMs,
      tokens_in: null, tokens_out: null, ok: false, error_msg: failure.error,
      provider: failure.provider, provider_status: failure.providerStatus, request_id: failure.requestId,
      attempts: failure.attempts, refunded_units: refunded ? 1 : 0 });
    await save({ ...failure, refundedUnits: refunded ? 1 : 0 });
  }
};
