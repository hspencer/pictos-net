/** Error vocabulary shared by synchronous requests and every background poll. */
export class QuotaExceededError extends Error {
  readonly units_used: number;
  readonly limit: number;
  constructor(units_used: number, limit: number) {
    super('Daily quota exceeded');
    this.name = 'QuotaExceededError';
    this.units_used = units_used;
    this.limit = limit;
  }
}

export class ExternalProviderQuotaError extends Error {
  readonly provider: string;
  readonly model?: string;
  readonly requestId?: string;
  readonly retryAfterMs: number | null;
  readonly attempts: number;
  constructor(provider: string, model?: string, requestId?: string, retryAfterMs: number | null = null, attempts = 1) {
    super(`External provider quota exhausted${requestId ? ` (ref ${requestId})` : ''}`);
    this.name = 'ExternalProviderQuotaError';
    Object.assign(this, { provider, model, requestId, retryAfterMs, attempts });
  }
}

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly providerStatus: number | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly attempts: number;
  readonly failureSource?: string;
  constructor(message: string, provider: string, providerStatus: number | null, requestId: string | null,
    retryable: boolean, retryAfterMs: number | null = null, attempts = 1, failureSource?: string) {
    super(`${message}${requestId ? ` (ref ${requestId})` : ''}`);
    this.name = 'ProviderRequestError';
    Object.assign(this, { provider, providerStatus, requestId, retryable, retryAfterMs, attempts, failureSource });
  }
}

export function providerErrorFromPayload(
  data: Record<string, any>,
  context: { provider: string; model?: string; status?: number; requestId?: string; attempts?: number },
): Error {
  if (data.quotaExceeded || data.failureSource === 'pictonet_user_quota') {
    return new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
  }
  const provider = data.provider ?? context.provider;
  const requestId = data.requestId ?? context.requestId;
  const attempts = data.attempts ?? context.attempts ?? 1;
  if (data.failureSource === 'external_provider_quota' ||
      (context.status === 429 && !data.failureSource)) {
    return new ExternalProviderQuotaError(provider, context.model, requestId, data.retryAfterMs ?? null, attempts);
  }
  return new ProviderRequestError(
    typeof data.error === 'string' ? data.error : `Provider request failed (${context.status ?? 'unknown'})`,
    provider, data.providerStatus ?? context.status ?? null, requestId ?? null,
    data.failureSource === 'external_provider_billing' ? false : data.retryable === true,
    data.retryAfterMs ?? null, attempts, data.failureSource,
  );
}

/** The server owns provider retries. Only an unclassified gateway response may be replayed. */
export function isUnmanagedGatewayFailure(status: number, data: Record<string, any>): boolean {
  return [502, 503, 504].includes(status) && !data.retryManaged && !data.provider && !data.failureSource;
}
