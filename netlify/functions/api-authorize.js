/**
 * Synchronous authorization gate for the background AI workers.
 *
 * Background functions cannot verify a Netlify Identity JWT: their
 * Authorization header is stripped, and a function's own outbound fetch to
 * /.netlify/identity/user returns a Netlify edge 404 (the Identity proxy is an
 * edge-only rewrite, not applied to loopback function->site requests).
 * Synchronous functions, in contrast, receive a signature-verified
 * context.clientContext.user from Netlify.
 *
 * The client calls this endpoint (synchronous) right before invoking a worker.
 * We verify the user here and write a short-lived, single-use grant to the
 * 'auth-grants' blob store keyed by jobId. The worker then consumes that grant
 * (see consumeAuthGrant in _shared/identity.js) instead of calling GoTrue.
 * Only functions can write blobs, so a forged token cannot mint a grant.
 */
import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { fetchFreshRoles } from './_shared/identity.js';

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

const GRANT_TTL_MS = 120000; // 2 min — enough to start the worker

export const handler = async (event, context) => {
  connectBlobs(event);
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Synchronous functions get a signature-verified clientContext from Netlify.
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  const { user } = context.clientContext || {};
  if (!isLocalDev && !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let jobId;
  try { ({ jobId } = JSON.parse(event.body || '{}')); } catch { /* handled below */ }
  if (!jobId || typeof jobId !== 'string') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  const email = isLocalDev ? 'dev' : user.email;
  // Roles inside the JWT are a snapshot from token-issue time (up to 1h old).
  // Read them live from GoTrue so a role assigned in the Identity panel
  // (e.g. 'superuser') takes effect immediately; fall back to the snapshot.
  const roles = (await fetchFreshRoles(event)) ?? (user?.app_metadata?.roles ?? []);

  try {
    const store = getStore('auth-grants');
    await store.setJSON(jobId, { email, roles, exp: Date.now() + GRANT_TTL_MS });
  } catch (err) {
    console.error('[api-authorize] failed to write grant:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not authorize' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
