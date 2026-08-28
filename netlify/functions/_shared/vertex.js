/**
 * Shared Vertex AI authentication and endpoint helpers.
 *
 * Used by: api-gemini-worker-background.js (Phase 3 — Gemini image models)
 * and api-gemini-structure.js (Phase 4 — gemini-* structuring models).
 *
 * Replaces the static Generative Language API key (AIza…) with short-lived
 * OAuth access tokens (~1 h) signed by a Google service account. The
 * credential JSON lives in GOOGLE_SERVICE_ACCOUNT_JSON (Netlify env var and
 * local .env, single line). OAuth changes authentication, not capacity or
 * provider policy controls; a service account is not exempt from suspension.
 */

import { GoogleAuth } from 'google-auth-library';

// Cached across warm invocations of the same function instance.
let cachedAuth = null;

/**
 * Build (once) the GoogleAuth client from GOOGLE_SERVICE_ACCOUNT_JSON.
 * Internal helper for getVertexAccessToken().
 */
function getAuth() {
  if (cachedAuth) return cachedAuth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  cachedAuth = new GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return cachedAuth;
}

/**
 * Return a valid OAuth access token for Vertex AI calls.
 * google-auth-library caches and refreshes the token internally,
 * so calling this per-request is cheap.
 */
export async function getVertexAccessToken() {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Vertex AI access token');
  return token;
}

/**
 * Build the Vertex AI generateContent URL for a Gemini model.
 * Project comes from VERTEX_PROJECT_ID (falls back to the service account's
 * own project_id). Location comes from VERTEX_LOCATION, default 'global'.
 */
export function vertexModelUrl(model) {
  const project =
    process.env.VERTEX_PROJECT_ID ||
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').project_id;
  if (!project) throw new Error('VERTEX_PROJECT_ID is not configured');

  const location = process.env.VERTEX_LOCATION || 'global';
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}
