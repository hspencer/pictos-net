import { connectBlobs } from './_shared/blobs.js';
import { logCall } from './_shared/usage.js';
import { generateOpenAIText, buildOpenAITextRequest, openAITextPhase } from './_shared/openaiText.js';
import { providerFailure } from './_shared/providerError.js';

/** Same authenticated proxy boundary as other text providers. Zero internal units is not free API usage. */
export const handler = async (event, context) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const user = context?.clientContext?.user;
  if (process.env.NETLIFY_DEV !== 'true' && !user?.email) return reply(401, { error: 'Unauthorized' });
  let params, phase;
  try {
    params = JSON.parse(event.body);
    phase = openAITextPhase(params);
    buildOpenAITextRequest(params);
  } catch (error) { return reply(400, { error: error.message, retryManaged: true }); }
  connectBlobs(event);
  const started = Date.now();
  try {
    const response = await generateOpenAIText(params, { maxTotalMs: 45000 });
    await logCall({ email: user?.email ?? 'dev', phase: `openai-text-${phase}`, model: params.model,
      actual_model: response.model, provider: 'openai', units_charged: 0,
      ms: Date.now() - started, tokens_in: response.usage?.input_tokens ?? null,
      tokens_out: response.usage?.output_tokens ?? null, usage: response.usage,
      reasoning_effort: response.meta.reasoningEffort, request_id: response.meta.requestId,
      attempts: response.meta.attempts, ok: true });
    return reply(200, response);
  } catch (error) {
    const failure = providerFailure(error, { provider: 'openai', requestId: params._requestId });
    await logCall({ email: user?.email ?? 'dev', phase: `openai-text-${phase}`, model: params.model,
      provider: 'openai', units_charged: 0, ms: Date.now() - started, ok: false,
      tokens_in: error.usage?.input_tokens ?? null, tokens_out: error.usage?.output_tokens ?? null,
      actual_model: error.actualModel, reasoning_effort: error.reasoningEffort, usage: error.usage,
      error_msg: failure.error, request_id: failure.requestId, attempts: failure.attempts, quota_failure_source: failure.failureSource });
    return reply(failure.providerStatus || 502, failure);
  }
};
