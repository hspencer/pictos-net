/**
 * Netlify Background Function: Gemini Structuring Proxy (Vertex AI, Phase 5).
 *
 * Runs ESTRUCTURAR (relabel / redraw) as a background job so slow, geometry-
 * heavy calls are not bound by the 60s synchronous function timeout (they were
 * surfacing as a raw 500 "Internal Server Error"). The Claude-compatible result
 * is stored in Netlify Blobs for the client to poll via api-gemini-structure-poll.
 *
 * Auth and large vision inputs are staged by the synchronous api-structure-stage
 * gate. Background requests contain only jobId. Zero internal units is not free API usage.
 */

import { logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { fetchWithRetry } from './_shared/httpRetry.js';
import { providerHttpError, providerFailure } from './_shared/providerError.js';
import { buildGeminiRequest, geminiResponseToClaude } from './_shared/geminiTranslate.js';

const ALLOWED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'];
const STORE = 'gemini-structure-jobs';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return;

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    console.error('[api-gemini-structure-bg] Invalid JSON body');
    return;
  }

  const { jobId } = payload;
  if (typeof jobId !== 'string' || !/^struct-[a-zA-Z0-9-]{1,100}$/.test(jobId)) return;
  connectBlobs(event);

  // Consume the single-use grant deposited by the synchronous api-authorize
  // gate (background functions cannot verify a JWT — see consumeAuthGrant).
  const user = await consumeAuthGrant(jobId);
  if (!user) return;
  const email = user.email ?? 'dev';
  const store = getStore(STORE);
  const existing = await store.get(jobId, { type: 'json' });
  if (existing?.owner && existing.owner !== email) return;
  const inputs = getStore('structure-inputs');
  const staged = await inputs.get(jobId, { type: 'json', consistency: 'strong' });
  if (!staged || staged.owner !== email || staged.provider !== 'gemini') return;
  const { model, system, tools, tool_choice, messages, max_tokens } = staged.params;
  const put = value => store.setJSON(jobId, { owner: email, ...value });

  const startMs = Date.now();

  try {
    await inputs.delete(jobId);
    if (!(staged.expiresAt > Date.now())) throw Object.assign(new Error('Staged structuring request expired'), { status: 400 });
    if (!ALLOWED_MODELS.includes(model)) throw Object.assign(new Error('Unsupported structuring model'), { status: 400 });
    await put({ pending: true });
    const accessToken = await getVertexAccessToken();
    const url = vertexModelUrl(model);
    const geminiBody = buildGeminiRequest({ model, system, tools, tool_choice, messages, max_tokens });

    const geminiRes = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(geminiBody),
    }, { retries: 2, baseDelayMs: 1000, retryOn429: true, maxTotalMs: 300000 });

    if (!geminiRes.ok) throw await providerHttpError(geminiRes, 'gemini', jobId);

    const geminiData = await geminiRes.json();
    const parsed = geminiResponseToClaude(geminiData);
    const usage = parsed.usage ?? {};
    const ms = Date.now() - startMs;

    if (!parsed.ok) {
      console.error(`[api-gemini-structure-bg] ${parsed.error}`);
      await logCall({
        email, phase: 'gemini-structure', model, units_charged: 0,
        ms, tokens_in: usage.promptTokenCount ?? null, tokens_out: usage.candidatesTokenCount ?? null,
        ok: false, error_msg: parsed.error.slice(0, 200),
      });
      await put({ error: parsed.error, retryManaged: true, retryable: false });
      return;
    }

    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms, tokens_in: parsed.response.usage?.input_tokens ?? null, tokens_out: parsed.response.usage?.output_tokens ?? null, ok: true,
    });
    console.log(`[api-gemini-structure-bg] done user=${email} model=${model} ms=${ms}`);

    await put({ response: parsed.response });

  } catch (error) {
    const failure = providerFailure(error, { provider: 'gemini', requestId: jobId });
    const detail = failure.error;
    console.error(`[api-gemini-structure-bg] Error: ${detail}`);
    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms: Date.now() - startMs, tokens_in: null, tokens_out: null, ok: false, error_msg: detail,
      provider: 'gemini', provider_status: failure.providerStatus, request_id: failure.requestId, attempts: failure.attempts,
    });
    await put(failure);
  }
};
