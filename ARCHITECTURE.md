# PICTOS.NET v2.5 - Architecture Documentation

**Semantic Image Architect / Semantic Pictogram Architect**

Generated: 2026-01-27

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Technology Stack](#3-technology-stack)
4. [Core Features](#4-core-features)
5. [Architecture & Design](#5-architecture--design)
6. [Component Hierarchy](#6-component-hierarchy)
7. [Data Models](#7-data-models)
8. [API Services](#8-api-services)
9. [Configuration](#9-configuration)
10. [Build & Deployment](#10-build--deployment)
11. [Key Insights](#11-key-insights)

---

## 1. Project Overview

### Purpose

PictoNet transforms natural language utterances into high-fidelity semantic pictogram schemas and bitmap images for augmentative and alternative communication (AAC) systems.

### Key Technologies

- **Natural Semantic Metalanguage (NSM)**: 65 universal semantic primitives
- **Google Gemini 2.5/3.0**: Semantic processing and image generation
- **Hierarchical Graph Architecture**: Semantic node processing
- **MediaFranca Standards**: Cognitive accessibility compliance

### Primary Use Cases

- Creating cognitively accessible pictograms from communicative intentions
- Augmentative and alternative communication (AAC) support
- Research in applied linguistics and semantic modeling
- Accessibility tooling for non-verbal communication

---

## 2. Repository Structure

```
pictos-net/
├── App.tsx                          # Main React application (1186 lines)
├── index.tsx                        # React entry point
├── index.html                       # HTML template with Tailwind & fonts
├── types.ts                         # TypeScript type definitions
├── vite.config.ts                   # Vite build configuration
├── tsconfig.json                    # TypeScript configuration
├── package.json                     # Dependencies and scripts
├── metadata.json                    # Project metadata
├── README.md                        # Spanish documentation
├── services/
│   └── geminiService.ts             # Google Gemini API integration
├── data/
│   └── canonicalData.ts             # VCSCI core semantic module
└── .git/                            # Version control
```

### Architecture Principles

- **services/**: API layer (Gemini integration)
- **data/**: Dataset and canonical data modules
- **types.ts**: Unified type definitions
- **App.tsx**: UI components and state management

---

## 3. Technology Stack

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| React | ^19.2.3 | UI framework |
| ReactDOM | ^19.2.3 | DOM rendering |
| @google/genai | ^1.38.0 | Google Gemini AI API |
| lucide-react | ^0.562.0 | Icon library |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| TypeScript | ~5.8.2 | Type-safe JavaScript |
| Vite | ^6.2.0 | Build tool and dev server |
| @vitejs/plugin-react | ^5.0.0 | React integration |
| @types/node | ^22.14.0 | Node.js type definitions |

### External Dependencies (CDN)

- **Tailwind CSS**: Utility-first CSS framework
- **Google Fonts**: Lexend (primary), Fira Code (monospace)

---

## 4. Core Features

### 4.1 Four-Stage Semantic Pipeline

```
Utterance → NLU → Visual Topology → Bitmap → Evaluation
```

#### Stage 1: NLU (Natural Language Understanding)

- **Input**: Utterance (natural language text)
- **Model**: Gemini-3-pro-preview
- **Output**: Structured semantic schema
  - Speech acts (assertive, directive, commissive, expressive)
  - Intent classification (inform, request, desire_expression, command)
  - Frame-based semantic roles (FrameNet compatible)
  - NSM explications (65 primitive semantic decomposition)
  - Logical form, pragmatics, visual guidelines

#### Stage 2: Visual Topology

- **Input**: NLU semantic data
- **Model**: Gemini-3-pro-preview
- **Output**: Two components
  - **elements**: Hierarchical visual component tree
  - **prompt**: Spatial articulation logic describing topology

#### Stage 3: Bitmap Rendering

- **Input**: Visual elements + spatial prompt + style config
- **Models**:
  - `gemini-2.5-flash-image` (fast)
  - `gemini-3-pro-image-preview` (high-quality)
- **Output**: Base64 PNG image (data URL)
- **Aspect Ratios**: 1:1, 3:4, 4:3, 9:16, 16:9

#### Stage 4: Evaluation (Manual)

- **Input**: Generated bitmap
- **Method**: VCSCI metrics (Vocabulary of Core Semantic Communicative Intentions)
- **Output**: Hexagonal evaluation across 6 dimensions (Likert 1-5 scale)
  - **Semantics**: Accuracy of meaning
  - **Syntactics**: Visual composition quality
  - **Pragmatics**: Context fitness
  - **Clarity**: Legibility and recognition
  - **Universality**: Cultural independence
  - **Aesthetics**: Visual appeal

### 4.2 Data Management Features

- **Transversal Consistency**: Unified JSON schema across entire pipeline
- **Full-Dump Export**: Projects exported with Base64 embedded images
- **Project Import**: Support for legacy and v2.5 formats
- **Local Storage**: Persistent browser storage
- **Batch Processing**: Multi-row processing with cascading execution

### 4.3 Workbench Capabilities

- **Editable Pipeline**: Manual editing at each stage
- **Status Tracking**: 5-state system (idle, processing, completed, error, outdated)
- **Cascading Validation**: Editing marks downstream stages as "outdated"
- **Search & Discovery**: Full-text search with auto-completion
- **Library Management**: Import/export semantic graphs

### 4.4 Semantic Monitoring

- **Real-time Trace Console**:
  - API call timestamps
  - Processing stage completion messages
  - Duration tracking (ms to seconds)
  - Error logs with context
- **Performance Metrics**: Per-row timing data

---

## 5. Architecture & Design

### 5.1 Design Patterns

**React Hooks Pattern:**

- **useState**: Primary state management (rows, config, logs, UI states)
- **useEffect**: Side effects (localStorage sync, processing scheduling)
- **useCallback**: Event handlers (pipeline execution, row updates)
- **useMemo**: Performance optimization (filtered rows, metrics)
- **useRef**: Non-state data (file inputs, stop flags)

### 5.2 Data Flow

```
User Input (Utterance)
    ↓
generateNLU() → NLU Data (JSON)
    ↓
generateVisualBlueprint() → Visual Elements + Spatial Prompt
    ↓
generateImage() → Base64 Bitmap
    ↓
Manual Evaluation → Metrics Data
```

### 5.3 State Management

**No External State Library** - Pure React hooks

```typescript
// Core application state
const [rows, setRows] = useState<RowData[]>([]);
const [config, setConfig] = useState<GlobalConfig>(DEFAULT_CONFIG);
const [logs, setLogs] = useState<LogEntry[]>([]);

// UI state
const [viewMode, setViewMode] = useState<'home' | 'list'>('home');
const [showConsole, setShowConsole] = useState(false);
const [focusMode, setFocusMode] = useState<any>(null);
```

### 5.4 Error Handling

- Try-catch blocks in `processStep` and `processCascade`
- Status-based error tracking per step
- User feedback via trace logs
- Graceful degradation (failed steps don't prevent rendering)

---

## 6. Component Hierarchy

```
App (Main Container)
├── Header
│   ├── Navigation (Home/List toggle)
│   ├── SearchComponent (utterance search)
│   ├── ConfigButton (global settings)
│   └── ConsoleButton (trace monitor)
│
├── Main Content
│   ├── Home View
│   │   ├── Module Loading (VCSCI core)
│   │   └── Text Import (batch processing)
│   │
│   └── List View
│       └── RowComponent[] (semantic nodes)
│           ├── StepBox (NLU)
│           │   └── SmartNLUEditor
│           ├── StepBox (Visual)
│           │   └── ElementsEditor
│           ├── StepBox (Bitmap)
│           └── StepBox (Eval)
│               └── EvaluationEditor
│                   └── HexagonChart
│
├── FocusViewModal (full-screen detail views)
├── ConsolePanel (Semantic Trace Monitor)
└── ConfigPanel (global settings)
```

### Key Components

#### App Component (Root)
- Global state management
- View mode switching
- Pipeline orchestration
- localStorage persistence
- Event delegation

**Key Methods:**
- `processCascade(index)`: Full 4-stage pipeline
- `processStep(index, step)`: Single-step processing
- `addNewRow(text)`: Create semantic node
- `exportProject()`: Generate JSON dump
- `handleImportProject()`: Load from file

#### RowComponent
- Display individual semantic node
- Manage expanded/collapsed state
- Trigger step processing
- Delete row

#### StepBox
- Display processing step container
- Show status with color coding
- Manage regeneration/stop buttons
- Track elapsed time
- Provide focus mode access

**Visual States:**
- idle: gray background
- processing: orange, animated pulse
- completed: white/green
- outdated: amber
- error: red

#### SmartNLUEditor
- Display/edit NLU schema
- Metadata classification
- Frame-based role editing
- NSM explications editor
- Expandable sections with VOCAB validation

#### ElementsEditor
- Visual hierarchy tree editing
- Add/remove/rename elements
- Parent-child relationships
- Hierarchical rendering with indentation

#### EvaluationEditor + HexagonChart
- Likert scale sliders (1-5) for 6 dimensions
- Hexagon radar chart visualization
- Average score calculation
- Reasoning text input
- Real-time chart updates

---

## 7. Data Models

### 7.1 Core Types

#### RowData (Complete semantic node)

```typescript
{
  id: string;                    // Unique identifier
  UTTERANCE: string;             // Input text
  NLU?: NLUData | string;        // Semantic analysis result
  elements?: VisualElement[];    // Visual hierarchy
  prompt?: string;               // Spatial articulation
  bitmap?: string;               // Base64 PNG data URL
  evaluation?: EvaluationMetrics;// Manual evaluation
  status: 'idle' | 'processing' | 'completed' | 'error';
  nluStatus: StepStatus;         // Per-step status
  visualStatus: StepStatus;
  bitmapStatus: StepStatus;
  evalStatus: StepStatus;
  nluDuration?: number;          // Processing time (seconds)
  visualDuration?: number;
  bitmapDuration?: number;
  evalDuration?: number;
}
```

#### NLUData (Semantic analysis schema)

```typescript
{
  utterance: string;
  lang: string;                  // ISO 639-1 code
  metadata: {
    speech_act: string;          // Communicative act type
    intent: string;              // User intent classification
  };
  frames: NLUFrame[];            // FrameNet-compatible roles
  nsm_explications: Record<string, string>;  // 65 primitives
  logical_form: {
    event: string;
    modality: string;
  };
  pragmatics: {
    politeness: string;
    formality: string;
    expected_response: string;
  };
  visual_guidelines: {
    focus_actor: string;
    action_core: string;
    object_core: string;
    context: string;
    temporal: string;
  };
}
```

#### NLUFrame (Semantic role frame)

```typescript
{
  frame_name: string;            // FrameNet compatible
  lexical_unit: string;          // Main predicate
  roles: Record<string, NLUFrameRole>;
}
```

#### NLUFrameRole (Individual role)

```typescript
{
  type: string;                  // Agent, Object, Event, Attribute, Place, Time, Abstract, Quantity, Recipient, Instrument
  surface: string;               // Surface text
  lemma?: string;
  definiteness?: string;         // none, definite, indefinite
  ref?: string;
  ref_frame?: string;
}
```

#### VisualElement (Hierarchical visual component)

```typescript
{
  id: string;                    // snake_case noun identifier
  children?: VisualElement[];    // Recursive tree structure
}
```

#### EvaluationMetrics (VCSCI evaluation)

```typescript
{
  semantics: number;             // 1-5 Likert scale
  syntactics: number;
  pragmatics: number;
  clarity: number;
  universality: number;
  aesthetics: number;
  reasoning: string;             // Human explanation
}
```

### 7.2 Vocabulary Enumerations

#### VOCAB (Semantic vocabulary)

```typescript
{
  speech_act: ['assertive', 'directive', 'commissive', 'expressive', 'declarative', 'interrogative'],
  intent: ['inform', 'request', 'desire_expression', 'command', 'offer', 'promise', 'thanking', 'greeting', 'question', 'complaint'],
  role_type: ['Agent', 'Object', 'Event', 'Attribute', 'Place', 'Time', 'Abstract', 'Quantity', 'Recipient', 'Instrument'],
  definiteness: ['none', 'definite', 'indefinite'],
  lang: ['en', 'es', 'fr', 'pt', 'it', 'de']
}
```

#### VOCAB_NSM (65 Universal Semantic Primitives)

Based on Wierzbicka/Goddard Natural Semantic Metalanguage:

- **Substantives**: I, YOU, SOMEONE, SOMETHING, PEOPLE, BODY
- **Determiners**: THIS, THE SAME, OTHER
- **Quantifiers**: ONE, TWO, SOME, ALL, MUCH/MANY, LITTLE/FEW
- **Evaluators**: GOOD, BAD
- **Descriptors**: BIG, SMALL
- **Mental Predicates**: THINK, KNOW, WANT, FEEL, SEE, HEAR
- **Speech**: SAY, WORD, TRUE
- **Actions**: DO, HAPPEN, MOVE
- **Existence**: THERE IS, HAVE, BE
- **Life/Death**: LIVE, DIE
- **Time**: WHEN, TIME, NOW, BEFORE, AFTER, A LONG TIME, A SHORT TIME, FOR SOME TIME, MOMENT
- **Space**: WHERE, PLACE, HERE, ABOVE, BELOW, FAR, NEAR, SIDE, INSIDE, TOUCH
- **Logical**: NOT, MAYBE, CAN, BECAUSE, IF
- **Intensifier**: VERY, MORE
- **Similarity**: LIKE

### 7.3 VCSCI Core Module

20 core semantic communicative intentions (canonicalData.ts):

1. **Physiological Needs**: Water, food, bathroom, sleep
2. **Action Control**: Help, stop, more, finished
3. **Preferences**: Like/dislike, rejection
4. **Emotional States**: Pain, happy, sad
5. **Information Seeking**: What, where questions
6. **Social Interaction**: Hello, goodbye, thanks, play

---

## 8. API Services

### 8.1 Gemini Service (geminiService.ts)

**Configuration:**
- Environment: `GEMINI_API_KEY`
- Client: `GoogleGenAI` from `@google/genai`

**Models:**
- `gemini-3-pro-preview`: NLU and visual topology
- `gemini-2.5-flash-image`: Fast image generation
- `gemini-3-pro-image-preview`: High-quality images

### 8.2 Service Functions

#### generateNLU(utterance: string): Promise<NLUData>

**Purpose**: Semantic analysis of natural language

**Input**: Natural language utterance string

**Processing**:
- System instruction with NSM primitive constraints
- Strict adherence to mediafranca/nlu-schema v1.0
- JSON output validation and cleanup

**Output**: Structured NLU semantic analysis

**Model**: gemini-3-pro-preview

---

#### generateVisualBlueprint(nlu: NLUData, config: GlobalConfig): Promise<Partial<RowData>>

**Purpose**: Convert semantic data to visual hierarchy

**Input**: NLU data + global configuration

**Processing**:
- Language-aware element ID generation (snake_case)
- Spatial topology articulation (composition focus)
- Hierarchical element structure

**Output**: `{ elements: VisualElement[], prompt: string }`

**Model**: gemini-3-pro-preview

---

#### generateImage(elements: VisualElement[], prompt: string, row: any, config: GlobalConfig): Promise<string>

**Purpose**: Generate bitmap image from visual specification

**Input**: Visual elements, spatial prompt, row data, config

**Processing**:
- Combines spatial + style prompts + metadata
- Applies aspect ratio from config
- Model selection based on config.imageModel

**Output**: Base64 data URL string

**Models**:
- `flash`: gemini-2.5-flash-image
- `pro`: gemini-3-pro-image-preview

**Aspect Ratios**: 1:1, 3:4, 4:3, 9:16, 16:9

---

### 8.3 Response Parsing

**cleanJSONResponse()**: Extracts JSON from markdown code blocks, handles nested structures

**Error Handling**:
- API errors logged to trace console
- User-friendly error messages
- Graceful failure with retry capability

---

## 9. Configuration

### 9.1 Environment Variables

```bash
# Required for production
GEMINI_API_KEY=<Google Generative AI API Key>
```

### 9.2 Build Configuration (vite.config.ts)

```typescript
{
  server: {
    port: 3000,
    host: '0.0.0.0'
  },
  plugins: [react()],
  define: {
    'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
}
```

### 9.3 TypeScript Configuration

- **Target**: ES2022
- **Module**: ESNext
- **JSX**: react-jsx (automatic runtime)
- **Module Resolution**: bundler
- **Path Alias**: `@/*` → project root

### 9.4 localStorage Keys

- `pictos_v19_storage`: Persisted rows array
- `pictos_v19_config`: Persisted global configuration

### 9.5 Default Global Configuration

```typescript
{
  lang: 'es',                    // Spanish default
  aspectRatio: '1:1',            // Square images
  imageModel: 'flash',           // Fast model
  author: 'PICTOS.NET',
  license: 'CC BY 4.0',
  visualStylePrompt: "Siluetas sobre un fondo blanco plano. Sin degradados...",
  geoContext: {
    lat: '40.4168',
    lng: '-3.7038',
    region: 'Madrid, ES'
  }
}
```

---

## 10. Build & Deployment

### 10.1 Build Scripts

```json
{
  "dev": "vite",                 // Start dev server at port 3000
  "build": "vite build",         // Production build
  "preview": "vite preview"      // Preview production build
}
```

### 10.2 Development Workflow

1. Install dependencies: `npm install`
2. Set environment: Create `.env` with `GEMINI_API_KEY`
3. Start dev server: `npm run dev`
4. Access at: `http://localhost:3000`
5. Production build: `npm run build`

### 10.3 Build Output

- **Directory**: `dist/`
- **Format**: ES modules
- **Target**: Modern browsers (ES2022)

---

## 11. Key Insights

### 11.1 Design Principles

1. **Semantic-First Architecture**: Everything flows from semantic analysis (NLU)
2. **Graph-Based Composition**: Nodes = semantic intentions; edges = relationships
3. **MediaFranca Compliance**: Follows mediafranca/nlu-schema and NSM primitives
4. **Iterative Refinement**: Manual editing at each stage with downstream invalidation
5. **Cognitive Accessibility**: Designed for non-verbal users and cognitive disabilities
6. **Language Agnostic**: Supports multiple languages with auto-detection

### 11.2 Technical Decisions

1. **React Hooks Only**: No Redux/Context API; lightweight state management
2. **TypeScript**: Full type safety across codebase
3. **Tailwind CSS**: Utility-first styling for rapid development
4. **Browser-Based**: No backend server (direct API calls)
5. **localStorage**: Ephemeral persistence (session-based)
6. **Vite**: Fast builds and HMR
7. **CDN Dependencies**: Reduced build complexity

### 11.3 Current Limitations

- Single-browser storage (no cloud sync)
- No user authentication/accounts
- Sequential API calls (no batching)
- Limited to Gemini API rate limits

### 11.4 Potential Extensions

- Backend with database for persistent projects
- Multi-user collaboration features
- Batch processing pipeline
- Vector search for semantic similarity
- Export to AAC device formats (SVG, PDF)
- Version control for project iterations

---

## 12. Version History

Recent commits:

- `ae3a740`: Visual style prompt improvement
- `de75c2d`: NLUFrameRole type additions
- `9b29e08`: VCSCI evaluation metrics and UI
- `f6ceb92`: NLU primitives refinement
- `30c4574`: Initial project structure

---

## Summary

**PICTOS.NET** is a sophisticated semantic pictogram generation system combining:

1. **NLP**: Gemini-powered NLU analysis using NSM primitives
2. **Visual Design**: Hierarchical element composition with spatial articulation
3. **Image Generation**: Multi-model synthesis (flash/pro)
4. **User Evaluation**: Manual VCSCI metrics for quality assessment
5. **Accessibility Focus**: Designed for AAC and cognitive accessibility

The architecture emphasizes **semantic consistency** across a 4-stage pipeline, **user control** through an editable workbench, and **research capability** through detailed logging and metrics.

All code is React/TypeScript with a focus on rapid iteration and semantic precision in service of accessibility and linguistic research.

---

**Document Generated**: 2026-01-27
**Repository**: `/Users/hspencer/Sites/pictos-net`
**Branch**: `local-dev`
**Main Branch**: `main`
