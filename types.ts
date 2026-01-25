
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

export interface VisualElement {
  id: string;
  children?: VisualElement[];
}

export interface RowData {
  id: string;
  UTTERANCE: string;
  NLU?: NLUData | string;
  elements?: VisualElement[];
  prompt?: string;
  bitmap?: string; // Base64 data URL
  status: 'idle' | 'processing' | 'completed' | 'error';
  nluStatus: StepStatus;
  visualStatus: StepStatus;
  bitmapStatus: StepStatus; // Renamed from svgStatus
  nluDuration?: number;
  visualDuration?: number;
  bitmapDuration?: number; // Renamed from svgDuration
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

export interface GlobalConfig {
  lang: string;
  aspectRatio: string; // '1:1', '3:4', '4:3', '9:16', '16:9'
  author: string;
  license: string;
  visualStylePrompt: string;
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
  quantifiers: ['ONE', 'TWO', 'MUCH', 'MANY', 'ALL'],
  evaluators: ['GOOD', 'BAD'],
  descriptors: ['BIG', 'SMALL'],
  mental_predicates: ['THINK', 'KNOW', 'WANT', 'FEEL', 'SEE', 'HEAR'],
  speech: ['SAY', 'WORD'],
  actions_events_movement: ['DO', 'HAPPEN', 'MOVE'],
  existence_possession: ['BE', 'HAVE'],
  life_death: ['LIVE', 'DIE'],
  time: ['WHEN', 'TIME', 'NOW', 'BEFORE', 'AFTER', 'A LONG TIME', 'A SHORT TIME', 'FOR SOME TIME'],
  space: ['WHERE', 'PLACE', 'HERE', 'ABOVE', 'BELOW', 'FAR', 'NEAR', 'SIDE', 'INSIDE'],
  logical_concepts: ['NOT', 'MAYBE', 'CAN', 'BECAUSE', 'IF'],
  intensifiers_augmentors: ['VERY', 'MORE'],
  taxonomy_partonomy: ['KIND OF', 'PART OF'],
  similarity: ['LIKE', 'AS']
};
