/** Server-only OpenAI Images adapter, shared by individual and pipeline jobs. */
export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_IMAGE_QUALITIES = ['low', 'medium', 'high'];
export const OPENAI_IMAGE_TIMEOUT_MS = 180_000;

export function openaiImageRequest({ model, prompt, quality = 'low' }) {
  if (model !== OPENAI_IMAGE_MODEL) throw new Error('Unsupported OpenAI image model');
  if (!OPENAI_IMAGE_QUALITIES.includes(quality)) throw new Error('Invalid OpenAI image quality');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) {
    throw new Error('OpenAI image prompt must contain 1–32000 characters');
  }
  return { model, prompt, quality, n: 1, size: '1024x1024', output_format: 'png', background: 'opaque' };
}

export function openaiApiKey() {
  const key = process.env.PICTOS_OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');
  return key;
}

export async function generateOpenAIImage(params) {
  const body = openaiImageRequest(params);
  // One paid attempt: do not replay an ambiguous timeout/transport failure.
  // The user may retry Phase 3 explicitly, without repeating Phases 1–2.
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OPENAI_IMAGE_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) {
    // Provider error bodies can echo credentials/prompts. Keep only safe codes.
    const code = typeof data.error?.code === 'string' && /^[a-z_]+$/.test(data.error.code)
      ? data.error.code : 'request_failed';
    throw Object.assign(new Error(`OpenAI ${response.status}: ${code}`), {
      status: response.status, code, type: data.error?.type, provider: 'openai', request_id: requestId, headers: response.headers,
    });
  }
  const base64 = data.data?.[0]?.b64_json;
  if (typeof base64 !== 'string' || !base64) throw new Error('OpenAI returned no image data');
  return {
    bitmap: `data:image/png;base64,${base64}`,
    generationQuality: body.quality,
    usage: data.usage ?? null,
    requestId,
  };
}
