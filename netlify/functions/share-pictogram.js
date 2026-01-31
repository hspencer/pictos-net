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

    // Construir payload para GitHub
    const githubPayload = {
      event_type: 'append-row',
      client_payload: payload
    };

    // Log detallado del payload
    console.log('[SHARE-FUNCTION] Payload para GitHub:', JSON.stringify({
      event_type: githubPayload.event_type,
      client_payload_keys: Object.keys(githubPayload.client_payload),
      payload_size: JSON.stringify(githubPayload).length
    }));

    // Log de tamaños individuales de campos
    console.log('[SHARE-FUNCTION] Tamaños de campos:', {
      id: payload.id?.length || 0,
      UTTERANCE: payload.UTTERANCE?.length || 0,
      bitmap: payload.bitmap?.length || 0,
      NLU: JSON.stringify(payload.NLU || {}).length,
      elements: JSON.stringify(payload.elements || []).length,
      prompt: payload.prompt?.length || 0,
      evaluation: JSON.stringify(payload.evaluation || {}).length
    });

    // Log de estructura del payload (sin bitmap para no saturar logs)
    const payloadWithoutBitmap = { ...payload };
    if (payloadWithoutBitmap.bitmap) {
      payloadWithoutBitmap.bitmap = `[BITMAP: ${payloadWithoutBitmap.bitmap.length} chars]`;
    }
    console.log('[SHARE-FUNCTION] Estructura del payload:', JSON.stringify(payloadWithoutBitmap, null, 2));

    // Enviar dispatch a GitHub
    const response = await fetch('https://api.github.com/repos/hspencer/pictogram-collector/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PictoNet-Netlify-Function'
      },
      body: JSON.stringify(githubPayload)
    });

    console.log('[SHARE-FUNCTION] Respuesta GitHub:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHARE-FUNCTION] Error desde GitHub:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        headers: Object.fromEntries(response.headers.entries())
      });
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
