# CLAUDE.md — PICTOS.NET v2.0

## Quick Reference

Generative pictogram system for AAC (Augmentative and Alternative Communication).
React 19 + TypeScript 5.8 + Vite 6 + Tailwind 3.4 + Claude AI + Recraft V4.1 Vector.

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
| `recraft` | local only | — |

Flow: `recraft` → `dev` (preview) → `main` (production)

## Architecture

4-phase pipeline: 3 automatic (Comprender → Componer → Producir) + 1 optional (Estructurar).
Phase 4 (Vectorizar/VTracer) is present in the codebase but eliminated from the cascade —
Recraft V4.1 delivers native SVG so VTracer is no longer needed.

- **Services**: `services/claudeService.ts` (phases 1-2), `services/recraftService.ts` (phase 3), `services/svgStructureService.ts` (phase 4)
- **API**: `services/aiClient.ts` — always-proxy client. All calls go through Netlify Functions (`callClaude`, `callRecraft`). No API key ever reaches the browser.
- **Functions**: `netlify/functions/api-claude.js` (phases 1,2,4), `netlify/functions/api-recraft.js` (phase 3)
- **State**: Zustand for SVG editor, localStorage for metadata, IndexedDB for binary (SVGs)
- **Main orchestrator**: `App.tsx` — processCascade, processStep, row management

## Pipeline

### Phase 1: COMPRENDER (Claude Haiku)
- Input: utterance + GlobalConfig (lang, geoContext, annotatedContext)
- Method: forced tool use (`analyze_utterance`) — guaranteed JSON
- Output: `NLUData` (domain, frames, nsm_explications, visual_guidelines, pragmatics)

### Phase 2: COMPONER (Claude Haiku)
- Input: NLUData + GlobalConfig
- Method: forced tool use (`compose_pictogram`) — guaranteed JSON
- Output: `{ elements: VisualElement[], prompt: string }`
- Each element carries `concept` (Root/Agent/Action/Object/Context/Element) derived from NLU frame roles — flows to `data-concept` in the structured SVG; legacy rows fall back to `guessConceptFromId`
- `generateSpatialPrompt()` regenerates only the prompt when user edits elements

### Phase 3: PRODUCIR (Recraft V4.1 Vector)
- Input: elements + prompt + visualStylePrompt + NLU context + utterance
- Model: `recraftv4_1_vector` (via `api-recraft` Netlify Function)
- Output: raw SVG string (`rawSvg`) — no bitmap, no rasterization
- No style/substyle params — V4.1 does not support them

### Phase 4: ESTRUCTURAR (Claude Sonnet, optional, user-initiated)
- Input: rawSvg + elements + NLU + GlobalConfig
- Method: local measurement (real anchors via getBBox+CTM, merge candidates via bbox IoU) → set-of-marks rasterization (anti-collision + leader lines) → vision call → local path assembly (safety nets) → deterministic polish (selective curve refit + coordinate rounding)
- Geometry never leaves the browser and is never model-authored
- Output: mf-svg-schema compliant SVG with semantic groups, `data-concept` congruent with NLU, and accessibility metadata
- Full reference: docs/ESTRUCTURAR.md
- Model selectable via `GlobalConfig.phase5Model`: `claude-sonnet-4-6`, `claude-opus-4-6`, `gemini-2.5-pro`, `gemini-2.5-flash` (default). `gemini-2.0-flash` removed 2026-06-13 (404 in `pictos-vertex`, all regions). Claude models route to `api-claude`, `gemini-*` to `api-gemini-structure`.

## GlobalConfig Parameters

| Parameter | Phases | Status | Notes |
|---|---|---|---|
| `lang` | 1, 2, 4 | Active | NLU language + element IDs |
| `uiLang` | — | Active | UI language (independent of NLU) |
| `geoContext` | 1, 4 | Active | Regional context + a11y metadata |
| `annotatedContext` | 1 | Active | Extra context injected into NLU prompt |
| `visualStylePrompt` | 3 | Active | Text added to Recraft prompt |
| `svgStyleDefs` | 2, 4 | Active | CSS definitions for SVG editor + structuring |
| `svgKeyframes` | 4 | Active | Animation keyframes for structured SVG |
| `generationModel` | 3 | Active | Phase 3 model: `recraftv4_1_vector` (default), `recraftv4_1`, `gemini-2.5-flash-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image` |
| `phase5Model` | 4 | Active | Phase 4 structuring model: `claude-sonnet-4-6`, `claude-opus-4-6`, `gemini-2.5-pro`, `gemini-2.5-flash` (default) |
| `aspectRatio` | — | Inactive | Was Gemini Image aspect ratio; Recraft uses fixed size |
| `imageModel` | — | Inactive | Legacy; migrated to `generationModel` on first load |

## Conventions

- Code & commits in English
- User-facing text in Spanish (es-419), i18n via `locales/` + `useTranslation()`
- No emojis in Markdown or docs
- Conventional commits: `type(scope): message`
- SVG styles: zero inline attributes, two-level CSS model (see docs/CSS_STYLING_ARCHITECTURE.md)
- Scripts in `scripts/` must support Node 18 (Netlify runtime) — no `import.meta.dirname`

## Key Patterns

- Tool use in Claude: always `tool_choice: { type: 'tool', name: '...' }` — hard failure if model doesn't invoke
- Recraft API: `recraftv4_1_vector` model, prompt only (no style/substyle), returns URL → fetched to SVG string
- Phase 4 set-of-marks: paths get numeric IDs in a rasterized PNG → Claude assigns each ID to a semantic element
- Local SVG assembly: Claude returns only `{ path_id → element_id }` map; geometry manipulation is all local
- Quota: phase 3 image generation = 1 unit/call (Recraft + Gemini workers; batch = 1 unit/row, refunded via `refundUnits` if the batch never starts); ALL Claude calls = 0 units. Limit from `DAILY_LIMIT_PER_USER` env (code default 50; prod = 50, preview = 100; env changes reach functions only on the next deploy). Role `superuser` bypasses the limit; roles are read LIVE from GoTrue at quota-decision points (`fetchFreshRoles` in `_shared/identity.js`), so a role assigned in the Identity panel applies without re-login
- Gemini auth: Vertex AI with service-account OAuth (`_shared/vertex.js`), no static API key. Env: `GOOGLE_SERVICE_ACCOUNT_JSON` (single line), optional `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`. Active project: `pictos-vertex` (SA `pictos-vertex-sa`, role Vertex AI User). The old `gen-lang-client-0167983259` was `CONSUMER_SUSPENDED`; if "servicio bloqueado" reappears it is a stale Netlify env var, not the local `.env`
- Google model availability (verified live 2026-06-13 against `pictos-vertex`, location `global`): structuring text = `gemini-2.5-pro`, `gemini-2.5-flash` (`gemini-2.0-flash` 404s everywhere); image gen = `gemini-2.5-flash-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image` (the last has low daily quota → intermittent 429). `INOPERATIVE_GENERATION_MODELS` in `types.ts` gates broken options in the selector (currently empty)
- Sequence PDF reuses the library export engine: `exportSequenceToPdf` (`sequencePdfService`) delegates to `exportLibraryToPdf` (`pdfExportService`) with `titleOverride` = sequence name and a per-cell step-number badge (top-left). Caption comes from `row.UTTERANCE`. The sequence grid view (`SequenceEditor`) mirrors `PictogramGridCell`
- Background functions MUST verify the Identity JWT via `_shared/identity.js` (GoTrue `/user` endpoint) — never trust a decoded payload

## Pre-existing TS Errors (not my concern)

- SemanticTree.tsx: `key` prop on TreeNodeProps
- SVGCanvas.tsx: `key` prop on BoundingBoxProps
- styleUtils.ts: `SVGStyleElement` vs `HTMLStyleElement` type mismatch
