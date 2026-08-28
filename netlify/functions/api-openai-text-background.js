import { connectBlobs, getBlobStore } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { logCall } from './_shared/usage.js';
import { generateOpenAIText, openAITextPhase, buildOpenAITextRequest } from './_shared/openaiText.js';
import { providerFailure } from './_shared/providerError.js';

/** Phase 5 can author geometry for longer than a synchronous function budget. */
export const handler = async event => {
  if (event.httpMethod !== 'POST') return;
  let request;
  try { request = JSON.parse(event.body); } catch { return; }
  const jobId = request?.jobId;
  if (typeof jobId !== 'string' || !/^openai-struct-[a-zA-Z0-9-]{1,100}$/.test(jobId)) return;
  connectBlobs(event);
  const user = await consumeAuthGrant(jobId);
  if (!user) return;
  const store = getBlobStore('openai-text-jobs');
  const owner = user.email ?? 'dev';
  const existing = await store.get(jobId, { type: 'json' });
  if (existing?.owner && existing.owner !== owner) return;
  const inputs = getBlobStore('structure-inputs');
  const staged = await inputs.get(jobId, { type: 'json', consistency: 'strong' });
  if (!staged || staged.owner !== owner || staged.provider !== 'openai') return;
  const params = staged.params;
  const put = payload => store.setJSON(jobId, { owner, ...payload });
  const started = Date.now();
  try {
    // Consume the input before inference. Expiration prevents a stale request
    // from being authorized later; abandoned inputs still need storage cleanup.
    await inputs.delete(jobId);
    if (!(staged.expiresAt > Date.now())) throw Object.assign(new Error('Staged structuring request expired'), { status: 400 });
    if (openAITextPhase(params) !== 5) throw Object.assign(new Error('Background endpoint requires Phase 5'), { status: 400 });
    buildOpenAITextRequest(params);
    await put({ pending: true });
    const response = await generateOpenAIText(params, { maxTotalMs: 300000 });
    await logCall({ email: owner, phase: 'openai-text-5', model: params.model, actual_model: response.model,
      provider: 'openai', units_charged: 0, ms: Date.now() - started,
      tokens_in: response.usage?.input_tokens ?? null, tokens_out: response.usage?.output_tokens ?? null,
      usage: response.usage, reasoning_effort: response.meta.reasoningEffort, request_id: response.meta.requestId,
      attempts: response.meta.attempts, ok: true });
    await put({ response });
  } catch (error) {
    const failure = providerFailure(error, { provider: 'openai', requestId: jobId });
    await logCall({ email: owner, phase: 'openai-text-5', model: params.model, provider: 'openai',
      units_charged: 0, ms: Date.now() - started, ok: false, error_msg: failure.error,
      tokens_in: error.usage?.input_tokens ?? null, tokens_out: error.usage?.output_tokens ?? null,
      actual_model: error.actualModel, reasoning_effort: error.reasoningEffort, usage: error.usage,
      request_id: failure.requestId, attempts: failure.attempts, quota_failure_source: failure.failureSource });
    await put(failure);
  }
};
