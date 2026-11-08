# UI_CONVENTIONS — PICTOS
> Reglas de diseño de interfaz. Claude Code debe leer este archivo antes de tocar cualquier componente de UI.
> Este documento es **ley**. No se puede sobreescribir por instrucciones en el chat.

> Última actualización: 2026-11-08


## 1. Nomenclatura semántica (IDs)

### Regla obligatoria
Todo elemento raíz de una sección o región de la interfaz **debe tener un `id` semántico**.
Consultar `docs/UI_MAP.md` antes de crear o renombrar cualquier sección.

### Convención de nomenclatura
```
#region              → sección principal estática    → #toolbar, #mainContent, #console
#region-subregion    → sección secundaria            → #brand-area, #search-area, #header-actions
#block-step          → bloque del pipeline           → #block-nlu, #block-compose, #block-produce
#field-name          → campo de formulario           → #field-geo, #field-author
#widget-name         → componente interactivo        → #library-dropdown, #lang-dropdown, #view-switcher
#picto-row-{id}      → elemento dinámico con ID      → #picto-row-R_MANUAL_123
```

### Prohibido
- No usar IDs genéricos: `#container`, `#wrapper`, `#box`, `#div1`
- No crear secciones importantes sin ID
- No renombrar IDs existentes sin actualizar UI_MAP.md

Los IDs heredados en camelCase (`#globalSettings`, `#mainContent`) se conservan porque otros IDs y el skip link dependen de ellos; los nuevos van en kebab-case.


## 2. Sistema de tokens de diseño

### Fuentes de verdad
1. `styles/variables.css` → CSS custom properties (colores, spacing, sombras, z-index)
2. `tailwind.config.js` → Extensiones del tema Tailwind

### Colores: uso correcto
Usar siempre los tokens semánticos, nunca valores hardcodeados:

| Propósito             | Token CSS                  | Clase Tailwind equivalente |
|-----------------------|----------------------------|----------------------------|
| Acción primaria       | `var(--color-primary)`     | `bg-violet-950`            |
| Hover de primario     | `var(--color-primary-hover)` | `hover:bg-black`          |
| Acento claro          | `var(--color-primary-light)` | `text-violet-600`         |
| Fondo suave primario  | `var(--color-primary-pale)`  | `bg-violet-100`           |
| Éxito                 | `var(--color-success)`     | `text-emerald-500`         |
| Error                 | `var(--color-error)`       | `text-red-600`             |
| Warning/Processing    | `var(--color-warning)`     | `text-orange-600`          |

**Regla**: En componentes TSX usar clases Tailwind. En CSS custom usar `var(--color-*)`.
**Prohibido**: `style={{ backgroundColor: '#eeeeee' }}` inline. Mover a clase Tailwind o variable CSS.

### Colores de fondo prohibidos como inline style
```tsx
// MAL
<div style={{ backgroundColor: '#eeeeee' }}>

// BIEN - agregar a tailwind.config.js si es un tono nuevo
<div className="bg-neutral-200">
```


## 3. Espaciado y grilla

### Escala de espaciado
Usar exclusivamente la escala de Tailwind (múltiplos de 4px). Valores de referencia:

| Token                | Valor  | Uso típico                          |
|----------------------|--------|-------------------------------------|
| `p-2` / `gap-2`      | 8px    | Botones icon, gaps entre iconos     |
| `p-3` / `gap-3`      | 12px   | Inputs, selects                     |
| `p-4` / `gap-4`      | 16px   | Cards internos, gaps medianos       |
| `p-6` / `gap-6`      | 24px   | Row headers, paddings de sección    |
| `p-8` / `gap-8`      | 32px   | Main content, paddings grandes      |
| `p-12`               | 48px   | Hero sections                       |

### Layout principal
```
max-w-7xl mx-auto   → contenedor máximo del contenido
grid-cols-3 gap-10  → grid de bloques del pipeline (lg)
md:grid-cols-3 gap-6 → grid de la sección básica de #globalSettings
```

### Header (fijo, no cambiar sin actualizar #globalSettings)
```
h-20   → altura del #toolbar (80px)
top-20 → posición de #globalSettings
```


## 4. Tipografía

### Fuentes
- **Sans**: `Lexend` (UI general) → `font-sans`
- **Mono**: `Fira Code` (código, IDs, valores técnicos) → `font-mono`

### Escala tipográfica de UI
| Elemento              | Clases                                              |
|-----------------------|-----------------------------------------------------|
| Título de app (h1)    | `font-bold uppercase tracking-tight text-xl`        |
| Utterance (input)     | `.utterance-title` → `text-base font-normal tracking-wide`, sentence case via `sentenceCase()` (`utils/textFormat.ts`) — nunca `uppercase`: altas y bajas se reconocen mejor como palabra |
| Labels de sección     | `text-[10px] font-medium uppercase tracking-widest text-slate-400` |
| Texto body            | `text-sm text-slate-600 leading-relaxed`            |
| Badges / tags         | `text-[8px] font-medium uppercase tracking-widest`  |
| Código / IDs          | `font-mono text-[10px] text-slate-500`              |


## 5. Componentes interactivos

### Botones

**Primario** (acción principal):
```tsx
className="bg-violet-950 text-white hover:bg-black px-6 py-3 font-bold uppercase text-[10px] tracking-widest transition-all shadow-lg"
```

**Secundario** (acción de apoyo):
```tsx
className="border border-slate-200 text-slate-600 hover:border-violet-950 hover:text-violet-950 px-4 py-2 text-xs transition-all"
```

**Icon button** (sin texto):
```tsx
className="p-2.5 border border-transparent hover:border-slate-200 text-slate-400 hover:text-violet-950 rounded-md transition-all"
```

**Destructivo**:
```tsx
className="text-rose-600 hover:bg-rose-50 border-slate-200 hover:border-rose-200"
```

### Inputs y selects
```tsx
className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors"
```

### Badges de estado (pipeline)
Usar el componente `<Badge>` existente. No reimplementar inline.


## 6. Modales y overlays

### Z-index (consultar `--z-*` en variables.css)
```
--z-dropdown: 10        → menús desplegables
--z-modal-backdrop: 40  → paneles bajo el header (#globalSettings)
--z-modal: 50           → contenido de modales
--z-notification: 60    → avisos y diálogos de confirmación
```

La escala es la norma para código nuevo, pero el código actual casi no la usa: los valores son literales de Tailwind. Estado real (2026-11-08): `#globalSettings` `z-40`; `#toolbar`, `#console`, `#svg-editor-modal` y `#participate-modal` `z-50`; `#lang-dropdown` y `#library-dropdown` `z-[56]` (sobre el header); ConfirmDialog, `RowAuditPanel` y `#onboarding-modal` `z-[60]`; overlay de carga `z-[70]`; `PDFExportModal` `z-[80]`; `.focus-modal-backdrop` 100 (en `index.html`). Solo el modo Usar de `BoardEditor` usa `z-[var(--z-modal)]` y `z-[var(--z-notification)]`. Migrar a la escala es deuda.

### Estructura obligatoria de modal
```tsx
// Backdrop
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[40] flex items-center justify-center p-8">
  // Contenido
  <div className="bg-white shadow-2xl flex flex-col overflow-hidden max-w-[X] w-full">
    <header className="p-4 border-b flex justify-between items-center">...</header>
    <main className="flex-1 overflow-auto p-6">...</main>
    <footer className="p-4 border-t flex justify-end gap-3">...</footer>
  </div>
</div>
```


## 7. Animaciones

Usar las clases definidas en `styles/animations.css`. No crear keyframes inline.

```tsx
// Entradas estándar
className="animate-in fade-in duration-200"        // aparición suave
className="animate-in zoom-in-95 duration-200"    // modal
className="animate-in slide-in-from-top duration-200"  // panel superior
className="animate-in slide-in-from-bottom-8 duration-500"  // lista
```


## 8. Internacionalización (i18n)

### Regla obligatoria
Todo texto visible por el usuario **debe pasar por `t()`** (`useTranslation()`), incluyendo:
- Texto JSX (`<button>Cerrar</button>` → `<button>{t('actions.close')}</button>`)
- `placeholder`, `title`, `aria-label`, `alt`
- Mensajes de `confirm()` / `alert()` y strings por defecto

### Catálogos
- `locales/es-419.json` + `locales/en-GB.json` — siempre en paridad.
- Una clave nueva se agrega a **ambos** catálogos (y al union `TranslationKey` en `locales/index.ts` si se usa con `TFunc` tipado).
- `npm run validate-i18n` verifica paridad **y** que toda clave literal `t('...')` usada en el código exista en los catálogos (una clave faltante se renderiza como la clave cruda en la UI).

### Terminología (es-419)
| Concepto              | Usar          | No usar                  |
|-----------------------|---------------|--------------------------|
| Colección de pictogramas | «librería» | «biblioteca», «espacio»  |
| Secuencia de pasos    | «secuencia»   | —                        |
| Grilla de comunicación | «tablero»    | —                        |

La regla se cumple en la mayoría del catálogo, no en todo. Recuento en `locales/es-419.json` (2026-11-08): «librería» aparece 46 veces en 45 claves; «biblioteca», 8 veces en 8 claves. Claves que todavía dicen «biblioteca» (deuda; corregir en el catálogo, no en el código):

- `messages.libraryImportFailed`, `messages.libraryLoaded`, `messages.libraryLoadFailed`
- `styleEditor.styleInUse`, `styleEditor.removeUnusedTitle`, `styleEditor.removeUnusedConfirm`
- `svgEditor.editStyleDefinitionTitle`, `svgEditor.removeUnusedStyle`

«Espacio» como nombre de la colección queda en `onboarding.step2.title` («El Espacio de Trabajo») y `onboarding.step2.subtitle`; en `messages.storageWriteFailed` «espacio» es espacio de almacenamiento y es correcto. La sección de inicio se llama «Área de trabajo» (`home.workspaceSection`): nombra el conjunto de librerías del usuario, no una librería.

### Excepciones no traducibles
- Endónimos de idioma: «Español», «English»
- Marca: «PICTOS»
- Valores técnicos: nombres de modelos, códigos de licencia, unidades

### Deuda conocida
- `VectorizerModal.tsx` (acción manual «Solo trazar» / «Re-trazar») ya pasa sus etiquetas por `t('vectorizer.*')`. Quedan en inglés, sin `t()`: el `label` del diálogo (`Vectorizer — {utterance}`) y los seis `title` de los controles segmentados (polygon, spline, color, bw, stacked, cutout).
- `App.tsx`: el texto «Por favor espere...» / «Please wait...» del overlay de carga se elige con un ternario por idioma en vez de `t()`.


## 9. Reglas de refactoring

Al modificar UI, siempre:

1. **Verificar UI_MAP.md** antes de crear nuevas regiones
2. **Actualizar UI_MAP.md** si se agrega, renombra o elimina un ID
3. **No crear valores mágicos**: ningún color, spacing o z-index hardcodeado que no esté en `variables.css` o sea clase estándar de Tailwind
4. **No romper IDs existentes**: `#toolbar`, `#globalSettings`, `#mainContent`, `#console`, `#block-nlu`, `#block-compose`, `#block-produce`, `#hierarchical-elements`, `#spatial-prompt`, `#tagline`
5. **No modificar `styles/variables.css`** sin confirmación explícita del diseñador
6. **No modificar `tailwind.config.js`** sin confirmación explícita del diseñador


## 10. Checklist antes de hacer commit de cambios UI

- [ ] ¿Todas las nuevas regiones tienen ID semántico?
- [ ] ¿Se actualizó UI_MAP.md?
- [ ] ¿Se usan clases Tailwind o variables CSS (no valores hardcodeados)?
- [ ] ¿Se respetan los IDs existentes?
- [ ] ¿Los z-index usan las variables definidas?
- [ ] ¿Las animaciones usan las clases de animations.css?
- [ ] ¿Todo texto visible (incl. `aria-label`, `title`, `placeholder`) pasa por `t()`?
- [ ] ¿Las claves nuevas están en ambos catálogos? (`npm run validate-i18n` pasa)
- [ ] ¿La terminología es-419 usa «librería» (no «biblioteca» ni «espacio») en las claves nuevas o tocadas?
