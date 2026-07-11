/**
 * Claude Service — Phases 1 (COMPRENDER), 2 (COMPONER), and spatial prompt regen.
 *
 * Uses Claude Haiku with forced tool use so every response is schema-validated JSON.
 * Phase 5 (ESTRUCTURAR / vision) lives in svgStructureService.ts.
 */

import { NLUData, GlobalConfig, VisualElement, VOCAB_NSM, VOCAB, DEFAULT_NLU_MODEL } from "../types";
import { callClaude, callGeminiNlu, extractToolUse, type ClaudeParams } from "./aiClient";
import { CHILD_CONCEPTS, normalizeElements, injectRoot } from "./visualElementUtils";

/** Route a Claude-format params object to the correct NLU endpoint. */
function callNluModel(model: string, params: ClaudeParams) {
    return model.startsWith('gemini-') ? callGeminiNlu(params) : callClaude(params);
}

type LogFn = (type: 'info' | 'error' | 'success', msg: string) => void;

// ── Helpers ──────────────────────────────────────────────────────────────────

const buildNSMPrimesBlock = (langTag: string): string => {
    const isEs = langTag.startsWith('es');
    const key = isEs ? 'es' : 'en';
    const entries = Object.entries(VOCAB_NSM) as [string, { en: string[]; es: string[] }][];
    return entries.map(([category, primes]) => {
        const label = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `*   **${label}:** ${primes[key].join(', ')}`;
    }).join('\n');
};

const formatElements = (els: VisualElement[], depth = 0): string => {
    if (!Array.isArray(els)) return '  (error: not an array)';
    return els.map(el => {
        const indent = '  '.repeat(depth);
        const concept = el.concept ? ` [${el.concept}]` : '';
        const children = el.children?.length ? '\n' + formatElements(el.children, depth + 1) : '';
        return `${indent}- ${el.id}${concept}${children}`;
    }).join('\n');
};

// ── Phase 1: COMPRENDER ──────────────────────────────────────────────────────

const NLU_TOOL_SCHEMA = {
    type: 'object' as const,
    properties: {
        utterance: { type: 'string' },
        lang: { type: 'string' },
        domain: { type: 'string' },
        metadata: {
            type: 'object',
            properties: {
                speech_act: { type: 'string' },
                intent: { type: 'string' },
            },
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
                                           'Theme', 'Beneficiary', 'Instrument', 'Object',
                                           'Event', 'Location', 'Time', 'Other'],
                                },
                                surface: { type: 'string', description: 'Surface form as it appears in the utterance.' },
                                lemma:   { type: 'string', description: 'Lemmatised base form.' },
                                ref:     { type: 'string', description: 'Reference to an NSM prime or concept ID.' },
                                ref_frame: { type: 'string', description: 'Reference to another frame_name in this analysis.' },
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
            properties: {
                event: { type: 'string' },
                modality: { type: 'string' },
            },
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

export const generateNLU = async (
    utterance: string,
    onLog?: LogFn,
    config?: GlobalConfig,
): Promise<NLUData> => {
    onLog?.('info', `[NLU] Iniciando análisis semántico: "${utterance.substring(0, 50)}…"`);

    const lang = config?.lang || 'es-419';
    const isEs = lang.startsWith('es');
    const geoRegion = config?.geoContext?.region || 'No especificado';
    const nsmPrimesBlock = buildNSMPrimesBlock(lang);
    const domainList = VOCAB.domain.join(', ');

    const annotatedContext = config?.annotatedContext?.trim()
        ? `\n- Contexto anotado: "${config.annotatedContext.trim()}"`
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

Dominio — infiere uno de: ${domainList}

Reglas:
1. Invoca SIEMPRE la herramienta analyze_utterance con el JSON completo.
2. Analiza semántica y pragmática profunda, no solo la superficie.
3. Todos los campos requeridos deben estar presentes.`;

    const nluModel = config?.comprenderModel ?? config?.nluModel ?? DEFAULT_NLU_MODEL;
    onLog?.('info', `[NLU] Enviando a ${nluModel}…`);
    const response = await callNluModel(nluModel, {
        model: nluModel,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{
            name: 'analyze_utterance',
            description: 'Return the NLU semantic analysis of the communicative intention.',
            input_schema: NLU_TOOL_SCHEMA,
            cache_control: { type: 'ephemeral' },
        }],
        tool_choice: { type: 'tool', name: 'analyze_utterance' },
        messages: [{ role: 'user', content: `UTTERANCE: "${utterance}"` }],
    });

    const result = extractToolUse(response, 'analyze_utterance') as NLUData;
    onLog?.('success', `[NLU] Completado. Intent: ${result.metadata?.intent || 'N/A'}`);
    return result;
};

// ── Phase 2: COMPONER ────────────────────────────────────────────────────────

const COMPOSE_TOOL_SCHEMA = {
    type: 'object' as const,
    properties: {
        elements: {
            type: 'array',
            description: 'Semantic child elements of the pictogram. Do NOT include a root pictograma/pictogram node — that is added automatically. IDs are nouns in the utterance language.',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Simple noun in utterance language, snake_case for compounds.' },
                    concept: {
                        type: 'string',
                        enum: CHILD_CONCEPTS,
                        description: 'Semantic concept derived from the NLU frame roles: Agent (Agent/Experiencer/Speaker/Addressee roles), Action (the lexical_unit event), Object (Patient/Theme/Object/Instrument/Beneficiary), Context (Location/Time/scenario/background), Element (anything else). Every element, including nested children, must carry one.',
                    },
                    children: { type: 'array', items: { type: 'object' } },
                },
                required: ['id', 'concept'],
            },
        },
        prompt: {
            type: 'string',
            description: 'Spatial composition text describing topology and layout of elements. Wrap element IDs in single quotes. 3–6 sentences max.',
        },
    },
    required: ['elements', 'prompt'],
};

export const generateVisualBlueprint = async (
    nlu: NLUData,
    config: GlobalConfig,
    onLog?: LogFn,
): Promise<{ elements: VisualElement[]; prompt: string }> => {
    if (!nlu) throw new Error('NLU data is required — run COMPRENDER first');
    const targetLang = nlu.lang || config?.lang || 'es-419';

    onLog?.('info', `[VISUAL] Generando blueprint visual (idioma: ${targetLang})…`);

    const availableClasses = config.svgStyleDefs
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

    const nluModel = config?.componerModel ?? config?.nluModel ?? DEFAULT_NLU_MODEL;
    onLog?.('info', `[VISUAL] Enviando NLU a ${nluModel}…`);
    const response = await callNluModel(nluModel, {
        model: nluModel,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{
            name: 'compose_pictogram',
            description: 'Return the visual DOM (elements hierarchy) and the spatial prompt for Recraft.',
            input_schema: COMPOSE_TOOL_SCHEMA,
            cache_control: { type: 'ephemeral' },
        }],
        tool_choice: { type: 'tool', name: 'compose_pictogram' },
        messages: [{ role: 'user', content: `NLU Semantics: ${JSON.stringify(nlu)}` }],
    });

    const raw = extractToolUse(response, 'compose_pictogram');
    const children = normalizeElements(raw.elements ?? []);
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : (Array.isArray(raw.prompt) ? raw.prompt.join(' ') : '');

    // Inject the root node deterministically — never delegated to the model.
    const elements = injectRoot(children, targetLang);

    onLog?.('success', `[VISUAL] Completado. Hijos: ${children.length}, Prompt: ${prompt.substring(0, 60)}…`);
    return { elements, prompt };
};

// ── Spatial prompt regen (prompt-only, user-initiated) ───────────────────────

export const generateSpatialPrompt = async (
    nlu: NLUData,
    elements: VisualElement[],
    config: GlobalConfig,
    onLog?: LogFn,
): Promise<string> => {
    if (!nlu) throw new Error('NLU data is required — run COMPRENDER first');
    const targetLang = nlu.lang || config?.lang || 'es-419';

    onLog?.('info', `[PROMPT] Regenerando prompt espacial (${targetLang})…`);

    const system = `You are the "Spatial Articulation Node" in the PictoNet graph.
Generate a spatial composition prompt for the given visual elements.

Language: **${targetLang}** — write the prompt in ${targetLang}.
Wrap every element ID in single quotes: 'pictograma', 'persona'.
Describe only TOPOLOGY and COMPOSITION. No style. 3–6 sentences.
Reply with plain text — no JSON, no markdown.`;

    const spatialModel = config?.componerModel ?? config?.nluModel ?? DEFAULT_NLU_MODEL;
    const response = await callNluModel(spatialModel, {
        model: spatialModel,
        max_tokens: 1024,
        system,
        messages: [{
            role: 'user',
            content: `NLU:\n${JSON.stringify(nlu, null, 2)}\n\nElements:\n${formatElements(elements)}\n\nGenerate the spatial prompt.`,
        }],
    });

    const textBlock = response.content?.find(b => b.type === 'text');
    const prompt = textBlock?.text?.trim() || '';
    onLog?.('success', `[PROMPT] Prompt generado: ${prompt.substring(0, 80)}…`);
    return prompt;
};
