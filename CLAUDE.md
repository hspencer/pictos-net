# CLAUDE.md — PICTOS v2.0

## Quick Reference

Generative pictogram system for AAC (Augmentative and Alternative Communication).
React 19 + TypeScript 5.8 + Vite 6 + Tailwind 3.4 + Claude AI + OpenAI/Gemini/Recraft image generation.
Model lineup and defaults: `DEFAULT_MODELS` in `netlify/functions/_shared/modelCatalog.js`; evidence in docs/BENCHMARK_MODELOS_2026-11.md.

## Commands

```bash
npm run dev          # copy-schemas + optimize-thumbs + netlify dev (port 9001, Vite internal: 3000)
npm run build        # copy-schemas + optimize-thumbs + vite build → dist/
npx tsc --noEmit     # type check (no lint script in package.json)
npm run validate-i18n # catalog parity + t('...') keys used in code exist
```

Access the app at **http://localhost:9001** (not 3000 — functions only available through Netlify Dev).
Vite proxy on port 3000 forwards `/.netlify/*` to 9001, so both ports work in practice.

## Branches & Deployment

| Branch | Deploy | URL |
|--------|--------|-----|
| `main` | Netlify auto | pictos.net |
| `dev`  | Netlify auto | next.pictos.net |

Flow: `dev` → `main`

## Architecture

4-phase pipeline: 3 automatic (Comprender → Componer → Producir) + 1 optional (Estructurar).
Vectorizar is no longer a phase: on a bitmap row, phase 4 starts with "Estructurar" (from the bitmap)
(`vectorizeAndStructure`: VTracer 1.0 regions via `lib/vtracer-web` + one `restructure_regions`
call); TRAZAR (legacy VTracer 0.6 modal) remains a manual trace-only action. Reference: docs/ESTRUCTURAR.md
Full architecture with Mermaid diagrams: docs/ARCHITECTURE.md. Research framing (expert controls across comprensión, composición, producción, activación): docs/CONTROLES_DE_EXPERTICIA.md. Superseded plans live in docs/archivo/. Studies and benchmarks (index, how to view and rerun): research/README.md

- **Services**: `services/claudeService.ts` (phases 1-2, routes by provider), `services/imageGenerationService.ts` (phase 3 dispatcher: OpenAI default, Gemini, Recraft via `geminiService.ts` / `recraftService.ts`, Quiver via `callQuiver`), `services/svgStructureService.ts` (phase 4)
- **API**: `services/aiClient.ts` — always-proxy client. All calls go through Netlify Functions (`callClaude`, `callRecraft`). No API key ever reaches the browser.
- **Functions**: `netlify/functions/api-claude.js` (phases 1,2,4), `api-openai-text*` (phases 1,2 with GPT-6 Luna), `api-openai-worker-background.js` + `api-openai-poll.js` (phase 3, default), `api-gemini-worker-background.js` + `api-gemini-poll.js` (phase 3, Nano Banana 2 Lite), `api-recraft-worker-background.js` + `api-recraft-poll.js` (phase 3, Recraft), `api-quiver-worker-background.js` + `api-quiver-poll.js` (phase 3, Quiver Arrow 2), `api-gemini-detect.js` (entity detection before ESTRUCTURAR); dormant routes listed in docs/ARCHITECTURE.md section 15
- **Machine API v1**: `netlify/functions/api-v1-comprender.js`, `api-v1-componer.js` (routes `/api/v1/*`) — thin shells over `_shared/apiV1.js` → `runPhase1`/`runPhase2`; revocable service credentials (`_shared/serviceCredentials.js`, CLI `scripts/service-credentials.mjs`), idempotency, contracts in `schemas/pictos-api-schema/`. Producir/Estructurar are draft contracts only. Reference: docs/API_V1.md
- **State**: Zustand for SVG editor, localStorage for metadata, IndexedDB for binary (SVGs)
- **Main orchestrator**: `App.tsx` — processCascade, processStep, row management

## Pipeline

### Phase 1: COMPRENDER (Claude Haiku 5.5; alternative GPT-6 Luna)
- Input: utterance + GlobalConfig (lang, geoContext, domainContext)
- Method: forced tool use (`analyze_utterance`) — guaranteed JSON
- Output: `NLUData` (domain, frames, nsm_explications, visual_guidelines, pragmatics)

### Phase 2: COMPONER (Claude Haiku 5.5; alternative GPT-6 Luna)
- Input: NLUData + GlobalConfig
- Method: forced tool use (`compose_pictogram`) — guaranteed JSON
- Output: `{ elements: VisualElement[], prompt: string }`
- Each element carries `concept` (Root/Agent/Action/Object/Context/Element) derived from NLU frame roles — flows to `data-concept` in the structured SVG; legacy rows fall back to `guessConceptFromId`
- `generateSpatialPrompt()` regenerates only the prompt when user edits elements

### Phase 3: PRODUCIR (default: gpt-image-2.5-flare)
- Input: elements + prompt + visualStylePrompt + NLU context + utterance
- Model: `gpt-image-2.5-flare` (default, `api-openai-worker-background` + `api-openai-poll`), `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite, Google alternative via `api-gemini-worker-background`, added 2026-11-06: p50 3.4 s, ~US$0.034, shares the 2 req/min Vertex image quota), `recraftv4_1_vector` (native SVG, `api-recraft`) and, restored 2026-11-07 at the user's request, the rest of the Recraft V4.1 family (Utility, Pro, Utility Pro; vector and raster). `arrow-2` (QuiverAI Arrow 2, native SVG, `experimental`, added 2026-11-10: library style sent apart as `instructions`, fixed 512 viewBox, temperature 0.4, reasoning low; ~30-60 s and ~US$0.07 per pictogram; `_shared/quiverImage.js` strips its credit comment and white canvas rects; server batch capped at 10 rows via catalog `batchMaxRows`; evidence research/2026-11-10_quiver-arrow2). Every other image model is retired (2026-11-01; Recraft V4 Styles stays retired: it needs a `style_id`); `gemini-2.5-flash-image` followed on 2026-11-05 (429 under concurrency), so Vertex batch is dormant. Evidence for the 2026-11-06 round: `research/2026-11-06_benchmark-producir/`
- Prompt: one builder for browser and server, `netlify/functions/_shared/imagePrompts.js`; quoted snake_case element ids reach the image model as plain words (models drew them as captions)
- Output: raw SVG string (`rawSvg`) for vector models; bitmap PNG (`bitmap`) for raster models

### Phase 4: ESTRUCTURAR (Claude Sonnet, optional, user-initiated)
- Entity detection first (bitmap entry): `api-gemini-detect` (`_shared/entityDetection.js`, `DEFAULT_MODELS.detect` = Gemini 3.8 Flash, catalog role `'detect'`, 0 quota units) returns a box per composition entity actually drawn. Each region is told which boxes contain it, entities not drawn get no regions, and an undrawn Action becomes an implicit binding of the detected Agent. Detection failure = old behaviour. Evidence: research/2026-11-07_segmentacion-semantica (90 % of entities, ~3 s). After assembly, `fuseSameFill` unions same-paint touching shapes and similar-colour slivers per entity, kept only if fidelity holds
- Two entries, one assembly: `vectorizeAndStructure` (bitmap → mosaic regions with explicit provenance and robust colour → `restructure_regions`: assign / protect / discard proposal / split request / unresolved; nothing is deleted from the partition) and `structureSVG` (trace or native SVG → `restructure_svg`). Both end in `assembleAndVerify` (mapping validation, local assembly, fidelity at 512 px, merge-free fallback); only schema-conforming results are certified, the rest are drafts
- Editing a structured SVG: `commitSvg` runs the semantic guard (`components/SVGEditor/editor/semanticGuard.ts`) on documents with metadata bindings and refuses any edit that adds a binding violation (bound group removed/renamed/emptied/attrs changed, geometry outside bound groups); moving shapes between bound groups is allowed. Saving still runs `reviseSVG` (schema validation + `manual_edit` revision with parent hash). Boolean results go to the operands' deepest common ancestor (root only when an ancestor is transformed). Child paths get entity-based ids via `deriveChildIds` (lone shape `lugar-forma`, several `mamá-1`, `mamá-2`), drafts included. The editor's Save closes it only when the save lands; failures stay in the editor with a visible message. Style rebuilds keep `#id { fill }` per-shape colours and the focus rule (`extractPreservedRules`). Pressing an unselected shape selects and moves it in one gesture (`pendingPress`). UI labels: "Estructurar" (bitmap, primary) / "Solo trazar"; with a trace, "Estructurar trazado" / "Estructurar desde el bitmap"
- Numbering: shown as phase 4 in the UI, but its internal identifier is 5 everywhere it is persisted or logged (`phase5Model`, catalog `phases: [5]`, phase executions, attempt log). 4 was the retired VTracer step. Do not renumber: `phase5Model` lives in saved configurations. The attempt log carries `phaseName` to remove the ambiguity.
- Input: rawSvg + elements + NLU + GlobalConfig
- Method: local measurement (real anchors via getBBox+CTM, merge candidates via bbox IoU) → set-of-marks rasterization (anti-collision + leader lines) → vision call → local path assembly (safety nets) → deterministic polish (selective curve refit + coordinate rounding)
- Geometry never leaves the browser and is never model-authored
- Output: pictos-svg-schema compliant SVG with semantic groups, `data-concept` congruent with NLU, and accessibility metadata
- Full reference: docs/ESTRUCTURAR.md
- Model: `claude-sonnet-4-6`, the only one offered (2026-11-01 benchmark: 98% node coverage; Opus 4.6 leaves ~10 unresolved regions per case, GPT-5.6 and Haiku 5.5 cover 60-75% of nodes). The OpenAI (`api-openai-text*`) and Gemini (`api-gemini-structure`) vision routes stay dormant for a future model. Claude models route to `api-claude`.

## GlobalConfig Parameters

| Parameter | Phases | Status | Notes |
|---|---|---|---|
| `lang` | 1, 2, 4 | Active | NLU language + element IDs |
| `uiLang` | — | Active | UI language (independent of NLU) |
| `geoContext` | 1, 4 | Active | Regional context + a11y metadata |
| `domainContext` | 1, 2 | Active | Semantic domain injected into NLU + composition prompts (e.g. "hospital", "cooking") |
| `visualStylePrompt` | 3 | Active | Text added to the image generation prompt |
| `svgStyleDefs` | 2, 4 | Active | CSS definitions for SVG editor + structuring |
| `svgKeyframes` | 4 | Active | Animation keyframes for structured SVG |
| `generationModel` | 3 | Active | Phase 3 model: `gpt-image-2.5-flare` (default), `gemini-3.1-flash-lite-image`, Recraft V4.1 (`recraftv4_1[_utility][_pro][_vector]`), `arrow-2` (Quiver, experimental) |
| `phase5Model` | 4 | Active | Phase 4 structuring model: `claude-sonnet-4-6` (only option); options come from the model catalog |
| `aspectRatio` | — | Inactive | Was Gemini Image aspect ratio; no longer used |
| `imageModel` | — | Inactive | Legacy; migrated to `generationModel` on first load |

## Conventions

- Code & commits in English
- User-facing text in Spanish (es-419), i18n via `locales/` + `useTranslation()`
- No emojis in Markdown or docs
- Conventional commits: `type(scope): message`
- SVG styles: zero inline attributes, two-level CSS model (see docs/CSS_STYLING_ARCHITECTURE.md)
- Scripts in `scripts/` must support Node 18 (Netlify runtime) — no `import.meta.dirname`

## Key Patterns

- Tool use in Claude: always `tool_choice: { type: 'tool', name: '...' }` — hard failure if model doesn't invoke. Sonnet 5.5, Opus 5.5 and Fable 5.1 reject forced tool_choice (400), so they cannot enter the catalog without a different client strategy
- Sampling: models flagged `fixedSampling` in the catalog (Haiku 5.5) reject non-default `temperature`; `api-claude` forwards it only when `acceptsSampling(model)`
- Prompt cache: Haiku 4.5 needs 4096 tokens to cache (the phase 1 prefix is ~2900, so it never cached); Haiku 5.5 caches from 512 (90%+ cache reads measured)
- Recraft API (non-default, via `api-recraft`): prompt only (no style/substyle), returns URL → fetched to SVG string; only invoked when `generationModel` starts with `recraft`
- Phase 4 set-of-marks: paths get numeric IDs in a rasterized PNG → Claude assigns each ID to a semantic element
- Local SVG assembly: Claude returns only `{ path_id → element_id }` map; geometry manipulation is all local
- Quota: phase 3 image generation = 1 unit/call (Recraft + Gemini workers; batch = 1 unit/row, refunded via `refundUnits` if the batch never starts); ALL Claude calls = 0 units. Limit from `DAILY_LIMIT_PER_USER` env (code default 50; prod = 50, preview = 100; env changes reach functions only on the next deploy). Role `superuser` bypasses the limit; roles are read LIVE from GoTrue at quota-decision points (`fetchFreshRoles` in `_shared/identity.js`), so a role assigned in the Identity panel applies without re-login
- Gemini auth: Vertex AI with service-account OAuth (`_shared/vertex.js`), no static API key. Env: `GOOGLE_SERVICE_ACCOUNT_JSON` (single line), optional `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`. Vertex projects are PER SITE (verified 2026-07-13 via Netlify env): prod pictos.net → `pictos-vertex` (NOT visible to herbert.spencer@gmail.com — owned by another Google identity, likely hspencer@ead.cl); preview next.pictos.net → `pictos-vertex-gmail` (gmail-owned); local `.env` → `pictos-vertex`. Image-gen quota is 2 req/min per base model by default; an increase to 20 req/min for `gemini-3-pro-image` was requested on `pictos-vertex-gmail` (2026-07-13, Cloud Quotas API). The old `gen-lang-client-0167983259` was `CONSUMER_SUSPENDED`; if "servicio bloqueado" reappears it is a stale Netlify env var, not the local `.env`
- Model catalog (`netlify/functions/_shared/modelCatalog.js`) is the single source of what each phase offers and admits. Every entry has a lifecycle `status`: `workshop`, `active`, `experimental` (offered with a warning) or `retired` (never offered, admitted by no endpoint, kept only for labels of saved configs). `modelIdsForPhase`, `modelSupportsPhase`, `modelAllowed` (endpoints), `batchModelIds` (Vertex batch: `vertexBatch` capability + workshop/active) and `assertModelAvailable` (client guard in every phase service) all derive from it; never add a model list elsewhere (`modelAdmission.test.mjs` fails if an endpoint declares one). Retiring a model is a one-line status change.
- Model benchmark: `scripts/benchmark-models.mjs` (phases 1-2, `--repairs 2` mirrors production), `scripts/eval/benchmark-images.mjs` (phase 3), `scripts/eval/summarize-benchmark.mjs`; synthetic corpus in `scripts/eval/cases/`; cadence and results in docs/BENCHMARK_MODELOS_2026-11.md
- Google model availability (re-verified live 2026-07-12 against `pictos-vertex`, location `global`; Gemini 2.5 text retired by Google 2026-10-20, Pro already 404s); image gen = `gemini-2.5-flash-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image` — all three respond 200; no newer Gemini image models exist (3.5/4 probes 404). `gemini-3-pro-image` has a low per-project daily quota; its intermittent 429 is handled at runtime (worker surfaces a clear Spanish message); a model that is truly broken or retired gets `status: 'retired'` in the catalog. Recraft API also accepts `recraftv4_1_pro[_vector]` and `recraftv4_1_utility[_vector]`; the utility-vector and pro-vector variants are exposed in the selector (Utility = flat, front-facing, predictable — good pictogram fit)
- Sequence PDF reuses the library export engine: `exportSequenceToPdf` (`sequencePdfService`) delegates to `exportLibraryToPdf` (`pdfExportService`) with `titleOverride` = sequence name and a per-cell step-number badge (top-left). Caption comes from `row.UTTERANCE`. The sequence grid view (`SequenceEditor`) mirrors `PictogramGridCell`
- Library config migration (`netlify/functions/_shared/libraryConfigMigration.js`): every config that enters the app (load, open, template import, backup restore) drops retired/unknown models (phase follows the default, logged), legacy `imageModel`/`aspectRatio`/`author`, and converts legacy `svgStyles` by colour role. Templates drop all declared models (`pins: 'drop'`); `saveLibraryConfig` never stores a model equal to its default. Rewrite shipped templates with `node scripts/migrate-library-templates.mjs --write`.
- Example libraries (`public/libraries/`): flat folder, one stable kebab-case slug per library, `.en.json` suffix for the en-GB version (`tablero.json` / `tablero.en.json`); never put dates in the filename. All are credited to MediaFranca under CC0; es-419 ones are located in Viña del Mar (Trámites in Santiago), en-GB ones in Auckland. `index.json` and `thumbs/` come from `npm run generate-index`. A rename needs an entry in `RENAMED_TEMPLATES` (App.tsx) so copies made earlier still recover their bitmaps. Bitmaps are stored as JPEG
- NLU repair on load: `sanitizeRow` silently applies `repairRowNlu` (`_shared/nluMigration.js`): letter-case fixes, the approved equivalences and removal of empty optional strings only, originals kept in `row.nluMigration`, media untouched. Add equivalences there (one source for app and `scripts/migrate-nlu.mjs`); never classify free text automatically.
- Background functions MUST verify the Identity JWT via `_shared/identity.js` (GoTrue `/user` endpoint) — never trust a decoded payload

## Pre-existing TS Errors (not my concern)

- SemanticTree.tsx: `key` prop on TreeNodeProps
- SVGCanvas.tsx: `key` prop on BoundingBoxProps
- styleUtils.ts: `SVGStyleElement` vs `HTMLStyleElement` type mismatch
