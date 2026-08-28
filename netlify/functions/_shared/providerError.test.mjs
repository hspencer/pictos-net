import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerErrorDetails } from './providerError.js';

test('classifies transient provider errors and preserves correlation metadata', () => {
  const details = providerErrorDetails({
    status: 500,
    message: 'Internal Server Error',
    request_id: 'anthropic-123',
    headers: { 'retry-after': '2' },
  }, { provider: 'anthropic', requestId: 'client-123' });

  assert.deepEqual(details, {
    provider: 'anthropic',
    providerStatus: 500,
    requestId: 'anthropic-123',
    retryable: true,
    retryAfterMs: 2000,
    message: 'Internal Server Error',
  });
});

test('classifies transport timeouts without an HTTP status as retryable', () => {
  const details = providerErrorDetails(
    { message: 'Request timed out.', cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } },
    { provider: 'anthropic', requestId: 'client-456' },
  );

  assert.equal(details.providerStatus, null);
  assert.equal(details.requestId, 'client-456');
  assert.equal(details.retryable, true);
  assert.match(details.message, /UND_ERR_CONNECT_TIMEOUT/);
});

test('does not retry validation failures', () => {
  const details = providerErrorDetails(
    { status: 400, message: 'Invalid tool schema' },
    { provider: 'anthropic' },
  );

  assert.equal(details.retryable, false);
});


test('supports HTTP-date Retry-After and case-insensitive request correlation', async () => {
  const { parseRetryAfter } = await import('./providerError.js');
  const now = Date.parse('2026-08-27T12:00:00Z');
  assert.equal(parseRetryAfter('Thu, 27 Aug 2026 12:00:45 GMT', now), 45000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('-1', now), null);
  assert.equal(parseRetryAfter('not-a-date', now), null);
  assert.equal(providerErrorDetails({ status: 429, headers: { 'X-Request-ID': 'actual' } }).requestId, 'actual');
});

test('hard billing is distinct from transient capacity, and provider body echoes are not exposed', async () => {
  const { providerHttpError, providerFailure } = await import('./providerError.js');
  for (const code of ['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'insufficient_quota']) {
    const response = Response.json({ error: { code, message: 'PRIVATE PROMPT AND KEY' } }, { status: 429 });
    const error = await providerHttpError(response, 'openai', 'local-request');
    const failure = providerFailure(error);
    assert.equal(failure.failureSource, 'external_provider_billing');
    assert.equal(failure.retryable, false);
    assert.equal(failure.providerStatus, 429);
    assert.equal(failure.retryManaged, true);
    assert.doesNotMatch(failure.error, /PRIVATE/);
  }
  const capacity = providerFailure(await providerHttpError(Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }), 'gemini'));
  assert.equal(capacity.failureSource, 'external_provider_quota');
  assert.equal(capacity.retryable, true);
});

test('keeps a CDN failure attributed to the CDN, not the generation account', async () => {
  const { providerFailure } = await import('./providerError.js');
  const error = Object.assign(new Error('Recraft CDN 429'), { provider: 'recraft-cdn', status: 429 });
  const failure = providerFailure(error, { provider: error.provider || 'recraft' });
  assert.equal(failure.provider, 'recraft-cdn');
  assert.equal(failure.providerStatus, 429);
});
