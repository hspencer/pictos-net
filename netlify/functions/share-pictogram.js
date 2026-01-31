/**
 * Netlify Function: Share Pictogram
 * Envía pictogramas a mediafranca/pictogram-collector via GitHub Dispatches
 */

exports.handler = async (event) => {
  // Solo permitir POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const payload = JSON.parse(event.body);

    console.log('[SHARE-FUNCTION] Recibida petición de compartir:', payload.UTTERANCE);

    // Validar que el token esté configurado
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.error('[SHARE-FUNCTION] Error: GITHUB_TOKEN no configurado');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error: GITHUB_TOKEN not set' })
      };
    }

    // Enviar dispatch a GitHub
    console.log('[SHARE-FUNCTION] Enviando a GitHub API...');
    const response = await fetch('https://api.github.com/repos/mediafranca/pictogram-collector/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PictoNet-Netlify-Function'
      },
      body: JSON.stringify({
        event_type: 'append-row',
        client_payload: payload
      })
    });

    console.log('[SHARE-FUNCTION] Respuesta GitHub:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHARE-FUNCTION] Error desde GitHub:', errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: `GitHub API error: ${response.status} - ${errorText}`
        })
      };
    }

    console.log('[SHARE-FUNCTION] ✓ Pictograma compartido exitosamente');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[SHARE-FUNCTION] Excepción:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Internal server error'
      })
    };
  }
};
