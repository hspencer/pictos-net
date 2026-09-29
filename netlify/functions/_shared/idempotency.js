/**
 * Idempotency for the /api/v1 process endpoints.
 *
 * Records live in the `api-idempotency` blob store under
 * `<principal>/<process>/<sha256(key)>` for 24 hours. Only successful results
 * are stored and replayed: a failure removes the in-flight marker so the same
 * key can be retried. Reusing a key with a different body is refused.
 * Blobs have no compare-and-set, so two truly simultaneous first requests can
 * both execute; the marker narrows that window, it does not close it.
 */

import { createHash } from 'node:crypto';
import { getBlobStore } from './blobs.js';
import { canonicalJson } from './pipelineContracts.js';

export const IDEMPOTENCY_STORE = 'api-idempotency';
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
// A marker older than the synchronous function limit belongs to a dead invocation.
const IN_FLIGHT_STALE_MS = 90_000;

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

export function requestFingerprint(body) {
  return sha256(canonicalJson(body));
}

function recordKey(principal, processName, key) {
  return `${principal}/${processName}/${sha256(key)}`;
}

/**
 * @returns {{ state: 'new' } | { state: 'replay', status: number, body: object }
 *   | { state: 'conflict' } | { state: 'in_progress' }}
 */
export async function beginIdempotent({ principal, processName, key, fingerprint, store = getBlobStore(IDEMPOTENCY_STORE), now = Date.now() }) {
  const blobKey = recordKey(principal, processName, key);
  const existing = await store.get(blobKey, { type: 'json', consistency: 'strong' }).catch(() => null);
  const live = existing && now - existing.created_at < IDEMPOTENCY_TTL_MS
    && !(existing.state === 'in_flight' && now - existing.created_at > IN_FLIGHT_STALE_MS);
  if (live) {
    if (existing.fingerprint !== fingerprint) return { state: 'conflict' };
    if (existing.state === 'in_flight') return { state: 'in_progress' };
    return { state: 'replay', status: existing.status, body: existing.body };
  }
  await store.setJSON(blobKey, { state: 'in_flight', fingerprint, created_at: now });
  return { state: 'new' };
}

export async function completeIdempotent({ principal, processName, key, fingerprint, status, body, store = getBlobStore(IDEMPOTENCY_STORE), now = Date.now() }) {
  await store.setJSON(recordKey(principal, processName, key), { state: 'done', fingerprint, created_at: now, status, body });
}

export async function abandonIdempotent({ principal, processName, key, store = getBlobStore(IDEMPOTENCY_STORE) }) {
  await store.delete(recordKey(principal, processName, key)).catch(() => {});
}
