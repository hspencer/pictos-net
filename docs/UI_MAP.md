# UI_MAP — PICTOS
> Mapa estructural de la interfaz. Fuente de verdad para todos los IDs semánticos.
> Actualizar este archivo siempre que se cree, renombre o elimine una región de la UI.
> La arquitectura de datos y servicios está en [ARCHITECTURE.md](ARCHITECTURE.md); este mapa cubre solo la interfaz.

> Última actualización: 2026-11-08
> Método: el árbol se construyó con los atributos `id="..."` presentes en `App.tsx`, `components/**`, `lib/style-editor/**` e `index.html`. Todo `#id` escrito abajo existe en el código salvo que lleve la marca [PENDING] o [NEW].

## Estado de los IDs
- [OK] Implementado (implícito: un `#id` sin marca está en el código)
- [PENDING] La región existe pero no tiene ID semántico
- [NEW] Propuesto, la región no existe aún

## Árbol de la interfaz

```
#root (index.html)
└── div.min-h-screen                    [PENDING: sin ID, era #app-shell]
    │
    ├── a.sr-only → #mainContent        [skip link, t('a11y.skipToMain')]
    │
    ├── HEADER (#toolbar)               [h-20, sticky top-0, z-50]
    │   ├── #brand-area                 [logo + título; clic → inicio de librerías]
    │   │   ├── LogoIcon (svg)
    │   │   ├── h1                      [nombre de la librería activa o "PICTOS"; sin ID]
    │   │   └── #tagline                [PICTOS v{APP_VERSION}]
    │   │
    │   ├── #search-area                [flex-1, max-w-xl]
    │   │   └── SearchComponent (App.tsx)
    │   │       ├── input               [buscar o crear enunciado]
    │   │       └── lista de sugerencias [PENDING: sin ID]
    │   │
    │   └── #header-actions (nav)
    │       ├── #lang-btn-group         [botón dividido: idioma de la UI + ChevronDown]
    │       │   └── #lang-dropdown      [portal → document.body, z-[56]: Español / English]
    │       ├── #library-btn-group      [botón dividido: Librería + ChevronDown]
    │       │   └── #library-dropdown   [portal → document.body, z-[56]]
    │       │       ├── Configurar librería   [abre/cierra #globalSettings]
    │       │       ├── Mis secuencias / Mis tableros
    │       │       ├── contador de elementos
    │       │       ├── Importar frases / Importar librería
    │       │       ├── Exportar librería / Exportar frases
    │       │       ├── Descargar imprimibles (PDF) / Descargar pictogramas (ZIP)
    │       │       ├── Generación por lotes  [botón o chip de progreso]
    │       │       └── Borrar todo
    │       ├── #console-btn
    │       └── menú de usuario         [solo fuera de DEV: avatar + Cerrar sesión, o Iniciar sesión]
    │
    ├── #globalSettings                 [fixed, top-20, z-40, condicional; se abre desde #library-dropdown]
    │   ├── Sección básica (colapsable, grid md:grid-cols-3)
    │   │   ├── COL-1: Identidad
    │   │   │   ├── #field-author           [input: nombre de la librería]
    │   │   │   ├── #field-credits          [textarea: créditos]
    │   │   │   ├── #field-license          [select: copyright / CC0 / CC BY / BY-SA / BY-NC / BY-NC-SA]
    │   │   │   ├── #field-geo              [idioma NLU + GeoAutocomplete]
    │   │   │   └── #field-domain-context   [textarea: domainContext]
    │   │   ├── COL-2: Estilo visual
    │   │   │   └── #field-visual-style     [textarea: visualStylePrompt]
    │   │   └── COL-3: Preferencias
    │   │       ├── #field-reduce-motion    [checkbox → clase .reduce-motion]
    │   │       ├── #field-high-contrast    [checkbox → clase .high-contrast]
    │   │       ├── #field-recording        [checkbox: registro de intervenciones]
    │   │       └── #field-tutorial         [button → OnboardingModal]
    │   └── Configuración avanzada (colapsable)
    │       ├── Modelos por fase             [selects COMPRENDER / COMPONER / PRODUCIR / ESTRUCTURAR, cada uno con ModelPricing y "Probar conexión"]
    │       │   ├── #openai-image-quality    [select, solo modelos OpenAI de imagen]
    │       │   ├── #recraft-style-id        [input, solo Recraft]
    │       │   └── #recraft-style-hint
    │       └── #field-style-editor          [button → StyleEditor]
    │   (eliminados: #field-annotated-context → #field-domain-context; #field-palette, #field-aspect-ratio, #field-image-model)
    │
    ├── #mainContent (main)             [max-w-7xl mx-auto]
    │   │
    │   ├── #library-home               [condicional: sin librería activa o volviendo al inicio]
    │   │   ├── section "Área de trabajo" (aria-labelledby=#workspace-title)
    │   │   │   ├── #library-home-toolbar  [#workspace-title + orden: recientes / alfabético]
    │   │   │   └── #library-grid          [HomeActionsCard + CreateLibraryCard + LibraryCard × N]
    │   │   └── section comunidad (aria-labelledby=#community-title)
    │   │       ├── #community-title + búsqueda + orden + "mostrar ocultas"
    │   │       └── #community-grid        [TemplateCard × N; solo los ejemplos en el idioma de la UI]
    │   │
    │   ├── #library-toolbar            [con librería activa]
    │   │   ├── pestañas Pictogramas / Secuencias / Tableros  [botones con aria-pressed]
    │   │   └── #view-switcher           [lista / grilla; solo en Pictogramas con filas]
    │   │   (copia flotante del selector, sin ID, cuando #view-switcher sale de la vista)
    │   │
    │   ├── Pestaña Secuencias
    │   │   ├── SequenceList → #sequence-list
    │   │   │   └── #sequence-grid       [SequenceCard × N + CreateSequenceCard]
    │   │   └── SequenceEditor           [secuencia abierta; sin ID de raíz]
    │   │       └── #sequence-steps      [lista (RowComponent con número de paso) o grilla, según viewMode]
    │   │
    │   ├── Pestaña Tableros
    │   │   ├── BoardList → #board-list  [tarjetas + modal crear/editar/borrar (sin ID)]
    │   │   └── BoardEditor              [tablero abierto; sin ID de raíz]
    │   │       ├── barra: volver, configurar grilla, mostrar etiquetas, convertir audio para iOS, modo Editar / Usar
    │   │       ├── grilla de celdas     [button por celda, fondo Fitzgerald]
    │   │       ├── panel flotante arrastrable → CellEditor  [modo Editar: color, pictograma, audio]
    │   │       ├── modal de grilla (filas × columnas)
    │   │       └── modo Usar            [fixed inset-0, pantalla completa; botón salir arriba a la izquierda; Escape vuelve a Editar; clic en celda con audio la reproduce]
    │   │
    │   ├── estado vacío                 [librería sin filas; sin ID]
    │   │
    │   ├── #grid-view                   [viewMode=grid]
    │   │   └── PictogramGridCell [#picto-cell-{id}]
    │   │
    │   └── #list-view                   [viewMode=list]
    │       └── RowComponent [#picto-row-{id}]
    │           │
    │           ├── #row-header-{id}
    │           │   ├── utterance (AutoGrowTextarea .utterance-title)
    │           │   ├── #cascade-ctrl-{id}      [Play | Stop]
    │           │   ├── #pipeline-badges-{id}   [tres Badge: COMPRENDER (nluStatus), COMPONER (visualStatus), PRODUCIR (bitmapStatus); ESTRUCTURAR no tiene badge]
    │           │   └── #picto-thumbnail-{id}   [w-20; SVG estructurado o trazado, si no bitmap]
    │           │
    │           ├── #row-detail-{id}   [grid lg:grid-cols-3, condicional]
    │           │   ├── StepBox [#block-nlu]
    │           │   │   └── SmartNLUEditor
    │           │   │       ├── #nlu-context           [idioma, dominio, geoContext]
    │           │   │       └── details: metadatos, frames, NSM / forma lógica / pragmática
    │           │   ├── StepBox [#block-compose]
    │           │   │   ├── #hierarchical-elements → ElementsEditor
    │           │   │   └── #spatial-prompt        → PromptRenderer / textarea
    │           │   └── StepBox [#block-produce]
    │           │       ├── bitmap                 [PENDING: sin ID, era #bitmap-preview; con botón de descarga]
    │           │       └── #svg-preview
    │           │           └── SVGGenerator       [se monta también con solo bitmap]
    │           │               ├── solo bitmap → "Estructurar" (principal) · "Solo trazar" (abre VectorizerModal)
    │           │               ├── con trazado → "Estructurar trazado" · "Estructurar desde el bitmap" · "Re-trazar" (VectorizerModal)
    │           │               ├── Phase5ReviewPanel      [revisión cronometrada del mapeo; solo con registro activo]
    │           │               ├── DraftChecklist         ["Para certificar falta:" por elemento + botón certificar]
    │           │               └── acciones: editar (SVGEditorModal), descargar, descartar
    │           │
    │           ├── acciones de fila           [copiar JSON, historial (RowAuditPanel), borrar]
    │           ├── RowAuditPanel              [portal, z-[60], useDialogA11y]
    │           └── confirmación de borrado    [portal, z-[60]; sin ID]
    │
    ├── footer                          [investigación, colaborar → ParticipateModal]
    │
    ├── #console                        [fixed bottom-0, h-64, z-50, condicional]
    │
    ├── región aria-live="polite"       [sr-only; anuncia mensajes success/error del registro]
    ├── banner de error de guardado     [role="alert", condicional]
    │
    └── MODALES Y OVERLAYS
        ├── FocusViewModal [#focus-view-modal → .focus-modal-backdrop / .focus-modal-content]
        │   ├── modo nlu     → SmartNLUEditor
        │   ├── modo visual  → ElementsEditor + PromptRenderer
        │   ├── modo produce → SVG nativo o bitmap de la fase 3
        │   └── modo format  → SVGGenerator en dos columnas (trazado / estructurado)
        ├── VectorizerModal              [acción manual "Solo trazar" / "Re-trazar" (VTracer 0.6), no es una fase]
        │   ├── #vectorizer-modal        [fixed inset-0]
        │   ├── #vectorizer-controls     [panel izquierdo: controles segmentados + acciones]
        │   └── #vectorizer-preview
        │       ├── #vectorizer-original [bitmap original]
        │       └── #vectorizer-result   [SVG resultante]
        ├── PDFExportModal               [progreso de exportación PDF; role="dialog", aria-labelledby=#pdf-export-modal-title, z-[80]]
        ├── OnboardingModal [#onboarding-modal]   [tutorial, z-[60]; visor de imagen ampliada z-[70]]
        ├── ParticipateModal [#participate-modal] [invitación a participar, z-50]
        ├── StyleEditor (components/PictoForge → lib/style-editor)
        │   ├── #style-editor-backdrop
        │   ├── #style-editor-modal
        │   │   └── #style-editor-panel
        │   │       ├── #style-editor-modal-header
        │   │       └── #style-editor-root           [lib/style-editor]
        │   │           ├── #style-editor-toolbar
        │   │           ├── #style-editor-content
        │   │           ├── #style-editor-gallery
        │   │           ├── #style-editor-code-view       [condicional]
        │   │           └── #style-editor-animations-view [condicional]
        │   └── EditModal [#style-edit-modal]
        │       ├── #style-edit-modal-backdrop
        │       ├── #style-edit-modal-header
        │       ├── #style-edit-modal-selectors
        │       ├── #style-edit-modal-properties
        │       ├── #style-edit-modal-preview
        │       └── #style-edit-modal-footer
        │
        ├── SVGEditorModal [#svg-editor-modal]  [fixed inset-0 z-50, useDialogA11y]
        │   ├── #canvas-stage                    [lienzo a pantalla completa, detrás de los paneles]
        │   │   └── SVGCanvas → #canvas-viewport
        │   ├── alertas de rechazo               [role="alert": guardia semántica y errores de guardado]
        │   ├── SelectionToolbar                 [barra contextual de selección]
        │   ├── #svg-editor-header               [h-16; cerrar, título, toolbar role="toolbar": deshacer/rehacer, zoom, contorno, estilos]
        │   ├── #svg-editor-tree-panel           [aside izquierdo, colapsable]
        │   │   ├── #svg-editor-tree-header
        │   │   └── #svg-editor-tree-content
        │   │       └── SemanticTree [#svg-editor-tree]
        │   │           └── TreeNode [#tree-node-{id}]
        │   └── #svg-editor-properties-panel     [aside derecho, colapsable] → StylePanel
        │       ├── #svg-editor-props-empty      [sin selección]
        │       └── #svg-editor-props-content    [con selección]
        │           ├── #svg-editor-props-header
        │           ├── #svg-editor-props-overrides  [clases citadas y overrides locales]
        │           └── #svg-editor-props-danger     [borrar]
        │   (no existen: #svg-editor-container, #svg-editor-history-controls, #svg-editor-canvas, #svg-editor-props-styles, #svg-editor-props-identity, #svg-editor-props-inline)
        │
        ├── modal de cuota               [role="alertdialog", aria-labelledby=#quota-modal-title]
        ├── ConfirmDialog (App.tsx)      [z-[60], useDialogA11y; PENDING: sin ID]
        └── overlay "Cargando librería"  [z-[70]; sin ID]
```

## IDs pendientes

| Prioridad | Región sin ID                      | Ubicación                                   |
|-----------|------------------------------------|---------------------------------------------|
| Media     | bitmap de la fase 3 (`#bitmap-preview`) | dentro de `#block-produce`, antes de `#svg-preview` |
| Media     | raíz de `BoardEditor`              | `components/BoardEditor.tsx`                |
| Media     | raíz de `SequenceEditor`           | `components/SequenceEditor.tsx`             |
| Baja      | lista de sugerencias de búsqueda   | `SearchComponent` en `App.tsx`              |
| Baja      | div raíz `min-h-screen` (`#app-shell`) | `App.tsx`                               |
| Baja      | ConfirmDialog                      | `App.tsx`                                   |

`#svg-output` se retiró de la lista: `#svg-preview` ocupa ese lugar.

## Notas de diseño

- **Grid principal**: el layout raíz es `flex-col`. `#mainContent` usa `max-w-7xl mx-auto`.
- **Header**: `h-20` (80px), sticky top-0, z-50. Es la única referencia fija del layout.
- **#globalSettings**: `top-20` coincide con la altura del header. Si el header cambia, ajustar.
- **#row-detail-{id}**: grid de 3 columnas (`lg:grid-cols-3`). Colapsa a 1 columna en pantallas angostas.
- **Modales**: usan `fixed inset-0` con z-index literal de Tailwind (`z-50`, `z-[60]`, `z-[80]`, `.focus-modal-backdrop` con 100); solo el modo Usar de `BoardEditor` usa `z-[var(--z-modal)]`.
- **#console**: `fixed bottom-0`, altura fija `h-64`. `#list-view` y `#grid-view` reservan `pb-64` para no quedar tapados.
