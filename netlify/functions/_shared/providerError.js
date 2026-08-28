const TRANSIENT_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const BILLING_CODES = new Set([
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'billing_hard_limit_reached', 'billing_not_active',
]);

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || String(value).trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function isHardBillingError(error) {
  // SDKs can wrap the provider's error envelope one additional time.
  return [error, error?.error, error?.error?.error]
    .some(detail => BILLING_CODES.has(detail?.code) || BILLING_CODES.has(detail?.type));
}

/** Normalize provider SDK errors; credentials and request payloads are not read. */
export function providerErrorDetails(error, { provider, requestId } = {}) {
  const status = Number(error?.status ?? error?.statusCode) || null;
  const message = error?.message || 'Provider request failed';
  const cause = [error?.cause?.code, error?.cause?.message].filter(Boolean).join(' ');
  const transportFailure = error?.name === 'TimeoutError' || /timed?\s*out|timeout|fetch failed|connection|socket|ECONN|ENET|EAI_AGAIN/i.test(`${message} ${cause}`);
  return {
    provider: provider || error?.provider || 'unknown',
    providerStatus: status,
    requestId: error?.request_id || header(error?.headers, 'x-request-id') || header(error?.headers, 'request-id') || requestId || null,
    retryable: !isHardBillingError(error) && error?.name !== 'AbortError' && (status ? TRANSIENT_STATUSES.has(status) : transportFailure),
    retryAfterMs: parseRetryAfter(header(error?.headers, 'retry-after')),
    message: cause ? `${message} — cause: ${cause}` : message,
  };
}

/** Preserve HTTP classification without copying a provider body that may echo prompts. */
export async function providerHttpError(response, provider, requestId) {
  const data = await response.json().catch(() => ({}));
  const detail = data.error ?? data;
  const rawCode = detail.code ?? detail.status;
  const code = typeof rawCode === 'string' && /^[a-zA-Z_][a-zA-Z_0-9-]{0,100}$/.test(rawCode) ? rawCode : null;
  const type = typeof detail.type === 'string' && /^[a-z_]{1,100}$/.test(detail.type) ? detail.type : null;
  return Object.assign(new Error(`${provider} ${response.status}${code ? `: ${code}` : ''}`), {
    status: response.status, headers: response.headers, code, type, provider,
    request_id: header(response.headers, 'x-request-id') || header(response.headers, 'request-id') || requestId,
    attempts: response.attempts ?? 1,
  });
}

export function providerFailure(error, context = {}) {
  const details = providerErrorDetails(error, context);
  const { message, ...metadata } = details;
  const failureSource = isHardBillingError(error) ? 'external_provider_billing'
    : details.providerStatus === 429 ? 'external_provider_quota' : 'provider_error';
  return {
    error: message, ...metadata,
    attempts: error?.attempts ?? 1, retryManaged: true, failureSource,
  };
}
