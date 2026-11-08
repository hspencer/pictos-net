# Conformidad WCAG 2.1 AA

PICTOS es una herramienta para profesionales de la comunicación aumentativa y alternativa que crean pictogramas para personas con necesidades de accesibilidad cognitiva. Una herramienta así no puede excluir a quienes la usan. Este documento registra el estado de conformidad con WCAG 2.1 nivel AA, verificado contra el código.

Última actualización: 2026-11-08

## Cómo leer este documento

- **Implementado**: el código lo hace; se cita dónde.
- **Parcial**: el mecanismo existe pero no cubre todos los casos; se dice cuáles faltan.
- **Pendiente**: no existe.
- **Sin verificar**: no se ha comprobado con herramientas (axe, Lighthouse) ni con lectores de pantalla. Ningún ítem de este documento se ha probado con un lector de pantalla real.

La revisión del 2026-03-04 marcaba P1 y P2 como completos. Al contrastarla con el código del 2026-11-08 varias afirmaciones resultaron falsas o se degradaron con componentes nuevos (tableros, secuencias, editor SVG); se corrigen abajo.

## P1: Fundamentos

### 1.1 Movimiento reducido (WCAG 2.3.3)

**Parcial.** Hay dos mecanismos, ambos en `index.html`:

- Media query `@media (prefers-reduced-motion: reduce)`: anula `animation` en `.animate-spectral`, `.animate-pulse` y `.animate-spin`, y reduce `transition-duration` a 0.01ms.
- Clase manual `.reduce-motion` en `<html>`, que aplica las mismas reglas. La conmuta `#field-reduce-motion` (estado `reduceMotion` en `App.tsx`, persistido en `localStorage` como `pictonet_reduce_motion`). Si no hay valor guardado, las animaciones parten **desactivadas**.

Lo que ninguno de los dos cubre:

- [ ] Las animaciones de entrada `.animate-in` + `fade-in`, `zoom-in-95`, `slide-in-from-*` de `styles/animations.css` (modales, paneles, listas). `animations.css` no tiene media query de movimiento reducido.
- [ ] Las animaciones CSS dentro de los SVG estructurados (`svgKeyframes`, clases animadas de `services/svgStyles.ts`): no respetan ni la preferencia del sistema ni el interruptor.

### 1.2 Contraste mínimo de texto (WCAG 1.4.3)

**Parcial.** La afirmación anterior («ningún texto bajo 4.5:1») es falsa.

- `text-slate-500` (#64748b) sobre blanco da ~4.6:1 y cumple.
- Quedan 68 usos de `text-slate-400` y 16 de `text-slate-300` en `App.tsx` y `components/` (recuento 2026-11-08). Muchos están sobre fondos claros: pestañas inactivas de `#library-toolbar`, orden de `#library-home`, metadatos de `BoardList`, textos de ayuda en `CellEditor`. `slate-400` sobre blanco da ~2.6:1 y no cumple.
- [ ] Auditar cada uso de `slate-300/400` sobre fondo claro y subirlo a `slate-500` o más oscuro.

### 1.3 Texto escalable (WCAG 1.4.4)

**Parcial.**

- La escala de Tailwind usa `rem` y escala con el navegador.
- Hay 19 tamaños arbitrarios en píxeles (`text-[10px]` × 9, `text-[11px]` × 10) en `App.tsx` y `components/`; no escalan con la preferencia de tamaño de fuente del navegador. Los subtítulos de `BoardEditor` usan `clamp(0.45rem, 1vw, 0.6rem)`, que baja de 8px en pantallas chicas.
- [ ] Reemplazar los `text-[Npx]` por tamaños en `rem`.
- [ ] Sin verificar: zoom del navegador al 200 % sin pérdida de contenido.

### 1.4 Nombres accesibles en botones de solo icono (WCAG 1.1.1, 4.1.2)

**Parcial.** La mayoría tiene `aria-label` (header, consola, editor SVG, `BoardEditor`, `CellEditor`, selector de vista). Excepciones encontradas:

- [ ] Acciones de fila en `RowComponent`: «Copiar» y «Borrar» solo tienen `title`; «Historial» sí tiene `aria-label`.
- [ ] Botón de descarga del bitmap en `#block-produce`: solo `title`.
- [ ] Botones de idioma y de librería en `#lang-btn-group` / `#library-btn-group`: el botón principal tiene `title` y texto visible solo desde `md`.

### 1.5 Iconos decorativos ocultos (WCAG 1.1.1)

**Parcial.** `aria-hidden="true"` está en los iconos de los componentes revisados recientemente (header, editor SVG, `CellEditor`), pero no en todos: varios iconos de `#library-dropdown`, de las acciones de fila y del modo Editar de `BoardEditor` no lo llevan. Sin verificar el resto.

## P2: Navegación y estructura

### 2.1 Teclado y diálogos (WCAG 2.1.1, 2.1.2)

**Parcial.** `hooks/useDialogA11y.ts` da `role="dialog"`, `aria-modal`, trampa de foco, Escape y devolución del foco. Lo usan: ConfirmDialog y FocusViewModal (`App.tsx`), `SVGEditorModal`, `StylePickerModal`, `StyleEditor` (`components/PictoForge`), `RowAuditPanel` y `VectorizerModal`.

No lo usan (sin trampa de foco ni Escape):

- [ ] `OnboardingModal`, `ParticipateModal`.
- [ ] Modal de crear/editar/borrar tablero (`BoardList`) y modal de grilla (`BoardEditor`).
- [ ] Confirmación de borrado de fila (`RowComponent`).
- [ ] `PDFExportModal` tiene `role="dialog"` y `aria-labelledby`, pero no trampa de foco.
- [ ] El modal de cuota tiene `role="alertdialog"` y `aria-labelledby`, pero no trampa de foco.

Otros problemas de teclado:

- [ ] Los nodos de `SemanticTree` (`#tree-node-{id}`) se seleccionan con `onClick` sobre un `div`: no son alcanzables con Tab.
- [ ] Las cabeceras de fila abren el detalle con clic en `#pipeline-badges-{id}`, la miniatura y el chevron, que son `div` o iconos sin rol de botón. El enunciado sí es un `textarea` enfocable.
- [ ] Cada `Badge` es enfocable (`tabIndex={0}`) y se describe con `aria-describedby="badge-tip-{step}"`; ese id se repite en todas las filas, así que la descripción puede resolverse contra el tooltip de otra fila.

### 2.2 Indicador de foco visible (WCAG 2.4.7)

**Implementado** a nivel global: `*:focus-visible` con contorno de 2px #6366f1 en `index.html`, y `box-shadow` equivalente en `input`, `textarea` y `select`. Sin verificar que ningún componente lo anule con `outline-none` sin alternativa (hay usos de `focus:outline-none` en `LibraryHome` y `BoardEditor`, este último con `focus-visible:ring-2`).

### 2.3 Landmarks y roles (WCAG 1.3.1)

**Implementado:**

- `<header id="toolbar" aria-label>`, `<nav id="header-actions" aria-label>`, `<main id="mainContent">`, `<footer>`.
- `<aside>` en los paneles laterales del editor SVG.
- `StepBox` (`#block-nlu`, `#block-compose`, `#block-produce`) con `role="region"` y `aria-label`.
- `#library-home` usa `section` con `aria-labelledby`.
- `#view-switcher` y las pestañas de `#library-toolbar` exponen su estado con `aria-pressed`.

### 2.4 Jerarquía de títulos (WCAG 1.3.1, 2.4.6)

**Sin verificar.** `App.tsx` tiene un `h1` (nombre de la librería), y el footer usa `h4` sin `h2`/`h3` intermedios en la vista de lista, lo que probablemente es un salto.

## P3: Experiencia avanzada

### 3.1 Live regions (WCAG 4.1.3)

**Parcial.** `App.tsx` tiene una región `aria-live="polite"` `sr-only` alimentada por `announce()`: cada mensaje `success` o `error` del registro se anuncia. Hay mensajes `role="alert"` en el banner de error de guardado, en los rechazos del editor SVG y en el modal de cuota.

- [ ] Los cambios de estado de los badges del pipeline (procesando, completado) no se anuncian por sí mismos; dependen de que la fase emita un mensaje de registro.
- [ ] La reproducción de audio en el modo Usar de tableros y sus errores no se anuncian (el error solo pinta el borde de rojo).

### 3.2 Descripciones contextuales (WCAG 1.1.1)

**Parcial.** `#recraft-style-id` se describe con `aria-describedby="recraft-style-hint"`. Los demás textos de ayuda de `#globalSettings` viven en el tooltip de `FieldLabel` (`App.tsx`), que aparece solo con hover del icono, no recibe foco y no está asociado al control.

- [ ] Asociar los tooltips de `FieldLabel` al control con `aria-describedby` y mostrarlos también con foco.

### 3.3 Skip link (WCAG 2.4.1)

**Implementado.** Primer elemento del árbol: enlace `t('a11y.skipToMain')` a `#mainContent`, visible con `focus:not-sr-only`.

### 3.4 Alto contraste (WCAG 1.4.11)

**Parcial.** No existe media query `prefers-contrast`: el modo alto contraste es solo la clase manual `.high-contrast` en `<html>`, conmutada por `#field-high-contrast` (estado `highContrast` en `App.tsx`, persistido como `pictonet_high_contrast`, desactivado por defecto). Las reglas, en `index.html`, ennegrecen bordes de landmarks y controles, oscurecen `text-slate-300/400/500`, blanquean `bg-slate-50` y oscurecen `border-slate-100/200`.

- [ ] Respetar `@media (prefers-contrast: more)` aplicando las mismas reglas sin intervención.
- [ ] Sin verificar: contraste de componentes no textuales (bordes de inputs, badges) fuera del modo alto contraste.

### 3.5 Alternativas de texto para contenido generado (WCAG 1.1.1)

**Parcial.** Los bitmaps usan `alt={row.UTTERANCE}`; los SVG pasan por `injectSvgA11y()` (ver sus problemas en «SVG estructurado como contenido accesible») o traen sus propios `<title>`/`<desc>`. El bitmap de las celdas de tablero usa `alt=""`.

## Tableros (BoardEditor, CellEditor)

Los tableros son la superficie que más se acerca al uso final con la persona usuaria de CAA, así que su accesibilidad pesa más que la del resto.

**Modo Usar** (`components/BoardEditor.tsx`):

- Implementado: ocupa la pantalla completa (`fixed inset-0`); botón de salida con `aria-label` (`board.exitUseMode`); Escape vuelve al modo Editar; cada celda es un `<button>` nativo; `touch-action: manipulation` evita el retardo de doble toque.
- Implementado: las celdas sin audio quedan `disabled` en modo Usar, así que no reciben foco ni clic.
- [ ] Nombre accesible de las celdas: no tienen `aria-label`. Con subtítulos visibles el nombre es el texto del enunciado; con subtítulos ocultos depende del SVG insertado (el estructurado trae `<title>`, el trazado probablemente no) o de un `<img alt="">` vacío. Una celda puede quedar sin nombre.
- [ ] Los subtítulos usan `clamp(0.45rem, 1vw, 0.6rem)` y `truncate`: pueden quedar ilegibles o cortados.
- [ ] El icono de audio (`Volume2`, 8px) es la única señal de que una celda suena; no hay equivalente textual.
- [ ] Contraste del texto sobre los fondos Fitzgerald (`FITZGERALD_BG`): sin verificar.

**Audio** (`BoardEditor`, `CellEditor`):

- Implementado: grabación desde el micrófono con mensaje de permiso denegado (`board.micDenied`), reproducción con `HTMLAudioElement` y conversión para iOS (`board.convertAudioForIos`).
- [ ] Sin verificar: comportamiento con lector de pantalla activo (el audio de la celda compite con la voz del lector).

**Modo Editar:** el `CellEditor` es un panel flotante que se arrastra solo con el ratón (`onMouseDown` en el asa); no hay alternativa de teclado para moverlo, aunque su contenido sí es operable con teclado. Sin verificar el orden de foco al abrirlo.

## Editor SVG (SVGEditorModal)

- Implementado: `useDialogA11y` (trampa de foco, Escape, devolución del foco); barra superior con `role="toolbar"`, `aria-label` y navegación con flechas (`handleToolbarKeyDown`); `aria-label` en deshacer, rehacer, zoom, modo contorno, estilos, cerrar y colapsar/expandir paneles; rechazos de la guardia semántica y errores de guardado con `role="alert"`.
- Implementado: en el lienzo, Escape y Supr/Retroceso actúan sobre la selección; Espacio activa el paneo.
- [ ] El árbol semántico no es navegable con teclado (ver 2.1) ni expone `role="tree"` / `treeitem`.
- [ ] La selección y manipulación de formas en el lienzo es solo con puntero.

## SVG estructurado como contenido accesible

ESTRUCTURAR (`services/svgStructureService.ts`) produce SVG con metadatos de accesibilidad propios:

- Implementado: `<svg role="img" aria-labelledby="title desc" lang="…" tabindex="0">` con `<title id="title">` (el enunciado) y `<desc id="desc">` (la descripción).
- Implementado: cada grupo semántico es `<g role="group" tabindex="0" aria-label="…" data-concept="…">`.
- Implementado: la regla de foco `g[role="group"]:focus { outline: 2px solid #0066cc; outline-offset: 2px; }` viene de `services/svgStyles.ts`; `buildFilteredCSS` la conserva siempre y `extractPreservedRules()` la mantiene al editar.

Problemas conocidos, sin verificar con lectores de pantalla:

- [ ] `role="img"` en el `<svg>` vuelve presentacionales a sus descendientes según ARIA, así que los `role="group"` con `aria-label` probablemente no se exponen; aun así son paradas de Tab por `tabindex="0"`.
- [ ] Varios SVG estructurados en la misma página (lista, grilla, tableros) repiten `id="title"` e `id="desc"`; `aria-labelledby` resuelve al primero del documento, así que cada pictograma podría anunciarse con el título de otro.
- [ ] `injectSvgA11y()` (`utils/svgAccessibility.ts`) agrega otro `<title>`/`<desc>` y otro `role="img"` sin comprobar si el SVG ya los trae; sobre un SVG estructurado los duplica. Se usa en `App.tsx`, `SVGGenerator` y `PictogramGridCell`; `BoardEditor` inserta el SVG sin pasar por él.
- [ ] Las miniaturas insertan el SVG estructurado completo, con todos sus `tabindex="0"`: cada grupo de cada miniatura puede ser una parada de Tab.

## Implementación técnica

| Archivo | Rol |
|---------|-----|
| `index.html` | `prefers-reduced-motion`, `.reduce-motion`, `.high-contrast`, `:focus-visible` |
| `styles/animations.css` | Animaciones de entrada; sin regla de movimiento reducido |
| `hooks/useDialogA11y.ts` | Rol de diálogo, trampa de foco, Escape y devolución del foco |
| `utils/svgAccessibility.ts` | `injectSvgA11y()`: `<title>`, `<desc>`, `role="img"` |
| `services/svgStructureService.ts` | Metadatos de accesibilidad del SVG estructurado |
| `services/svgStyles.ts` | Regla de foco `g[role="group"]:focus` |
| `App.tsx` | Skip link, landmarks, live region, interruptores de movimiento y contraste |
| `components/BoardEditor.tsx` | Modo Usar, Escape, celdas como botones |

## Próximo paso recomendado

Correr axe o Lighthouse sobre `#list-view`, `#library-home`, el modo Usar de un tablero y `#svg-editor-modal`, y probar el modo Usar con VoiceOver en iPad antes del próximo taller. Los ítems «sin verificar» de este documento salen de leer el código, no de pruebas.

## Referencias

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [Tailwind CSS Accessibility](https://tailwindcss.com/docs/screen-readers)
