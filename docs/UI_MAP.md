# UI_MAP — PICTOS.NET
> Mapa estructural de la interfaz. Fuente de verdad para todos los IDs semánticos.
> Actualizar este archivo siempre que se cree, renombre o elimine una región de la UI.

> Última actualización: 2026-07-07
> Cobertura: ~95% (auditoría GUI 2026-07-07)

## Estado de los IDs
- [OK] Implementado
- [PENDING] Pendiente (el elemento existe pero sin ID semántico)
- [NEW] Nuevo (propuesto, no existe aún)

---

## Árbol de la interfaz

```
APP-SHELL (#app-shell) [via div.min-h-screen]
│
├── HEADER (#toolbar) 
│   ├── #brand-area                 [logo + título, clickeable → home]
│   │   ├── LogoIcon (svg)
│   │   ├── #app-title (h1)          [config.author]
│   │   └── #tagline (span) 
│   │
│   ├── #search-area               [flex-1, max-w-xl]
│   │   └── SearchComponent
│   │       ├── input (search/create utterance)
│   │       └── #search-suggestions  [dropdown z-50]
│   │
│   └── #header-actions            [flex, gap-2, items-center]
│       ├── #lang-switcher           [select]
│       ├── #library-btn-group     [botón split: Library + ChevronDown]
│       │   └── #library-dropdown  [portal → document.body, z-[56]]
│       │       ├── Import
│       │       ├── Export
│       │       ├── Export SVGs
│       │       └── Delete All
│       ├── #settings-btn 
│       └── #console-btn 
│
├── #settings-panel (#globalSettings)   [fixed, top-20, z-40, condicional]
│   ├── Sección básica (colapsable, grid 3-col)
│   │   ├── COL-1: Identidad
│   │   │   ├── #field-author           [input: config.name]
│   │   │   ├── #field-credits          [textarea: config.credits]
│   │   │   ├── #field-license          [select: CC / copyright]
│   │   │   └── #field-geo              [lang select + GeoAutocomplete]
│   │   ├── COL-2: Estilo visual
│   │   │   └── #field-visual-style     [textarea: visualStylePrompt]
│   │   └── COL-3: Generación y preferencias
│   │       ├── #field-reduce-motion    [checkbox WCAG 2.3.3]
│   │       ├── #field-high-contrast    [checkbox WCAG 1.4.11]
│   │       ├── #field-recording        [checkbox: auditoría]
│   │       └── #field-tutorial         [button → OnboardingModal]
│   └── Configuración avanzada (colapsable)
│       ├── #field-annotated-context    [textarea: contexto NLU]
│       ├── #field-palette              [paleta de colores Recraft]
│       ├── #field-style-editor         [button → StyleEditor modal]
│       └── modelos por fase            [selects NLU / generación / phase5]
│   (eliminados: #field-aspect-ratio, #field-image-model — legacy Gemini)
│
├── #main-content (#mainContent) 
│   │
│   ├── #library-home              [condicional: sin librería activa]
│   │   ├── #library-home-toolbar    [orden: recientes / alfabético]
│   │   └── #library-grid            [HomeActionsCard + LibraryCard × N + TemplateCard × N + CreateLibraryCard]
│   │
│   ├── #library-toolbar           [con librería activa: nombre + tabs pictogramas/secuencias + #view-switcher (#list-view/#grid-view)]
│   │
│   ├── #sequence-list             [condicional: tab secuencias]
│   │   └── #sequence-grid           [SequenceCard × N + CreateSequenceCard]
│   │
│   ├── SequenceEditor             [condicional: secuencia abierta]
│   │   └── #sequence-steps          [lista (space-y-2) o grilla (grid), según viewMode]
│   │
│   └── #list-view                 [condicional: viewMode=list]
│       └── RowComponent [#picto-row-{id}] 
│           │
│           ├── #row-header-{id}   [p-6, flex, items-center]
│           │   ├── utterance-input  [.utterance-title]
│           │   ├── #pipeline-badges-{id} 
│           │   │   ├── Badge (COMPRENDER / nluStatus)
│           │   │   ├── Badge (COMPONER / visualStatus)
│           │   │   └── Badge (PRODUCIR / bitmapStatus)
│           │   ├── #picto-thumbnail-{id}    [w-14, h-14]
│           │   └── #cascade-ctrl-{id}       [Play | Stop]
│           │
│           └── #row-detail-{id}   [p-8, border-t, grid-cols-3, condicional]
│               │
│               ├── StepBox [#block-nlu] 
│               │   └── SmartNLUEditor
│               │       ├── #nlu-context           [lang dropdown, domain dropdown, geoContext]
│               │       ├── details (metadata/speech_act/intent)
│               │       ├── details (frames) — shows frame_label + frame_name
│               │       └── details (nsm/logical_form/pragmatics) — expanded by default
│               │
│               ├── StepBox [#block-compose] 
│               │   ├── #hierarchical-elements   → ElementsEditor
│               │   └── #spatial-prompt           → PromptRenderer / textarea
│               │
│               └── StepBox [#block-produce] 
│                   ├── #bitmap-preview          [bg-neutral-200, flex, min-h-250]
│                   └── SVGGenerator
│                       └── #svg-output  [NEW]
│
├── #console-panel (#console)       [fixed bottom-0, h-64, condicional]
│
└── MODALES (portales React, z-[60+])
    ├── FocusViewModal [#focus-view-modal → .focus-modal-backdrop / .focus-modal-content] 
    │   ├── modo: nlu → SmartNLUEditor
    │   ├── modo: visual → ElementsEditor + PromptRenderer
    │   ├── modo: bitmap → imagen full
    │   └── modo: eval → layout 2-col (imagen + SVGGenerator)
    ├── StyleEditor
    │   ├── #style-editor-backdrop         [fixed inset-0 z-[60], overlay blur]
    │   ├── #style-editor-modal            [fixed inset-0 z-[61], centrado]
    │   │   └── #style-editor-panel        [bg-white rounded-xl, flex-col]
    │   │       ├── #style-editor-modal-header   [h-14, título + shape selector + export + close]
    │   │       └── #style-editor-root           [lib interna, flex-col h-full]
    │   │           ├── #style-editor-content    [área principal overflow-y-auto]
    │   │           ├── #style-editor-gallery    [grid auto-fill 7.5em, StylePreviewCard × N]
    │   │           ├── #style-editor-code-view  [vista CSS raw, condicional]
    │   │           └── #style-editor-animations-view  [vista animaciones, condicional]
    │   └── EditModal [#style-edit-modal] 
    │       ├── #style-edit-modal-backdrop 
    │       ├── #style-edit-modal-header 
    │       ├── #style-edit-modal-selectors 
    │       ├── #style-edit-modal-properties 
    │       ├── #style-edit-modal-preview 
    │       └── #style-edit-modal-footer 
    │
    ├── SVGEditorModal [#svg-editor-modal]  [fullscreen modal editor SVG]
    │   ├── #svg-editor-container           [bg-slate-900, w-full h-full]
    │   ├── #svg-editor-header              [h-16, bg-slate-800]
    │   │   └── #svg-editor-history-controls  [undo/redo]
    │   ├── #svg-editor-tree-panel          [aside w-80, izquierda]
    │   │   ├── #svg-editor-tree-header     [label "Capas y estructura"]
    │   │   └── #svg-editor-tree-content    [overflow-y-auto]
    │   │       └── SemanticTree [#svg-editor-tree] 
    │   │           └── TreeNode [#tree-node-{id}]   [por cada elemento]
    │   ├── #svg-editor-canvas              [main, flex-1]
    │   │   └── SVGCanvas                    [zoom controls, bounding box]
    │   └── #svg-editor-properties-panel   [aside w-80, derecha]
    │       ├── #svg-editor-props-empty     [cuando no hay selección]
    │       ├── #svg-editor-props-content   [cuando hay elemento seleccionado]
    │       │   ├── #svg-editor-props-header 
    │       │   ├── #svg-editor-props-styles    [Section A: galería citar/descitar clases]
    │       │   ├── #svg-editor-props-overrides  [Section B: overrides locales por clase]
    │       │   │   └── CitedClassEditor × N      [por cada clase citada]
    │       │   ├── #svg-editor-props-identity  [RenameField]
    │       │   └── #svg-editor-props-danger    [DeleteButton]
    │       NOTE: #svg-editor-props-inline eliminado (modelo cero-inline)
    │
    ├── VectorizerModal             [modal vectorizador bitmap→SVG]
    │   ├── #vectorizer-modal         [fixed inset-0 z-[50], dark backdrop]
    │   ├── #vectorizer-controls      [w-72, panel izq: segmented controls + actions]
    │   ├── #vectorizer-original      [flex-1, imagen bitmap original]
    │   └── #vectorizer-result        [flex-1, SVG result dangerouslySetInnerHTML]
    ├── OnboardingModal [#onboarding-modal]   [tutorial de introducción, z-[60]]
    ├── ParticipateModal [#participate-modal] [invitación a participar, z-50]
    └── ConfirmDialog  [PENDING]              [modal genérico confirmación]
```

---

## IDs pendientes

La mayoría de los IDs prioritarios ya está implementada (auditoría 2026-07-07):
`#brand-area`, `#search-area`, `#header-actions`, `#list-view`, `#grid-view`, `#library-dropdown`,
`#picto-row-{id}`, `#pipeline-badges-{id}`, `#library-home`, `#library-grid`, `#sequence-list`,
`#sequence-grid`, `#sequence-steps`, `#focus-view-modal`, `#onboarding-modal`, `#participate-modal`.

| Prioridad | ID a implementar       | Ubicación                          |
|-----------|------------------------|------------------------------------|
| Media     | `#bitmap-preview`      | dentro de block-produce            |
| Baja      | `#app-shell`           | div raíz min-h-screen              |
| Baja      | ConfirmDialog          | modal genérico de confirmación     |

---

## Notas de diseño

- **Grid principal**: El layout raíz es `flex-col`. El contenido principal usa `max-w-7xl mx-auto`.
- **Header**: `h-20` (80px), sticky top-0. Es la única referencia fija del layout.
- **#settings-panel**: `top-20` coincide con altura del header. Si el header cambia, ajustar.
- **#row-detail**: grid de 3 columnas (`lg:grid-cols-3`). Colapsa a 1 col en mobile.
- **Modales**: todos usan `fixed inset-0` con z-index desde `--z-modal-backdrop` (40) o superior.
- **#console-panel**: `fixed bottom-0`, altura fija `h-64`. No interfiere con el layout principal (el list-view tiene `pb-64`).
