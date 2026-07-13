/**
 * Netlify Background Function: full Phase 1→2→3 pipeline batch.
 *
 * Runs NLU (Phase 1) → Compose (Phase 2) → Image generation (Phase 3) for
 * each submitted row sequentially. Up to 25 rows, 15-minute function budget.
 *
 * Per-row failure isolation: one row's error is recorded and the batch
 * continues with the next row. Quota was charged upfront by the sync gate
 * (api-pipeline-batch-create); this function does NOT re-charge.
 *
 * Auth: single-use grant deposited by api-pipeline-batch-create, keyed by
 * 'pipeline-{jobId}'. See consumeAuthGrant in _shared/identity.js.
 *
 * Results stored in 'pipeline-jobs' blob store:
 *   {libraryId}/state → job progress + row list
 *   {jobId}/{rowId}   → per-row result (nluData, elements, prompt, svg/bitmap)
 */

import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { consumeAuthGrant } from './_shared/identity.js';
import { logCall } from './_shared/usage.js';
import { runPhase1, runPhase2, composeRecraftPrompt, composeGeminiImagePrompt } from './_shared/pipelineRunner.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { fetchWithRetry, describeFetchError } from './_shared/httpRetry.js';

const RECRAFT_API_URL = 'https://external.api.recraft.ai/v1/images/generations';
const RECRAFT_MODELS = new Set(['recraftv4_1_vector', 'recraftv4_1', 'recraftv4_1_utility_vector', 'recraftv4_1_pro_vector']);
const GEMINI_IMAGE_MODELS = new Set(['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image']);

// ── Phase 3 runners ───────────────────────────────────────────────────────────

async function phase3Recraft(elements, prompt, utterance, nluData, config, email) {
  const model = config.generationModel || 'recraftv4_1_vector';
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error('RECRAFT_API_KEY not configured');

  const fullPrompt = composeRecraftPrompt(elements, prompt, utterance, nluData, config);
  const body = { model, prompt: fullPrompt, n: 1, size: '1:1' };
  const colors = config.paletteColors?.filter(c => /^#[0-9a-fA-F]{6}$/.test(c));
  if (colors?.length) {
    body.controls = {
      colors: colors.slice(0, 10).map(hex => ({
        rgb: [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
      })),
    };
  }

  const startMs = Date.now();
  const recraftRes = await fetchWithRetry(RECRAFT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, { retries: 3, baseDelayMs: 2000, retryOn429: true, maxTotalMs: 60000 });

  if (!recraftRes.ok) {
    const text = await recraftRes.text().catch(() => recraftRes.statusText);
    throw new Error(`Recraft ${recraftRes.status}: ${text.slice(0, 200)}`);
  }

  const data = await recraftRes.json();
  const imageUrl = data?.data?.[0]?.url;
  if (!imageUrl) throw new Error('Recraft returned no image URL');

  const imageRes = await fetchWithRetry(imageUrl, {});
  if (!imageRes.ok) throw new Error(`Recraft CDN fetch failed: ${imageRes.status}`);

  const ms = Date.now() - startMs;
  await logCall({ email, phase: 'recraft-batch', model, units_charged: 0, ms, tokens_in: 0, tokens_out: 0, ok: true });

  if (model.endsWith('_vector')) {
    const svg = await imageRes.text();
    if (!svg.includes('<svg')) throw new Error('Recraft response is not valid SVG');
    return { svg };
  }
  const ab = await imageRes.arrayBuffer();
  return { bitmap: `data:image/png;base64,${Buffer.from(ab).toString('base64')}` };
}

async function phase3Gemini(elements, prompt, utterance, nluData, config, email) {
  const model = config.generationModel;
  const fullPrompt = composeGeminiImagePrompt(elements, prompt, utterance, nluData, config);

  const startMs = Date.now();
  const accessToken = await getVertexAccessToken();
  const url = vertexModelUrl(model);

  const geminiRes = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    }),
  }, { retries: 3, baseDelayMs: 2000, retryOn429: true, maxTotalMs: 60000 });

  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => geminiRes.statusText);
    throw new Error(`Gemini image ${geminiRes.status}: ${text.slice(0, 200)}`);
  }

  const data = await geminiRes.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData?.data) throw new Error('Gemini returned no image data');

  const ms = Date.now() - startMs;
  await logCall({ email, phase: 'gemini-batch', model, units_charged: 0, ms, tokens_in: 0, tokens_out: 0, ok: true });

  return { bitmap: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event, context) => {
  connectBlobs(event);

  let body;
  try { body = JSON.parse(event.body); } catch {
    console.error('[pipeline-batch] Invalid JSON body');
    return;
  }

  const { libraryId, jobId, rows, config } = body ?? {};
  if (!libraryId || !jobId || !Array.isArray(rows) || rows.length === 0) {
    console.error('[pipeline-batch] Missing required fields');
    return;
  }

  const jobs = getStore('pipeline-jobs');

  const user = await consumeAuthGrant(`pipeline-${jobId}`);
  if (!user) {
    console.warn(`[pipeline-batch] Unauthorized for job ${jobId}`);
    await jobs.setJSON(`${libraryId}/state`, {
      id: jobId, libraryId, state: 'failed', error: 'Unauthorized',
      rowCount: rows.length, rowIds: rows.map(r => r.rowId),
      succeededCount: 0, failedCount: rows.length,
    }).catch(() => {});
    return;
  }

  const email = user.email ?? 'dev';
  const genModel = config?.generationModel || 'recraftv4_1_vector';
  const isRecraft = RECRAFT_MODELS.has(genModel);
  const isGeminiImage = GEMINI_IMAGE_MODELS.has(genModel);

  if (!isRecraft && !isGeminiImage) {
    console.error(`[pipeline-batch] Unsupported generation model: ${genModel}`);
    await jobs.setJSON(`${libraryId}/state`, {
      id: jobId, libraryId, state: 'failed',
      error: `Unsupported generation model: ${genModel}`,
      rowCount: rows.length, rowIds: rows.map(r => r.rowId),
      succeededCount: 0, failedCount: rows.length,
    }).catch(() => {});
    return;
  }

  // Write initial running state so the poll endpoint returns something immediately.
  let jobState = {
    id: jobId,
    libraryId,
    state: 'running',
    model: genModel,
    rowCount: rows.length,
    rowIds: rows.map(r => r.rowId),
    succeededCount: 0,
    failedCount: 0,
    startedAt: new Date().toISOString(),
  };
  await jobs.setJSON(`${libraryId}/state`, jobState);

  console.log(`[pipeline-batch] job=${jobId} user=${email} rows=${rows.length} model=${genModel}`);

  for (const { rowId, utterance } of rows) {
    const rowKey = `${jobId}/${rowId}`;
    try {
      // Phase 1: NLU
      const nluData = await runPhase1(utterance, config);

      // Phase 2: Compose
      const { elements, prompt } = await runPhase2(nluData, config);

      // Phase 3: Image generation
      const imageResult = isRecraft
        ? await phase3Recraft(elements, prompt, utterance, nluData, config, email)
        : await phase3Gemini(elements, prompt, utterance, nluData, config, email);

      await jobs.setJSON(rowKey, { nluData, elements, prompt, ...imageResult });
      jobState.succeededCount++;
      console.log(`[pipeline-batch] job=${jobId} row=${rowId} ok`);
    } catch (err) {
      const detail = describeFetchError(err);
      console.error(`[pipeline-batch] job=${jobId} row=${rowId} error: ${detail}`);
      await jobs.setJSON(rowKey, { error: detail.slice(0, 500) });
      jobState.failedCount++;
    }

    // Update progress after each row so the UI can show incremental progress.
    await jobs.setJSON(`${libraryId}/state`, jobState);
  }

  jobState.state = jobState.succeededCount > 0 ? 'completed' : 'failed';
  jobState.completedAt = new Date().toISOString();
  await jobs.setJSON(`${libraryId}/state`, jobState);

  console.log(`[pipeline-batch] job=${jobId} done ok=${jobState.succeededCount}/${jobState.rowCount}`);
};
