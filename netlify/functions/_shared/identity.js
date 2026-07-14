/**
 * Shared Netlify Identity verification.
 *
 * Used by: api-gemini-worker-background.js, api-recraft-worker-background.js,
 * and api-gemini-structure-background.js.
 * Background functions do not receive a verified context.clientContext, so the
 * Bearer token must be validated against the site's GoTrue endpoint instead.
 *
 * Why this exists: decoding a JWT payload without checking its signature lets
 * anyone forge a token (any email, any roles) and consume the AI proxies —
 * this was the abuse vector behind the Google Cloud "hijacked resources"
 * suspension. GoTrue's /user endpoint only answers 200 when the token's
 * signature and expiry are valid, so it acts as the source of truth.
 */

import { getBlobStore } from './blobs.js';

const IDENTITY_TIMEOUT_MS = 5000;
const IDENTITY_RETRY_DELAY_MS = 1000;
const AUTH_GRANTS_STORE = 'auth-grants';

/**
 * Consume a single-use authorization grant written by the synchronous
 * api-authorize gate. Background functions cannot verify a JWT themselves
 * (Authorization header stripped; a loopback fetch to /.netlify/identity/user
 * hits a Netlify edge 404), so a synchronous function verifies the user via
 * context.clientContext.user and deposits a grant in the blob store keyed by
 * jobId. Only functions can write blobs, so a forged token cannot mint one.
 *
 * Returns a user-like object ({ email, app_metadata }) or null.
 * Requires connectBlobs(event) to have been called first.
 */
export async function consumeAuthGrant(jobId) {
  if (process.env.NETLIFY_DEV === 'true') return { email: 'dev', app_metadata: {} };
  if (!jobId) return null;
  try {
    const store = getBlobStore(AUTH_GRANTS_STORE);
    const grant = await store.get(jobId, { type: 'json' });
    if (grant && typeof grant.exp === 'number' && grant.exp > Date.now()) {
      await store.delete(jobId).catch(() => {}); // single-use: prevent replay
      return { email: grant.email, app_metadata: { roles: grant.roles ?? [] } };
    }
    console.warn(`[identity] ${grant ? 'expired' : 'missing'} auth grant for job ${jobId}`);
  } catch (err) {
    console.warn('[identity] consumeAuthGrant error:', err.message);
  }
  return null;
}

// Diagnostic breadcrumb from the last verifyIdentityUser() call that failed.
// Set within a single invocation and read by the caller to surface the real
// GoTrue reason (status/host/body) in the user-facing error. Temporary.
let lastDiagnostic = null;
export function getLastIdentityDiagnostic() {
  return lastDiagnostic;
}

/**
 * Verify the request's Netlify Identity JWT and return the user, or null.
 *
 * Resolution order:
 *   1. Local dev (NETLIFY_DEV=true): returns a synthetic 'dev' user, no auth.
 *   2. context.clientContext.user: already signature-verified by Netlify
 *      (only populated on synchronous functions).
 *   3. Authorization: Bearer <token> header → GET {URL}/.netlify/identity/user.
 *      GoTrue validates signature + expiry server-side and returns the user.
 *   4. bodyToken fallback: if the Authorization header was stripped by the
 *      Netlify routing layer (observed on branch-deploy background functions),
 *      use the token passed explicitly from the request body.
 *
 * A cache-busting query param is appended to the GoTrue URL to prevent the
 * Netlify CDN from serving stale responses — the CDN does not vary its cache
 * on the Authorization header for /.netlify/identity/user.
 *
 * Returns a GoTrue user object ({ email, app_metadata, user_metadata, … })
 * or null when the token is missing, forged, or expired.
 *
 * @param {object} event - Netlify function event
 * @param {object} context - Netlify function context
 * @param {string|null} bodyToken - JWT token extracted from request body (fallback)
 */
export async function verifyIdentityUser(event, context, bodyToken = null) {
  if (process.env.NETLIFY_DEV === 'true') {
    return { email: 'dev', app_metadata: {} };
  }

  if (context?.clientContext?.user) {
    return context.clientContext.user;
  }

  const headerAuth = event.headers?.authorization || event.headers?.Authorization;
  const authHeader = headerAuth || (bodyToken ? `Bearer ${bodyToken}` : null);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[identity] no Authorization header and no bodyToken; rejecting');
    return null;
  }

  if (!headerAuth && bodyToken) {
    console.warn('[identity] Authorization header absent — using bodyToken fallback');
  }

  return goTrueUserLookup(authHeader);
}

/**
 * Fetch the user's CURRENT roles from GoTrue, bypassing the JWT snapshot.
 *
 * Why: app_metadata.roles inside a JWT (and therefore inside
 * context.clientContext.user) reflect the moment the token was ISSUED. The
 * Identity widget caches tokens for up to an hour, so a role assigned in the
 * Netlify admin panel ("superuser") is invisible to quota checks until the
 * user happens to re-login. GoTrue's /user endpoint reads the live user
 * record, so roles administered in the panel apply immediately.
 *
 * Returns a roles array, or null when the live lookup could not be performed
 * (no token, GoTrue unreachable) — callers should fall back to the JWT
 * snapshot in that case: `(await fetchFreshRoles(event)) ?? jwtRoles`.
 */
export async function fetchFreshRoles(event, bodyToken = null) {
  if (process.env.NETLIFY_DEV === 'true') return [];
  const headerAuth = event.headers?.authorization || event.headers?.Authorization;
  const authHeader = headerAuth || (bodyToken ? `Bearer ${bodyToken}` : null);
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const user = await goTrueUserLookup(authHeader);
  if (!user) return null;
  return Array.isArray(user.app_metadata?.roles) ? user.app_metadata.roles : [];
}

/**
 * Resolve a Bearer token against GoTrue's /user endpoint, trying each
 * candidate site origin in order. Returns the live GoTrue user record
 * (signature + expiry validated server-side) or null.
 */
async function goTrueUserLookup(authHeader) {
  // Candidate GoTrue base URLs, tried in order. The custom domain
  // (process.env.URL, e.g. https://next.pictos.net) works for EXTERNAL
  // requests but a function's own outbound fetch to it does NOT reach the
  // Identity addon — Netlify's edge returns a plain "Not Found" 404. The
  // canonical *.netlify.app origin routes /.netlify/identity/* reliably from
  // inside a function, so try it first, then fall back to the others.
  const bases = [];
  if (process.env.SITE_NAME) bases.push(`https://${process.env.SITE_NAME}.netlify.app`);
  if (process.env.DEPLOY_PRIME_URL) bases.push(process.env.DEPLOY_PRIME_URL);
  if (process.env.URL) bases.push(process.env.URL);
  const uniqueBases = [...new Set(bases)];

  if (uniqueBases.length === 0) {
    console.error('[identity] no site URL env (SITE_NAME/DEPLOY_PRIME_URL/URL); cannot verify');
    lastDiagnostic = 'no site URL env available';
    return null;
  }

  const headers = { Authorization: authHeader };
  const diagnostics = [];

  for (const base of uniqueBases) {
    const host = (() => { try { return new URL(base).host; } catch { return base; } })();
    // Cache-bust: the CDN does not vary on Authorization for this endpoint.
    const identityUrl = `${base}/.netlify/identity/user?_cb=${Date.now()}`;
    try {
      const res = await fetch(identityUrl, {
        headers,
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        // GoTrue reached and it rejected the token — definitive, stop here.
        const body = await res.text().catch(() => '');
        console.warn(`[identity] token rejected by GoTrue (${res.status}) @ ${host}: ${body.slice(0, 200)}`);
        lastDiagnostic = `rejected ${res.status} @ ${host}`;
        return null;
      }
      if (res.ok) {
        return await res.json();
      }
      // 404/5xx — this host did not route to GoTrue; try the next candidate.
      const body = await res.text().catch(() => '');
      const note = `${res.status} @ ${host} body=${body.slice(0, 80)}`;
      console.warn(`[identity] ${note}; trying next host`);
      diagnostics.push(note);
    } catch (err) {
      const note = `error @ ${host}: ${err.message}`;
      console.warn(`[identity] ${note}; trying next host`);
      diagnostics.push(note);
    }
  }

  lastDiagnostic = `all hosts failed: ${diagnostics.join(' | ')}`;
  console.error(`[identity] verification failed — ${lastDiagnostic}`);
  return null;
}
