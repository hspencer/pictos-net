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
import { logCall, refundUnitsOnce } from './_shared/usage.js';
import { runPhase1, runPhase2, composeRecraftPrompt, composeGeminiImagePrompt } from './_shared/pipelineRunner.js';
import { getVertexAccessToken, vertexModelUrl } from './_shared/vertex.js';
import { fetchWithRetry } from './_shared/httpRetry.js';
import { generateOpenAIImage, OPENAI_IMAGE_MODEL } from './_shared/openaiImage.js';
import { openProviderQuotaCircuit } from './_shared/pipelineQuotaCircuit.js';
import { MODEL_CATALOG, getModelProvider } from './_shared/modelCatalog.js';
import { providerHttpError, providerFailure } from './_shared/providerError.js';
import { generateRecraftImage } from './_shared/recraftImage.js';

const RECRAFT_MODELS = new Set(Object.keys(MODEL_CATALOG).filter(id => MODEL_CATALOG[id].provider === 'recraft'));
const GEMINI_IMAGE_MODELS = new Set(Object.keys(MODEL_CATALOG).filter(id => MODEL_CATALOG[id].provider === 'gemini' && MODEL_CATALOG[id].phases.includes(3)));

// ── Phase 3 runners ───────────────────────────────────────────────────────────

async function phase3Recraft(elements, prompt, utterance, nluData, config, email) {
  const startMs = Date.now();
  const model = config.generationModel || 'recraftv4_1_vector';
  const result = await generateRecraftImage({
    model, prompt: composeRecraftPrompt(elements, prompt, utterance, nluData, config),
    colors: config.paletteColors, style_id: config.recraftStyleId,
  }, { maxTotalMs: 60000 });
  await logCall({ email, phase: 'recraft-batch', model, style_id: config.recraftStyleId ?? null, units_charged: 0,
    ms: Date.now() - startMs, tokens_in: null, tokens_out: null, ok: true });
  return result;
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

  if (!geminiRes.ok) throw await providerHttpError(geminiRes, 'gemini');

  const data = await geminiRes.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData?.data) throw new Error('Gemini returned no image data');

  const ms = Date.now() - startMs;
  await logCall({ email, phase: 'gemini-batch', model, units_charged: 0, ms,
    tokens_in: data.usageMetadata?.promptTokenCount ?? null,
    tokens_out: Number.isFinite(data.usageMetadata?.candidatesTokenCount)
      ? data.usageMetadata.candidatesTokenCount + (data.usageMetadata.thoughtsTokenCount ?? 0) : null,
    usage: data.usageMetadata ?? null, actual_model: data.modelVersion ?? null, ok: true });

  return { bitmap: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
}

async function phase3OpenAI(elements, prompt, utterance, nluData, config, email) {
  const startMs = Date.now();
  const result = await generateOpenAIImage({
    model: config.generationModel,
    prompt: composeGeminiImagePrompt(elements, prompt, utterance, nluData, config),
    quality: config.openaiImageQuality ?? 'low',
  });
  await logCall({
    email, phase: 'openai-batch', model: config.generationModel, quality: result.generationQuality,
    units_charged: 0, ms: Date.now() - startMs, ok: true,
    tokens_in: result.usage?.input_tokens ?? null, tokens_out: result.usage?.output_tokens ?? null,
    provider: 'openai', request_id: result.requestId, usage: result.usage,
  });
  return { bitmap: result.bitmap, generationQuality: result.generationQuality };
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

  const isOpenAI = genModel === OPENAI_IMAGE_MODEL;

  if (!isRecraft && !isGeminiImage && !isOpenAI) {
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

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const { rowId, utterance } = rows[rowIndex];
    const rowKey = `${jobId}/${rowId}`;
    const phaseExecutions = [];
    const captureExecution = execution => { phaseExecutions.push(execution); };
    let nluData;
    let elements;
    let prompt;
    let activePhase = 1;
    const rowStartMs = Date.now();
    try {
      // Phase 1: NLU
      nluData = await runPhase1(utterance, config, captureExecution);

      // Phase 2: Compose
      activePhase = 2;
      ({ elements, prompt } = await runPhase2(nluData, config, captureExecution));

      // Phase 3: Image generation
      activePhase = 3;
      const imageResult = isRecraft
        ? await phase3Recraft(elements, prompt, utterance, nluData, config, email)
        : isOpenAI
          ? await phase3OpenAI(elements, prompt, utterance, nluData, config, email)
          : await phase3Gemini(elements, prompt, utterance, nluData, config, email);

      await jobs.setJSON(rowKey, { nluData, elements, prompt, phaseExecutions, ...imageResult });
      jobState.succeededCount++;
      console.log(`[pipeline-batch] job=${jobId} row=${rowId} ok`);
    } catch (err) {
      const failedModel = activePhase === 1 ? config.comprenderModel || config.nluModel || 'claude-haiku-4-5-20251001'
        : activePhase === 2 ? config.componerModel || config.nluModel || 'claude-haiku-4-5-20251001' : genModel;
      const provider = err.provider || (Object.hasOwn(MODEL_CATALOG, failedModel) ? getModelProvider(failedModel) : 'unknown');
      const failure = providerFailure(err, { provider, requestId: jobId });
      const partial = { nluData, elements, prompt, phaseExecutions, ...failure,
        failedPhase: activePhase, failedModel, recoverable: failure.retryable };
      if (failure.providerStatus === 429) {
        const { deferredRows, refundableUnits } = openProviderQuotaCircuit(jobState, rows, rowIndex, false);
        const refunded = await refundUnitsOnce(email, refundableUnits, `pipeline:${jobId}:provider-quota`, failure.failureSource);
        const circuit = openProviderQuotaCircuit(jobState, rows, rowIndex, refunded, {
          provider, phase: activePhase, failureSource: failure.failureSource,
        });
        await logCall({ email, phase: `phase${activePhase}-batch`, model: failedModel, units_charged: 0,
          ms: Date.now() - rowStartMs, tokens_in: err.usage?.input_tokens ?? null, tokens_out: err.usage?.output_tokens ?? null,
          usage: err.usage ?? null, actual_model: err.actualModel ?? null, ok: false,
          error_msg: failure.error, provider, provider_status: 429, request_id: failure.requestId,
          attempts: failure.attempts, quota_failure_source: failure.failureSource,
          refunded_units: refunded ? refundableUnits : 0, job_id: jobId, row_id: rowId });
        await jobs.setJSON(rowKey, { ...partial, rowState: activePhase === 3 ? 'phase3_error' : 'error' });
        for (const deferred of deferredRows) {
          await jobs.setJSON(`${jobId}/${deferred.rowId}`, { deferred: true, rowState: 'deferred',
            error: `Deferred after ${provider} rejected phase ${activePhase}`, provider,
            failureSource: failure.failureSource, recoverable: failure.retryable, retryable: failure.retryable });
        }
        jobState = circuit.state;
        jobState.completedAt = new Date().toISOString();
        await jobs.setJSON(`${libraryId}/state`, jobState);
        break;
      }
      // No image was requested for failed Phase 1/2. Failed OpenAI/Recraft
      // image jobs also release their reservation once; Gemini's existing
      // non-429 image policy is unchanged.
      const shouldRefund = activePhase < 3 || isOpenAI || isRecraft;
      const refunded = shouldRefund
        ? await refundUnitsOnce(email, 1, `pipeline:${jobId}:${rowId}:provider-error`, 'provider_error') : false;
      jobState.refundedGenerationUnits = (jobState.refundedGenerationUnits ?? 0) + (refunded ? 1 : 0);
      await logCall({ email, phase: `phase${activePhase}-batch`, model: failedModel, units_charged: 0,
        ms: Date.now() - rowStartMs, tokens_in: err.usage?.input_tokens ?? null, tokens_out: err.usage?.output_tokens ?? null,
          usage: err.usage ?? null, actual_model: err.actualModel ?? null, ok: false,
        error_msg: failure.error, provider, provider_status: failure.providerStatus,
        request_id: failure.requestId, attempts: failure.attempts, refunded_units: refunded ? 1 : 0,
        job_id: jobId, row_id: rowId });
      await jobs.setJSON(rowKey, { ...partial, rowState: 'error' });
      jobState.failedCount++;
    }

    // Update progress after each row so the UI can show incremental progress.
    await jobs.setJSON(`${libraryId}/state`, jobState);
  }

  if (jobState.state === 'running') {
    jobState.state = jobState.succeededCount > 0 ? 'completed' : 'failed';
    jobState.completedAt = new Date().toISOString();
    await jobs.setJSON(`${libraryId}/state`, jobState);
  }

  console.log(`[pipeline-batch] job=${jobId} done ok=${jobState.succeededCount}/${jobState.rowCount}`);
};
