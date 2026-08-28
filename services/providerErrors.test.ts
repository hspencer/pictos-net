import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerErrorFromPayload, isUnmanagedGatewayFailure, ProviderRequestError, ExternalProviderQuotaError, QuotaExceededError } from './providerErrors.ts';

test('billing 429 remains nonretryable across synchronous and background payloads', () => {
  for (const status of [429, undefined]) {
    const error = providerErrorFromPayload({ error: 'Insufficient credits', failureSource: 'external_provider_billing',
      provider: 'recraft', providerStatus: 429, requestId: 'ref1', attempts: 2, retryable: true }, { provider: 'unknown', status });
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.retryable, false);
    assert.equal(error.provider, 'recraft');
    assert.equal(error.providerStatus, 429);
    assert.equal(error.requestId, 'ref1');
    assert.equal(error.attempts, 2);
  }
});

test('internal quota and capacity quota remain distinguishable, preserving wait guidance', () => {
  assert.ok(providerErrorFromPayload({ quotaExceeded: true, units_used: 3, limit: 3 }, { provider: 'gemini' }) instanceof QuotaExceededError);
  const error = providerErrorFromPayload({ failureSource: 'external_provider_quota', retryAfterMs: 90000, attempts: 3 },
    { provider: 'gemini', model: 'gemini-2.5-pro', requestId: 'job1' });
  assert.ok(error instanceof ExternalProviderQuotaError);
  assert.equal(error.retryAfterMs, 90000);
  assert.equal(error.model, 'gemini-2.5-pro');
  assert.equal(error.attempts, 3);
});

test('client retries only bare gateway failures and never amplifies managed failures', () => {
  assert.equal(isUnmanagedGatewayFailure(503, {}), true);
  assert.equal(isUnmanagedGatewayFailure(503, { retryManaged: true }), false);
  assert.equal(isUnmanagedGatewayFailure(502, { provider: 'openai' }), false);
  assert.equal(isUnmanagedGatewayFailure(504, { failureSource: 'external_provider_timeout' }), false);
  assert.equal(isUnmanagedGatewayFailure(429, {}), false);
});
