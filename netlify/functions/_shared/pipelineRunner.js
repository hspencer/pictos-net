import { getModelProvider, modelSupportsPhase } from './modelCatalog.js';
import { generateOpenAIText } from './openaiText.js';
/**
 * Pipeline phase runners for the full-pipeline batch background function.
 *
 * Mirrors the client-side claudeService.ts / recraftService.ts / geminiService.ts
 * logic so the server can run Phase 1 (NLU) → Phase 2 (Compose) → Phase 3 (Image)
 * without a browser or client-side auth token.
 *
 * Used by: api-pipeline-batch-background.js
 * Pure helpers except for the AI API calls.
 */

import Anthropic from '@anthropic-ai/sdk';
import { fetchWithRetry } from './httpRetry.js';
import { providerHttpError } from './providerError.js';
import { buildGeminiRequest, geminiResponseToClaude } from './geminiTranslate.js';
import { getVertexAccessToken, vertexModelUrl } from './vertex.js';
import { buildNluRequest, buildCompositionRequest, acceptNlu, acceptComposition, createPhaseExecution } from './pipelineContracts.js';

function formatElements(els, depth = 0) {
  if (!Array.isArray(els)) return '';
  return els.map(el => {
    const indent = '  '.repeat(depth);
    const kids = el.children?.length ? '\n' + formatElements(el.children, depth + 1) : '';
    return `${indent}- ${el.id}${kids}`;
  }).join('\n');
}

function extractToolUse(content, toolName) {
  const block = (content ?? []).find(b => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error(`Model did not invoke tool '${toolName}'`);
  return block.input;
}

// ── AI call dispatchers ───────────────────────────────────────────────────────

async function callClaudeApi(params, { retries = 2, maxTotalMs = 75000 } = {}) {
  const apiKey = process.env.PICTOS_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('PICTOS_ANTHROPIC_KEY / ANTHROPIC_API_KEY not configured');
  let attempts = 0;
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', maxRetries: 0,
    fetch: async (url, init) => {
      try {
        const result = await fetchWithRetry(url, init, { retries, baseDelayMs: 1000, retryOn429: true, maxTotalMs });
        attempts = result.attempts;
        return result;
      } catch (error) { attempts = error.attempts ?? 1; throw error; }
    },
  });
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.max_tokens || 4096,
    system: params.system,
    tools: params.tools,
    tool_choice: params.tool_choice,
    messages: params.messages,
  }).catch(error => { throw Object.assign(error, { attempts, provider: 'claude' }); });
  return { ...response, meta: { provider: 'claude', attempts } };
}

async function callGeminiNluApi(params, { retries = 2, maxTotalMs = 75000 } = {}) {
  const accessToken = await getVertexAccessToken();
  const url = vertexModelUrl(params.model);
  const geminiBody = buildGeminiRequest(params);
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(geminiBody),
  }, { retries, baseDelayMs: 1000, retryOn429: true, maxTotalMs });
  if (!res.ok) throw await providerHttpError(res, 'gemini');
  const data = await res.json();
  const parsed = geminiResponseToClaude(data);
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), {
    provider: 'gemini', actualModel: parsed.model, rawResponse: data,
    usage: { input_tokens: parsed.usage?.promptTokenCount ?? null,
      output_tokens: Number.isFinite(parsed.usage?.candidatesTokenCount)
        ? parsed.usage.candidatesTokenCount + (parsed.usage.thoughtsTokenCount ?? 0) : null,
      provider_usage: parsed.usage ?? null },
  });

  return parsed.response;
}

export function callTextModel(params, options) {
  const model = params.model;
  const provider = getModelProvider(model);
  if (provider === 'openai') return generateOpenAIText(params, options);
  if (provider === 'gemini') return callGeminiNluApi(params, options);
  if (provider === 'claude') return callClaudeApi(params, options);
  throw new Error('Unsupported semantic provider');
}

function acceptModelOutput(request, response, accept) {
  try { return accept(); }
  catch (error) {
    throw Object.assign(error, { usage: response.usage ?? null, actualModel: response.model ?? null,
      provider: getModelProvider(request.model), attempts: response.meta?.attempts ?? 1 });
  }
}

// ── Phase runners ─────────────────────────────────────────────────────────────

/**
 * Phase 1: COMPRENDER — NLU semantic analysis.
 * Returns NLUData (same shape as claudeService.generateNLU).
 */
export async function runPhase1(utterance, config, onExecution) {
  const request = buildNluRequest(utterance, config);
  if (!modelSupportsPhase(request.model, 1)) throw new Error(`Disallowed comprenderModel: ${request.model}`);
  const response = await callTextModel(request);
  const result = acceptModelOutput(request, response, () => acceptNlu(extractToolUse(response.content, 'analyze_utterance'), utterance));
  if (onExecution) onExecution(await createPhaseExecution(1, request, result, response));
  return result;
}

/** Phase 2 shares the exact request and acceptance boundary with the browser. */
export async function runPhase2(nluData, config, onExecution) {
  const request = buildCompositionRequest(nluData, config);
  if (!modelSupportsPhase(request.model, 2)) throw new Error(`Disallowed componerModel: ${request.model}`);
  const response = await callTextModel(request);
  const result = acceptModelOutput(request, response, () => acceptComposition(extractToolUse(response.content, 'compose_pictogram'), nluData.lang));
  if (onExecution) onExecution(await createPhaseExecution(2, request, result, response));
  return result;
}

/**
 * Build the Recraft Phase 3 prompt (mirrors recraftService.ts).
 * Preserved up to the V4.1/V4 Styles 10000-character contract; never truncated.
 */
export function composeRecraftPrompt(elements, prompt, utterance, nluData, config) {
  const nluContext = nluData?.visual_guidelines
    ? `\nNLU context: ${nluData.visual_guidelines.focus_actor || ''} — ${nluData.visual_guidelines.action_core || ''} — ${nluData.visual_guidelines.object_core || ''}`
    : '';
  const style = config?.visualStylePrompt || 'Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.';
  const suffix = `\n\n${style}\nSin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.`;
  const prefix = `Pictograma AAC: "${utterance}"${nluContext}\n\nElementos (jerarquía visual):\n${formatElements(elements)}\n\nComposición espacial:\n${prompt}`;

  const full = `${prefix}${suffix}`;
  if (full.length > 10000) throw new Error('Recraft prompt exceeds 10000 characters; shorten the composition explicitly.');
  return full;
}

/**
 * Build the Gemini image Phase 3 prompt (mirrors geminiService.ts).
 */
export function composeGeminiImagePrompt(elements, prompt, utterance, nluData, config) {
  const nluContext = nluData?.visual_guidelines
    ? `\nSemantic context: ${nluData.visual_guidelines.focus_actor || ''} — ${nluData.visual_guidelines.action_core || ''} — ${nluData.visual_guidelines.object_core || ''}`
    : '';
  return [
    `AAC pictogram: "${utterance}"`,
    nluContext,
    '',
    'Visual elements (hierarchy):',
    formatElements(elements),
    '',
    'Spatial composition:',
    prompt,
    '',
    config?.visualStylePrompt || 'Flat pictogram style, no text, simple vector design, white background.',
    '',
    'No text. No labels. No watermarks. White background. Flat design. Square format.',
  ].join('\n');
}
