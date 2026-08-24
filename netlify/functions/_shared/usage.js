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
export const MODEL_CATALOG = {
  'claude-haiku-4-5-20251001': { label: 'Claude Haiku 4.5', phaseLabel: 'Comprender + Componer', description: 'NLU y composición de elementos (fases 1-2), gratuito' },
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', phaseLabel: 'Estructurar', description: 'Visión + ensamblaje semántico (fase 5)' },
  'claude-opus-4-6': { label: 'Claude Opus 4.6', phaseLabel: 'Estructurar', description: 'Visión + ensamblaje semántico (fase 5), mayor calidad' },
  'gemini-2.5-pro': { label: 'Gemini 2.5 Pro', phaseLabel: 'Estructurar', description: 'Estructuración por visión (fase 5)' },
  'gemini-2.5-flash': { label: 'Gemini 2.5 Flash', phaseLabel: 'Estructurar', description: 'Estructuración por visión (fase 5), default' },
  'gemini-2.5-flash-image': { label: 'Gemini 2.5 Flash', phaseLabel: 'Producir', description: 'Generación de imagen (fase 3)' },
  'gemini-3.1-flash-image': { label: 'Gemini 3.1 Flash', phaseLabel: 'Producir', description: 'Generación de imagen (fase 3)' },
  'gemini-3-pro-image': { label: 'Gemini 3 Pro', phaseLabel: 'Producir', description: 'Generación de imagen (fase 3), cuota diaria baja' },
  'recraftv4_1': { label: 'Recraft (raster)', phaseLabel: 'Producir', description: 'Generación de imagen bitmap (fase 3)' },
  'recraftv4_1_vector': { label: 'Recraft (vector)', phaseLabel: 'Producir', description: 'Generación de SVG nativo (fase 3), default' },
  'recraftv4_1_utility_vector': { label: 'Recraft Utility (vector)', phaseLabel: 'Producir', description: 'SVG nativo, variante simple y predecible (fase 3)' },
  'recraftv4_1_pro_vector': { label: 'Recraft Pro (vector)', phaseLabel: 'Producir', description: 'SVG nativo de mayor resolución (fase 3)' },
};

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

  if (current.units >= DAILY_LIMIT) {
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
  if (!email || email === 'dev' || !(units > 0)) return;
  const store = getStore(STORE_NAME);
  const key = `quota/${email}/${today()}`;
  try {
    const current = await store.get(key, { type: 'json' });
    if (!current) return;
    await store.set(key, JSON.stringify({
      ...current,
      units: Math.max(0, (current.units ?? 0) - units),
      last_call: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`[usage] refund failed for ${email}:`, err.message);
  }
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
