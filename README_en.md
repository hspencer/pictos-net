# [PICTOS.NET](https://pictos.net)

**Generative Pictograms for Augmentative and Alternative Communication (AAC)**

* [![Netlify Status](https://api.netlify.com/api/v1/badges/24f068d3-f368-4526-a503-2f09af1def0b/deploy-status)](https://app.netlify.com/projects/pictos/deploys)
* ![version](https://img.shields.io/badge/version-2.3.11-violet)
* ![opensource](https://img.shields.io/badge/opensource--always-available-blue)

PICTOS.NET transforms communicative intentions expressed in natural language into pictograms using a semantic reasoning pipeline. It is part of the doctoral research of [Herbert Spencer](https://herbertspencer.net/cc) and **[MediaFranca](https://github.com/mediafranca)** — a public good open-source initiative for AAC.

The `dev` development branch contains the next version:

* view: [next.PICTOS.net](https://next.pictos.net)
* [![Netlify Status](https://api.netlify.com/api/v1/badges/c3a0cb25-110a-49a6-9d9b-05ccf7a72347/deploy-status)](https://app.netlify.com/projects/pictos-next/deploys)

## How it works

The system implements a pipeline of three automatic phases plus an optional post-processing one. Each phase is visible, editable, and independently regenerable:

**(1) Understand** (Claude Haiku) — Deep linguistic analysis based on Natural Semantic Metalanguage (NSM): 65 universal semantic primitives. It uses forced tool use to ensure valid JSON. It produces a structured schema with communicative intent, domain, semantic roles (FrameNet), and visual instructions.

**(2) Compose** (Claude Haiku) — Translates the NLU analysis into a hierarchy of visual elements (`elements`) and a spatial articulation description (`prompt`). Each element carries a semantic `concept` (Agent, Action, Object, Context) derived from the NLU's frame roles, which travels down to the final SVG's `data-concept`. If the user edits the elements, they can regenerate only the prompt without repeating the entire composition.

**(3) Produce** (Recraft V4.1 Vector) — Generates the pictogram as a native SVG from the semantic context, elements, spatial prompt, and configured visual style. There is no intermediate bitmap: the result is a directly editable vector SVG.

**(4) Structure** (Claude Sonnet, optional) — Reorganizes the raw SVG paths into semantic groups consistent with the hierarchy of phase 2, embedding accessibility metadata according to [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema). It combines local geometric measurement (real anchors via `getBBox` + CTM, pre-calculated merge candidates), a single vision call (set-of-marks with anti-collision and guide lines), local assembly with safety nets, and deterministic geometric polishing: the geometry never leaves the browser nor is it written by the model. Detailed documentation in [docs/ESTRUCTURAR.md](docs/ESTRUCTURAR.md).

The automatic cascade (1 → 2 → 3) runs when creating a new sentence or pressing Play. Phase 4 is optional and initiated manually by the user. Pictograms can be evaluated using the [ICAP](https://github.com/mediafranca/ICAP) framework.

## Detailed Schema

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#e8f0fe',
    'primaryTextColor': '#1a1a2e',
    'primaryBorderColor': '#4a6fa5',
    'lineColor': '#888',
    'fontSize': '13px',
    'fontFamily': 'Lexend, system-ui, sans-serif'
  },
  'flowchart': {
    'padding': 20,
    'nodeSpacing': 35,
    'rankSpacing': 45,
    'curve': 'basis'
  }
}}%%
flowchart TD
    UTT["<b>utterance</b><br><i>communicative intent</i>"]

    subgraph CFG["<b>GlobalConfig</b>"]
        direction TB
        cfg_lang["lang · geoContext<br>annotatedContext"]
        cfg_visual["visualStylePrompt"]
        cfg_css["svgStyleDefs · svgKeyframes"]
    end

    subgraph F1["<b>(1) UNDERSTAND</b> — Claude Haiku"]
        direction TB
        f1_proc["NSM Schema Engine<br>65 universal primes<br>nlu-schema v1.0<br>forced tool use"]
        f1_out["<b>NLUData</b><br>domain · frames · frame_label<br>nsm_explications<br>visual_guidelines · pragmatics"]
    end

    subgraph F2["<b>(2) COMPOSE</b> — Claude Haiku"]
        direction TB
        f2a["Visual Topology Node<br><i>generates elements + prompt<br>in a single call</i>"]
        f2b["Spatial Articulation Node<br><i>only on manual regeneration<br>when user edits elements</i>"]
        f2_elem["<b>elements</b><br>VisualElement tree<br><i>concept per node from<br>NLU frame roles</i>"]
        f2_prompt["<b>prompt</b><br>spatial composition"]
    end

    subgraph F3["<b>(3) PRODUCE</b> — Recraft V4.1 Vector"]
        direction TB
        f3_merge["<b>fullPrompt</b> combines:<br>utterance + NLU context<br>+ elements + prompt<br>+ visualStylePrompt"]
        f3_gen["recraftv4_1_vector<br>no text · white background"]
        f3_out["<b>rawSvg</b><br>Native vector SVG"]
    end

    subgraph POST["Post-processing — manual, optional · see docs/ESTRUCTURAR.md"]
        direction TB
        subgraph F4["<b>(4) STRUCTURE</b> — Claude Sonnet Vision"]
            direction TB
            f4_measure["Local Measurement<br><i>real anchors getBBox + CTM<br>merge candidates (IoU bbox)</i>"]
            f4_marks["Set-of-marks<br><i>numbered marks with anti-collision<br>and guide lines to anchor</i>"]
            f4_vision["Claude vision<br><i>assigns paths to elements<br>confirms merges · forced tool use</i>"]
            f4_assemble["Local Assembly<br><i>boolean unions + safety nets<br>geometry never leaves browser</i>"]
            f4_polish["Deterministic Polishing<br><i>selective refit to curves<br>coordinate rounding</i>"]
            f4_out["<b>structuredSvg</b><br>mf-svg-schema · semantic groups<br>data-concept consistent with NLU<br>accessibility metadata"]
        end
    end

    subgraph ROW["<b>RowData</b> — cumulative state per row"]
        direction LR
        r1["NLU"]
        r2["elements<br>prompt"]
        r3["rawSvg"]
        r4["structuredSvg"]
    end

    UTT ==> F1
    cfg_lang --> F1
    f1_proc --> f1_out

    f1_out ==> F2
    cfg_css -.->|availableClasses| F2
    f2a --> f2_elem
    f2a --> f2_prompt
    f2b -.->|"regenerates prompt only"| f2_prompt

    f2_elem ==> F3
    f2_prompt ==> F3
    cfg_visual --> f3_merge
    f1_out -.->|"intent · domain · focus"| f3_merge
    UTT -.->|original context| f3_merge
    f3_merge --> f3_gen --> f3_out

    f3_out -.->|"user initiates"| POST
    f2_elem -.->|"DOM structure + concept"| f4_vision
    cfg_css -->|generateStylesheet| f4_assemble
    f4_measure --> f4_marks --> f4_vision --> f4_assemble --> f4_polish --> f4_out

    f1_out --> r1
    f2_elem --> r2
    f2_prompt --> r2
    f3_out --> r3
    f4_out --> r4

    style UTT fill:#fff3cd,stroke:#e6a800,stroke-width:2px,color:#664d00
    style CFG fill:#f5f5f5,stroke:#aaa,stroke-width:1px,color:#555
    style cfg_lang fill:#e9e9e9,stroke:#bbb,color:#444
    style cfg_visual fill:#e9e9e9,stroke:#bbb,color:#444
    style cfg_css fill:#e9e9e9,stroke:#bbb,color:#444

    style F1 fill:#dbeafe,stroke:#3b82f6,stroke-width:2px
    style f1_proc fill:#eff6ff,stroke:#93c5fd,color:#1e40af
    style f1_out fill:#bfdbfe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f

    style F2 fill:#d1fae5,stroke:#10b981,stroke-width:2px
    style f2a fill:#ecfdf5,stroke:#6ee7b7,color:#065f46
    style f2b fill:#ecfdf5,stroke:#6ee7b7,color:#065f46,stroke-dasharray: 5 5
    style f2_elem fill:#a7f3d0,stroke:#10b981,stroke-width:2px,color:#064e3b
    style f2_prompt fill:#a7f3d0,stroke:#10b981,stroke-width:2px,color:#064e3b

    style F3 fill:#ffedd5,stroke:#f97316,stroke-width:2px
    style f3_merge fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style f3_gen fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style f3_out fill:#fed7aa,stroke:#f97316,stroke-width:2px,color:#7c2d12

    style POST fill:#f8f8ff,stroke:#999,stroke-width:1px,stroke-dasharray: 8 4
    style F4 fill:#fce7f3,stroke:#ec4899,stroke-width:2px
    style f4_measure fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_marks fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_vision fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_assemble fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_polish fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_out fill:#fbcfe8,stroke:#ec4899,stroke-width:2px,color:#831843

    style ROW fill:#fafafa,stroke:#333,stroke-width:3px
    style r1 fill:#bfdbfe,stroke:#3b82f6,color:#1e3a5f
    style r2 fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style r3 fill:#fed7aa,stroke:#f97316,color:#7c2d12
    style r4 fill:#fbcfe8,stroke:#ec4899,color:#831843
```

### Feedback Model

Each field is editable. When data is modified, subsequent steps are marked as `outdated`, and the user can selectively regenerate them:

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#fafafa',
    'primaryTextColor': '#1a1a2e',
    'lineColor': '#888',
    'fontSize': '12px',
    'fontFamily': 'Lexend, system-ui, sans-serif'
  },
  'flowchart': { 'curve': 'basis' }
}}%%
flowchart LR
    subgraph EDIT["User Edit"]
        e1["Edit <b>utterance</b>"]
        e2["Edit <b>NLU</b>"]
        e3["Edit <b>elements</b>"]
        e4["Edit <b>prompt</b>"]
    end

    subgraph INVALIDATION["Invalidated Fields"]
        nlu_out["NLU outdated"]
        vis_out["visual outdated"]
        svg_out["rawSvg outdated"]
    end

    subgraph REGEN["Regeneration Available"]
        r1["Regenerate NLU"]
        r2["Regenerate composition"]
        r2b["Regenerate prompt only"]
        r3["Regenerate SVG"]
        r_all["Full cascade"]
    end

    e1 --> nlu_out & vis_out & svg_out
    e2 --> vis_out & svg_out
    e3 --> svg_out
    e3 -.->|"Regenerate Prompt button"| r2b
    e4 --> svg_out
    e4 -.->|"Produce button"| r3

    nlu_out --> r1 --> r_all
    vis_out --> r2
    svg_out --> r3

    style EDIT fill:#fff3cd,stroke:#e6a800
    style INVALIDATION fill:#fef3c7,stroke:#f59e0b
    style REGEN fill:#ecfdf5,stroke:#10b981
    style nlu_out fill:#fde68a,stroke:#f59e0b,color:#92400e
    style vis_out fill:#fde68a,stroke:#f59e0b,color:#92400e
    style svg_out fill:#fde68a,stroke:#f59e0b,color:#92400e
```

### Global Configuration Parameters

| Parameter | Phase | Status | Description |
|---|---|---|---|
| `lang` | 1, 2, 4 | Active | Language for NLU analysis and element IDs |
| `uiLang` | — | Active | Interface language (independent of NLU) |
| `geoContext` | 1, 4 | Active | Geographic region for contextualization and a11y metadata |
| `annotatedContext` | 1 | Active | Additional context annotated by the user (injected into NLU prompt) |
| `visualStylePrompt` | 3 | Active | Visual style description injected into the Recraft prompt |
| `svgStyleDefs` | 2, 4 | Active | CSS definitions for the SVG (classes available in composition and structuring) |
| `svgKeyframes` | 4 | Active | Animation keyframes for the structured SVG |
| `aspectRatio` | — | Inactive | Was the aspect ratio for Gemini Image; Recraft V4.1 uses a fixed size |
| `imageModel` | — | Inactive | Was the flash/pro selector for Gemini; removed from the pipeline |

---

## Philosophy

Pictograms are more than illustrations: they are communicative acts. PICTOS proposes that to generate a good pictogram, one must first *deeply understand* what is to be communicated, before deciding how to visualize it.

The project stems from a conviction: **visual communication must be explainable and accessible, based on context**.

The generated pictograms aim to reduce cognitive barriers, facilitate the expression of basic needs, and contribute to the autonomy of people with functional diversity.

---

## MediaFranca Ecosystem

PICTOS.NET is part of [MediaFranca](https://github.com/mediafranca), a set of open schemas for augmentative and alternative communication:

| Repository | Description |
|---|---|
| [nlu-schema](https://github.com/mediafranca/nlu-schema) | Deep linguistic analysis schema based on NSM |
| [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema) | Standard for semantic and self-contained SVG pictograms |
| [ICAP](https://github.com/mediafranca/ICAP) | Pictogram evaluation framework (6 cognitive dimensions) |
| [pictos.cl](https://pictos.cl) | Visual support platform for public services (PUCV Accessibility Nucleus) |

`nlu-schema` and `mf-svg-schema` are included as git submodules in this repository.

---

## Usage

**Web application**: [pictos.net](https://pictos.net)

Pictograms and data are stored **locally in the browser** (IndexedDB + localStorage). To back up your work, use **Export Library** — it generates a JSON file with all the images and pipeline metadata.

You can share your exported graph with comments to [contact@pictos.net](mailto:contact@pictos.net).

---

## Local Development

```bash
git clone --recurse-submodules https://github.com/hspencer/pictos-net.git
cd pictos-net
cp .env.example .env        # add ANTHROPIC_API_KEY and RECRAFT_API_KEY
npm install
npm run dev                 # → http://localhost:9001 (netlify dev)
```

Required API keys:
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com)
- `RECRAFT_API_KEY` — [recraft.ai](https://www.recraft.ai/api)
- `GITHUB_TOKEN` — for the pictogram sharing feature (optional)

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for full instructions.

---

## Stack

- React 19 + TypeScript 5.8
- Vite 6 + Tailwind CSS 3.4
- Zustand (SVG editor state)
- Anthropic SDK — Claude Haiku 4.5 (phases 1 & 2) + Claude Sonnet 4.6 (phase 4, vision)
- Recraft V4.1 Vector (phase 3, native SVG)
- Netlify Functions (API proxy with JWT) + Netlify Identity
- IndexedDB v3 + localStorage (dual persistence)

---

## Documentation

### Architecture and Development

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Technical architecture, data models, services |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Development guide, submodules, i18n, deployment |
| [docs/SECURITY.md](./docs/SECURITY.md) | API key management, security considerations |
| [docs/PIPELINE_MIGRATION_CLAUDE_RECRAFT.md](./docs/PIPELINE_MIGRATION_CLAUDE_RECRAFT.md) | Notes on the Gemini → Claude + Recraft migration (v1.x → v2.0) |

### User Interface

| Document | Description |
|---|---|
| [docs/UI_MAP.md](./docs/UI_MAP.md) | Structural map of the UI: all semantic IDs |
| [docs/UI_CONVENTIONS.md](./docs/UI_CONVENTIONS.md) | Design conventions: colors, typography, z-index |
| [docs/CSS_STYLING_ARCHITECTURE.md](./docs/CSS_STYLING_ARCHITECTURE.md) | Two-level model for SVG styles (classes + local overrides) |
| [docs/WCAG_ROADMAP.md](./docs/WCAG_ROADMAP.md) | WCAG 2.1 AA compliance status and accessibility roadmap |

---

## Community

PICTOS invites **linguists** to refine NLU and NSM analysis, **designers** to improve visual composition, **educators and psychologists** to imagine new use cases, **researchers** to validate quality metrics, and **developers** to extend functionalities.

Contributions are welcome. Report bugs, propose features, or open a Pull Request on GitHub.

---

## Citation

```
Spencer, H. (2026). PICTOS.NET: Generative pictograms for cognitive accessibility.
MediaFranca. https://pictos.net
```

*License: Apache 2.0 (code) · CC-BY-4.0 (generated pictograms, per user's choice)*
