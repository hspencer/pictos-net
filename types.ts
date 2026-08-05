
export interface NLUMetadata {
  speech_act: string;
  intent: string;
}

export interface NLUFrameRole {
  type: string;
  surface: string;
  lemma?: string;
  definiteness?: string;
  ref?: string;
  ref_frame?: string;
}

export interface NLUFrame {
  frame_name: string;
  frame_label?: string;
  lexical_unit: string;
  roles: Record<string, NLUFrameRole>;
}

export interface NLUVisualGuidelines {
  focus_actor: string;
  action_core: string;
  object_core: string;
  context: string;
  temporal: string;
}

export interface Pragmatics {
  politeness: string;
  formality: string;
  expected_response: string;
}

export interface LogicalForm {
  event: string;
  modality: string;
}

export interface NLUData {
  utterance: string;
  lang: string;
  domain?: string;
  metadata: NLUMetadata;
  frames: NLUFrame[];
  nsm_explications: Record<string, string>;
  logical_form: LogicalForm;
  pragmatics: Pragmatics;
  visual_guidelines: NLUVisualGuidelines;
}

export type StepStatus = 'idle' | 'processing' | 'completed' | 'error' | 'outdated' | 'review';

// ── NLU Model (Phases 1+2: COMPRENDER + COMPONER) ────────────────────────────

export type NluModel =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro';

export const NLU_MODELS: { id: NluModel; label: string }[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
  { id: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro',            label: 'Gemini 2.5 Pro' },
];

export const DEFAULT_NLU_MODEL: NluModel = 'claude-haiku-4-5-20251001';

// ── Phase 5: ESTRUCTURAR ─────────────────────────────────────────────────────

export type Phase5StructuringModel =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash';
// Nota: gemini-2.0-flash se retiro del selector el 2026-06-13: el proyecto
// pictos-vertex devuelve 404 NOT_FOUND para ese modelo en global y us-central1.

export const PHASE5_MODELS: { id: Phase5StructuringModel; label: string }[] = [
  { id: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6',    label: 'Claude Opus 4.6' },
  { id: 'gemini-2.5-pro',     label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash',   label: 'Gemini 2.5 Flash' },
];

// Structuring is the finest visual-judgment task in the pipeline and runs
// manually at low volume — default to the most capable model, not the fastest.
export const DEFAULT_PHASE5_MODEL: Phase5StructuringModel = 'claude-sonnet-4-6';

export interface MergedPath {
  // Computed locally (exact geometric union via svgBooleanOps) — the model
  // only proposes `sources`; it never authors path data itself.
  d?: string;
  sources: string[]; // original path ids that were merged
}

export interface StructuringGroup {
  nodeId: string;
  label: string;
  cssClass: string;
  parentId?: string | null;
  keep: string[];
  merge?: MergedPath | null;
  selected: boolean; // default true; toggled in Phase5_Review
}

export interface StructuringMapping {
  description: string;
  groups: StructuringGroup[];
  discard: string[];
}



/**
 * Semantic concept of a visual element, derived from the NLU frame roles in
 * Phase 2 (COMPONER). Flows through to the structured SVG as `data-concept`
 * so the final DOM is congruent with the comprehension phase.
 * Used in: claudeService (compose_pictogram schema) and svgStructureService
 * (flattenElements, renderGroup, renderRedrawGroup).
 */
export type VisualConcept = 'Root' | 'Agent' | 'Action' | 'Object' | 'Context' | 'Element';

export const VISUAL_CONCEPTS: VisualConcept[] = ['Root', 'Agent', 'Action', 'Object', 'Context', 'Element'];

export interface VisualElement {
  id: string;
  /** Semantic concept from the NLU frame roles (Phase 2). Optional for
   *  backwards compatibility — legacy rows fall back to id-prefix guessing. */
  concept?: VisualConcept;
  children?: VisualElement[];
}

// === Intervention Recording (see specs/intervention-recording.allium) ===

export type InterventionPhase =
  | 'utterance'
  | 'nlu'
  | 'elements'
  | 'prompt'
  | 'svg_raw'
  | 'svg_structured';
export type InterventionEventKind = 'edit' | 'discard';
export type ElementOpKind = 'add' | 'remove' | 'rename' | 'reorder';

/**
 * Lightweight indicative summary of an SVG artifact, stored on
 * intervention events for the svg_raw / svg_structured phases instead
 * of the full SVG content (which can be hundreds of KB).
 * See specs/intervention-recording.allium § SvgMetrics.
 */
export interface SvgMetrics {
  size: number;             // byte length of the SVG string
  entities: number;         // count of geometric DOM elements
  classes: string[];        // ordered union of all class= values
  structuralHash: string;   // 8-char fingerprint of all `d=` attributes
}

/**
 * Portability header injected ONLY when a row leaves its containing
 * library (e.g. "Copy Row" → clipboard). Inside a library export the
 * library config already carries this information, so events never
 * duplicate it. See specs/intervention-recording.allium § 1.
 */
export interface RowClipboardContext {
  lang: string;
  uiLang?: string;
  geoContext?: { lat: string; lng: string; region: string };
}

export interface InterventionEvent {
  /** Stable short id (8-char hex) generated at creation. Lets per-event
   *  annotations and audit-panel curation survive reordering or partial
   *  deletion of the events array. */
  id: string;
  phase: InterventionPhase;
  kind: InterventionEventKind;
  at: string; // ISO 8601
  op?: ElementOpKind; // present iff phase = 'elements' and kind = 'edit'
  before?: unknown;
  after?: unknown; // absent when kind = 'discard'
  /** Gemini model id that produced the artifact being discarded. Only
   *  set on discard events for AI-generated phases (nlu, elements, prompt). */
  modelId?: string;
}

export interface InterventionSession {
  startedAt: string;
  endedAt?: string;
  events: InterventionEvent[];
}

export interface RowInterventionLog {
  sessions: InterventionSession[];
}

export interface RecordingSetting {
  enabled: boolean;
}

export interface RowData {
  id: string;
  UTTERANCE: string;

  // Pipeline Data
  // Phase 1: "Comprender" (Understanding) - NLU Analysis
  NLU?: NLUData | string;

  // Phase 2: "Componer" (Compose) - Visual Strategy
  elements?: VisualElement[];
  prompt?: string;

  // Phase 3: "Producir" (Produce) - Image Generation
  bitmap?: string;       // Base64 PNG data URL — set by bitmap-producing models
  rawSvg?: string;       // Native SVG — set by vector models in Phase 3 (Gemini image / Recraft vector)
  structuredSvg?: string; // mf-svg-schema compliant SVG (Phase 5)
  /** Model that produced Phase 3 output. Frozen at Phase 3 completion. */
  generationModel?: GenerationModel;

  // Discard flags. When true, the artifact is preserved on disk and in
  // memory (for telemetry / research / regeneration) but is NOT
  // considered valid by downstream consumers — notably the PDF picker,
  // which falls through to the next downstream artifact. Cleared
  // automatically whenever the matching artifact is (re)generated.
  bitmapDiscarded?: boolean;
  rawSvgDiscarded?: boolean;
  structuredSvgDiscarded?: boolean;

  // Global Pipeline Status
  status: 'idle' | 'processing' | 'completed' | 'error';

  // Step Statuses
  nluStatus: StepStatus;            // Phase 1: Comprender (Claude Haiku → NLU)
  visualStatus: StepStatus;         // Phase 2: Componer  (Claude Haiku → VisualDOM + prompt)
  bitmapStatus: StepStatus;         // Phase 3: Producir  (image generation model → rawSvg or bitmap)
  structuredSvgStatus?: StepStatus; // Phase 5: Estructurar (vision model → structuredSvg)
  phase5Mapping?: StructuringMapping; // intermediate result awaiting review (recording mode)

  // Metrics
  nluDuration?: number;
  visualDuration?: number;
  bitmapDuration?: number;

  // Intervention recording (see specs/intervention-recording.allium)
  interventionLog?: RowInterventionLog;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

export interface SVGStyleConfig {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  [key: string]: any; // Allow custom properties
}

import type { StyleDefinition, KeyframeDefinition } from './lib/style-editor/lib/types';

// ── Generation Model ─────────────────────────────────────────────────────────

/** The Phase 3 generation models, by stable API identifier. */
export type GenerationModel =
  | 'gemini-2.5-flash-image'
  | 'gemini-3.1-flash-image'
  | 'gemini-3-pro-image'
  | 'recraftv4_1'
  | 'recraftv4_1_vector'
  | 'recraftv4_1_utility_vector'
  | 'recraftv4_1_pro_vector';

/** Output type classification: *_vector models produce SVG ('vector'); all others produce PNG ('bitmap'). */
export type ModelFamily = 'bitmap' | 'vector';

export function getModelFamily(model: GenerationModel): ModelFamily {
  return model.endsWith('_vector') ? 'vector' : 'bitmap';
}

export const DEFAULT_GENERATION_MODEL: GenerationModel = 'gemini-2.5-flash-image';

/** Human-readable labels for GenerationModel values (used by GenerationModelSelector). */
export const GENERATION_MODEL_LABELS: Record<GenerationModel, string> = {
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash',
  'gemini-3.1-flash-image': 'Gemini 3.1 Flash',
  'gemini-3-pro-image': 'Gemini 3 Pro',
  'recraftv4_1': 'Recraft (raster)',
  'recraftv4_1_vector': 'Recraft (vector)',
  // Utility: Recraft's variant tuned for "flat lighting, front-facing
  // composition, and simple scenes" — closest fit to AAC pictogram style.
  'recraftv4_1_utility_vector': 'Recraft Utility (vector)',
  'recraftv4_1_pro_vector': 'Recraft Pro (vector)',
};

/**
 * Generation models that are configured but NOT operational right now, mapped
 * to the reason. Consumed by the GenerationModelSelector in App.tsx to disable
 * these options. Vaciar este objeto cuando la cuota/modelo vuelvan a estar
 * disponibles.
 *
 * Re-verificado 2026-06-13 (en vivo) contra Vertex project `pictos-vertex`,
 * location `global`: los tres modelos de la familia Gemini devuelven imagen
 * (image/png) — gemini-2.5-flash-image, gemini-3.1-flash-image y
 * gemini-3-pro-image. Por eso el mapa queda vacio. Nota operativa: la cuota de
 * gemini-3-pro-image es baja y puede devolver 429 RESOURCE_EXHAUSTED de forma
 * intermitente; el cliente debe degradar con un mensaje claro en ese caso.
 */
export const INOPERATIVE_GENERATION_MODELS: Partial<Record<GenerationModel, string>> = {
  // Re-verificado 2026-07-12 (en vivo): gemini-3-pro-image responde 200 y
  // genera imagen. Su cuota diaria en el proyecto Google es baja y puede
  // agotarse de forma intermitente, pero eso ahora se maneja en runtime (el
  // worker devuelve un mensaje claro en el 429) en lugar de deshabilitar el
  // modelo permanentemente aquí. Reservar este mapa para modelos realmente
  // rotos (404, retirados).
};

/** Migrates a legacy imageModel string to the canonical GenerationModel value. */
export function migrateImageModel(imageModel: string | undefined): GenerationModel {
  if (!imageModel) return DEFAULT_GENERATION_MODEL;
  if (imageModel === 'recraftv4_1_vector') return 'recraftv4_1_vector';
  if (imageModel === 'recraftv4_1') return 'recraftv4_1';
  if (imageModel.includes('pro')) return 'gemini-3-pro-image';
  if (imageModel.includes('flash') || imageModel.startsWith('gemini')) return 'gemini-2.5-flash-image';
  return DEFAULT_GENERATION_MODEL;
}

const VALID_GENERATION_MODELS: readonly GenerationModel[] = [
  'gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image',
  'recraftv4_1', 'recraftv4_1_vector', 'recraftv4_1_utility_vector', 'recraftv4_1_pro_vector',
];

/** Migrates a stored generationModel string — maps removed -preview IDs to stable IDs. */
export function migrateGenerationModel(model: string | undefined): GenerationModel {
  if (!model) return DEFAULT_GENERATION_MODEL;
  if (model === 'gemini-3.1-flash-image-preview') return 'gemini-3.1-flash-image';
  if (model === 'gemini-3-pro-image-preview') return 'gemini-3-pro-image';
  if ((VALID_GENERATION_MODELS as readonly string[]).includes(model)) return model as GenerationModel;
  return DEFAULT_GENERATION_MODEL;
}

/** Result from Phase 3 (PRODUCIR). Exactly one of svg/bitmap will be set. */
export interface Phase3Result {
  /** Present for vector models (Gemini image / Recraft *_vector) — native SVG string. */
  svg?: string;
  /** Present for all bitmap-producing models — base64 PNG data URL. */
  bitmap?: string;
  generationModel: GenerationModel;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface GlobalConfig {
  lang: string; // Language for NLU processing (e.g., 'es', 'en')
  uiLang?: 'en-GB' | 'es-419'; // UI language (independent from NLU language)
  geoContext?: {
    lat: string;
    lng: string;
    region: string;
  };

  /** @deprecated v2.0 — was Gemini Image aspect ratio; no longer used. Kept for persistence compatibility. */
  aspectRatio?: string;
  /** @deprecated v2.0 — migrated to generationModel on first load. */
  imageModel?: string;
  /** @deprecated Use comprenderModel + componerModel instead.
   *  Migration fallback: if neither field is set, both phases use this value. */
  nluModel?: NluModel;
  /** Phase 1 (COMPRENDER) model. Persisted per library. Defaults to DEFAULT_NLU_MODEL. */
  comprenderModel?: NluModel;
  /** Phase 2 (COMPONER) model. Persisted per library. Defaults to DEFAULT_NLU_MODEL. */
  componerModel?: NluModel;
  /** Phase 3 generation model. Persisted in localStorage. */
  generationModel: GenerationModel;
  /** Phase 5 structuring model. Persisted in localStorage. Defaults to DEFAULT_PHASE5_MODEL. */
  phase5Model?: Phase5StructuringModel;
  /** Whether the "Configuración avanzada" panel section is expanded. Persisted. */
  advancedConfigOpen?: boolean;
  name: string;
  credits?: string; // Autores/institución para atribución de la librería
  license: string;
  visualStylePrompt: string;
  /** Semantic domain context injected into Phase 1 (COMPRENDER) and Phase 2 (COMPONER).
   *  Tells the NLU how to interpret utterances within a specific domain (e.g. "computer
   *  interface", "hospital", "cooking"). Separate from visualStylePrompt which targets Phase 3. */
  domainContext?: string;
  /** Structured style definitions — single source of truth for CSS classes embedded in SVGs */
  svgStyleDefs?: StyleDefinition[];
  /** Structured keyframe definitions */
  svgKeyframes?: KeyframeDefinition[];
  /** @deprecated Use svgStyleDefs instead */
  svgStyles?: {
    [className: string]: SVGStyleConfig;
  };
  /** Intervention recording setting (see specs/intervention-recording.allium) */
  recording?: RecordingSetting;
  /** Library presentation mode (see specs/library-views.allium) */
  libraryViewMode?: 'list' | 'grid';
  /** Preferred colors sent to Recraft as controls.colors (hex strings, max 10). Recraft-specific; ignored by Gemini. */
  paletteColors?: string[];
}



export const VOCAB = {
  speech_act: ['assertive', 'directive', 'commissive', 'expressive', 'declarative', 'interrogative'],
  intent: ['inform', 'request', 'desire_expression', 'command', 'offer', 'promise', 'thanking', 'greeting', 'question', 'complaint'],
  role_type: ['Agent', 'Object', 'Event', 'Attribute', 'Place', 'Time', 'Abstract', 'Quantity', 'Recipient', 'Instrument'],
  definiteness: ['none', 'definite', 'indefinite'],
  lang: ['es-419', 'en-GB'] as const,
  domain: [
    'transporte',
    'salud',
    'alimentación',
    'educación',
    'vida_cotidiana',
    'trabajo',
    'emociones',
    'tiempo_libre',
    'dinero',
    'seguridad',
    'comunicación',
    'lugar',
    'trámites',
  ] as const,
};

/** NSM 65 semantic primes (Goddard & Wierzbicka, Chart v19, 2017) — bilingual ES/EN */
export const VOCAB_NSM = {
  substantives: {
    en: ['I', 'YOU', 'SOMEONE', 'SOMETHING~THING', 'PEOPLE', 'BODY'],
    es: ['YO', 'TÚ~USTED', 'ALGUIEN', 'ALGO~COSA', 'GENTE~PERSONAS', 'CUERPO']
  },
  relational_substantives: {
    en: ['KIND', 'PART'],
    es: ['TIPO~CLASE', 'PARTE']
  },
  determiners: {
    en: ['THIS', 'THE SAME', 'OTHER~ELSE'],
    es: ['ESTE~ESTO', 'EL MISMO', 'OTRO']
  },
  quantifiers: {
    en: ['ONE', 'TWO', 'SOME', 'ALL', 'MUCH~MANY', 'LITTLE~FEW'],
    es: ['UNO', 'DOS', 'ALGUNOS', 'TODO~TODOS', 'MUCHO~MUCHOS', 'POCO~POCOS']
  },
  evaluators: {
    en: ['GOOD', 'BAD'],
    es: ['BUENO', 'MALO']
  },
  descriptors: {
    en: ['BIG', 'SMALL'],
    es: ['GRANDE', 'PEQUEÑO']
  },
  mental_predicates: {
    en: ['THINK', 'KNOW', 'WANT', "DON'T WANT", 'FEEL', 'SEE', 'HEAR'],
    es: ['PENSAR', 'SABER', 'QUERER', 'NO QUERER', 'SENTIR', 'VER', 'OÍR']
  },
  speech: {
    en: ['SAY', 'WORDS', 'TRUE'],
    es: ['DECIR', 'PALABRAS', 'VERDAD']
  },
  actions_events_movement: {
    en: ['DO', 'HAPPEN', 'MOVE'],
    es: ['HACER', 'PASAR~OCURRIR', 'MOVER~MOVERSE']
  },
  existence_possession: {
    en: ['BE (THERE IS)', 'HAVE'],
    es: ['HAY~ESTAR', 'TENER']
  },
  life_death: {
    en: ['LIVE', 'DIE'],
    es: ['VIVIR', 'MORIR']
  },
  time: {
    en: ['WHEN~TIME', 'NOW', 'BEFORE', 'AFTER', 'A LONG TIME', 'A SHORT TIME', 'FOR SOME TIME', 'MOMENT'],
    es: ['CUÁNDO~TIEMPO', 'AHORA', 'ANTES', 'DESPUÉS', 'MUCHO TIEMPO', 'POCO TIEMPO', 'POR UN TIEMPO', 'MOMENTO']
  },
  space: {
    en: ['WHERE~PLACE', 'HERE', 'ABOVE', 'BELOW~UNDER', 'FAR', 'NEAR', 'SIDE', 'INSIDE', 'TOUCH'],
    es: ['DÓNDE~LUGAR', 'AQUÍ', 'ARRIBA~ENCIMA', 'ABAJO~DEBAJO', 'LEJOS', 'CERCA', 'LADO', 'DENTRO', 'TOCAR']
  },
  logical_concepts: {
    en: ['NOT', 'MAYBE', 'CAN', 'BECAUSE', 'IF'],
    es: ['NO', 'QUIZÁS~TAL VEZ', 'PODER', 'PORQUE', 'SI']
  },
  intensifier_augmentor: {
    en: ['VERY', 'MORE'],
    es: ['MUY', 'MÁS']
  },
  similarity: {
    en: ['LIKE~AS~WAY'],
    es: ['COMO~ASÍ']
  }
};

/** Get flat list of NSM primes for a given language key */
export const getNSMPrimes = (langKey: 'en' | 'es'): string[] => {
  return Object.values(VOCAB_NSM).flatMap(cat => cat[langKey]);
};

// ── Multi-Library ──────────────────────────────────────────────────────────

export interface LibraryMeta {
  id: string;
  name: string;
  createdAt: string;     // ISO-8601
  modifiedAt: string;    // ISO-8601
  pictogramCount: number;
  sequenceCount: number;
  language?: string;
  sourceTemplate?: string;  // filename in /libraries/ — set when loaded from a template card
}

// ── Sequences ──────────────────────────────────────────────────────────────

export type StepState = 'blank' | 'pending' | 'complete';

export interface Step {
  id: string;
  position: number;       // 1-based, always contiguous
  utterance: string | null;
  rowId: string | null;   // non-null iff state = 'complete'
  state: StepState;
}

export interface Sequence {
  id: string;
  libraryId: string;
  name: string;
  steps: Step[];
  createdAt: string;
  modifiedAt: string;
}
