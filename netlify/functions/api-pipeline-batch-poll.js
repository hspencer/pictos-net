/**
 * Netlify Function: poll a pipeline batch job or fetch a single row result.
 *
 * GET ?libraryId=...                     → job state blob
 * GET ?libraryId=...&jobId=...&rowId=... → per-row result (consumed on read)
 *
 * Job state shape: { id, state, rowCount, rowIds, succeededCount, failedCount, ... }
 * Row result shape: { nluData, elements, prompt, svg?, bitmap?, error? }
 *   — or { pending: true } when the row has not completed yet.
 */

import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';

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

export const handler = async (event, context) => {
  connectBlobs(event);
  const headers = corsHeaders(event.headers?.origin || '');

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { libraryId, jobId, rowId } = event.queryStringParameters || {};
  if (!libraryId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing libraryId' }) };
  }

  const jobs = getStore('pipeline-jobs');

  // Per-row result (consumed on read so the blob store stays clean).
  if (jobId && rowId) {
    const rowKey = `${jobId}/${rowId}`;
    const result = await jobs.get(rowKey, { type: 'json' }).catch(() => null);
    if (!result) {
      return { statusCode: 200, headers, body: JSON.stringify({ pending: true }) };
    }
    // Delete after read — single-use, same pattern as recraft-jobs / gemini-jobs.
    await jobs.delete(rowKey).catch(() => {});
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  }

  // Job state.
  const state = await jobs.get(`${libraryId}/state`, { type: 'json' }).catch(() => null);
  if (!state) {
    return { statusCode: 200, headers, body: JSON.stringify({ none: true }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify(state) };
};
