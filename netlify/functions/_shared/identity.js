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

const IDENTITY_TIMEOUT_MS = 5000;
const IDENTITY_RETRY_DELAY_MS = 1000;

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

  const siteUrl = process.env.URL;
  if (!siteUrl) {
    console.error('[identity] process.env.URL not set; cannot verify token');
    return null;
  }

  // Cache-bust to prevent Netlify CDN from serving a stale 401 response:
  // the CDN does not vary on Authorization for this endpoint.
  const identityUrl = `${siteUrl}/.netlify/identity/user?_cb=${Date.now()}`;
  const headers = { Authorization: authHeader };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(identityUrl, {
        headers,
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        // Definitive rejection — no point retrying.
        const body = await res.text().catch(() => '');
        console.warn(`[identity] token rejected by GoTrue (${res.status}): ${body.slice(0, 200)}`);
        return null;
      }
      if (!res.ok) {
        // Diagnostic: capture host + body to distinguish a routing/URL 404
        // (HTML "Not Found") from a GoTrue user-not-found 404 (JSON msg).
        const diagBody = await res.text().catch(() => '');
        let diagHost = 'invalid';
        try { diagHost = new URL(identityUrl).host; } catch {}
        // 5xx or unexpected — retry once before giving up.
        if (attempt === 0) {
          console.warn(`[identity] GoTrue ${res.status} host=${diagHost} body=${diagBody.slice(0, 200)}; retrying…`);
          await new Promise(r => setTimeout(r, IDENTITY_RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[identity] GoTrue ${res.status} host=${diagHost} body=${diagBody.slice(0, 200)} on retry`);
        return null;
      }
      return await res.json();
    } catch (err) {
      // Timeout or network error — retry once.
      if (attempt === 0) {
        console.warn(`[identity] verification error (${err.message}), retrying…`);
        await new Promise(r => setTimeout(r, IDENTITY_RETRY_DELAY_MS));
        continue;
      }
      console.error('[identity] verification failed after retry:', err.message);
      return null;
    }
  }
  return null;
}
