import { isHardBillingError, parseRetryAfter } from './providerError.js';

export function describeFetchError(error) {
  const parts = [error?.message || 'Unknown error'];
  const cause = error?.cause;
  if (cause) {
    const detail = [cause.code || cause.errno, cause.message].filter(Boolean).join(' ');
    if (detail) parts.push(`cause: ${detail}`);
  }
  return parts.join(' — ');
}

// Promise.race alone leaves abort listeners behind; remove them after each stage.
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * One finite budget covers fetch, full response body, progress and backoff.
 * Provider Retry-After is never shortened. Explicit cancellation and ambiguous
 * POST transport failures are not replayed; GET transport retries remain bounded.
 * No provider, model, region or credential fallback occurs here.
 */
export async function fetchWithRetry(url, options = {}, {
  retries = 2, baseDelayMs = 600, retryOn429 = false, maxTotalMs = Infinity,
  onRetry = null, retryTransport = (options.method || 'GET').toUpperCase() === 'GET',
} = {}) {
  const startedAt = Date.now();
  if (maxTotalMs <= 0) throw new DOMException('Provider request deadline exceeded', 'TimeoutError');
  const controller = new AbortController();
  const externalAbort = () => controller.abort(options.signal.reason);
  if (options.signal?.aborted) throw options.signal.reason;
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  const timer = Number.isFinite(maxTotalMs)
    ? setTimeout(() => controller.abort(new DOMException('Provider request deadline exceeded', 'TimeoutError')), Math.max(0, maxTotalMs)) : null;
  const signal = controller.signal;
  let attempts = 0;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal.aborted) throw signal.reason;
      attempts++;
      let response;
      let transportError;
      try {
        const upstream = await abortable(fetch(url, { ...options, signal }), signal);
        // These callers consume complete JSON/images, never a streaming API.
        // Buffering also keeps the deadline active while the response arrives.
        const bytes = await abortable(upstream.arrayBuffer(), signal);
        response = new Response([101, 204, 205, 304].includes(upstream.status) ? null : bytes, {
          status: upstream.status, statusText: upstream.statusText, headers: upstream.headers,
        });
        Object.defineProperties(response, {
          url: { value: upstream.url }, redirected: { value: upstream.redirected }, attempts: { value: attempts },
        });
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError' || !retryTransport) throw error;
        transportError = error;
      }
      let retryable = !!transportError || (response.status >= 500 && response.status < 600) || (retryOn429 && response.status === 429);
      if (response?.status === 429 && isHardBillingError(await response.clone().json().catch(() => ({})))) retryable = false;
      if (!retryable || attempt === retries) {
        if (transportError) throw transportError;
        return response;
      }
      const backoff = Math.min(baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.25), 30000);
      const requestedWait = response ? parseRetryAfter(response.headers.get('retry-after')) : null;
      const wait = Math.max(backoff, requestedWait ?? 0);
      if (Date.now() - startedAt + wait >= maxTotalMs) {
        if (transportError) throw transportError;
        return response;
      }
      if (onRetry) {
        try { await abortable(Promise.resolve(onRetry(attempt + 1, retries, wait, response?.status ?? 0)), signal); }
        catch (error) { if (signal.aborted) throw error; /* progress only */ }
      }
      let waitTimer;
      try { await abortable(new Promise(resolve => { waitTimer = setTimeout(resolve, wait); }), signal); }
      finally { clearTimeout(waitTimer); }
    }
  } catch (error) {
    if (error && typeof error === 'object') error.attempts = attempts;
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}
