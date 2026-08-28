import { randomUUID } from 'node:crypto';
import { connectBlobs, getBlobStore } from './_shared/blobs.js';
import { buildOpenAITextRequest, openAITextPhase } from './_shared/openaiText.js';
import { buildGeminiRequest } from './_shared/geminiTranslate.js';
import { MODEL_CATALOG, modelSupportsPhase } from './_shared/modelCatalog.js';

// Background requests are limited to 256 KB; stage vision input through the
// authenticated synchronous boundary (5 MB here, below Netlify's 6 MB limit).
export const handler = async (event, context) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const user = context?.clientContext?.user;
  const local = process.env.NETLIFY_DEV === 'true';
  if (!local && !user?.email) return reply(401, { error: 'Unauthorized' });
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body, 'utf8') > 5_000_000) {
    return reply(413, { error: 'Structuring request must be JSON smaller than 5 MB', retryManaged: true });
  }
  let params, provider;
  try {
    const input = JSON.parse(event.body);
    provider = MODEL_CATALOG[input.model]?.provider;
    if (!['gemini', 'openai'].includes(provider) || !modelSupportsPhase(input.model, 5)) throw new Error('Unsupported structuring model');
    const name = input.tool_choice?.name;
    if (input.tool_choice?.type !== 'tool' || !['restructure_svg', 'redraw_svg'].includes(name) ||
        !Array.isArray(input.tools) || input.tools.length !== 1 || input.tools[0]?.name !== name ||
        !input.tools[0].input_schema || !Array.isArray(input.messages) || !input.messages.length) throw new Error('Staging requires a Phase 5 tool request');
    if (provider === 'openai') {
      if (openAITextPhase(input) !== 5) throw new Error('Staging requires Phase 5');
      buildOpenAITextRequest(input);
    } else buildGeminiRequest(input);
    // Keep application inputs only: never persist an arbitrary auth token or
    // accept a client-selected job ID that could overwrite another request.
    const { model, system, messages, tools, tool_choice, max_tokens } = input;
    params = { model, system, messages, tools, tool_choice, max_tokens };
  } catch { return reply(400, { error: 'Invalid Phase 5 structuring request', retryManaged: true }); }
  connectBlobs(event);
  const jobId = `${provider === 'openai' ? 'openai-struct' : 'struct'}-${randomUUID()}`;
  const owner = local ? 'dev' : user.email;
  const expiresAt = Date.now() + 120000;
  const inputs = getBlobStore('structure-inputs');
  try {
    await inputs.setJSON(jobId, { owner, provider, expiresAt, params });
    if (!local) await getBlobStore('auth-grants').setJSON(jobId, { email: owner, roles: [], exp: expiresAt });
    return reply(200, { jobId });
  } catch {
    await inputs.delete(jobId).catch(() => {});
    return reply(500, { error: 'Could not stage structuring request', retryManaged: true });
  }
};
