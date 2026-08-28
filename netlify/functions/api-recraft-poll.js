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
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  const { user } = context?.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev && !user?.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const jobId = event.queryStringParameters?.jobId;
  if (typeof jobId !== 'string' || !/^(job|recraft)-[a-zA-Z0-9-]{1,100}$/.test(jobId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  const store = getStore('recraft-jobs');
  let result;
  try {
    result = await store.get(jobId, { type: 'json' });
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Invalid job data' }) };
  }

  if (!result) {
    return { statusCode: 200, headers, body: JSON.stringify({ pending: true }) };
  }

  if (!isLocalDev && result.owner !== user.email) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  const { owner, ...payload } = result;

  // Si ya se procesó (con éxito o error), devolvemos el resultado y limpiamos el blob
  if (result.svg || result.bitmap || result.error) {
    await store.delete(jobId);
    return { statusCode: 200, headers, body: JSON.stringify(payload) };
  }

  // Pending: forward the blob as-is so retry progress written by the worker
  // (`retrying: { attempt, of, waitMs, status }`) reaches the client UI.
  return { statusCode: 200, headers, body: JSON.stringify({ pending: true, ...payload }) };
};
