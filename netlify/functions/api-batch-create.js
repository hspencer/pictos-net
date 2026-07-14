/**
 * Netlify Function: create a Vertex batch generation job for a library.
 *
 * Spec: specs/batch-generation.allium (rule SubmitBatch).
 * Synchronous (not background): JSONL upload + job creation take 2-4s and a
 * sync function gives proper error responses and clientContext auth.
 * Timeout raised in netlify.toml (26s, same as api-recraft was).
 *
 * Body: { libraryId, model, rows: [{rowId, prompt}] }
 *   (Fase B4 will add sequenceId, anchors, referenceRowId.)
 * The composed Phase 3 prompt is built CLIENT-side (same composition as
 * geminiService.generateImage) so online and batch prompts are identical.
 *
 * Blob store "batch-jobs", key = libraryId — single source of truth for the
 * job, enforcing one active batch per library and cross-session resumption.
 */

import { checkAndCharge, refundUnits, logCall } from './_shared/usage.js';
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { fetchFreshRoles } from './_shared/identity.js';
import {
  buildBatchJsonl, uploadToGcs, createBatchPredictionJob, batchBucket,
  isActiveBatchState,
} from './_shared/vertexBatch.js';

const ALLOWED_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
const MAX_ROWS = 200;

const ALLOWED_ORIGINS = [
  'https://pictos.net',
  'https://next.pictos.net',
  'https://pictos-next.netlify.app',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export const handler = async (event, context) => {
  connectBlobs(event);
  const headers = corsHeaders(event.headers?.origin || '');

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth: sync functions get a signature-verified clientContext from Netlify.
  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const email = user?.email ?? 'dev';
  // Live roles from GoTrue — the JWT snapshot can be up to 1h stale, which
  // made freshly assigned 'superuser' roles miss the quota bypass.
  const roles = (await fetchFreshRoles(event)) ?? (user?.app_metadata?.roles ?? []);

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { libraryId, model, rows } = body ?? {};
  if (!libraryId || !model || !Array.isArray(rows)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing libraryId, model or rows' }) };
  }
  if (!ALLOWED_MODELS.includes(model)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Model not allowed for batch: ${model}` }) };
  }
  if (rows.length < 1 || rows.length > MAX_ROWS) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Row count must be 1..${MAX_ROWS}` }) };
  }
  if (!rows.every(r => r?.rowId && typeof r.prompt === 'string' && r.prompt.length > 0)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Every row needs rowId and a non-empty prompt (Phase 2 must be completed)' }) };
  }

  const store = getStore('batch-jobs');

  // One active batch per library (spec invariant OneActiveBatchPerLibrary).
  const existing = await store.get(libraryId, { type: 'json' }).catch(() => null);
  if (existing && isActiveBatchState(existing.state)) {
    return {
      statusCode: 409, headers,
      body: JSON.stringify({ error: 'A batch is already active for this library', job: existing }),
    };
  }

  // Fail fast on missing bucket config before charging quota.
  try {
    batchBucket();
  } catch {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error (VERTEX_BATCH_BUCKET)' }) };
  }

  // Quota: rows.count units charged up-front (spec: no refund, open question).
  const quota = await checkAndCharge(email, rows.length, roles);
  if (!quota.allowed) {
    return {
      statusCode: 429, headers,
      body: JSON.stringify({
        error: 'Daily quota exceeded', quotaExceeded: true,
        units_used: quota.units_used, limit: quota.limit,
      }),
    };
  }

  const jobId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();

  try {
    const { jsonl, items } = buildBatchJsonl(rows);
    const inputUri = await uploadToGcs(`batch/input/${jobId}.jsonl`, jsonl, 'application/jsonl');
    const outputPrefix = `gs://${batchBucket()}/batch/output/${jobId}/`;

    const vertexJobName = await createBatchPredictionJob({
      displayName: `pictos-${jobId}`,
      model,
      inputUri,
      outputPrefix,
    });

    const job = {
      id: jobId,
      libraryId,
      ownerEmail: email,
      model,
      vertexJobName,
      state: 'submitted',
      items,
      rowCount: rows.length,
      succeededCount: 0,
      failedCount: 0,
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(libraryId, job);

    await logCall({
      email, phase: 'gemini-batch', model, units_charged: rows.length,
      ms: Date.now() - startMs, tokens_in: 0, tokens_out: 0, ok: true,
    });

    console.log(`[api-batch-create] user=${email} model=${model} rows=${rows.length} job=${vertexJobName}`);
    return { statusCode: 200, headers, body: JSON.stringify({ jobId, state: job.state, rowCount: job.rowCount }) };
  } catch (error) {
    console.error(`[api-batch-create] ${error.message}`);
    // The Vertex job never started — return the up-front charge.
    await refundUnits(email, rows.length);
    await logCall({
      email, phase: 'gemini-batch', model, units_charged: rows.length,
      ms: Date.now() - startMs, tokens_in: 0, tokens_out: 0, ok: false,
      error_msg: error.message.slice(0, 300),
    });
    return { statusCode: 502, headers, body: JSON.stringify({ error: `Batch creation failed: ${error.message.slice(0, 200)}` }) };
  }
};
