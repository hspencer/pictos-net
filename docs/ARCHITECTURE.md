# PICTOS.NET — Documentación de Arquitectura

**Pictogramas generativos para la Comunicación Aumentativa y Alternativa (CAA)**

Actualizado: 2026-03-05

---

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Estructura del repositorio](#2-estructura-del-repositorio)
3. [Stack tecnológico](#3-stack-tecnológico)
4. [Pipeline de generación (5 fases)](#4-pipeline-de-generación-5-fases)
5. [Modelos de datos](#5-modelos-de-datos)
6. [Servicios](#6-servicios)
7. [Componentes](#7-componentes)
8. [Almacenamiento](#8-almacenamiento)
9. [Configuración](#9-configuración)
10. [Build y deployment](#10-build-y-deployment)

---

## 1. Visión general

PICTOS.NET transforma intenciones comunicativas en lenguaje natural en pictogramas SVG semánticos mediante un pipeline de razonamiento en 5 fases. Es una herramienta de investigación doctoral orientada a profesionales de la CAA (fonoaudiólogos, educadores especiales, psicólogos) que trabajan con personas con diversidad funcional comunicativa.

### Principios de diseño

- **Explicabilidad**: cada fase es visible, editable y regenerable de forma independiente
- **Control local**: todo el procesamiento pesado (vectorización) ocurre en el navegador via WASM
- **Semántica persistente**: los SVG exportados son autocontenidos con metadatos accesibles embebidos
- **Privacidad**: datos almacenados localmente (IndexedDB), sin servidor propio

---

## 2. Estructura del repositorio

```
pictos-net/
├── App.tsx                        # Componente raíz, orquestación del pipeline
├── index.tsx                      # Entry point React
├── index.html                     # Template HTML (Tailwind CDN, fuentes)
├── types.ts                       # Tipos TypeScript globales
├── vite.config.ts
├── tailwind.config.js
├── package.json
│
├── services/
│   ├── geminiService.ts           # Integración Gemini API (NLU, imagen, composición)
│   ├── vtracerService.ts          # Vectorización WASM (vtracer visioncortex)
│   ├── svgStructureService.ts     # Estructuración semántica SVG (Gemini multimodal)
│   ├── indexedDBService.ts        # Capa de persistencia (IndexedDB v3)
│   ├── svgStyles.ts               # Generación de CSS para SVG
│   └── geocodingService.ts        # Geocodificación para contexto geográfico
│
├── stores/
│   └── svgEditorStore.ts          # Estado del editor SVG (zustand-like, pure React)
│
├── hooks/
│   ├── useDialogA11y.ts           # Focus trap + Escape para modales
│   ├── useSVGLibrary.ts           # Gestión de la librería de SVGs
│   └── useTranslation.ts          # i18n hook (en-GB / es-419)
│
├── components/
│   ├── SVGGenerator.tsx           # UI de generación SVG por fila
│   ├── SVGThumbnail.tsx           # Miniatura de pictograma
│   ├── GeoAutocomplete.tsx        # Input de contexto geográfico
│   ├── VectorizerModal.tsx        # Modal bitmap→SVG (vtracer WASM)
│   ├── PictoForge/
│   │   └── StyleEditor.tsx        # Editor de estilos CSS para SVG
│   ├── SVGEditor/
│   │   ├── SVGEditorModal.tsx     # Modal editor SVG semántico (fullscreen)
│   │   ├── SVGCanvas.tsx          # Viewport zoom/pan con selección de elementos
│   │   ├── SemanticTree.tsx       # Árbol de capas del SVG
│   │   ├── StylePanel.tsx         # Panel de propiedades y estilos
│   │   ├── StylePickerModal.tsx   # Modal selector de clases CSS
│   │   ├── SelectionToolbar.tsx   # Toolbar contextual de selección
│   │   └── BoundingBox.tsx        # Caja de selección visual
│   └── ui/
│       ├── button.tsx
│       └── input.tsx
│
├── utils/
│   ├── svgAccessibility.ts        # Inyección de <title>, <desc>, role="img"
│   └── styleUtils.ts              # Parse/serialize de reglas CSS del SVG
│
├── lib/
│   ├── style-editor/              # Librería interna de edición de estilos
│   │   ├── lib/constants.ts       # INITIAL_STYLES
│   │   └── lib/keyframeConstants.ts # INITIAL_KEYFRAMES
│   └── vtracer-wasm/              # WASM bundle (visioncortex vtracer-webapp)
│       └── vtracer_webapp_bg.wasm
│
├── locales/
│   ├── en-GB.json                 # Traducciones inglés
│   └── es-419.json                # Traducciones español latinoamericano
│
├── schemas/                       # Git submodules
│   ├── nlu-schema/                # mediafranca/nlu-schema
│   ├── mf-svg-schema/             # mediafranca/mf-svg-schema
│   └── ICAP/                      # mediafranca/ICAP
│
├── public/
│   ├── wasm/vtracer/              # WASM binary servido estáticamente
│   ├── libraries/                 # Bibliotecas de ejemplo (.json)
│   └── schemas/                   # Copias de schemas para acceso web
│
├── docs/                          # Documentación técnica
└── data/
    └── canonicalData.ts           # Corpus ICAP-50 (fallback offline)
```

---

## 3. Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| UI Framework | React | 19 |
| Tipado | TypeScript | ~5.8 |
| Build | Vite | ^6.2 |
| Estilos | Tailwind CSS (CDN) | — |
| Iconos | Lucide React | ^0.562 |
| Drag & drop | @dnd-kit | — |
| Compresión de descarga | JSZip | — |
| AI / LLM | Google Gemini API (`@google/genai`) | ^1.38 |
| Vectorización | vtracer-webapp WASM (visioncortex) | 0.4.0 |
| Persistencia | IndexedDB (nativo) | — |
| i18n | Hook personalizado | — |

---

## 4. Pipeline de generación (4 fases)

La cascada automática abarca las fases (1)(2)(3). La fase (4) es opcional e iniciada manualmente por el usuario. La antigua fase VECTORIZAR (vtracer) fue eliminada de la cascada: Recraft V4.1 entrega SVG nativo.

```mermaid
flowchart TD
    UTT["utterance"] --> F1

    F1["(1) COMPRENDER — Claude Haiku<br><i>NSM Schema Engine, 65 primos universales<br>tool use forzado</i>"]
    F1 --> NLU["NLUData<br><i>domain · frames · nsm_explications<br>visual_guidelines · pragmatics</i>"]

    NLU --> F2["(2) COMPONER — Claude Haiku<br><i>Visual Topology Node</i>"]
    F2 --> ELEM["elements: VisualElement[]<br><i>concept por nodo desde roles de frame</i>"]
    F2 --> PROMPT["prompt espacial"]

    ELEM --> F3["(3) PRODUCIR — Recraft V4.1 Vector<br><i>fullPrompt = utterance + NLU<br>+ elements + prompt + visualStylePrompt</i>"]
    PROMPT --> F3
    F3 --> RAW["rawSvg<br><i>SVG vectorial nativo, sin bitmap intermedio</i>"]

    RAW -->|usuario inicia| F4["(4) ESTRUCTURAR — Claude Sonnet Vision<br><i>medición local + set-of-marks + ensamblaje local<br>+ pulido determinístico — ver docs/ESTRUCTURAR.md</i>"]
    ELEM -.->|"DOM objetivo + concept"| F4
    F4 --> STRUCT["structuredSvg<br><i>mf-svg-schema · grupos semánticos<br>data-concept congruente con NLU</i>"]
```

### Acumulación en RowData

Cada fila acumula los resultados progresivamente:

```
RowData = { utterance, NLU, elements, prompt, bitmap, rawSvg, structuredSvg }
```

Ningún campo se sobreescribe automáticamente al regenerar una fase posterior. El usuario controla qué fases regenerar.

### Invalidación en cascada

Al editar un campo, los pasos posteriores se marcan como `outdated`:

| Edición | Invalida |
|---------|---------|
| utterance | NLU → elements → prompt → bitmap |
| NLU | elements → prompt → bitmap |
| elements | prompt → bitmap |
| prompt | bitmap |
| bitmap | rawSvg → structuredSvg |

---

## 5. Modelos de datos

### RowData

```typescript
interface RowData {
  id: string;
  UTTERANCE: string;
  NLU?: NLUData;
  elements?: VisualElement[];
  prompt?: string;
  bitmap?: string;               // base64 data URL (PNG en memoria, JPEG en IndexedDB)
  rawSvg?: string;               // output vtracer, sin semántica
  structuredSvg?: string;        // output mf-svg-schema, autocontenido
  shared?: boolean;

  // Estado por fase
  nluStatus: StepStatus;
  visualStatus: StepStatus;
  bitmapStatus: StepStatus;

  // Duración de procesamiento (segundos)
  nluDuration?: number;
  visualDuration?: number;
  bitmapDuration?: number;
}

type StepStatus = 'idle' | 'processing' | 'completed' | 'error' | 'outdated';
```

### NLUData (nlu-schema v2.0)

```typescript
interface NLUData {
  utterance: string;
  lang: string;
  metadata: {
    speech_act: string;
    intent: string;
  };
  domain: string;
  frame_name: string;
  frame_label: string;
  frames: NLUFrame[];
  nsm_explications: Record<string, string>;
  logical_form: { event: string; modality: string };
  pragmatics: { politeness: string; formality: string; expected_response: string };
  visual_guidelines: {
    focus_actor: string;
    action_core: string;
    object_core: string;
    context: string;
    temporal: string;
  };
}
```

### VisualElement

```typescript
interface VisualElement {
  id: string;                    // snake_case, sustantivo en el idioma del utterance
  children?: VisualElement[];
}
```

### GlobalConfig

```typescript
interface GlobalConfig {
  lang: string;                  // ISO 639 (ej: 'es-419')
  aspectRatio: string;           // '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
  imageModel: 'flash' | 'pro';
  author: string;
  license: string;
  visualStylePrompt: string;
  geoContext?: { lat: string; lng: string; region: string };
  annotatedContext?: string;
  svgStyleDefs?: StyleDefinition[];
  svgKeyframes?: KeyframeDefinition[];
}
```

---

## 6. Servicios

### geminiService.ts

Integración con la API de Google Gemini. Todas las llamadas usan `@google/genai`.

| Función | Modelo | Descripción |
|---------|--------|-------------|
| `generateNLU(utterance, onLog, config)` | `gemini-2.5-flash` | Análisis semántico NSM → NLUData |
| `generateElements(nlu, config, onLog)` | `gemini-2.5-flash` | Visual Topology → VisualElement[] |
| `generatePrompt(nlu, elements, config, onLog)` | `gemini-2.5-flash` | Spatial Articulation → string |
| `generateImage(elements, prompt, row, config, onLog)` | `gemini-2.5-flash-image` / `gemini-3-pro-image-preview` | Bitmap PNG |

**Post-procesamiento de imagen:**
```typescript
// En memoria: PNG lossless 1024px
const resized = await resizeImage(base64Image, 1024);
// En IndexedDB: JPEG q=0.75 (compressForStorage en indexedDBService.ts)
```

### vtracerService.ts

Vectorización local via WASM. El WASM es DOM-coupled: lee pixels de un `<canvas>` y escribe `<path>` directamente a un `<svg>`, ambos referenciados por ID.

**APIs principales:**

| Función | Descripción |
|---------|-------------|
| `traceInteractive(canvasId, svgId, config, onProgress, signal)` | API interactiva para VectorizerModal (renderizado progresivo) |
| `vectorizeBitmap(base64, config, onProgress)` | API one-shot (crea elementos DOM temporales) |
| `drawBitmapToCanvas(base64, canvasId)` | Dibuja bitmap en canvas, aplica downscale si >1024px |
| `preloadWasm()` | Precarga el WASM (llamar antes de la primera conversión) |

**VectorizerConfig:**

```typescript
interface VectorizerConfig {
  mode?: 'polygon' | 'spline' | 'none';      // default: 'spline'
  colorMode?: 'color' | 'bw';                // default: 'color'
  hierarchical?: 'stacked' | 'cutout';       // default: 'stacked'
  colorPrecision?: number;                   // 1-8, default: 6
  layerDifference?: number;                  // 0-255, default: 16
  filterSpeckle?: number;                    // 0-16, default: 4
  cornerThreshold?: number;                  // grados, default: 60
  lengthThreshold?: number;                  // 1-10, default: 4.0
  spliceThreshold?: number;                  // grados, default: 45
  pathPrecision?: number;                    // 1-8, default: 8
}
```

### svgStructureService.ts

Estructuración semántica del SVG crudo (fase 4). Documento de referencia completo: [ESTRUCTURAR.md](ESTRUCTURAR.md).

**Input:** `{ rawSvg, nlu, elements, utterance, config, referenceImage? }`

**Proceso (una sola llamada de visión; la geometría nunca la escribe el modelo):**
1. Pre-proceso local: `ensurePathIds` → `buildPathInventory` con anclas reales (`measurePathAnchors`: getBBox + cadena CTM + isPointInPath) → `detectMergeCandidates` (contornos dobles por IoU de bbox) → `rasterizeWithMarks` (marcas numeradas con anti-colisión y líneas guía)
2. Llamada de visión con tool use forzado (`restructure_svg`): el modelo asigna path-ids a nodos semánticos, confirma candidatos de fusión y descarta ruido
3. Ensamblaje local: `resolveMergeGeometry` (unión Martinez + refit a curvas), redes de seguridad (huérfanos reparentados, descartes no micro-blob revertidos, fallback plano) y `renderGroup` con `data-concept` tomado del árbol compuesto en fase 2
4. Post-proceso: CSS filtrado a clases usadas, metadata mf-svg (incluye `visualDom`), `deriveChildIds`, `polishGeometry` (refit selectivo de paths polyline-pesados + redondeo de coordenadas)

**Módulos puros testeables** (sin imports, `node --test`): `svgMergeCandidates.ts`, `svgPathPolish.ts`, `svgTreeUtils.ts`, `svgGeometryUtils.ts`.

**Funciones de eligibilidad:**
```typescript
canVectorize(row): EligibilityResult          // siempre inelegible — VTracer eliminado
canStructureSVG({ rawSvg, NLU, elements }): EligibilityResult
```

### indexedDBService.ts

Capa de persistencia. Base de datos `pictonet_storage` v3, tres stores:

| Store | Contenido | Notas |
|-------|-----------|-------|
| `rows` | RowData sin campos binarios | Metadata del pipeline |
| `bitmaps` | `{ id, bitmap: string }` | PNG→JPEG q=0.75 al escribir |
| `svgs` | `{ id, rawSvg?, structuredSvg? }` | Sin compresión |

**Funciones principales:**
```typescript
saveRows(rows)           getAllRows()
saveBitmap(id, bitmap)   getBitmap(id)      deleteBitmap(id)
saveSvgs(id, svgs)       getSvgs(id)        deleteSvgs(id)
clearAllData()           getStorageEstimate()
```

---

## 7. Componentes

### Jerarquía

```
App.tsx
├── Header (#toolbar)
│   ├── SearchComponent
│   ├── Library dropdown
│   ├── Settings button → #globalSettings panel
│   └── Console button → #console-panel
│
├── Main (#mainContent)
│   ├── Home view (#home-view)
│   └── List view (#list-view)
│       └── RowComponent (#picto-row-{id}) × N
│           ├── row header (utterance, badges, thumbnail, cascade control)
│           └── row detail (3 StepBoxes)
│               ├── #block-nlu → SmartNLUEditor
│               ├── #block-compose → ElementsEditor + PromptRenderer
│               └── #block-produce → SVGGenerator
│
└── Modales (portales, z-index 50+)
    ├── FocusViewModal       — detalle fullscreen de cada fase
    ├── StyleEditor          — editor de clases CSS del sistema visual
    ├── SVGEditorModal       — editor semántico fullscreen del SVG estructurado
    │   ├── SemanticTree     — árbol de capas
    │   ├── SVGCanvas        — viewport zoom/pan
    │   ├── StylePanel       — propiedades y clases CSS
    │   └── StylePickerModal — selector de estilos de biblioteca
    └── VectorizerModal      — vectorizador bitmap→SVG con controles vtracer
```

### SVGEditorModal

Editor semántico completo para `structuredSvg` o `rawSvg`. Organizado en tres paneles:

- **Izquierda** (`#svg-editor-tree-panel`): SemanticTree — árbol de elementos SVG como capas editables
- **Centro** (`#svg-editor-canvas`): SVGCanvas — viewport con zoom/pan, selección, bounding boxes
- **Derecha** (`#svg-editor-properties-panel`): StylePanel — aplicar/quitar clases CSS, overrides locales, renombrar, eliminar

El modelo de estilos sigue arquitectura de dos niveles documentada en `docs/CSS_STYLING_ARCHITECTURE.md`.

### VectorizerModal

Modal fullscreen para la fase (4). Panel izquierdo con controles vtracer (presets, curve mode, color mode, sliders). Panel derecho dividido: original bitmap (canvas) | SVG result (renderizado progresivo).

---

## 8. Almacenamiento

### Arquitectura dual

**IndexedDB** (`pictonet_storage` v3) — datos binarios y pipeline:
- Filas (metadata sin binarios), bitmaps, SVGs
- Persiste entre sesiones, sobrevive recarga de página
- Los bitmaps se comprimen a JPEG q=0.75 al guardar (solo para storage, no afecta al pipeline)

**localStorage** — solo configuración:
- Clave: `pictonet_v19_config`
- Contiene: `GlobalConfig` (lang, modelo, estilos, geo, etc.)

### Exportación

**Exportar librería** → JSON con todos los rows + bitmaps base64 embebidos
**Exportar SVGs** → ZIP con todos los `structuredSvg` como archivos `.svg` individuales

### Limpiar datos (desarrollo / troubleshooting)

```javascript
// Consola del navegador
indexedDB.deleteDatabase('pictonet_storage')
localStorage.removeItem('pictonet_v19_config')
```

O desde DevTools → Application → Storage → Clear site data.

---

## 9. Configuración

### Variables de entorno

```bash
GEMINI_API_KEY=<Google Generative AI API Key>
```

Necesaria en `.env` para desarrollo local. En producción se inyecta via GitHub Actions secret.

WARNING: La API key queda embebida en el bundle compilado. Ver `docs/SECURITY.md`.

### vite.config.ts

```typescript
{
  server: { port: 3000, host: '0.0.0.0' },
  plugins: [react()],
  define: {
    'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  }
}
```

### GlobalConfig por defecto

```typescript
{
  lang: 'es-419',
  aspectRatio: '1:1',
  imageModel: 'flash',
  author: 'PICTOS.NET',
  license: 'CC BY 4.0',
  visualStylePrompt: 'Siluetas sobre fondo blanco plano...',
  geoContext: { lat: '-33.4489', lng: '-70.6693', region: 'Santiago, CL' }
}
```

---

## 10. Build y deployment

```bash
npm run dev          # → http://localhost:3000 (HMR)
npm run build        # → dist/ (ES modules, ES2022)
npm run preview      # preview del build de producción
npm run validate-i18n # verifica consistencia de traducciones
```

### Deployment automático

GitHub Actions (`.github/workflows/deploy.yml`) despliega a GitHub Pages desde la rama `main`. Requiere el secret `GEMINI_API_KEY` configurado en el repositorio.

### Submodules

```bash
git clone --recurse-submodules https://github.com/hspencer/pictos-net.git
# o post-clone:
git submodule update --init --recursive
```

Los submodules (`nlu-schema`, `mf-svg-schema`, `ICAP`) se copian a `public/schemas/` automáticamente en `postinstall`.

---

## Referencias cruzadas

| Documento | Cubre |
|-----------|-------|
| `docs/CONTRIBUTING.md` | Setup local, submodules, i18n, flujo de contribución |
| `docs/SECURITY.md` | API key management, consideraciones de seguridad |
| `docs/CSS_STYLING_ARCHITECTURE.md` | Modelo de estilos SVG (dos niveles, overrides, garbage collection) |
| `docs/UI_MAP.md` | Todos los IDs semánticos de la interfaz |
| `docs/UI_CONVENTIONS.md` | Reglas de diseño, tokens, componentes |
| `docs/WCAG_ROADMAP.md` | Estado de conformidad WCAG 2.1 AA |
| `docs/PROMPT_MAESTRO.md` | Prompt para sesiones de diseño con Claude Code |

---

*Licencia: Apache 2.0 (código) · CC-BY-4.0 (pictogramas generados)*
