import { connectBlobs, getBlobStore } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { checkAndCharge, refundUnitsOnce, logCall } from './_shared/usage.js';
import { generateOpenAIImage, openaiImageRequest, openaiApiKey } from './_shared/openaiImage.js';
import { providerFailure } from './_shared/providerError.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return;
  let body;
  try { body = JSON.parse(event.body); } catch { return; }
  if (typeof body?.jobId !== 'string' || !/^openai-[a-zA-Z0-9-]{1,100}$/.test(body.jobId)) return;
  connectBlobs(event);
  const { jobId } = body;
  const user = await consumeAuthGrant(jobId);
  if (!user) return; // Unauthorized callers cannot write/overwrite job results.
  const email = user.email ?? 'dev';
  const store = getBlobStore('openai-jobs');
  const existing = await store.get(jobId, { type: 'json' });
  if (existing?.owner && existing.owner !== email) return;
  const save = result => store.setJSON(jobId, { ...result, owner: email });
  let charged = false;
  const startMs = Date.now();
  await save({ pending: true });
  try {
    const request = openaiImageRequest(body);
    openaiApiKey(); // Reject missing config before charging.
    const quota = await checkAndCharge(email, 1, user.app_metadata?.roles ?? []);
    if (!quota.allowed) {
      await save({ error: 'Daily quota exceeded', quotaExceeded: true, units_used: quota.units_used, limit: quota.limit });
      return;
    }
    charged = true;
    const { bitmap, generationQuality, usage, requestId } = await generateOpenAIImage(request);
    await logCall({
      email, phase: 'openai', model: body.model, quality: generationQuality,
      units_charged: 1, ms: Date.now() - startMs, ok: true,
      tokens_in: usage?.input_tokens ?? null, tokens_out: usage?.output_tokens ?? null,
      provider: 'openai', request_id: requestId, usage,
    });
    await save({ bitmap, generationQuality });
  } catch (error) {
    const details = providerFailure(error, { provider: 'openai', requestId: jobId });
    const refunded = charged && await refundUnitsOnce(email, 1, `openai:${jobId}`, 'provider_error');
    const failureSource = details.failureSource;
    await logCall({
      email, phase: 'openai', model: body.model, quality: body.quality ?? 'low',
      units_charged: charged && !refunded ? 1 : 0, ms: Date.now() - startMs, ok: false,
      tokens_in: error.usage?.input_tokens ?? null, tokens_out: error.usage?.output_tokens ?? null, error_msg: details.error,
      provider: 'openai', provider_status: details.providerStatus,
      request_id: details.requestId, quota_failure_source: failureSource, refunded_units: refunded ? 1 : 0,
    });
    await save({ ...details, error: details.error, failureSource, recoverable: details.retryable, refundedUnits: refunded ? 1 : 0 });
  }
};
