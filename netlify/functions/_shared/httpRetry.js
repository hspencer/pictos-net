/**
 * Resilient fetch helpers shared by the image-generation background workers
 * (api-gemini-worker-background.js — Vertex AI, and
 *  api-recraft-worker-background.js — Recraft).
 *
 * Why this exists: occasionally the upstream generation call throws a bare
 * "fetch failed". That string is an undici transport-level TypeError (DNS,
 * IPv6/happy-eyeballs, or a dead keep-alive socket). The real reason is hidden
 * inside `error.cause`, so the previous catch blocks — which stored only
 * `error.message` — left us blind and surfaced the useless "fetch failed" to
 * the user. These helpers (1) retry transient transport failures with
 * exponential backoff and (2) flatten the error into a readable string that
 * preserves the underlying cause code (ECONNRESET, ENETUNREACH, UND_ERR_SOCKET).
 */

/**
 * Pause for `ms` milliseconds. Internal helper for fetchWithRetry's backoff.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Flatten a network/undici error into a human-readable string, keeping the
 * underlying `error.cause` (the part that actually says why the socket died).
 *
 * Used in the catch blocks of both image workers so logs and the client get
 * "fetch failed — cause: ENETUNREACH ..." instead of just "fetch failed".
 */
export function describeFetchError(error) {
  const parts = [error?.message || 'Unknown error'];
  const cause = error?.cause;
  if (cause) {
    const code = cause.code || cause.errno;
    const detail = [code, cause.message].filter(Boolean).join(' ');
    if (detail) parts.push(`cause: ${detail}`);
  }
  return parts.join(' — ');
}

/**
 * fetch() with retry + exponential backoff for transient failures.
 *
 * Retries on: network-level throws (the "fetch failed" TypeError) and upstream
 * 5xx responses. Does NOT retry 4xx (auth, quota, bad request) by default —
 * those are returned to the caller unchanged so existing handling still applies.
 *
 * `retryOn429: true` additionally retries HTTP 429 (RESOURCE_EXHAUSTED).
 * Rationale: Gemini image models on Vertex AI run on dynamic *shared* quota —
 * there is no per-project quota to raise, and transient 429s are expected
 * during bursts or global congestion. Google's own guidance is truncated
 * exponential backoff. The `Retry-After` header is honored when present, and
 * jitter de-synchronises parallel background workers so they don't all retry
 * at the same instant. Waits are capped at 30s per attempt.
 *
 * Used by both image workers for the upstream generation request (and, in the
 * Recraft worker, the CDN image download).
 *
 * `maxTotalMs` is a hard time budget for the whole retry dance: when the next
 * wait would exceed it, the last upstream response is returned immediately so
 * the caller can surface a terminal error. This guarantees the background
 * workers always write a result to the blob store BEFORE the browser client
 * stops polling — without it, a long Retry-After chain leaves the user staring
 * at an infinite spinner (silent failure).
 *
 * `onRetry(attempt, retries, waitMs, status)` fires before each backoff wait;
 * the workers use it to publish retry progress into the job blob so the UI
 * can show "provider saturated, retry 2/4" instead of a mute spinner.
 *
 * @param {string} url
 * @param {RequestInit} options    Standard fetch options.
 * @param {{retries?: number, baseDelayMs?: number, retryOn429?: boolean, maxTotalMs?: number, onRetry?: (attempt: number, retries: number, waitMs: number, status: number) => Promise<void> | void}} cfg
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options, { retries = 2, baseDelayMs = 600, retryOn429 = false, maxTotalMs = Infinity, onRetry = null } = {}) {
  const startedAt = Date.now();
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Retry transient upstream 5xx (and 429 when opted in); return
      // everything else to the caller.
      const retryable = (res.status >= 500 && res.status < 600) || (retryOn429 && res.status === 429);
      if (retryable && attempt < retries) {
        lastError = new Error(`Upstream ${res.status}`);
        const retryAfterSec = Number(res.headers.get('retry-after'));
        const backoff = baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.25);
        const wait = Math.min(retryAfterSec > 0 ? retryAfterSec * 1000 : backoff, 30000);
        // Budget exhausted → hand the response back so the caller reports a
        // terminal error while the client is still polling.
        if (Date.now() - startedAt + wait > maxTotalMs) {
          console.warn(`[httpRetry] upstream ${res.status}, retry budget exhausted (${maxTotalMs}ms) — returning last response`);
          return res;
        }
        console.warn(`[httpRetry] upstream ${res.status}, retry ${attempt + 1}/${retries} in ${Math.round(wait)}ms`);
        if (onRetry) { try { await onRetry(attempt + 1, retries, wait, res.status); } catch { /* progress is best-effort */ } }
        await delay(wait);
        continue;
      }
      return res;
    } catch (error) {
      // Transport-level failure (DNS/IPv6/socket). Back off and retry.
      lastError = error;
      if (attempt < retries) {
        await delay(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
