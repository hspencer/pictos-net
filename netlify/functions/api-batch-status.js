/**
 * Netlify Function: poll the batch job of a library.
 *
 * Spec: specs/batch-generation.allium (rule PollBatch).
 * GET ?libraryId=... → the stored BatchJob (refreshed from Vertex while
 * active). Terminal Vertex states flip the job to "collecting"; Fase B2's
 * collector (api-batch-collect-background) is then kicked exactly once via
 * the `collectRequested` flag on the blob.
 *
 * The client polls this every 60s while the app is open and a job pointer
 * exists; cross-session resumption is free because the blob is the truth.
 */

import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { getBatchPredictionJob, mapVertexState } from './_shared/vertexBatch.js';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

/** Strip fields the client does not need (items carry hashes; keep rowIds only). */
function publicView(job) {
  const { items, ...rest } = job;
  return { ...rest, rowIds: (items ?? []).map(i => i.rowId) };
}

export const handler = async (event, context) => {
  connectBlobs(event);
  const headers = corsHeaders(event.headers?.origin || '');

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const libraryId = event.queryStringParameters?.libraryId;
  if (!libraryId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing libraryId' }) };
  }

  const store = getStore('batch-jobs');
  const job = await store.get(libraryId, { type: 'json' }).catch(() => null);
  if (!job) {
    return { statusCode: 200, headers, body: JSON.stringify({ none: true }) };
  }

  /**
   * Invoke the background collector for this library and AWAIT the 202.
   * Awaiting matters twice over: the Lambda freezes on response (a
   * fire-and-forget fetch may never leave the process), and the job blob
   * must be persisted BEFORE the collector reads it — the original
   * fire-first-save-later order was a race that stranded jobs in
   * "collecting" with collectRequested stuck true.
   * DEPLOY_PRIME_URL over URL: on branch deploys URL points at production,
   * and the kick must run THIS deploy's function code.
   */
  const kickCollector = async (partial) => {
    const base = process.env.DEPLOY_PRIME_URL || process.env.URL || '';
    if (!base) return;
    try {
      await fetch(`${base}/.netlify/functions/api-batch-collect-background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward the caller's Identity token so the background
          // collector can verify it via GoTrue (_shared/identity.js).
          Authorization: event.headers?.authorization || event.headers?.Authorization || '',
        },
        body: JSON.stringify({ libraryId, partial }),
      });
    } catch (err) {
      console.warn(`[api-batch-status] collector kick failed: ${err.message}`);
    }
  };

  // Only refresh from Vertex while the job is in a pollable state.
  if (['submitted', 'queued', 'running'].includes(job.state)) {
    try {
      const v = await getBatchPredictionJob(job.vertexJobName);
      job.succeededCount = v.successfulCount;
      job.failedCount = v.failedCount;
      job.vertexState = v.state;
      job.state = mapVertexState(v.state);

      if (job.state === 'collecting' && !job.collectRequested) {
        // Terminal on Vertex → final collection, exactly once (self-healing
        // below re-kicks if the collector dies without finishing).
        job.collectRequested = true;
        job.collectKickedAt = Date.now();
        await store.setJSON(libraryId, job);   // persist BEFORE the kick
        await kickCollector(false);
      } else if (job.state === 'running' && v.successfulCount > (job.partialCollected ?? 0)) {
        // Vertex exports completed lines continuously: kick a PARTIAL
        // collection whenever new results exist, so pictograms appear in
        // the UI as they finish instead of all at the end.
        job.partialCollected = v.successfulCount;
        await store.setJSON(libraryId, job);
        await kickCollector(true);
      } else {
        await store.setJSON(libraryId, job);
      }
    } catch (error) {
      // Polling failures are transient by default: report the stored state
      // and let the next poll retry. Do not fail the job from here.
      console.warn(`[api-batch-status] Vertex poll failed: ${error.message}`);
    }
  } else if (job.state === 'collecting') {
    // Self-healing: if final collection was kicked but hasn't concluded in
    // 3 minutes (collector crashed, cold-start loss, expired token), re-kick
    // with the fresh token this poll carries.
    const staleMs = Date.now() - (job.collectKickedAt ?? 0);
    if (staleMs > 180_000) {
      job.collectKickedAt = Date.now();
      await store.setJSON(libraryId, job);
      await kickCollector(false);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify(publicView(job)) };
};
