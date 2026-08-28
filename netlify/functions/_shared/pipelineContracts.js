import { getModelProvider } from './modelCatalog.js';
/** Canonical Phase 1/2 boundaries shared by browser and full pipeline batch. */
import { documentSchema as nluDocumentSchema, generationSchema, validateDocument as validateNluDocument, validateGeneration, VERSION as NLU_VERSION } from '../../../schemas/nlu-schema/index.js';
import { providerSchema as compositionSchema, documentSchema as compositionDocumentSchema, validateProvider, validateDocument as validateComposition, validateElementTree, VERSION as COMPOSITION_VERSION } from '../../../schemas/pictogram-composition-schema/index.js';
export { NLU_VERSION, COMPOSITION_VERSION };

export class PipelineContractError extends Error {
  constructor(phase, issues, rawOutput) {
    super(`Phase ${phase} contract validation failed: ${issues.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
    this.name = 'PipelineContractError';
    this.code = 'pipeline_contract_invalid';
    this.phase = phase;
    this.issues = issues;
    // Diagnostic retained locally; never log the raw communicative content automatically.
    this.rawOutput = rawOutput;
  }
}

/** Resolve local schema references before provider adaptation. Recursive child
 * trees are projected to six levels, with children forbidden at the last level.
 * Canonical validation remains recursive and independent of this provider limit. */
export function projectProviderSchema(schema, maxRecursiveDepth = 6) {
  function project(node, refs = []) {
    if (Array.isArray(node)) return node.map(value => project(value, refs));
    if (!node || typeof node !== 'object') return node;
    if (node.$ref) {
      if (!node.$ref.startsWith('#/')) throw new Error(`Unresolved external schema reference: ${node.$ref}`);
      const target = node.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
      if (!target) throw new Error(`Unresolved schema reference: ${node.$ref}`);
      const occurrences = refs.filter(ref => ref === node.$ref).length;
      if (occurrences >= maxRecursiveDepth) throw new Error('Recursive provider projection exceeded its declared limit');
      let resolved = target;
      if (occurrences === maxRecursiveDepth - 1 && target.properties?.children) {
        resolved = { ...target, properties: { ...target.properties } };
        delete resolved.properties.children;
      }
      return project({ ...resolved, ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref')) }, [...refs, node.$ref]);
    }
    return Object.fromEntries(Object.entries(node)
      .filter(([key]) => !['$schema', '$id', '$defs', '$comment', 'default', 'deprecated', 'title'].includes(key))
      .map(([key, value]) => [key === 'unevaluatedProperties' ? 'additionalProperties' : key, project(value, refs)]));
  }
  return project(schema);
}

export const NLU_TOOL_SCHEMA = projectProviderSchema(generationSchema);
export const COMPOSE_TOOL_SCHEMA = projectProviderSchema(compositionSchema);
const SPATIAL_TOOL = 'regenerate_spatial_prompt';
const SPATIAL_PROMPT_VERSION = 'spatial-regeneration-0.1.0';

/** Reverse only the dynamic maps encoded by the Gemini adapter. Never replace
 * malformed input with an empty object, and do not mutate the provider evidence. */
export function decodeNluMaps(raw) {
  const result = structuredClone(raw);
  const decode = (owner, key, path) => {
    if (!owner || typeof owner[key] !== 'string') return;
    try {
      const value = JSON.parse(owner[key]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
      owner[key] = value;
    } catch {
      throw new PipelineContractError(1, [{ instancePath: path, message: 'must encode a valid JSON object map' }], raw);
    }
  };
  if (Array.isArray(result?.frames)) result.frames.forEach((frame, i) => decode(frame, 'roles', `/frames/${i}/roles`));
  decode(result, 'nsm_explications', '/nsm_explications');
  decode(result, 'NSM_explications', '/NSM_explications');
  decode(result?.visual_guidelines, 'salience', '/visual_guidelines/salience');
  return result;
}

export function acceptNlu(raw, expectedUtterance) {
  const data = decodeNluMaps(raw);
  if (!validateGeneration(data)) throw new PipelineContractError(1, structuredClone(validateGeneration.errors), raw);
  if (expectedUtterance !== undefined && data.utterance !== expectedUtterance) {
    throw new PipelineContractError(1, [{ instancePath: '/utterance', message: 'must preserve the exact input utterance' }], raw);
  }
  return data;
}

export function acceptComposition(raw, lang) {
  if (!validateProvider(raw)) throw new PipelineContractError(2, structuredClone(validateProvider.errors), raw);
  const data = { elements: [{ id: lang.startsWith('es') ? 'pictograma' : 'pictogram', concept: 'Root', children: structuredClone(raw.elements) }], prompt: raw.prompt };
  if (!validateComposition(data)) throw new PipelineContractError(2, structuredClone(validateComposition.errors), raw);
  return data;
}

const VOCAB_DOMAIN = generationSchema.properties.domain.enum;

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

function buildNSMPrimesBlock(langTag) {
  const key = langTag.startsWith('es') ? 'es' : 'en';
  return Object.entries(VOCAB_NSM).map(([cat, primes]) => {
    const label = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `*   **${label}:** ${primes[key].join(', ')}`;
  }).join('\n');
}


export function buildNluRequest(utterance, config = {}) {
    const lang = config?.lang || 'es-419';
    const isEs = lang.startsWith('es');
    const geoRegion = config?.geoContext?.region || 'No especificado';
    const nsmPrimesBlock = buildNSMPrimesBlock(lang);
    const domainList = VOCAB_DOMAIN.join(', ');

    const domainCtx = config?.domainContext?.trim()
        ? `\n- Contexto de dominio: "${config.domainContext.trim()}" — interpreta TODAS las utterances dentro de este dominio semántico; úsalo para resolver cualquier ambigüedad léxica.`
        : '';
    const visualCtx = config?.visualStylePrompt?.trim()
        ? `\n- Contexto visual: "${config.visualStylePrompt.trim()}"`
        : '';

    const explicLang = isEs
        ? `Las explicaciones NSM (nsm_explications) deben estar escritas usando los primos en ESPAÑOL.
Formato: clave = lema del concepto (p.ej. "ayudar"), valor = fórmula NSM usando SÓLO los primos en MAYÚSCULAS.
Ejemplo correcto — clave "ayudar": "ALGUIEN (YO) piensa: ALGO MALO está pasando para MÍ. ESTE ALGUIEN quiere que ALGUIEN (TÚ) HAGA ALGO bueno para ESTE ALGUIEN ahora."`
        : `The NSM explications (nsm_explications) must be written using the primes in ENGLISH.
Format: key = concept lemma (e.g. "help"), value = NSM formula using ONLY the primes in ALL CAPS.
Correct example — key "help": "SOMEONE (I) thinks: SOMETHING BAD is happening to ME now. THIS SOMEONE wants SOMEONE (YOU) to DO SOMETHING good for THIS SOMEONE."`;

    const frameLabelLang = isEs
        ? 'Genera frame_label como traducción al español del frame_name.'
        : 'Generate frame_label as the English label for the frame_name.';

    const system = `Operas como el nodo "NLU Schema Engine" en la arquitectura PictoNet.
Tu tarea es analizar la intención comunicativa y devolver el resultado JSON vía la herramienta disponible.

Contexto de uso:
- Región geográfica: ${geoRegion}
- Idioma del vocabulario: ${lang}${domainCtx}${visualCtx}

Ontología NSM (Goddard & Wierzbicka v19, 2017):
${nsmPrimesBlock}

${explicLang}
${frameLabelLang}

Dominio — infiere uno de: ${domainList}${domainCtx ? ' — prioriza el más afín al contexto de dominio indicado.' : ''}

Reglas:
1. Invoca SIEMPRE la herramienta analyze_utterance con el JSON completo.
2. Analiza semántica y pragmática profunda${domainCtx ? ' dentro del dominio indicado' : ''}, no solo la superficie.
3. Todos los campos requeridos deben estar presentes.
4. Conserva utterance exactamente. Usa IDs únicos cuando un frame sea referenciado; ref_frame apunta a un ID existente, nunca a frame_name.
5. No inventes identidad del hablante ni timestamp de captura; esos datos no forman parte de la salida generada.`;


    const model = config?.comprenderModel ?? config?.nluModel ?? 'claude-haiku-4-5-20251001';
    return {
      model, max_tokens: 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'analyze_utterance', description: 'Return the NLU semantic analysis of the communicative intention.', input_schema: NLU_TOOL_SCHEMA, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: 'analyze_utterance' },
      messages: [{ role: 'user', content: `UTTERANCE: "${utterance}"` }],
    };
}

export function buildCompositionRequest(nlu, config = {}) {
    if (!validateNluDocument(nlu)) throw new PipelineContractError(2, structuredClone(validateNluDocument.errors), nlu);
    const targetLang = nlu.lang;
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

Available visual style context (do not add CSS fields to semantic elements): ${availableClasses}

Prompt rules:
— Wrap every element ID in single quotes: 'persona', 'casa'.
— Describe only TOPOLOGY (relative position, size, connections). No style.
— 3–6 sentences maximum.

${config.domainContext?.trim() ? `Domain context: "${config.domainContext.trim()}" — all element IDs and visual choices must be grounded in this domain.\n` : ''}You MUST invoke the compose_pictogram tool with both \`elements\` and \`prompt\`.`;


    const model = config?.componerModel ?? config?.nluModel ?? 'claude-haiku-4-5-20251001';
    return {
      model, max_tokens: 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'compose_pictogram', description: 'Return the provider-independent semantic children and spatial composition.', input_schema: COMPOSE_TOOL_SCHEMA, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: 'compose_pictogram' },
      messages: [{ role: 'user', content: `NLU Semantics: ${JSON.stringify(nlu)}` }],
    };
}

export function buildSpatialPromptRequest(nlu, elements, config = {}) {
  if (!validateNluDocument(nlu)) throw new PipelineContractError(2, structuredClone(validateNluDocument.errors), nlu);
  if (!validateElementTree(elements)) throw new PipelineContractError(2, structuredClone(validateElementTree.errors), elements);
  const model = config?.componerModel ?? config?.nluModel ?? 'claude-haiku-4-5-20251001';
  return {
    model, max_tokens: 1024,
    system: `You are the Spatial Articulation Node in PictoNet. Regenerate only the spatial composition prompt for the supplied complete NLU and unchanged element tree. Write in ${nlu.lang}. Reference every semantic child ID in single quotes. You may reference the synthetic root but do not invent IDs. Describe topology and composition, not style. Use 3–6 sentences. Invoke ${SPATIAL_TOOL} with the prompt.`,
    tools: [{ name: SPATIAL_TOOL, description: 'Return only a replacement spatial prompt for the existing semantic tree.', input_schema: {
      type: 'object', additionalProperties: false, required: ['prompt'],
      properties: { prompt: { type: 'string', pattern: '\\S' } },
    } }],
    tool_choice: { type: 'tool', name: SPATIAL_TOOL },
    messages: [{ role: 'user', content: JSON.stringify({ nlu, elements }) }],
  };
}

export function acceptSpatialPrompt(raw, elements) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'prompt')) {
    throw new PipelineContractError(2, [{ instancePath: '/', message: 'must contain only a replacement prompt' }], raw);
  }
  const artifact = { elements: structuredClone(elements), prompt: raw.prompt };
  if (!validateComposition(artifact)) throw new PipelineContractError(2, structuredClone(validateComposition.errors), raw);
  return artifact;
}

/** The browser route uses this exact one-call orchestration. Invalid output is
 * diagnostic evidence, not a reason to silently make another paid request. */
export async function requestSpatialPrompt(nlu, elements, config, callModel, onExecution) {
  const request = buildSpatialPromptRequest(nlu, elements, config);
  const response = await callModel(request.model, request);
  const block = response?.content?.find(item => item.type === 'tool_use' && item.name === SPATIAL_TOOL);
  if (!block) throw new PipelineContractError(2, [{ instancePath: '/', message: `provider must invoke ${SPATIAL_TOOL}` }], response);
  const artifact = acceptSpatialPrompt(block.input, elements);
  if (onExecution) onExecution(await createPhaseExecution(2, request, artifact, response));
  return artifact.prompt;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function sha256(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Evidence for an accepted execution, not a full attempt audit or training approval.
 * The snapshot is the actual credential-free application request sent to a proxy;
 * provider wire translation can differ (e.g. Gemini schema adaptation). */
export async function createPhaseExecution(phase, request, output, response) {
  const inputSnapshot = structuredClone(request);
  const contract = phase === 1 ? generationSchema : compositionDocumentSchema;
  return {
    id: globalThis.crypto.randomUUID(), phase, createdAt: new Date().toISOString(),
    model: request.model, provider: ({ gemini: 'google', claude: 'anthropic', openai: 'openai' })[getModelProvider(request.model)],
    ...(response?.model ? { actualModel: response.model } : {}),
    ...(response?.usage ? { usage: structuredClone(response.usage) } : {}),
    ...(response?.meta?.reasoningEffort ? { reasoningEffort: response.meta.reasoningEffort } : {}),
    ...(response?.meta?.requestId ? { providerRequestId: response.meta.requestId } : {}),
    ...(response?.meta?.durationMs != null ? { durationMs: response.meta.durationMs } : {}),
    contractId: contract.$id, contractHash: await sha256(contract), contractVersion: phase === 1 ? NLU_VERSION : COMPOSITION_VERSION,
    promptVersion: phase === 1 ? 'nlu-1.1.0' : request.tool_choice?.name === SPATIAL_TOOL ? SPATIAL_PROMPT_VERSION : 'composition-0.1.0',
    promptHash: await sha256(request.system), inputSnapshot,
    inputHash: await sha256(inputSnapshot), outputHash: await sha256(output),
    validated: true,
  };
}
