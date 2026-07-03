/**
 * Shared helpers for Vertex AI Batch API + Cloud Storage.
 *
 * Used by: api-batch-create.js (build JSONL, upload, create job) and
 * api-batch-status.js (poll job state). Fase B2 (api-batch-collect-background)
 * will reuse listGcsObjects/downloadGcsObject to read predictions.
 *
 * Spec: specs/batch-generation.allium. Design: docs/BATCH_GENERATION_DESIGN.md.
 *
 * All calls authenticate with the service-account OAuth token from
 * _shared/vertex.js (scope cloud-platform covers both aiplatform and storage).
 */

import { createHash } from 'node:crypto';
import { getVertexAccessToken } from './vertex.js';

/**
 * sha256 hex digest of a prompt string. The correlation key of the batch
 * manifest: Vertex output lines carry no custom id, only an echo of the
 * request, so we hash the exact prompt text to recover the row.
 */
export function promptHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Resolve project id the same way vertexModelUrl does.
 * Internal helper for URL builders below.
 */
function vertexProject() {
  const project =
    process.env.VERTEX_PROJECT_ID ||
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').project_id;
  if (!project) throw new Error('VERTEX_PROJECT_ID is not configured');
  return project;
}

/**
 * Bucket name for batch I/O. Fails loudly when unset so api-batch-create
 * returns a clear "server configuration error" instead of a cryptic 404.
 */
export function batchBucket() {
  const bucket = process.env.VERTEX_BATCH_BUCKET;
  if (!bucket) throw new Error('VERTEX_BATCH_BUCKET is not configured');
  return bucket;
}

/**
 * Build the JSONL body for a batch job: one generateContent request per row.
 * Mirrors the online worker's generationConfig (IMAGE, 1:1, 1K — batch caps
 * output at 1K anyway). `referenceGcsUri` (Fase B4) adds the reference
 * pictogram as fileData on every line.
 *
 * @param {Array<{rowId: string, prompt: string}>} rows
 * @param {string?} referenceGcsUri
 * @returns {{jsonl: string, items: Array<{rowId: string, promptHash: string}>}}
 */
export function buildBatchJsonl(rows, referenceGcsUri = null) {
  const items = [];
  const lines = rows.map(({ rowId, prompt }) => {
    items.push({ rowId, promptHash: promptHash(prompt) });
    const parts = [{ text: prompt }];
    if (referenceGcsUri) {
      parts.push({ fileData: { fileUri: referenceGcsUri, mimeType: 'image/png' } });
    }
    return JSON.stringify({
      request: {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      },
    });
  });
  return { jsonl: lines.join('\n'), items };
}

/**
 * Upload a small object to Cloud Storage via the JSON API (media upload).
 * Used for the input JSONL (KBs) and, in Fase B4, the reference PNG.
 * Returns the gs:// URI.
 */
export async function uploadToGcs(objectPath, body, contentType) {
  const bucket = batchBucket();
  const token = await getVertexAccessToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`GCS upload failed (${res.status}): ${err.slice(0, 300)}`);
  }
  return `gs://${bucket}/${objectPath}`;
}

/**
 * List object names under a prefix. Used by the collector (Fase B2) to find
 * the predictions*.jsonl files Vertex wrote to the output prefix.
 */
export async function listGcsObjects(prefix) {
  const bucket = batchBucket();
  const token = await getVertexAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS list failed (${res.status})`);
  const data = await res.json();
  return (data.items ?? []).map(o => o.name);
}

/**
 * Download an object's content as text. Used by the collector (Fase B2).
 */
export async function downloadGcsObject(objectPath) {
  const bucket = batchBucket();
  const token = await getVertexAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS download failed (${res.status}) for ${objectPath}`);
  return res.text();
}

/**
 * Delete an object (best-effort cleanup after collection, Fase B2).
 */
export async function deleteGcsObject(objectPath) {
  const bucket = batchBucket();
  const token = await getVertexAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
  await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

/**
 * Create a Vertex batch prediction job on the global endpoint.
 * Returns the job resource name (projects/.../batchPredictionJobs/{id}).
 */
export async function createBatchPredictionJob({ displayName, model, inputUri, outputPrefix }) {
  const project = vertexProject();
  const token = await getVertexAccessToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/batchPredictionJobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      displayName,
      model: `publishers/google/models/${model}`,
      inputConfig: { instancesFormat: 'jsonl', gcsSource: { uris: [inputUri] } },
      outputConfig: { predictionsFormat: 'jsonl', gcsDestination: { outputUriPrefix: outputPrefix } },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Vertex batch create failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.name;
}

/**
 * Get a batch prediction job's state and completion stats.
 */
export async function getBatchPredictionJob(jobName) {
  const token = await getVertexAccessToken();
  const url = `https://aiplatform.googleapis.com/v1/${jobName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Vertex batch get failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    state: data.state,
    successfulCount: Number(data.completionStats?.successfulCount ?? 0),
    failedCount: Number(data.completionStats?.failedCount ?? 0),
  };
}

/**
 * Map Vertex JOB_STATE_* to the spec's BatchState enum.
 * SUCCEEDED / FAILED / CANCELLED all map to "collecting": even a cancelled
 * job exported its completed lines, so we always attempt collection.
 */
export function mapVertexState(vertexState) {
  switch (vertexState) {
    case 'JOB_STATE_PENDING':
    case 'JOB_STATE_QUEUED':
      return 'queued';
    case 'JOB_STATE_RUNNING':
    case 'JOB_STATE_PAUSED':
      return 'running';
    case 'JOB_STATE_SUCCEEDED':
    case 'JOB_STATE_FAILED':
    case 'JOB_STATE_CANCELLED':
    case 'JOB_STATE_EXPIRED':
      return 'collecting';
    default:
      return 'queued';
  }
}

/** True when a stored batch state still needs polling. */
export function isActiveBatchState(state) {
  return ['submitted', 'queued', 'running', 'collecting'].includes(state);
}
