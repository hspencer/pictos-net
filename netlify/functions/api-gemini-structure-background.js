/**
 * Netlify Background Function: Gemini Structuring Proxy (Vertex AI, Phase 5).
 *
 * Runs ESTRUCTURAR (relabel / redraw) as a background job so slow, geometry-
 * heavy calls are not bound by the 90s synchronous function timeout (they were
 * surfacing as a raw 500 "Internal Server Error"). The Claude-compatible result
 * is stored in Netlify Blobs for the client to poll via api-gemini-structure-poll.
 *
 * Auth: Identity JWT verified against GoTrue (_shared/identity.js) — background
 * functions must never trust a decoded payload. Phase 5 is free-tier (0 units).
 */

import { logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { fetchWithRetry, describeFetchError } from './_shared/httpRetry.js';
import { buildGeminiRequest, geminiResponseToClaude } from './_shared/geminiTranslate.js';

const ALLOWED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'];
const STORE = 'gemini-structure-jobs';

export const handler = async (event, context) => {
  connectBlobs(event);

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    console.error('[api-gemini-structure-bg] Invalid JSON body');
    return;
  }

  const { jobId, model, system, tools, tool_choice, messages, max_tokens, _authToken } = payload;
  if (!jobId || !model || !messages) {
    console.error('[api-gemini-structure-bg] Missing jobId, model, or messages');
    return;
  }
  if (!ALLOWED_MODELS.includes(model)) {
    console.error(`[api-gemini-structure-bg] Disallowed model: ${model}`);
    return;
  }

  const store = getStore(STORE);
  await store.setJSON(jobId, { pending: true });

  // Consume the single-use grant deposited by the synchronous api-authorize
  // gate (background functions cannot verify a JWT — see consumeAuthGrant).
  const user = await consumeAuthGrant(jobId);
  if (!user) {
    await store.setJSON(jobId, { error: 'Unauthorized (no valid authorization grant)' });
    return;
  }
  const email = user.email ?? 'dev';

  console.log(`[api-gemini-structure-bg] user=${email} model=${model} jobId=${jobId}`);

  const startMs = Date.now();

  try {
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
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => geminiRes.statusText);
      console.error(`[api-gemini-structure-bg] Gemini error ${geminiRes.status}: ${errText.slice(0, 400)}`);
      await logCall({
        email, phase: 'gemini-structure', model, units_charged: 0,
        ms: Date.now() - startMs, tokens_in: 0, tokens_out: 0, ok: false,
        error_msg: `Gemini ${geminiRes.status}: ${errText.slice(0, 300)}`,
      });
      await store.setJSON(jobId, { error: `Gemini error: ${errText.slice(0, 200)}` });
      return;
    }

    const geminiData = await geminiRes.json();
    const parsed = geminiResponseToClaude(geminiData);
    const usage = parsed.usage ?? {};
    const ms = Date.now() - startMs;

    if (!parsed.ok) {
      console.error(`[api-gemini-structure-bg] ${parsed.error}`);
      await logCall({
        email, phase: 'gemini-structure', model, units_charged: 0,
        ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0,
        ok: false, error_msg: parsed.error.slice(0, 200),
      });
      await store.setJSON(jobId, { error: parsed.error });
      return;
    }

    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms, tokens_in: usage.promptTokenCount ?? 0, tokens_out: usage.candidatesTokenCount ?? 0, ok: true,
    });
    console.log(`[api-gemini-structure-bg] done user=${email} model=${model} ms=${ms}`);

    await store.setJSON(jobId, { response: parsed.response });

  } catch (error) {
    const detail = describeFetchError(error);
    console.error(`[api-gemini-structure-bg] Error: ${detail}`);
    await logCall({
      email, phase: 'gemini-structure', model, units_charged: 0,
      ms: Date.now() - startMs, tokens_in: 0, tokens_out: 0, ok: false, error_msg: detail,
    });
    await store.setJSON(jobId, { error: detail || 'Structuring service error' });
  }
};
