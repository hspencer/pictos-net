/**
 * Netlify Function: Gemini Structuring Job Poll.
 * Reads the result blob written by api-gemini-structure-background.
 * Returns { pending: true } while running, or { response } / { error } when done.
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
    'Cache-Control': 'no-store',
  };
}

export const handler = async (event, context) => {
  connectBlobs(event);
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const user = context?.clientContext?.user;
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user?.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const jobId = event.queryStringParameters?.jobId;
  if (typeof jobId !== 'string' || !/^struct-[a-zA-Z0-9-]{1,100}$/.test(jobId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  const store = getStore('gemini-structure-jobs');
  let result;
  try {
    result = await store.get(jobId, { type: 'json' });
  } catch {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Invalid job data' }) };
  }

  if (!result) {
    return { statusCode: 200, headers, body: JSON.stringify({ pending: true }) };
  }
  if (!isLocalDev && result.owner !== user.email) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  const { owner, ...value } = result;

  if (result.response || result.error) {
    await store.delete(jobId);
    return { statusCode: 200, headers, body: JSON.stringify(value) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ pending: true }) };
};
