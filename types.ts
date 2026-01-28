
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
  metadata: NLUMetadata;
  frames: NLUFrame[];
  nsm_explications: Record<string, string>;
  logical_form: LogicalForm;
  pragmatics: Pragmatics;
  visual_guidelines: NLUVisualGuidelines;
}

export type StepStatus = 'idle' | 'processing' | 'completed' | 'error' | 'outdated';

export type SortCriteria = 'alphabetical' | 'completeness' | 'evaluation';

export interface VisualElement {
  id: string;
  children?: VisualElement[];
}

// ICAP Hexagonal Dimensions (Manual Input - Likert 1-5)
// Aligned with official ICAP schema (mediafranca/ICAP)
export interface EvaluationMetrics {
  clarity: number;
  recognizability: number;
  semantic_transparency: number;
  pragmatic_fit: number;
  cultural_adequacy: number;
  cognitive_accessibility: number;
  reasoning: string;
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

  // Phase 3: "Producir" (Produce) - Bitmap Generation + Evaluation
  bitmap?: string; // Base64 data URL
  rawSvg?: string; // Vectorized SVG from vtracer (raw)
  structuredSvg?: string; // mf-svg-schema compliant SVG (Gemini-processed)
  evaluation?: EvaluationMetrics; // Manual Evaluation (part of Producir phase)

  // Global Pipeline Status
  status: 'idle' | 'processing' | 'completed' | 'error';

  // Step Statuses (3 phases + evaluation integrated in phase 3)
  nluStatus: StepStatus;       // Phase 1: Comprender
  visualStatus: StepStatus;    // Phase 2: Componer
  bitmapStatus: StepStatus;    // Phase 3: Producir (includes generation)
  evalStatus: StepStatus;      // Evaluation (integrated within Producir phase)

  // Metrics
  nluDuration?: number;
  visualDuration?: number;
  bitmapDuration?: number;
  evalDuration?: number;
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

export interface GlobalConfig {
  lang: string; // Language for NLU processing (e.g., 'es', 'en')
  uiLang?: 'en-GB' | 'es-419'; // UI language (independent from NLU language)
  geoContext?: {
    lat: string;
    lng: string;
    region: string;
  };
  aspectRatio: string; // '1:1', '3:4', '4:3', '9:16', '16:9'
  imageModel: string; // 'flash' | 'pro'
  author: string;
  license: string;
  visualStylePrompt: string;
  svgStyles?: {
    [className: string]: SVGStyleConfig;
  };
}

export const VOCAB = {
  speech_act: ['assertive', 'directive', 'commissive', 'expressive', 'declarative', 'interrogative'],
  intent: ['inform', 'request', 'desire_expression', 'command', 'offer', 'promise', 'thanking', 'greeting', 'question', 'complaint'],
  role_type: ['Agent', 'Object', 'Event', 'Attribute', 'Place', 'Time', 'Abstract', 'Quantity', 'Recipient', 'Instrument'],
  definiteness: ['none', 'definite', 'indefinite'],
  lang: ['en', 'es', 'fr', 'pt', 'it', 'de']
};

export const VOCAB_NSM = {
  substantives: ['I', 'YOU', 'SOMEONE', 'SOMETHING', 'PEOPLE', 'BODY'],
  determiners: ['THIS', 'THE SAME', 'OTHER'],
  quantifiers: ['ONE', 'TWO', 'SOME', 'ALL', 'MUCH/MANY', 'LITTLE/FEW'],
  evaluators: ['GOOD', 'BAD'],
  descriptors: ['BIG', 'SMALL'],
  actions_events_movement: ['DO', 'HAPPEN', 'MOVE'],
  existence: ['EXIST'],
  mental_predicates: ['THINK', 'KNOW', 'WANT', 'FEEL', 'SEE', 'HEAR'],
  speech: ['SAY', 'WORD'],
  propositions: ['KNOW', 'UNDERSTAND'],
  connectors: ['AND', 'NOT', 'MAYBE', 'CAN', 'BECAUSE', 'IF'],
  intensifiers: ['VERY', 'MORE'],
  similarity: ['LIKE', 'AS', 'WAY'],
  time: ['WHEN', 'TIME', 'NOW', 'BEFORE', 'AFTER', 'A LONG TIME', 'A SHORT TIME', 'FOR SOME TIME', 'MOMENT'],
  space: ['WHERE', 'PLACE', 'HERE', 'ABOVE', 'BELOW', 'FAR', 'NEAR', 'SIDE', 'INSIDE', 'TOUCH'],
  possession: ['MINE'],
  life_death: ['LIVE', 'DIE'],
  parts: ['PART'],
  taxonomy: ['KIND']
};
