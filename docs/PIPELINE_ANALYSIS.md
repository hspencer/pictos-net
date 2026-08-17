# Generative Pipeline — Technical Analysis

**Historical pipeline snapshot — PICTOS.NET v2.4.0**
Last updated: 2026-07-29

> This document records the pipeline as analysed in v2.4.0 and is retained as
> a research artefact. It is not the current operational specification. For the
> deployed v2.5.0 behaviour use `specs/visual-reasoning.allium`,
> `specs/svg-structuring.allium`, and `docs/PROJECT_CONTEXT.md`. In particular,
> the current pipeline distinguishes optional VECTORIZAR and ESTRUCTURAR phases
> and supports configurable Claude/Gemini/Recraft models.

This document describes each phase of the generative pipeline in technical detail — the prompts, constraints, forced formats, transport mechanisms, and post-processing steps — and identifies opportunities for improvement. It is intended as a research artefact for pipeline evaluation and participatory design sessions.

## Table of Contents

1. [Overview](#1-overview)
2. [Phase 1: COMPRENDER](#2-phase-1-comprender)
3. [Phase 2: COMPONER](#3-phase-2-componer)
4. [Spatial Prompt Regeneration](#4-spatial-prompt-regeneration)
5. [Phase 3: PRODUCIR](#5-phase-3-producir)
6. [Phase 4: ESTRUCTURAR](#6-phase-4-estructurar)
7. [Transport and Auth Layer](#7-transport-and-auth-layer)
8. [Cross-cutting Observations](#8-cross-cutting-observations)
9. [Improvement Opportunities](#9-improvement-opportunities)

## 1. Overview

The pipeline transforms a natural language utterance into a semantically structured SVG pictogram through four sequential phases. Phases 1–3 run automatically and in sequence on each row. Phase 4 is optional and user-initiated.

```
Utterance
    │
    ▼
┌─────────────┐
│ COMPRENDER  │  Phase 1 — NLU semantic analysis (Claude Haiku 4.5)
└─────────────┘
    │ NLUData
    ▼
┌─────────────┐
│  COMPONER   │  Phase 2 — Visual blueprint: element tree + spatial prompt (Claude Haiku 4.5)
└─────────────┘
    │ VisualElement[] + prompt string
    ▼
┌─────────────┐
│  PRODUCIR   │  Phase 3 — SVG vector generation (Recraft V4.1)
└─────────────┘
    │ rawSvg
    ▼
┌─────────────┐
│ ESTRUCTURAR │  Phase 4 — Semantic restructuring (Claude Sonnet 4.6, optional)
└─────────────┘
    │ mf-svg-schema SVG
    ▼
  SVG Editor / Export
```

All AI calls are proxied through Netlify Functions. No API key reaches the browser. Each phase can be regenerated independently from the UI.

## 2. Phase 1: COMPRENDER

**Model:** Claude Haiku 4.5 (default). Configurable per-library to Claude Sonnet 4.6, Gemini 2.5 Flash, or Gemini 2.5 Pro via `GlobalConfig.comprenderModel`.

**File:** `services/claudeService.ts` — `generateNLU()`

### What it does

Performs deep semantic and pragmatic analysis of the utterance. The output is a structured NLU object that drives every subsequent phase.

### System prompt

Written in Spanish. Positions the model as the "NLU Schema Engine" node in the PictoNet graph architecture. It injects:

- Geographic region (`geoContext.region`)
- Utterance language (`lang`)
- Optional annotated context (from `visualStylePrompt`, used as domain hint)
- The full NSM (Natural Semantic Metalanguage) prime ontology in the configured language, formatted as a Markdown table — Goddard and Wierzbicka v19 (2017), covering all semantic prime categories: SUBSTANTIVES, DETERMINERS, QUANTIFIERS, ATTRIBUTES, MENTAL PREDICATES, SPEECH, ACTIONS/EVENTS, EXISTENCE, LIFE/DEATH, TIME, SPACE, LOGICAL, INTENSIFIER, TAXONOMY, PART-WHOLE
- The list of valid domain values from `VOCAB.domain`
- Three hard rules: always invoke the tool, perform deep semantic analysis, all required fields must be present

### Forced format: `analyze_utterance` tool

Strict JSON Schema enforced via Claude's tool use (`tool_choice: { type: 'tool', name: 'analyze_utterance' }`). The model must invoke the tool or the call throws — there is no text-fallback path.

The schema requires:

| Field | Type | Description |
|---|---|---|
| `utterance` | string | The original utterance |
| `lang` | string | Detected or configured language |
| `domain` | string | Inferred domain (from VOCAB.domain) |
| `metadata` | object | `speech_act` + `intent` |
| `frames` | array | FrameNet frames, each with `frame_name`, `lexical_unit`, and a `roles` map |
| `nsm_explications` | object | NSM prime decompositions keyed by concept |
| `logical_form` | object | `event` + `modality` |
| `pragmatics` | object | `politeness`, `formality`, `expected_response` |
| `visual_guidelines` | object | `focus_actor`, `action_core`, `object_core`, `context`, `temporal` |

Frame roles are typed with a controlled enum: `Agent`, `Addressee`, `Speaker`, `Experiencer`, `Patient`, `Theme`, `Beneficiary`, `Instrument`, `Object`, `Event`, `Location`, `Time`, `Other`. Each role filler carries `type` (required), `surface`, `lemma`, `definiteness`, and cross-frame references (`ref`, `ref_frame`).

**NSM explications language:** written in the utterance language, not in English. Spanish utterances produce Spanish NSM primes; English utterances produce English primes.

**Frame label language:** `frame_label` is generated as a translation of the FrameNet `frame_name` into the utterance language.

### Token budget

`max_tokens: 4096`. Both the system prompt and the tool schema are sent with `cache_control: { type: 'ephemeral' }` for prompt caching.

### User message

A single line: `UTTERANCE: "«utterance text»"`

### Output

`NLUData` object. The `visual_guidelines` sub-object is the primary bridge to Phase 2 and Phase 4: `focus_actor`, `action_core`, and `object_core` are used verbatim in the Recraft prompt (Phase 3) as semantic context.

## 3. Phase 2: COMPONER

**Model:** Claude Haiku 4.5 (default). Configurable via `GlobalConfig.componerModel`.

**File:** `services/claudeService.ts` — `generateVisualBlueprint()`

### What it does

Translates the semantic NLU graph into (a) a flat-to-shallow tree of visual elements and (b) a spatial composition prompt. The element tree becomes the DOM of the final SVG; the prompt drives Recraft's image generation.

### System prompt

Written in English. Positions the model as the "Visual Topology Node". It injects:

- Target language (from NLUData, not GlobalConfig — ensures elements use the utterance language)
- Concept mapping rules: how NLU frame roles map to element concepts (Agent, Action, Object, Context, Element)
- ID rules: simple nouns in the utterance language, snake_case for compounds
- Explicit prohibition on emitting a root `pictograma`/`pictogram` node (added deterministically post-call)
- Available CSS classes from `GlobalConfig.svgStyleDefs` (hint only — not enforced by schema)
- Prompt rules: wrap element IDs in single quotes, topology only (no style), 3–6 sentences

### Forced format: `compose_pictogram` tool

Strict JSON Schema via forced tool use. Two levels of nesting are fully specified (no `$ref`) to prevent id-less nodes — an earlier schema bug using `$ref` allowed the model to omit `id` and `concept` on children.

```
{
  elements: [
    {
      id: string (noun, utterance language),
      concept: enum [Agent | Action | Object | Context | Element],
      children?: [
        { id, concept, children? }  // same shape, two levels explicit
      ]
    }
  ],
  prompt: string  // 3-6 sentences, topology only
}
```

The `concept` field is required on every element, including nested children, and must be derived from the NLU frame roles — not inferred from the ID text.

### Post-processing

1. `normalizeElements()` — drops any node without an `id` or `concept`; prevents phantom tree nodes
2. `injectRoot()` — prepends the root element (`pictograma` or `pictogram`, language-dependent) deterministically; the model never emits it

### Token budget

`max_tokens: 4096`. System and tool both cached with `cache_control: ephemeral`.

### User message

The full NLUData object as JSON: `NLU Semantics: {…}`

### Output

`{ elements: VisualElement[], prompt: string }` — the element tree with root injected, and the spatial prompt.

## 4. Spatial Prompt Regeneration

**Model:** `componerModel` (same as Phase 2).

**File:** `services/claudeService.ts` — `generateSpatialPrompt()`

### What it does

Regenerates only the spatial composition prompt from the current element tree, without re-running Phase 2. User-triggered from the element editor.

### System prompt

Written in English. Positions the model as the "Spatial Articulation Node". Key rules: every element ID must appear in the output (wrapped in single quotes), topology only, 3–6 sentences, plain text (no JSON or Markdown).

### No tool use

This is the only phase-level call that does not use forced tool use. The model returns plain text. Failure mode is a missing or malformed string, not a schema violation.

### Retry logic

After the first attempt, `missingIds()` checks whether every element ID appears in the prompt using a substring search. If any ID is missing, a second call is made with an explicit instruction: "Your previous attempt omitted these element ids: 'x', 'y'. Rewrite so EVERY element id appears." If IDs are still missing after the retry, an error is logged but the partial prompt is used.

**Known limitation:** The substring check produces false positives when a short ID is contained within a longer one (e.g. `mesa` inside `mesita`).

### Token budget

`max_tokens: 1024`. No prompt caching (system prompt is sent as a plain string, no `cache_control`).

## 5. Phase 3: PRODUCIR

**Model:** Recraft V4.1 Vector (`recraftv4_1_vector`, default). Configurable to `recraftv4_1` (raster), `recraftv4_1_utility_vector`, or `recraftv4_1_pro_vector` via `GlobalConfig.generationModel`.

**File:** `services/recraftService.ts` — `generateImage()`

### What it does

Generates a native SVG vector pictogram from the element tree and spatial prompt. Recraft is an image generation API, not a language model — there is no system prompt or tool use.

### Prompt construction

The prompt is assembled from five sections concatenated with newlines:

```
Pictograma AAC: "«utterance»"
Contexto semántico: «focus_actor» — «action_core» — «object_core»

Elementos (jerarquía visual):
- pictograma
  - «child_id»
    - «grandchild_id»

Composición espacial:
«spatial prompt from Phase 2»

«visualStylePrompt from config, or: Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.»

Sin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.
```

If the assembled string exceeds 2,000 characters, it is truncated by slicing the prefix and appending the style suffix whole, to ensure the pictogram identity and no-text constraint always appear.

### Colour palette

Optional: `GlobalConfig.paletteColors` (hex strings) are passed as `controls.colors` to the Recraft API (max 10 colours). If none are configured, no colour control is sent.

### No style/substyle parameters

Recraft V4.1 does not support `style` or `substyle` fields. Passing them causes an API error. Style is guided entirely through the prompt.

### Post-processing

`normalizeSvgDimensions()` strips explicit `width` and `height` attributes from the `<svg>` tag and constructs a `viewBox` from them if absent, so the SVG scales to its container.

### Transport

Recraft calls use the background worker pattern: the client fires a POST to `api-recraft-worker-background` (receives 202 Accepted), then polls `api-recraft-poll` every 2 seconds for up to 120 seconds. The worker handles provider 429s with exponential backoff internally; retry progress is surfaced to the UI log. Quota (1 unit per call) is checked and reserved at the synchronous `api-recraft` gate before the background job starts.

## 6. Phase 4: ESTRUCTURAR

**Model:** Claude Sonnet 4.6 (default). Configurable to Claude Opus 4.6, Gemini 2.5 Pro, or Gemini 2.5 Flash via `GlobalConfig.phase5Model`.

**File:** `services/svgStructureService.ts`

This is the most complex phase. All geometry manipulation happens locally in the browser; the model never authors path data.

### 6.1 Local Pre-processing

Before any API call, five steps run in the browser:

**Step 1: Path inventory (`buildPathInventory`)**

Parses the raw SVG DOM. For each `<path>` element:
- Resolves its effective fill (accounting for CSS cascade and `<style>` rules)
- Classifies `fillRole` as `dark` (luminance < 0.2), `light` (luminance > 0.8), or `accent` (saturation > 0.4 and luminance > 0.1)
- Computes centroid via `getCentroid()` (bounding-box midpoint from path data approximation) or `measurePathAnchors()` (DOM-based `getBBox()` + CTM, preferred)
- Records the VTracer group (`<g>` parent) each path belongs to
- Identifies and pre-excludes background rectangles (paths covering the full viewBox)

**Step 2: Real anchor measurement (`measurePathAnchors`)**

Temporarily injects the SVG into the document to use `getBBox()` and `getScreenCTM()` for accurate real-space centroids and bounding boxes. Used by the anti-collision algorithm and merge candidate detection.

**Step 3: Set-of-marks rasterisation (`rasterizeWithMarks`)**

Renders the SVG to a canvas at 800px on the longest side (JPEG, quality 0.85). Overlays a numbered red circle on each path's centroid. Applies an iterative anti-collision algorithm (up to 30 iterations of pairwise repulsion) so overlapping marks separate until readable. If a mark is displaced more than 75% of the circle radius from its anchor, a red leader line connects mark to anchor. The resulting image is the primary visual reference sent to the model.

**Step 4: Merge candidate detection (`detectMergeCandidates`)**

A purely local geometric analysis using bounding-box IoU (intersection over union ≥ 0.7), similar area ratio, and matching fill role. Identifies pairs or groups of paths that are almost certainly double-contour traces of the same stroked line — a systematic artefact of Recraft's vector output. The detected candidates are passed to the model as hints in the user prompt.

### 6.2 System Prompt

Written in Spanish. Two variants: with and without a clean reference bitmap.

**Without reference image (common case):**
The model receives one image (the numbered trace) and is told to work from visual evidence, not from node names.

**With reference image (when a clean source bitmap is available):**
The model receives two images in order: Image A (the clean source bitmap — ground truth), Image B (the numbered trace — coordinates but noisy). Explicit instruction to use A to judge what is real and B for mark coordinates.

Key rules in both variants:
1. Work from the visual evidence in the images — do not infer content from node names
2. Every path not classified as background must appear in exactly one group's `keep` list, or in `discard`
3. Use only CSS class names from the provided palette
4. CSS classes are COLOUR, not semantics (`k` = dark/black forms, `f` = white forms/holes, `accent` = pre-coloured paths) — do not recolour: a black path must not receive class `f`
5. `parentId` must be null for top-level nodes, or a valid `nodeId` for children
6. For double-contour pairs (two near-concentric paths tracing the same stroked line): propose a merge via `merge.sources`, never choose one and silently discard the other

Preservation rule: keeping a visible element incorrectly is tolerable; losing a visible element (a hand, a speech bubble) is a hard failure.

### 6.3 User Prompt

Five sections concatenated:

1. **Intro:** Directs use of Image A vs Image B (or single-image variant)
2. **Semantic DOM:** Flat list of nodes with `id`, `concept`, `label`, and `parentId` from the VisualElement tree
3. **CSS palette:** Up to 30 CSS rules from the active style definitions (keyframe blocks stripped, first class name per rule extracted to avoid alias confusion)
4. **Marks table:** `mark N: id="…" fill-role="…" centroid=(x,y)` for every path
5. **Merge candidates:** Geometric candidates from Step 4, with instruction to verify against images
6. **SVG source:** Raw SVG code, truncated at 10,000 characters with a `<!-- … SVG truncado -->` marker

### 6.4 Tool Schema: `restructure_svg`

Forced tool use (`tool_choice: { type: 'tool', name: 'restructure_svg' }`).

```
{
  description: string,          // 1-2 sentence visual description
  groups: [
    {
      nodeId: enum (VisualDOM ids),
      label: string,
      cssClass: string,
      parentId: string | null,
      keep: string[],           // path ids to include verbatim
      merge?: {
        sources: string[]       // path ids for geometric union (model proposes; browser computes)
      } | null
    }
  ],
  discard: string[]             // path ids to exclude
}
```

`nodeId` is an enum constrained to the exact IDs from the VisualElement tree. Groups must not be empty — the schema's `minItems: 1` on `groups` and the prompt's explicit warning ("an empty array means every path was silently lost") guard against total-loss responses.

`max_tokens: 8192`

### 6.5 Local Assembly (`assembleFromMapping`)

All geometry is assembled locally:

1. **Merge resolution (`resolveMergeGeometry`):** For each group proposing a merge, validates the proposal against the local IoU detector (re-runs `detectMergeCandidates` on the proposed sources). Only merges that pass the IoU gate (≥ 0.7 overlap, similar area, same fill role) proceed to geometric union. Non-passing proposals fall back to keeping the sources as separate paths. The union itself is computed by `applyBooleanN()` (Martinez sweep-line polygon clipping, exact) followed by `applySimplify()` (Bezier refit).

2. **Path re-parenting:** Each `<path>` element is moved into its assigned `<g>` semantic group. Ancestor `transform` chains are baked onto each path (to preserve geometry after re-parenting), and inherited presentation attributes (`stroke`, `stroke-width`, `fill-rule`, etc.) are resolved from the ancestor chain and baked onto the path directly.

3. **Group rendering (`renderGroup`):** Emits `<g id="nodeId" role="group" tabindex="0" data-concept="…" aria-label="…" class="…">`. The `data-concept` value comes from the VisualElement tree (NLU-derived), not from the model's output. CSS class compatibility is checked locally: if the model assigns a class that conflicts with the path's measured colour role (e.g. assigning `f` to a dark path), the locally-derived colour class is substituted with a warning.

4. **Path polish:** `shouldSimplify()` + `roundPathD()` optionally refit polyline segments to smooth Bezier curves and round coordinates.

5. **Validation:** `filterCSS()` strips unused rules from the embedded stylesheet. `validateXML()` runs a DOMParser parse to verify well-formed output.

### 6.6 Transport

Claude models: synchronous call to `api-claude` (90-second function timeout).

Gemini models: background job pattern — client fires POST to `api-gemini-structure-background` (202 Accepted), then polls `api-gemini-structure-poll` every 2 seconds for up to 6 minutes (180 polls). The extended timeout accommodates Gemini's longer reasoning time for complex restructuring.

## 7. Transport and Auth Layer

**File:** `services/aiClient.ts`

All calls go through Netlify Functions. The client never holds an API key.

**Authentication:** GoTrue JWT, fetched from the Netlify Identity session. The token is refreshed proactively if expiry is within 2 minutes (to survive cold-start delays in background functions). In `netlify dev`, authentication is bypassed (a `NETLIFY_DEV` flag enables a passthrough in each function).

**Retry:** For synchronous calls, 502/503/504 responses trigger up to 2 retries with 3-second and 6-second delays.

**Quota:** 429 responses surface a `QuotaExceededError` with `units_used` and `limit`. Phase 3 (Recraft and Gemini image generation) consumes 1 unit per call; all Claude text calls consume 0 units. The daily limit is set per-site via `DAILY_LIMIT_PER_USER` environment variable (default 50 in production, 100 in preview).

**Background job authorisation:** Before starting any background worker, the client calls `api-authorize` synchronously. This endpoint verifies the JWT via GoTrue and writes a single-use grant blob. The background worker consumes this grant — necessary because Netlify's background function routing strips the `Authorization` header.

## 8. Cross-cutting Observations

### Language mixing in prompts

Phase 1 (COMPRENDER) system prompt is in Spanish. Phase 2 (COMPONER) system prompt is in English. Phase 4 (ESTRUCTURAR) is in Spanish. This inconsistency is historical rather than intentional. For models trained on multilingual corpora (Haiku, Sonnet) the practical effect is minimal, but it complicates prompt auditing and comparison.

### NLU context in Phase 4

Phase 4 explicitly does not receive NLUData. The rationale: structuring is a purely visual task and NLU context risks biasing the model's visual judgment (it may "see" elements because it expects them semantically, not because they are visible). The cost: the model has no semantic guidance for ambiguous cases where multiple visual interpretations are plausible.

### Phase 3 prompt language

The Recraft prompt is always assembled in Spanish (template strings are Spanish), regardless of the utterance language. This affects models that are sensitive to prompt language for stylistic output. English utterances produce a Spanish-language prompt to a multilingual image generator.

### Concept assignment source of truth

Phase 2 derives `concept` from NLU frame roles. Phase 4 reads `concept` from the VisualElement tree (NLU-derived) and writes it into `data-concept` on SVG groups. For rows created before Phase 2 emitted explicit concepts, a legacy `guessConceptFromId()` heuristic falls back to prefix matching (`actor*` → Agent, `accion*` → Action, etc.). This fallback cannot distinguish nuanced cases.

### CSS class validation at assembly

The colour-role compatibility check in `renderGroup()` enforces a fixed mapping: `dark` → `k`/`main`, `light` → `f`/`w`, `accent` → `accent`. Custom palette classes that the user defines in `svgStyleDefs` bypass this check and receive a derived colour class appended (e.g. `my-class k`). The model is unaware of this post-hoc override.

## 9. Improvement Opportunities

The following are specific, actionable observations — not a comprehensive redesign.

### 9.1 Phase 1→2: Selective NLU forwarding

Phase 2 receives the entire `NLUData` JSON (`JSON.stringify(nlu)`) as its user message. Most of the structure (NSM explications, pragmatics, logical_form) is not used by the composition task. Forwarding only `frames`, `visual_guidelines`, and `lang` would reduce the token count and improve cache hit rates.

**Impact:** Token cost reduction; more predictable Phase 2 behaviour. The full NLU remains available in the client for Phase 4's concept map.

### 9.2 Phase 3 prompt: Language consistency

The Recraft prompt template is in Spanish regardless of utterance language. For English-language libraries (e.g. Idiomatic, Kitchen) this creates a mismatch between the element IDs (in English) and the surrounding prompt text (in Spanish). Template strings should branch on the utterance language.

**Impact:** Likely small, but relevant for multilingual research libraries.

### 9.3 Spatial prompt: Substring ID check

The `missingIds()` function uses `prompt.includes(id)`. A short ID such as `mano` registers as present if the prompt contains `manos`. Replacing with a word-boundary regex (`\b${id}\b`, accounting for single-quote wrapping) would eliminate false positives.

**Impact:** Prevents silently incorrect retry signals; the fix is one line.

### 9.4 Phase 4 SVG source truncation

The raw SVG is truncated at 10,000 characters with a comment marker. Recraft's SVGs for complex pictograms can be 20–40 KB, meaning roughly half the path data is withheld from the model. The model works primarily from the image, but missing path IDs in the source make it impossible to verify mark numbers against the SVG.

**Options:** (a) Send only `<path id="…" d="…"/>` elements, omitting group wrappers and style blocks which the model does not use; (b) increase the limit with a compactified format.

### 9.5 Merge gate: IoU threshold sensitivity

The merge IoU gate (≥ 0.7) was chosen conservatively. Recraft's double-contour noise occasionally produces pairs with IoU in the 0.55–0.70 range that the gate rejects, leaving visible contour seams in the output. The gate could be made configurable or the threshold lowered with an additional area-ratio guard.

### 9.6 Phase 4 without reference image

When no clean bitmap is available (the common case: `referenceImage` is optional and typically absent), the model works only from the numbered trace, which may be noisy. The rasterised SVG at 800px is the only visual ground truth. Storing the Recraft SVG thumbnail (before structuring) as the reference image for Phase 4 would consistently provide a clean baseline.

**Impact:** Better discard decisions; fewer false-positive path drops. Requires saving an additional small artefact per row.

### 9.7 No inter-phase feedback

The pipeline is strictly feedforward: each phase is blind to the quality of downstream outputs. If Phase 3 generates a pictogram that misses a key element, Phase 2 receives no signal. A lightweight rating or correction gesture at Phase 3 (e.g. "regenerate — missing focus actor") could route back to Phase 2 for prompt adjustment before re-calling Recraft.

**Impact:** Would reduce wasted generation cycles in workshop settings. This is a UI/orchestration concern, not a model constraint.

### 9.8 Spatial prompt retry: single attempt

The retry logic fires at most once (one check, one retry). For utterances with many elements (10+), a single retry may not be sufficient. An iterative loop with a small number of retries (e.g. 3 max) and a diminishing list of missing IDs would be more robust.

### 9.9 CSS palette sent to Phase 2

CSS class names are passed to Phase 2 as an informational hint in the system prompt, but the tool schema does not enforce them. The model can emit any string in `suggestedClass` (though this field is not in the current schema — classes appear only in Phase 4). Aligning Phase 2's awareness of available classes with Phase 4's palette validation would reduce the gap between composition intent and rendered style.

### 9.10 Phase 1 domain list

The domain ontology is inferred from `VOCAB.domain` (a flat string list). The model can return any string, but only values in the list are meaningful for downstream filtering. Adding the list as an `enum` constraint in the `analyze_utterance` schema would enforce consistency with no prompting overhead.

### 9.11 NSM primes: prompt caching invalidation

The NSM block is built at call time from `VOCAB_NSM` and injected into the system prompt string. Because Anthropic's prompt cache keys on exact string content, any change to `geoContext.region` or `visualStylePrompt` — even whitespace — invalidates the Phase 1 cache. Splitting the static NSM block into a separately cached prefix would preserve cache hits across configuration changes.
