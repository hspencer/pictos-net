import { MODEL_CATALOG as PROVIDER_MODELS } from './modelCatalog.js';
/**
 * Usage tracking and quota enforcement for PictoNet Netlify Functions.
 *
 * Uses Netlify Blobs (no external service required).
 *
 * Quota model:
 *   - Each api-recraft call          = 1 unit  (one generated pictogram)
 *   - All api-claude calls           = 0 units (phases 1+2+5, not counted)
 *   - Default daily limit: DAILY_LIMIT_PER_USER env var (default: 50)
 *
 * Blob schema:
 *   Store: "pictonet-usage"
 *   quota/{email}/{YYYY-MM-DD}         → { units, first_call, last_call }
 *   audit/{YYYY-MM-DD}/{ts-safe-email} → { ts, email, phase, model, units_charged,
 *                                          ms, tokens_in, tokens_out, ok, error_msg }
 */

import { getBlobStore as getStore } from './blobs.js';

export const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT_PER_USER ?? '50', 10);
const STORE_NAME = 'pictonet-usage';

/**
 * Friendly label + description + pipeline phase for every model id that
 * logCall() has ever recorded (see grep across api-claude.js,
 * api-recraft-worker-background.js, api-gemini-worker-background.js,
 * api-gemini-structure.js, api-batch-create.js). Used only for admin
 * reporting — never referenced by the generation pipeline itself.
 */
export const MODEL_CATALOG = Object.fromEntries(Object.entries(PROVIDER_MODELS).map(([id, model]) => [id, {
  label: model.label,
  phaseLabel: model.phases.map(phase => ({ 1: 'Comprender', 2: 'Componer', 3: 'Producir', 5: 'Estructurar' })[phase]).join(' + '),
  description: model.pricing.kind === 'tokens'
    ? 'API de texto/visión; coste según tokens reales, sin unidades internas de PictoNet'
    : model.output === 'vector' ? 'Generación de SVG nativo (fase 3)' : 'Generación de imagen bitmap (fase 3)',
}]));

function modelInfo(model) {
  return MODEL_CATALOG[model] ?? { label: model || 'desconocido', phaseLabel: '—', description: '' };
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** YYYY-MM-DD strings from `from` to `to` inclusive. */
function dateRange(from, to) {
  const dates = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** List every blob under a prefix, following pagination cursors. */
async function listAll(store, prefix) {
  const all = [];
  let cursor;
  do {
    const page = await store.list({ prefix, cursor });
    all.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return all;
}

function safeEmail(email) {
  return email.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 80);
}

/**
 * Check quota and increment if allowed.
 *
 * @param {string}   email  - user email (use 'dev' for local dev, always allowed)
 * @param {number}   units  - units to charge (0 = log only, no quota impact)
 * @param {string[]} roles  - Netlify Identity roles from app_metadata.roles
 * @returns {{ allowed: boolean, units_used: number, limit: number }}
 */
export async function checkAndCharge(email, units = 1, roles = []) {
  // Dev mode or anonymous: always allow, no tracking
  if (!email || email === 'dev') {
    return { allowed: true, units_used: 0, limit: DAILY_LIMIT };
  }

  // Superusers bypass the daily quota entirely
  if (Array.isArray(roles) && roles.includes('superuser')) {
    return { allowed: true, units_used: 0, limit: Infinity };
  }

  if (units === 0) {
    return { allowed: true, units_used: 0, limit: DAILY_LIMIT };
  }

  const store = getStore(STORE_NAME);
  const date = today();
  const key = `quota/${email}/${date}`;

  let current = { units: 0, first_call: null, last_call: null };
  try {
    current = await store.get(key, { type: 'json' }) ?? current;
  } catch {
    // Blob not found → first call today
  }

  if (current.units + units > DAILY_LIMIT) {
    return { allowed: false, units_used: current.units, limit: DAILY_LIMIT };
  }

  const updated = {
    units: current.units + units,
    first_call: current.first_call ?? new Date().toISOString(),
    last_call: new Date().toISOString(),
  };

  try {
    await store.set(key, JSON.stringify(updated));
  } catch (err) {
    // Don't block the request if the write fails — log and continue
    console.error(`[usage] quota write failed for ${email}:`, err.message);
  }

  return { allowed: true, units_used: updated.units, limit: DAILY_LIMIT };
}

/**
 * Return previously charged units when work never actually ran (e.g. a batch
 * worker failed to start after an up-front charge). Floor at 0; failures are
 * logged and swallowed — a missed refund must never break the error path.
 */
export async function refundUnits(email, units) {
  if (!email || email === 'dev' || !(units > 0)) return true;
  const store = getStore(STORE_NAME);
  const key = `quota/${email}/${today()}`;
  try {
    const current = await store.get(key, { type: 'json' });
    if (!current) return true;
    await store.set(key, JSON.stringify({
      ...current,
      units: Math.max(0, (current.units ?? 0) - units),
      last_call: new Date().toISOString(),
    }));
    return true;
  } catch (err) {
    console.error(`[usage] refund failed for ${email}:`, err.message);
    return false;
  }
}

/**
 * Apply a refund once for a stable generation or batch idempotency key.
 *
 * The refund id is persisted in the same quota blob as the decremented unit
 * count. `onlyIfMatch` makes both changes one atomic conditional write, so two
 * workers racing with the same id cannot both refund it.
 */
export async function refundUnitsOnce(email, units, idempotencyKey, reason = 'provider_error') {
  if (!idempotencyKey || !(units > 0)) return false;
  if (!email || email === 'dev') return true;

  const store = getStore(STORE_NAME);
  const key = `quota/${email}/${today()}`;
  const refundId = String(idempotencyKey).replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 160);

  return refundUnitsOnceInStore(store, key, email, units, refundId, reason);
}

/** @internal Exported for deterministic unit testing without Netlify. */
export async function refundUnitsOnceInStore(store, key, email, units, refundId, reason) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const snapshot = await store.getWithMetadata(key, { type: 'json' });
      if (!snapshot) return true;

      const appliedRefunds = Array.isArray(snapshot.data?.applied_refunds)
        ? snapshot.data.applied_refunds
        : [];
      if (appliedRefunds.some(refund => refund?.id === refundId)) return true;

      const appliedAt = new Date().toISOString();
      const updated = {
        ...snapshot.data,
        units: Math.max(0, (snapshot.data?.units ?? 0) - units),
        last_call: appliedAt,
        applied_refunds: [...appliedRefunds, {
          id: refundId,
          units,
          reason,
          applied_at: appliedAt,
        }],
      };
      const result = await store.set(key, JSON.stringify(updated), {
        onlyIfMatch: snapshot.etag,
      });
      if (result.modified) return true;
    } catch (err) {
      console.error(`[usage] idempotent refund failed for ${email}:`, err.message);
      return false;
    }
  }

  console.error(`[usage] idempotent refund conflicted repeatedly for ${email}`);
  return false;
}

/**
 * Record an API call for audit purposes.
 * Non-blocking — failures are logged but never thrown.
 *
 * @param {{ email, phase, model, units_charged, ms, tokens_in, tokens_out, ok, error_msg }} record
 */
export async function logCall(record) {
  try {
    const store = getStore(STORE_NAME);
    const ts = new Date().toISOString();
    const date = ts.slice(0, 10);
    // Unique key per call — no race condition on concurrent writes
    const tsKey = ts.slice(11, 23).replace(/[:.]/g, '-');
    const key = `audit/${date}/${tsKey}-${safeEmail(record.email ?? 'anon')}`;

    await store.set(key, JSON.stringify({ ts, ...record }));
  } catch (err) {
    console.error('[usage] audit log write failed:', err.message);
  }
}

/**
 * Return an aggregated usage report across a date range: per-user totals,
 * per-model totals (with catalog descriptions), and a weekday×hour heatmap
 * of call volume — the "time concentration" view for admin reporting.
 *
 * @param {{ from: string, to: string, email?: string }} params - YYYY-MM-DD bounds (inclusive)
 * @returns {Promise<{
 *   users: Record<string, {calls, units, errors, phases, models, first_call, last_call}>,
 *   models: Record<string, {calls, units, errors, totalMs, avgMs, label, phaseLabel, description}>,
 *   heatmap: number[][],  // [weekday 0-6][hour 0-23]
 *   byHour: number[],     // [hour 0-23]
 *   byWeekday: number[],  // [weekday 0-6], 0 = Sunday
 *   byDate: Record<string, {calls, units}>,  // YYYY-MM-DD -> totals, for daily charting
 * }>}
 */
export async function getRangeSummary({ from, to, email = null }) {
  const store = getStore(STORE_NAME);
  const dates = dateRange(from, to);

  const byUser = {};
  const byModel = {};
  const byDate = {};
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  const byHour = Array(24).fill(0);
  const byWeekday = Array(7).fill(0);

  for (const date of dates) {
    byDate[date] = { calls: 0, units: 0 };
    const blobs = await listAll(store, `audit/${date}/`);
    for (const blob of blobs) {
      let record;
      try {
        record = await store.get(blob.key, { type: 'json' });
      } catch {
        continue;
      }
      if (!record) continue;

      const { ts, email: recEmail, phase, model, units_charged = 0, ms = 0, ok } = record;
      if (email && recEmail !== email) continue;

      byDate[date].calls++;
      byDate[date].units += units_charged;

      if (!byUser[recEmail]) {
        byUser[recEmail] = { calls: 0, units: 0, phases: {}, models: {}, errors: 0, first_call: ts, last_call: ts };
      }
      const u = byUser[recEmail];
      u.calls++;
      u.units += units_charged;
      u.phases[phase] = (u.phases[phase] ?? 0) + 1;
      u.models[model] = (u.models[model] ?? 0) + 1;
      if (!ok) u.errors++;
      if (ts < u.first_call) u.first_call = ts;
      if (ts > u.last_call) u.last_call = ts;

      if (!byModel[model]) byModel[model] = { calls: 0, units: 0, errors: 0, totalMs: 0 };
      const m = byModel[model];
      m.calls++;
      m.units += units_charged;
      m.totalMs += ms;
      if (!ok) m.errors++;

      const when = new Date(ts);
      const hour = when.getUTCHours();
      const weekday = when.getUTCDay();
      heatmap[weekday][hour]++;
      byHour[hour]++;
      byWeekday[weekday]++;
    }
  }

  for (const [model, m] of Object.entries(byModel)) {
    m.avgMs = m.calls > 0 ? Math.round(m.totalMs / m.calls) : 0;
    Object.assign(m, modelInfo(model));
  }

  return { users: byUser, models: byModel, heatmap, byHour, byWeekday, byDate };
}

/**
 * Return raw quota entry for a user on a given date.
 * Useful for admin inspection.
 *
 * @param {string} email
 * @param {string} [date]
 */
export async function getUserQuota(email, date = today()) {
  const store = getStore(STORE_NAME);
  try {
    return await store.get(`quota/${email}/${date}`, { type: 'json' });
  } catch {
    return null;
  }
}
