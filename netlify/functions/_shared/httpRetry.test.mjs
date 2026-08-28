import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './httpRetry.js';

test('retries a transient 500 and returns the successful response', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => new Response('{}', { status: ++calls === 1 ? 500 : 200 });

  const response = await fetchWithRetry('https://provider.test', {}, { retries: 2, baseDelayMs: 0 });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('retries 429 only when provider-quota retry is enabled', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => new Response('{}', { status: ++calls === 1 ? 429 : 200 });

  const response = await fetchWithRetry('https://provider.test', {}, {
    retries: 1, baseDelayMs: 0, retryOn429: true,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('does not retry before a long Retry-After or beyond the deadline', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); };
  const response = await fetchWithRetry('https://provider.test', {}, { retries: 4, retryOn429: true, maxTotalMs: 50 });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test('does not retry an explicitly cancelled request', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => { calls++; throw controller.signal.reason; };
  await assert.rejects(fetchWithRetry('https://provider.test', { signal: controller.signal }, { baseDelayMs: 0 }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('hard budget bounds a hanging fetch and a hanging response body', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const bodyHangs of [false, true]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (!bodyHangs) return new Promise(() => {});
      return new Response(new ReadableStream({ start() {} }));
    };
    const result = await Promise.race([
      fetchWithRetry('https://provider.test', {}, { maxTotalMs: 20 }).then(() => 'unexpected-success', error => error.name),
      new Promise(resolve => setTimeout(() => resolve('deadline-not-enforced'), 150)),
    ]);
    assert.equal(result, 'TimeoutError');
    assert.equal(calls, 1);
  }
});

test('hard billing 429 is not retried even when capacity retry is enabled', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }, { status: 429 }); };
  const response = await fetchWithRetry('https://provider.test', {}, { retries: 3, retryOn429: true, baseDelayMs: 0, maxTotalMs: 100 });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test('transport backoff cannot overrun the remaining budget', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('fetch failed'); };
  await assert.rejects(fetchWithRetry('https://provider.test', {}, { retries: 3, baseDelayMs: 200, maxTotalMs: 20 }), /fetch failed/);
  assert.equal(calls, 1);
});
