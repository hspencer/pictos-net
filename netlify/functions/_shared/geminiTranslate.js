import { projectProviderSchema } from './pipelineContracts.js';
/**
 * Pure Claude→Gemini request translation for the structuring proxy.
 *
 * Kept free of side-effectful imports (no Vertex/Blobs/usage) so it can be
 * unit-tested in isolation with `node --test`. See geminiTranslate.test.mjs.
 */

// Max output cap. Geometry-authoring (redraw) needs headroom so the tool call
// is not truncated mid-output — truncation loses the function call and the
// proxy then returns a 500.
export const MAX_OUTPUT_TOKENS_CAP = 32768;

/**
 * Translate a Claude-style content block array to Gemini parts.
 * Handles { type:'text', text } and { type:'image', source:{ type:'base64', media_type, data } }.
 */
export function claudeContentToGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return (content ?? []).map(block => {
    if (block.type === 'text') return { text: block.text };
    if (block.type === 'image' && block.source?.type === 'base64') {
      return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
    }
    return { text: '' };
  });
}

/**
 * Recursively strip JSON Schema keywords that Gemini's function calling
 * does not support (OpenAPI 3.0 subset only).
 *
 * Unsupported: minProperties, maxProperties, additionalProperties,
 *   patternProperties, $schema, $ref, $defs, cache_control (Anthropic-only).
 *
 * Objects typed with ONLY additionalProperties (dynamic maps, e.g. the NLU
 * `roles` field) are converted to type:'string' with a description hint.
 * Gemini cannot generate arbitrary keys from schema alone, but it CAN return
 * a JSON-encoded string which the shared canonical acceptance boundary decodes
 * before validating. Reference resolution must happen before this projection.
 */
export function sanitizeSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  if (schema.$ref) throw new Error('Resolve schema references before Gemini sanitization');
  if ('const' in schema) {
    const { const: value, ...rest } = schema;
    return sanitizeSchemaForGemini({ ...rest, type: schema.type ?? typeof value, enum: [value] });
  }
  const { additionalProperties } = schema;
  if (schema.type === 'object' && !schema.properties && additionalProperties && typeof additionalProperties === 'object') {
    return {
      type: 'string',
      description: [schema.description, schema.minProperties ? `At least ${schema.minProperties} entries are required.` : '',
        'Encode a JSON object string with arbitrary keys. Every value must satisfy this JSON Schema:',
        JSON.stringify(additionalProperties),
      ].filter(Boolean).join(' '),
    };
  }
  // A provider projection guides generation; the original canonical JSON Schema
  // remains authoritative. Unsupported keywords are not represented as validation.
  const allowed = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'anyOf', 'nullable']);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) continue;
    if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, sanitizeSchemaForGemini(child)]));
    else if (key === 'items') out.items = sanitizeSchemaForGemini(value);
    else if (key === 'anyOf') {
      // Required-only branches rely on sibling properties in JSON Schema, which
      // cannot be represented as independent Gemini alternatives. Keep the rule
      // as a generation hint; canonical Ajv still enforces the actual anyOf.
      if (value.every(branch => Object.keys(branch).every(k => k === 'required'))) {
        out.description = [out.description, `At least one of these fields must be present: ${value.flatMap(branch => branch.required ?? []).join(', ')}.`].filter(Boolean).join(' ');
      } else out.anyOf = value.map(sanitizeSchemaForGemini);
    }
    else out[key] = value;
  }
  return out;
}

/** Translate a Claude tool (input_schema) to a Gemini functionDeclaration. */
export function claudeToolToGeminiFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description ?? '',
    parameters: sanitizeSchemaForGemini(projectProviderSchema(tool.input_schema ?? {})),
  };
}

/**
 * Gemini 2.5 "thinking" budget. Disabled (0) for flash to keep latency and the
 * output budget for the actual tool call — a slow redraw with thinking on
 * exceeds the function timeout. Pro cannot fully disable thinking (min 128).
 */
export function thinkingBudgetFor(model) {
  return String(model).includes('pro') ? 128 : 0;
}

/**
 * Build the full Gemini generateContent request body from a Claude-style
 * request. Pure: same input → same output.
 */
export function buildGeminiRequest({ model, system, tools, tool_choice, messages, max_tokens }) {
  const userContent = messages?.[0]?.content ?? [];
  const body = {
    contents: [{ role: 'user', parts: claudeContentToGeminiParts(userContent) }],
  };

  if (system) {
    const systemText = typeof system === 'string' ? system : system.map(b => b.text ?? '').join('\n');
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  if (tools && tools.length > 0) {
    body.tools = [{ functionDeclarations: tools.map(claudeToolToGeminiFunctionDeclaration) }];
  }

  if (tool_choice?.name) {
    body.toolConfig = {
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool_choice.name] },
    };
  }

  body.generationConfig = {
    maxOutputTokens: Math.min(max_tokens || 8192, MAX_OUTPUT_TOKENS_CAP),
    thinkingConfig: { thinkingBudget: thinkingBudgetFor(model) },
  };

  return body;
}

/**
 * Translate a Gemini generateContent response into a Claude-compatible shape.
 * Returns { ok:true, response, usage } when the model invoked the tool, or
 * { ok:false, error, usage } when it did not (so callers surface a clear cause
 * instead of a truncation/timeout). Pure — no I/O.
 */
export function geminiResponseToClaude(geminiData) {
  const candidate = geminiData?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const usage = geminiData?.usageMetadata ?? {};
  const functionParts = parts.filter(p => p.functionCall);
  const funcCallPart = functionParts[0];

  if (!funcCallPart?.functionCall || functionParts.length !== 1 || (candidate?.finishReason && candidate.finishReason !== 'STOP')) {
    const finish = candidate?.finishReason ? ` [finishReason=${candidate.finishReason}]` : '';
    return {
      ok: false,
      error: `Gemini did not invoke the tool completely${finish}`,
      usage,
      model: geminiData?.modelVersion ?? null,
    };
  }

  return {
    ok: true,
    response: {
      content: [{
        type: 'tool_use',
        name: funcCallPart.functionCall.name,
        input: funcCallPart.functionCall.args,
      }],
      stop_reason: 'tool_use',
      model: geminiData?.modelVersion,
      usage: {
        input_tokens: usage.promptTokenCount ?? null,
        output_tokens: Number.isFinite(usage.candidatesTokenCount)
          ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) : null,
        input_tokens_details: { cached_tokens: usage.cachedContentTokenCount ?? null },
        output_tokens_details: { reasoning_tokens: usage.thoughtsTokenCount ?? null },
        provider_usage: structuredClone(usage),
      },
    },
    usage,
  };
}
