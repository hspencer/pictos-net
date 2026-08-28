/** OpenAI Responses adapter for the existing forced-tool semantic contracts. */
import { getModelProvider, modelSupportsPhase } from './modelCatalog.js';
import { openaiApiKey } from './openaiImage.js';
import { fetchWithRetry } from './httpRetry.js';
import { providerHttpError } from './providerError.js';

export const OPENAI_REASONING_EFFORT = 'low';
const TOOL_PHASE = { analyze_utterance: 1, compose_pictogram: 2, regenerate_spatial_prompt: 2, restructure_svg: 5, redraw_svg: 5 };
const invalid = message => Object.assign(new Error(message), { status: 400, provider: 'openai', code: 'invalid_request' });

export function openAITextPhase(params) {
  const name = params?.tool_choice?.name;
  if (params?.tool_choice?.type !== 'tool' || !Object.hasOwn(TOOL_PHASE, name)) throw invalid('Unsupported semantic tool');
  const phase = TOOL_PHASE[name];
  if (!modelSupportsPhase(params.model, phase) || getModelProvider(params.model) !== 'openai') throw invalid('Unsupported OpenAI text model or phase');
  return phase;
}

export function buildOpenAITextRequest(params) {
  openAITextPhase(params);
  if (!Array.isArray(params.tools) || params.tools.length !== 1 || params.tools[0]?.name !== params.tool_choice.name) {
    throw invalid('Exactly one matching semantic tool is required');
  }
  const tool = params.tools[0];
  if (!tool.input_schema || typeof tool.input_schema !== 'object' || Array.isArray(tool.input_schema)) throw invalid('Missing tool schema');
  const maxOutput = params.max_tokens ?? 8192;
  if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 32768) throw invalid('max_tokens must be an integer between 1 and 32768');
  if (!Array.isArray(params.messages) || !params.messages.length) throw invalid('Messages are required');
  const input = params.messages.map(message => {
    if (!['user', 'assistant'].includes(message.role)) throw invalid('Unsupported message role');
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(blocks) || !blocks.length) throw invalid('Message content is required');
    return { role: message.role, content: blocks.map(block => {
      if (block.type === 'text' && typeof block.text === 'string') return { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: block.text };
      if (message.role === 'user' && block.type === 'image' && block.source?.type === 'base64' &&
          /^image\/(png|jpeg|webp)$/.test(block.source.media_type) && typeof block.source.data === 'string' &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(block.source.data)) {
        return { type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}` };
      }
      throw invalid('Unsupported input block');
    }) };
  });
  let instructions = params.system ?? '';
  if (Array.isArray(instructions)) {
    if (!instructions.every(block => block.type === 'text' && typeof block.text === 'string')) throw invalid('Unsupported system content');
    instructions = instructions.map(block => block.text).join('\n');
  }
  if (typeof instructions !== 'string') throw invalid('System content must be text');
  return {
    model: params.model, instructions, input, store: false,
    reasoning: { effort: OPENAI_REASONING_EFFORT }, max_output_tokens: maxOutput,
    tools: [{ type: 'function', name: tool.name, description: tool.description ?? '', parameters: structuredClone(tool.input_schema), strict: false }],
    tool_choice: { type: 'function', name: tool.name }, parallel_tool_calls: false,
  };
}

export function openAIResponseToClaude(data, toolName) {
  const fail = message => { throw Object.assign(new Error(message), { provider: 'openai', code: 'invalid_provider_output', usage: data?.usage, rawResponse: data }); };
  if (data?.status !== 'completed') fail(`OpenAI response was not completed (${data?.status ?? 'missing status'})`);
  if (!Array.isArray(data.output)) fail('OpenAI response has no output');
  if (data.output.some(item => item.type === 'refusal' || item.content?.some(block => block.type === 'refusal'))) fail('OpenAI refused the request');
  const calls = data.output.filter(item => item.type === 'function_call');
  if (calls.length !== 1 || calls[0].name !== toolName || calls[0].status === 'incomplete') fail('OpenAI did not return exactly the requested semantic function');
  let args;
  try { args = JSON.parse(calls[0].arguments); } catch { fail('OpenAI function arguments are not valid JSON'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('OpenAI function arguments must be an object');
  return {
    content: [{ type: 'tool_use', name: toolName, input: args }], stop_reason: 'tool_use',
    model: data.model,
    usage: data.usage ? structuredClone(data.usage) : null,
  };
}

export async function generateOpenAIText(params, { maxTotalMs = 75000, retries = 2 } = {}) {
  const body = buildOpenAITextRequest(params);
  const started = Date.now();
  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${openaiApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { retries, baseDelayMs: 1000, retryOn429: true, maxTotalMs });
  if (!response.ok) throw await providerHttpError(response, 'openai', params._requestId);
  const data = await response.json();
  let parsed;
  try { parsed = openAIResponseToClaude(data, params.tool_choice.name); }
  catch (error) {
    Object.assign(error, { actualModel: data.model ?? null, request_id: response.headers.get('x-request-id'),
      attempts: response.attempts ?? 1, reasoningEffort: OPENAI_REASONING_EFFORT, durationMs: Date.now() - started });
    throw error;
  }
  return { ...parsed, meta: {
    provider: 'openai', requestId: response.headers.get('x-request-id'), attempts: response.attempts ?? 1,
    requestedModel: params.model, actualModel: parsed.model ?? null,
    reasoningEffort: OPENAI_REASONING_EFFORT, durationMs: Date.now() - started,
  } };
}
