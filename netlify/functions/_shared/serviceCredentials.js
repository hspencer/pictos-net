/**
 * Machine credentials for the /api/v1 process endpoints.
 *
 * A credential is `pk_<keyId>_<secret>`. Only sha256(secret) is stored, in the
 * `service-credentials` blob store under `keys/<keyId>`, next to the service
 * principal it acts for, its scopes and its daily call limit. Revoking sets
 * `revoked_at`; it applies to the next request, no deploy needed.
 * Secrets are never in Git, env files shipped to the browser, or logs: they are
 * printed once by scripts/service-credentials.mjs and kept by the caller.
 * Under `netlify dev` a token in PICTOS_DEV_SERVICE_TOKEN (.env) is also
 * accepted, as principal service:dev; it is ignored everywhere else.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getBlobStore } from './blobs.js';

export const CREDENTIALS_STORE = 'service-credentials';
export const SERVICE_QUOTA_STORE = 'pictonet-usage';
export const PRINCIPAL_PATTERN = /^service:[a-z0-9][a-z0-9-]{0,39}$/;
export const V1_SCOPES = ['comprender', 'componer'];
const TOKEN_PATTERN = /^pk_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export function hashSecret(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function parseServiceToken(token) {
  const match = typeof token === 'string' ? TOKEN_PATTERN.exec(token.trim()) : null;
  return match ? { keyId: match[1], secret: match[2] } : null;
}

/** Accept `Authorization: Bearer pk_…` or `X-Pictos-Key: pk_…`. */
export function presentedToken(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const bearer = /^Bearer\s+(\S+)$/i.exec(lower.authorization ?? '')?.[1];
  return bearer ?? lower['x-pictos-key'] ?? null;
}

export function mintServiceToken() {
  const keyId = Array.from(randomBytes(12), byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
  const secret = randomBytes(32).toString('base64url');
  return { keyId, secret, token: `pk_${keyId}_${secret}` };
}

export function credentialRecord({ keyId, secret, principal, label = '', scopes = V1_SCOPES, dailyCallLimit = 200, now = new Date() }) {
  if (!PRINCIPAL_PATTERN.test(principal)) throw new Error(`Invalid service principal: ${principal} (expected service:<name>)`);
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope => !V1_SCOPES.includes(scope))) throw new Error('Invalid scopes');
  if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 0) throw new Error('dailyCallLimit must be a non-negative integer');
  return {
    key_id: keyId, principal, label, scopes: [...scopes], daily_call_limit: dailyCallLimit,
    secret_sha256: hashSecret(secret), created_at: now.toISOString(), revoked_at: null,
  };
}

/**
 * Resolve the presented credential. Unknown, malformed, mismatched and revoked
 * credentials all answer `unauthorized` so a caller cannot probe key ids.
 */
export async function verifyServiceCredential(headers, { store = getBlobStore(CREDENTIALS_STORE) } = {}) {
  const parsed = parseServiceToken(presentedToken(headers));
  if (!parsed) return { ok: false };
  const devToken = process.env.NETLIFY_DEV === 'true' ? parseServiceToken(process.env.PICTOS_DEV_SERVICE_TOKEN) : null;
  if (devToken && devToken.keyId === parsed.keyId) {
    // Local `netlify dev` only: the token lives in the gitignored .env.
    const same = timingSafeEqual(Buffer.from(hashSecret(devToken.secret), 'hex'), Buffer.from(hashSecret(parsed.secret), 'hex'));
    return same ? { ok: true, keyId: 'dev', principal: 'service:dev', scopes: [...V1_SCOPES], dailyCallLimit: 1000 } : { ok: false };
  }
  const record = await store.get(`keys/${parsed.keyId}`, { type: 'json', consistency: 'strong' }).catch(() => null);
  if (!record || typeof record.secret_sha256 !== 'string' || record.revoked_at) return { ok: false };
  const expected = Buffer.from(record.secret_sha256, 'hex');
  const actual = Buffer.from(hashSecret(parsed.secret), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false };
  return {
    ok: true, keyId: record.key_id, principal: record.principal,
    scopes: record.scopes ?? [], dailyCallLimit: record.daily_call_limit ?? 0,
  };
}

/**
 * Count one executed call against the principal's UTC-day limit. Blobs have no
 * atomic increment, so concurrent calls can overshoot by the concurrency level;
 * the limit bounds cost, it is not an exact meter.
 */
export async function chargeServiceCall(principal, limit, { store = getBlobStore(SERVICE_QUOTA_STORE), now = new Date() } = {}) {
  const key = `service-quota/${principal}/${now.toISOString().slice(0, 10)}`;
  const current = await store.get(key, { type: 'json' }).catch(() => null) ?? { calls: 0 };
  if (current.calls + 1 > limit) return { allowed: false, used: current.calls, limit };
  const updated = { calls: current.calls + 1, first_call: current.first_call ?? now.toISOString(), last_call: now.toISOString() };
  await store.set(key, JSON.stringify(updated));
  return { allowed: true, used: updated.calls, limit };
}
