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
 * a JSON-encoded string which api-gemini-nlu.js then parses back to an object.
 */
export function sanitizeSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;

  // Strip Anthropic/unsupported keywords
  const {
    minProperties, maxProperties,
    additionalProperties, patternProperties,
    $schema, $ref, $defs,
    cache_control,
    ...rest
  } = schema;

  // Dynamic-map object (additionalProperties only, no explicit properties):
  // collapse to string so Gemini can return a JSON-encoded map.
  if (rest.type === 'object' && !rest.properties && additionalProperties) {
    return {
      type: 'string',
      description: [
        rest.description,
        'Encode as a JSON object string mapping role names (Agent, Patient, Theme, etc.) to their filler objects.',
      ].filter(Boolean).join(' '),
    };
  }

  const out = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeSchemaForGemini(v);
    } else if (k === 'items' || k === 'not') {
      out[k] = sanitizeSchemaForGemini(v);
    } else {
      out[k] = v;
    }
  }
  // Recurse into properties map
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([pk, pv]) => [pk, sanitizeSchemaForGemini(pv)])
    );
  }
  return out;
}

/** Translate a Claude tool (input_schema) to a Gemini functionDeclaration. */
export function claudeToolToGeminiFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description ?? '',
    parameters: sanitizeSchemaForGemini(tool.input_schema ?? {}),
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
  const funcCallPart = parts.find(p => p.functionCall);

  if (!funcCallPart?.functionCall) {
    const textParts = parts.filter(p => p.text).map(p => p.text).join('\n');
    const finish = candidate?.finishReason ? ` [finishReason=${candidate.finishReason}]` : '';
    return {
      ok: false,
      error: `Gemini did not invoke the tool${finish}. ${textParts.slice(0, 200)}`.trim(),
      usage,
    };
  }

  return {
    ok: true,
    response: {
      content: [{
        type: 'tool_use',
        name: funcCallPart.functionCall.name,
        input: funcCallPart.functionCall.args ?? {},
      }],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: usage.candidatesTokenCount ?? 0,
      },
    },
    usage,
  };
}
