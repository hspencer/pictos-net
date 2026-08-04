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
import { buildGeminiRequest, geminiResponseToClaude } from './geminiTranslate.js';
import { getVertexAccessToken, vertexModelUrl } from './vertex.js';

// ── Constants (mirrored from types.ts) ───────────────────────────────────────

const DEFAULT_NLU_MODEL = 'claude-haiku-4-5-20251001';

// Mirrors ALLOWED_MODELS from api-claude.js and api-gemini-nlu.js.
// Validated before any model call so a crafted config cannot invoke arbitrary models.
const NLU_ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6',
  'gemini-2.5-flash', 'gemini-2.5-pro',
]);

const VOCAB_DOMAIN = [
  'transporte', 'salud', 'alimentación', 'educación', 'vida_cotidiana',
  'trabajo', 'emociones', 'tiempo_libre', 'dinero', 'seguridad',
  'comunicación', 'lugar', 'trámites',
];

const VOCAB_NSM = {
  substantives: {
    en: ['I', 'YOU', 'SOMEONE', 'SOMETHING~THING', 'PEOPLE', 'BODY'],
    es: ['YO', 'TÚ~USTED', 'ALGUIEN', 'ALGO~COSA', 'GENTE~PERSONAS', 'CUERPO'],
  },
  relational_substantives: { en: ['KIND', 'PART'], es: ['TIPO~CLASE', 'PARTE'] },
  determiners: {
    en: ['THIS', 'THE SAME', 'OTHER~ELSE'],
    es: ['ESTE~ESTO', 'EL MISMO', 'OTRO'],
  },
  quantifiers: {
    en: ['ONE', 'TWO', 'SOME', 'ALL', 'MUCH~MANY', 'LITTLE~FEW'],
    es: ['UNO', 'DOS', 'ALGUNOS', 'TODO~TODOS', 'MUCHO~MUCHOS', 'POCO~POCOS'],
  },
  evaluators: { en: ['GOOD', 'BAD'], es: ['BUENO', 'MALO'] },
  descriptors: { en: ['BIG', 'SMALL'], es: ['GRANDE', 'PEQUEÑO'] },
  mental_predicates: {
    en: ['THINK', 'KNOW', 'WANT', "DON'T WANT", 'FEEL', 'SEE', 'HEAR'],
    es: ['PENSAR', 'SABER', 'QUERER', 'NO QUERER', 'SENTIR', 'VER', 'OÍR'],
  },
  speech: { en: ['SAY', 'WORDS', 'TRUE'], es: ['DECIR', 'PALABRAS', 'VERDAD'] },
  actions_events_movement: {
    en: ['DO', 'HAPPEN', 'MOVE'],
    es: ['HACER', 'PASAR~OCURRIR', 'MOVER~MOVERSE'],
  },
  existence_possession: {
    en: ['BE (THERE IS)', 'HAVE'],
    es: ['HAY~ESTAR', 'TENER'],
  },
  life_death: { en: ['LIVE', 'DIE'], es: ['VIVIR', 'MORIR'] },
  time: {
    en: ['WHEN~TIME', 'NOW', 'BEFORE', 'AFTER', 'A LONG TIME', 'A SHORT TIME', 'FOR SOME TIME', 'MOMENT'],
    es: ['CUÁNDO~TIEMPO', 'AHORA', 'ANTES', 'DESPUÉS', 'MUCHO TIEMPO', 'POCO TIEMPO', 'POR UN TIEMPO', 'MOMENTO'],
  },
  space: {
    en: ['WHERE~PLACE', 'HERE', 'ABOVE', 'BELOW~UNDER', 'FAR', 'NEAR', 'SIDE', 'INSIDE', 'TOUCH'],
    es: ['DÓNDE~LUGAR', 'AQUÍ', 'ARRIBA~ENCIMA', 'ABAJO~DEBAJO', 'LEJOS', 'CERCA', 'LADO', 'DENTRO', 'TOCAR'],
  },
  logical_concepts: {
    en: ['NOT', 'MAYBE', 'CAN', 'BECAUSE', 'IF'],
    es: ['NO', 'QUIZÁS~TAL VEZ', 'PODER', 'PORQUE', 'SI'],
  },
  intensifier_augmentor: { en: ['VERY', 'MORE'], es: ['MUY', 'MÁS'] },
  similarity: { en: ['LIKE~AS~WAY'], es: ['COMO~ASÍ'] },
};

// Concepts the model may assign (Root excluded — injected locally).
const CHILD_CONCEPTS = ['Agent', 'Action', 'Object', 'Context', 'Element'];

// ── Tree helpers (mirrors visualElementUtils.ts) ─────────────────────────────

function normalizeElements(raw) {
  if (!Array.isArray(raw)) return [];
  // Unwrap if model mistakenly added a pictograma/pictogram root.
  if (raw.length === 1 && (raw[0].id === 'pictograma' || raw[0].id === 'pictogram')) {
    const kids = raw[0].children || raw[0].elements;
    raw = Array.isArray(kids) ? kids : [];
  }
  return raw.map(el => {
    const node = { id: el.id || 'unknown' };
    if (CHILD_CONCEPTS.includes(el.concept)) node.concept = el.concept;
    const kids = el.children || el.elements;
    if (Array.isArray(kids) && kids.length > 0) node.children = normalizeElements(kids);
    return node;
  });
}

function injectRoot(children, lang) {
  const rootId = lang.startsWith('es') ? 'pictograma' : 'pictogram';
  return [{ id: rootId, concept: 'Root', ...(children.length > 0 ? { children } : {}) }];
}

function formatElements(els, depth = 0) {
  if (!Array.isArray(els)) return '';
  return els.map(el => {
    const indent = '  '.repeat(depth);
    const kids = el.children?.length ? '\n' + formatElements(el.children, depth + 1) : '';
    return `${indent}- ${el.id}${kids}`;
  }).join('\n');
}

function buildNSMPrimesBlock(langTag) {
  const key = langTag.startsWith('es') ? 'es' : 'en';
  return Object.entries(VOCAB_NSM).map(([cat, primes]) => {
    const label = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `*   **${label}:** ${primes[key].join(', ')}`;
  }).join('\n');
}

function extractToolUse(content, toolName) {
  const block = (content ?? []).find(b => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error(`Model did not invoke tool '${toolName}'`);
  return block.input;
}

// ── NLU schemas (mirrors claudeService.ts) ───────────────────────────────────

const NLU_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    utterance: { type: 'string' },
    lang: { type: 'string' },
    domain: { type: 'string' },
    metadata: {
      type: 'object',
      properties: { speech_act: { type: 'string' }, intent: { type: 'string' } },
      required: ['speech_act', 'intent'],
    },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          frame_name: { type: 'string' },
          frame_label: { type: 'string' },
          lexical_unit: { type: 'string' },
          roles: {
            type: 'object',
            description: 'Map of FrameNet role names to their fillers in the utterance.',
            minProperties: 1,
            additionalProperties: {
              type: 'object',
              required: ['type'],
              properties: {
                type: {
                  type: 'string',
                  enum: ['Agent', 'Addressee', 'Speaker', 'Experiencer', 'Patient',
                    'Theme', 'Beneficiary', 'Instrument', 'Object', 'Event', 'Location', 'Time', 'Other'],
                },
                surface: { type: 'string' },
                lemma: { type: 'string' },
                ref: { type: 'string' },
                ref_frame: { type: 'string' },
                definiteness: { type: 'string', enum: ['definite', 'indefinite', 'unspecified'] },
              },
            },
          },
        },
        required: ['frame_name', 'lexical_unit', 'roles'],
      },
    },
    nsm_explications: { type: 'object', additionalProperties: { type: 'string' } },
    logical_form: {
      type: 'object',
      properties: { event: { type: 'string' }, modality: { type: 'string' } },
      required: ['event', 'modality'],
    },
    pragmatics: {
      type: 'object',
      properties: {
        politeness: { type: 'string' },
        formality: { type: 'string' },
        expected_response: { type: 'string' },
      },
      required: ['politeness', 'formality', 'expected_response'],
    },
    visual_guidelines: {
      type: 'object',
      properties: {
        focus_actor: { type: 'string' },
        action_core: { type: 'string' },
        object_core: { type: 'string' },
        context: { type: 'string' },
        temporal: { type: 'string' },
      },
      required: ['focus_actor', 'action_core', 'object_core', 'context', 'temporal'],
    },
  },
  required: ['utterance', 'lang', 'metadata', 'frames', 'nsm_explications', 'logical_form', 'pragmatics', 'visual_guidelines'],
};

const COMPOSE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      description: 'Semantic child elements. Do NOT include a root pictograma/pictogram node — added automatically.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          concept: { type: 'string', enum: CHILD_CONCEPTS },
          children: { type: 'array', items: { type: 'object' } },
        },
        required: ['id', 'concept'],
      },
    },
    prompt: {
      type: 'string',
      description: 'Spatial composition text. Wrap element IDs in single quotes. 3–6 sentences max.',
    },
  },
  required: ['elements', 'prompt'],
};

// ── AI call dispatchers ───────────────────────────────────────────────────────

async function callClaudeApi(params) {
  const apiKey = process.env.PICTOS_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('PICTOS_ANTHROPIC_KEY / ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' });
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.max_tokens || 4096,
    system: params.system,
    tools: params.tools,
    tool_choice: params.tool_choice,
    messages: params.messages,
  });
  return { content: response.content };
}

async function callGeminiNluApi(params) {
  const accessToken = await getVertexAccessToken();
  const url = vertexModelUrl(params.model);
  const geminiBody = buildGeminiRequest(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(geminiBody),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini NLU ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const parsed = geminiResponseToClaude(data);
  if (!parsed.ok) throw new Error(parsed.error);

  // Post-process: parse roles from JSON string (Gemini schema compat — see sanitizeSchemaForGemini).
  const toolBlock = parsed.response?.content?.find(b => b.type === 'tool_use');
  if (toolBlock?.input?.frames) {
    for (const frame of toolBlock.input.frames) {
      if (typeof frame.roles === 'string') {
        try { frame.roles = JSON.parse(frame.roles); } catch { frame.roles = {}; }
      }
      frame.roles = (frame.roles && typeof frame.roles === 'object') ? frame.roles : {};
    }
  }
  return parsed.response;
}

function callNluModel(model, params) {
  return model.startsWith('gemini-') ? callGeminiNluApi(params) : callClaudeApi(params);
}

// ── Phase runners ─────────────────────────────────────────────────────────────

/**
 * Phase 1: COMPRENDER — NLU semantic analysis.
 * Returns NLUData (same shape as claudeService.generateNLU).
 */
export async function runPhase1(utterance, config) {
  const lang = config?.lang || 'es-419';
  const isEs = lang.startsWith('es');
  const geoRegion = config?.geoContext?.region || 'No especificado';
  const nsmPrimesBlock = buildNSMPrimesBlock(lang);

  const annotatedContext = config?.visualStylePrompt?.trim()
    ? `\n- Contexto visual: "${config.visualStylePrompt.trim()}"`
    : '';

  const explicLang = isEs
    ? 'Las explicaciones NSM (nsm_explications) deben estar escritas usando los primos en ESPAÑOL.'
    : 'The NSM explications (nsm_explications) must be written using the primes in ENGLISH.';

  const frameLabelLang = isEs
    ? 'Genera frame_label como traducción al español del frame_name.'
    : 'Generate frame_label as the English label for the frame_name.';

  const system = `Operas como el nodo "NLU Schema Engine" en la arquitectura PictoNet.
Tu tarea es analizar la intención comunicativa y devolver el resultado JSON vía la herramienta disponible.

Contexto de uso:
- Región geográfica: ${geoRegion}
- Idioma del vocabulario: ${lang}${annotatedContext}

Ontología NSM (Goddard & Wierzbicka v19, 2017):
${nsmPrimesBlock}

${explicLang}
${frameLabelLang}

Dominio — infiere uno de: ${VOCAB_DOMAIN.join(', ')}

Reglas:
1. Invoca SIEMPRE la herramienta analyze_utterance con el JSON completo.
2. Analiza semántica y pragmática profunda, no solo la superficie.
3. Todos los campos requeridos deben estar presentes.`;

  const model = config?.comprenderModel ?? config?.nluModel ?? DEFAULT_NLU_MODEL;
  if (!NLU_ALLOWED_MODELS.has(model)) throw new Error(`Disallowed comprenderModel: ${model}`);
  const response = await callNluModel(model, {
    model,
    max_tokens: 4096,
    system,
    tools: [{ name: 'analyze_utterance', description: 'Return the NLU semantic analysis.', input_schema: NLU_TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: 'analyze_utterance' },
    messages: [{ role: 'user', content: `UTTERANCE: "${utterance}"` }],
  });

  return extractToolUse(response.content, 'analyze_utterance');
}

/**
 * Phase 2: COMPONER — visual element tree + spatial prompt.
 * Returns { elements, prompt } (same shape as claudeService.generateVisualBlueprint).
 */
export async function runPhase2(nluData, config) {
  const targetLang = nluData.lang || config?.lang || 'es-419';

  const availableClasses = config?.svgStyleDefs
    ? config.svgStyleDefs.flatMap(s => s.selectors).join(', ')
    : '.main, .secondary, .tertiary, .accent, .red, .green, .dashed, .glow, .anim-blink, .anim-beat, .anim-swing';

  const system = `You are the "Visual Topology Node" in the PictoNet graph.
Translate the semantic NLU graph into a list of visual child elements and a spatial prompt.

Language context: **${targetLang}**
— Element IDs and the prompt must be in **${targetLang}**.
— IDs: simple nouns in ${targetLang}, snake_case for compounds.
— Do NOT include a root pictograma/pictogram element — return only the semantic children.

Concept mapping (REQUIRED on every element, including nested children):
— Derive each element's \`concept\` from the NLU frame roles, never from the ID text:
  · Agent — fillers of Agent, Experiencer, Speaker or Addressee roles (the protagonist).
  · Action — the visual depiction of the lexical_unit / event itself (gesture, motion lines, arrows).
  · Object — fillers of Patient, Theme, Object, Instrument or Beneficiary roles.
  · Context — Location, Time, scenario or background elements.
  · Element — anything that does not map to a frame role.

Available CSS classes (optional suggestedClass hint only): ${availableClasses}

Prompt rules:
— Wrap every element ID in single quotes: 'persona', 'casa'.
— Describe only TOPOLOGY (relative position, size, connections). No style.
— 3–6 sentences maximum.

You MUST invoke the compose_pictogram tool with both \`elements\` and \`prompt\`.`;

  const model = config?.componerModel ?? config?.nluModel ?? DEFAULT_NLU_MODEL;
  if (!NLU_ALLOWED_MODELS.has(model)) throw new Error(`Disallowed componerModel: ${model}`);
  const response = await callNluModel(model, {
    model,
    max_tokens: 4096,
    system,
    tools: [{ name: 'compose_pictogram', description: 'Return the visual DOM and spatial prompt.', input_schema: COMPOSE_TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: 'compose_pictogram' },
    messages: [{ role: 'user', content: `NLU Semantics: ${JSON.stringify(nluData)}` }],
  });

  const raw = extractToolUse(response.content, 'compose_pictogram');
  const children = normalizeElements(raw.elements ?? []);
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : (Array.isArray(raw.prompt) ? raw.prompt.join(' ') : '');
  const elements = injectRoot(children, targetLang);
  return { elements, prompt };
}

/**
 * Build the Recraft Phase 3 prompt (mirrors recraftService.ts).
 * Truncated to 2000 chars when necessary.
 */
export function composeRecraftPrompt(elements, prompt, utterance, nluData, config) {
  const nluContext = nluData?.visual_guidelines
    ? `\nNLU context: ${nluData.visual_guidelines.focus_actor || ''} — ${nluData.visual_guidelines.action_core || ''} — ${nluData.visual_guidelines.object_core || ''}`
    : '';
  const style = config?.visualStylePrompt || 'Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.';
  const suffix = `\n\n${style}\nSin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.`;
  const prefix = `Pictograma AAC: "${utterance}"${nluContext}\n\nElementos (jerarquía visual):\n${formatElements(elements)}\n\nComposición espacial:\n${prompt}`;

  const full = `${prefix}${suffix}`;
  if (full.length <= 2000) return full;
  return prefix.slice(0, 1995 - suffix.length) + suffix;
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
