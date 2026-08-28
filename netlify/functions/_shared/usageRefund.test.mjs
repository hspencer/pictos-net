import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundUnitsOnceInStore } from './usage.js';

function createStore(units) {
  let data = { units, first_call: '2026-08-25T00:00:00.000Z' };
  let revision = 1;
  return {
    async getWithMetadata() {
      return { data: structuredClone(data), etag: String(revision) };
    },
    async set(_key, value, { onlyIfMatch }) {
      if (onlyIfMatch !== String(revision)) return { modified: false };
      data = JSON.parse(value);
      revision++;
      return { modified: true, etag: String(revision) };
    },
    value() { return structuredClone(data); },
  };
}

test('records the refund atomically and applies an idempotency key once', async () => {
  const store = createStore(5);

  assert.equal(await refundUnitsOnceInStore(
    store, 'quota/user/day', 'user@example.com', 2, 'batch:123', 'external_provider_quota',
  ), true);
  assert.equal(await refundUnitsOnceInStore(
    store, 'quota/user/day', 'user@example.com', 2, 'batch:123', 'external_provider_quota',
  ), true);

  assert.equal(store.value().units, 3);
  assert.deepEqual(store.value().applied_refunds.map(refund => refund.id), ['batch:123']);
});
