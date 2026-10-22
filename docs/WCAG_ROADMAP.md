# Conformidad WCAG 2.1 AA

PICTOS es una herramienta para profesionales de accesibilidad cognitiva que crean pictogramas para jovenes autistas. Es contradictorio que la propia herramienta no cumpla con estandares de accesibilidad web. Este documento registra el estado de conformidad WCAG 2.1 nivel AA.

## Estado general

Todas las prioridades criticas (P1) y estructurales (P2) estan implementadas. Quedan items de experiencia avanzada (P3) parcialmente implementados.

## P1: Fundamentos (implementado)

### 1.1 `prefers-reduced-motion` (WCAG 2.3.3)

Implementado en `index.html` via media query `@media (prefers-reduced-motion: reduce)`:

- Desactiva `.animate-spectral`, `.animate-pulse`, `.animate-spin`
- Reduce transiciones a `0.01ms`
- Clase `.reduce-motion` como toggle a nivel de aplicacion

### 1.2 Contraste minimo de texto (WCAG 1.4.3)

- `text-slate-300` y `text-slate-400` reemplazados por `text-slate-500` (#64748b) en fondos claros
- `slate-500` sobre blanco = ~4.6:1 (cumple AA)
- Instancias sobre fondos oscuros (`bg-slate-800`) conservan `text-slate-300/400` porque el contraste ya supera 4.5:1
- Modo alto contraste definido en `index.html` con overrides forzados

### 1.3 Tamanos de texto escalables (WCAG 1.4.4)

- Todos los tamanos usan unidades relativas de Tailwind (`text-xs` = 0.75rem, `text-sm` = 0.875rem)
- Ningun tamano fijo en pixeles menor a 12px
- Texto escala con preferencias del navegador

### 1.4 Labels accesibles en botones de icono (WCAG 1.1.1, 4.1.2)

- Todos los botones de solo icono tienen `aria-label`
- `title` mantenido para tooltip visual donde corresponde

### 1.5 Iconos decorativos ocultos (WCAG 1.1.1)

- `aria-hidden="true"` en todos los iconos que acompanan texto
- Evita lectura duplicada en screen readers

### Verificacion P1

- [x] `prefers-reduced-motion: reduce` desactiva todas las animaciones
- [x] Transiciones reducidas a 0.01ms con motion reduce
- [x] Ningun texto tiene contraste menor a 4.5:1 sobre su fondo
- [x] No existen tamanos de fuente fijos menores a 12px
- [x] Todos los tamanos de fuente usan unidades rem
- [x] Todos los botones de solo icono tienen `aria-label`
- [x] Todos los iconos decorativos tienen `aria-hidden="true"`
- [x] `npm run build` compila sin errores

## P2: Navegacion y estructura (implementado)

### 2.1 Navegacion por teclado (WCAG 2.1.1, 2.1.2)

- Todos los controles interactivos alcanzables via Tab
- `useDialogA11y` hook implementa focus trap en todos los modales
- Escape cierra modales y paneles

### 2.2 Indicadores de foco visibles (WCAG 2.4.7)

- `*:focus-visible` con outline de 2px solido definido en `index.html`
- Box-shadow fallback en inputs
- `focus-visible` evita anillos en clicks de mouse

### 2.3 Landmarks y roles ARIA (WCAG 1.3.1)

- `<main id="mainContent">` para contenido principal
- `<nav id="header-actions" aria-label="Acciones principales">` para navegacion
- `<aside>` en paneles laterales del editor SVG
- `role="region"` con `aria-label` en secciones principales
- `role="img"` con `aria-label` en visualizaciones SVG

### 2.4 Jerarquia de headings (WCAG 1.3.1, 2.4.6)

- Progresion logica h1 > h2 > h3 > h4 sin saltos
- Cada seccion principal tiene heading identificable

### Verificacion P2

- [x] Todos los controles interactivos son alcanzables via teclado
- [x] Modales implementan focus trap y se cierran con Escape
- [x] Indicadores de foco visibles en todos los elementos interactivos
- [x] Landmarks semanticos en la estructura principal
- [x] Jerarquia de headings correcta y sin saltos

## P3: Experiencia avanzada (parcial)

### 3.1 Live regions para feedback dinamico (WCAG 4.1.3)

**Parcial.** Infraestructura `aria-live="polite"` presente en la vista de foco, pero no se utiliza activamente para anunciar cambios de estado del pipeline (generacion completada, errores).

Pendiente:
- [ ] Poblar la live region con mensajes de estado del pipeline
- [ ] `aria-live="assertive"` para errores criticos

### 3.2 Descripciones contextuales (WCAG 1.1.1)

Pendiente:
- [ ] `aria-describedby` para controles complejos
- [ ] Textos de ayuda asociados a inputs y selectores

### 3.3 Skip links (WCAG 2.4.1)

**Implementado.** Link "Saltar al contenido principal" visible con `focus:not-sr-only`, apunta a `#mainContent`.

- [x] Skip link funcional al inicio de la pagina

### 3.4 Preferencias de color y alto contraste (WCAG 1.4.11)

**Implementado.** CSS para `prefers-contrast: more` definido en `index.html` con overrides forzados de color.

- [x] Interfaz usable en modo alto contraste

### 3.5 Alternativas de texto para contenido generado (WCAG 1.1.1)

**Implementado.** Utilidad `injectSvgA11y()` en `utils/svgAccessibility.ts` inyecta `<title>`, `<desc>` y `role="img"` en todos los SVG renderizados, basado en la utterance y el prompt.

- [x] Pictogramas generados tienen alt text descriptivo

## Implementacion tecnica

| Archivo | Rol |
|---------|-----|
| `index.html` | `prefers-reduced-motion`, `prefers-contrast`, `focus-visible`, alto contraste |
| `hooks/useDialogA11y.ts` | Focus trap, Escape, restauracion de foco en modales |
| `utils/svgAccessibility.ts` | Inyeccion de `<title>`, `<desc>`, `role="img"` en SVG |
| `App.tsx` | Skip link, landmarks, aria-labels, aria-live region |

## Referencias

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Tailwind CSS Accessibility](https://tailwindcss.com/docs/screen-readers)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)

*Ultima actualizacion: 2026-03-04*
