/**
 * Netlify Function: Share Pictogram
 * Sends pictogram data to hspencer/pictogram-collector via GitHub Dispatches.
 * Requires Netlify Identity JWT.
 */

const ALLOWED_ORIGINS = [
  'https://pictos.net',
  'https://pictos-next.netlify.app',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export const handler = async (event, context) => {
  const origin = event.headers?.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth: require Netlify Identity JWT
  const { user } = context.clientContext || {};
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Validate payload size
  if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('[share-pictogram] GITHUB_TOKEN not configured');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const payload = JSON.parse(event.body);

    // Minimal validation
    if (!payload.UTTERANCE || !payload.id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: id, UTTERANCE' }) };
    }

    console.log(`[share-pictogram] user=${user.email} utterance="${payload.UTTERANCE}"`);

    const response = await fetch('https://api.github.com/repos/hspencer/pictogram-collector/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PICTOS-Netlify-Function',
      },
      body: JSON.stringify({
        event_type: 'append-row',
        client_payload: payload,
      }),
    });

    if (!response.ok) {
      console.error(`[share-pictogram] GitHub API ${response.status}`);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Upstream service error' }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('[share-pictogram] Error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
