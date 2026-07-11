/**
 * Shared Netlify Identity verification.
 *
 * Used by: api-gemini-worker-background.js and api-recraft-worker-background.js.
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
 *   3. Authorization: Bearer <token> → GET {URL}/.netlify/identity/user.
 *      GoTrue validates signature + expiry server-side and returns the user.
 *
 * Returns a GoTrue user object ({ email, app_metadata, user_metadata, … })
 * or null when the token is missing, forged, or expired.
 */
export async function verifyIdentityUser(event, context) {
  if (process.env.NETLIFY_DEV === 'true') {
    return { email: 'dev', app_metadata: {} };
  }

  if (context?.clientContext?.user) {
    return context.clientContext.user;
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const siteUrl = process.env.URL;
  if (!siteUrl) {
    console.error('[identity] process.env.URL not set; cannot verify token');
    return null;
  }

  const identityUrl = `${siteUrl}/.netlify/identity/user`;
  const headers = { Authorization: authHeader };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(identityUrl, {
        headers,
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        // Definitive rejection — no point retrying.
        console.warn(`[identity] token rejected by GoTrue (${res.status})`);
        return null;
      }
      if (!res.ok) {
        // 5xx or unexpected — retry once before giving up.
        if (attempt === 0) {
          console.warn(`[identity] GoTrue returned ${res.status}, retrying…`);
          await new Promise(r => setTimeout(r, IDENTITY_RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[identity] GoTrue returned ${res.status} on retry`);
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
