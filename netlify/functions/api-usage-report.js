/**
 * Netlify Function: Usage Report (admin only)
 *
 * Returns usage summary from Netlify Blobs, aggregated by user and by model,
 * plus a weekday×hour heatmap of call volume. Restricted to the site owner.
 *
 * GET /.netlify/functions/api-usage-report?date=YYYY-MM-DD        (single day, legacy)
 * GET /.netlify/functions/api-usage-report?from=YYYY-MM-DD&to=YYYY-MM-DD&email=...
 */

import { getRangeSummary, DAILY_LIMIT } from './_shared/usage.js';
import { connectBlobs } from './_shared/blobs.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const ALLOWED_ORIGINS = [
  'https://pictos.net',
  'https://next.pictos.net',
  'https://pictos-next.netlify.app',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

export const handler = async (event, context) => {
  connectBlobs(event);
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { user } = context.clientContext || {};
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  const authHeader = event.headers.authorization;

  // Permite acceso si envían una llave de API válida
  const hasValidApiKey = authHeader && process.env.ADMIN_API_KEY && authHeader === `Bearer ${process.env.ADMIN_API_KEY}`;
  
  // Permite acceso si está autenticado como administrador vía Netlify Identity
  const hasValidUser = user && user.email === ADMIN_EMAIL;

  if (!isLocalDev && !hasValidApiKey && !hasValidUser) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized. Requires valid Netlify Identity token or Bearer ADMIN_API_KEY.' }) };
  }

  const params = event.queryStringParameters || {};
  const today = new Date().toISOString().slice(0, 10);
  // `date` is a legacy single-day shorthand; `from`/`to` take precedence when present.
  const from = params.from || params.date || today;
  const to = params.to || params.date || today;
  const email = params.email || null;

  const dateFmt = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateFmt.test(from) || !dateFmt.test(to)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' }) };
  }
  if (from > to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '`from` must not be after `to`' }) };
  }

  try {
    const { users, models, heatmap, byHour, byWeekday, byDate } = await getRangeSummary({ from, to, email });
    const totalCalls = Object.values(users).reduce((s, u) => s + u.calls, 0);
    const totalUnits = Object.values(users).reduce((s, u) => s + u.units, 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        from,
        to,
        daily_limit: DAILY_LIMIT,
        total_calls: totalCalls,
        total_units: totalUnits,
        users,
        models,
        heatmap,
        byHour,
        byWeekday,
        byDate,
      }),
    };
  } catch (error) {
    console.error('[api-usage-report] Error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
