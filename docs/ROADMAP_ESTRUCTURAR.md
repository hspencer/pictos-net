# Roadmap: Optimización de la fase (5) ESTRUCTURAR

Branch de experimentación: `exp/optimize-structure`

Creado: 2026-03-05
Estado: Histórico — reemplazado en julio 2026 por el plan documentado en [ESTRUCTURAR.md](ESTRUCTURAR.md)

Nota (2026-07-04): este documento describe la línea base vtracer + Gemini, anterior a la migración a Recraft V4.1. El Experimento A (CSS mínimo) quedó cubierto por `buildFilteredCSS`, el Experimento D (IDs semánticos) por `deriveChildIds`, y el Experimento C por el selector `phase5Model`. El Experimento E (SVG de trabajo vs distribución) sigue vigente como paso 7 del plan actual. Para el enfoque vigente de la fase, ver [ESTRUCTURAR.md](ESTRUCTURAR.md).

---

## Contexto

La fase (5) ESTRUCTURAR es actualmente la más lenta del pipeline y la única que combina tres cargas simultáneas hacia la API: una imagen base64, el SVG crudo completo, y un system instruction denso. Este documento traza el plan de optimización en cinco experimentos independientes, ordenados por seguridad e impacto, más una decisión de diseño transversal sobre el rol del SVG como artefacto.

### Estado actual (línea base)

```
Modelo:         gemini-2.5-flash (texto y estructurar) — ya optimizado
Payload imagen: bitmap PNG 1024×1024 completo (~150–400 KB base64)
Payload SVG:    rawSvg completo (vtracer output, ~10–80 KB)
Payload CSS:    stylesheet completo del sistema (~200+ líneas, ~2.000 tokens)
Elements:       jerarquía VisualElement[] duplicada (system instruction + user content)
Post-proceso:   sanitizeSVG con 3 pasadas regex secuenciales
IDs de paths:   hashes aleatorios de vtracer ("el-abc1234")
Accesibilidad:  tabindex="0" en svg + todos los grupos, desc con glosa NSM
```

### Métricas a capturar por experimento

Para cada variante se mide:
- **Latencia total** (ms desde envío hasta último chunk del stream)
- **Tamaño del payload total** (bytes de la solicitud)
- **Calidad de agrupación** (% de paths correctamente asignados — evaluación manual sobre corpus de 10 pictogramas de referencia)
- **Calidad de accesibilidad** (score WCAG del SVG resultante — auditoría axe-core)

---

## Experimento A — CSS mínimo (solo clases citadas)

**Riesgo: ninguno. Implementar primero.**

### Problema

`buildSystemInstruction()` embebe `generateStylesheet(config)` completo — todas las clases del sistema, incluyendo clases que el usuario nunca va a usar en ese pictograma. Esto puede ser 200+ líneas de CSS (~2.000 tokens) por llamada.

Gemini no necesita saber que `.dashed` o `.tertiary` existen para estructurar un pictograma que solo usa `.main` y `.red`.

### Solución

Extraer del `rawSvg` solo las clases realmente citadas, y construir el CSS mínimo con solo esas definiciones.

```typescript
// utils/cssUtils.ts (nueva función)
export function getUsedClassNames(svgString: string): string[] {
  const matches = svgString.matchAll(/class="([^"]+)"/g);
  const names = new Set<string>();
  for (const m of matches) {
    m[1].split(/\s+/).forEach(c => names.add(c));
  }
  return Array.from(names).filter(c => !c.startsWith('from-inline'));
}

export function buildMinimalCss(
  usedClassNames: string[],
  config: GlobalConfig
): string {
  const allDefs = config.svgStyleDefs ?? INITIAL_STYLES;
  const relevant = allDefs.filter(def =>
    def.selectors.some(sel =>
      usedClassNames.some(name => sel === `.${name}`)
    )
  );
  const minimalCss = generateCssString(relevant, config.svgKeyframes ?? []);

  // Si el usuario no citó nada: esqueleto mínimo para k/f
  if (!minimalCss.trim()) {
    return `
.k { fill: #1a1a1a; stroke: #ffffff; stroke-width: 3pt; }
.f { fill: #ffffff; stroke: #1a1a1a; stroke-width: 3pt; }
    `.trim();
  }
  return minimalCss;
}
```

Luego en `svgStructureService.ts`:
```typescript
// Antes
const css = generateStylesheet(config);

// Después
const usedClasses = getUsedClassNames(input.rawSvg);
const css = buildMinimalCss(usedClasses, input.config);
```

### Alternativa A2: usar el `<style>` ya embebido en el rawSvg

Si el usuario editó estilos en el VectorizerModal antes de estructurar, el `rawSvg` ya tiene un `<style>` con exactamente las reglas activas:

```typescript
import { getSvgStyleText } from '../utils/styleUtils';

const existingCss = getSvgStyleText(input.rawSvg);
const css = existingCss.trim()
  ? existingCss                          // usar lo que ya tiene el SVG
  : buildMinimalCss(usedClasses, input.config);  // fallback si no editó
```

Esto respeta el trabajo previo del usuario y es conceptualmente más coherente con el modelo de dos niveles documentado en `CSS_STYLING_ARCHITECTURE.md`.

### Resultado esperado
- Reducción del payload: ~70–90% del CSS actual
- Latencia: mejora moderada (~5–10%) — el CSS no es el bottleneck principal pero reduce tokens del system instruction
- Riesgo de regresión: ninguno — si Gemini no ve una clase, simplemente no la aplica

---

## Experimento B — Bitmap condicional + downscale a 512px

**Riesgo: requiere validación empírica. El cambio más sensible.**

### El dilema

El bitmap PNG 1024×1024 base64 es el componente de mayor peso del payload (~150–400 KB). Pero es también el que da a Gemini la capacidad de correlacionar paths SVG con conceptos visuales cuando los colores por sí solos son ambiguos.

La pregunta real: **¿cuándo es imprescindible la imagen?**

### Análisis de casos

| Escenario | ¿Imagen necesaria? | Razonamiento |
|-----------|-------------------|--------------|
| Elementos con colores distintos, pocos paths (<15) | No | El color + posición en el SVG es suficiente |
| Mismo color en múltiples elementos (silueta negra) | Sí | Sin imagen, la segmentación es geométrica pura — frágil |
| Modo `stacked` con muchas capas superpuestas | Sí | El orden de capas no es obvio desde el SVG crudo |
| Modo `cutout` | Probablemente no | Las capas son aditivas y visualmente independientes |
| >3 elementos en la jerarquía | Depende | Más elementos = más ambigüedad en la asignación |

### Heurístico propuesto (configurable)

```typescript
// svgStructureService.ts

interface VisualReferenceDecision {
  useImage: boolean;
  reason: string;
}

function shouldUseVisualReference(
  rawSvg: string,
  elements: VisualElement[],
  config: Partial<VectorizerConfig>
): VisualReferenceDecision {
  const pathCount = (rawSvg.match(/<path/g) ?? []).length;
  const elementCount = flattenElements(elements).length;
  const isMonochrome = !rawSvg.match(/fill="#(?!1a1a1a|ffffff)[0-9a-f]{6}"/i);
  const isStacked = config.hierarchical !== 'cutout';

  if (pathCount > 20) return { useImage: true, reason: 'alto número de paths' };
  if (elementCount > 4) return { useImage: true, reason: 'jerarquía compleja' };
  if (isMonochrome && elementCount > 2) return { useImage: true, reason: 'monocromo con múltiples elementos' };
  if (isStacked && pathCount > 10) return { useImage: true, reason: 'modo stacked con capas superpuestas' };

  return { useImage: false, reason: 'SVG suficientemente informativo' };
}
```

### Downscale cuando se usa imagen

La resolución para identificar regiones visuales es mucho menor que la de generación. 512×512 JPEG es suficiente para distinguir "eso es la cabeza" vs "eso es el vaso".

```typescript
// Nueva función en svgStructureService.ts o utils/imageUtils.ts
async function prepareReferenceImage(
  dataUrl: string,
  maxDim = 512
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // JPEG para referencia visual — la fidelidad exacta no importa
      resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
    };
    img.src = dataUrl;
  });
}
```

### Variantes a evaluar

| Variante | Descripción | Payload imagen |
|----------|-------------|---------------|
| B0 (actual) | Siempre bitmap 1024px PNG | 100% |
| B1 | Siempre bitmap 512px JPEG | ~15% |
| B2 | Condicional (heurístico) — sin imagen cuando aplica | 0% o 15% |
| B3 | Sin imagen, nunca | 0% |

### Corpus de evaluación

Usar 10 pictogramas del corpus ICAP con variedad de complejidad:
- 2 siluetas monocromas simples (1-2 elementos)
- 3 pictogramas color con 2-3 elementos
- 3 pictogramas complejos (4+ elementos, modo stacked)
- 2 pictogramas con elementos muy pequeños (texto, flechas)

Para cada variante, evaluar manualmente la calidad de agrupación (paths en grupo correcto vs total paths).

### Resultado esperado
- **B1 sobre B0**: ~60–70% reducción de payload imagen, sin pérdida de calidad esperada
- **B2 sobre B0**: reducción variable (30–80% según pictograma), posible degradación en casos complejos
- **B3**: reducción máxima, degradación significativa esperada en pictogramas con elementos del mismo color

---

## Experimento C — Modelo: gemini-2.5-flash en lugar de gemini-3-pro-preview

**Riesgo: bajo — pero requiere validación de calidad de agrupación.**

### Problema

La fase ESTRUCTURAR usa `gemini-3-pro-preview` — el modelo más lento del stack. La tarea es fundamentalmente una transformación estructurada de documento (distribuir paths en grupos), no razonamiento creativo ni síntesis compleja. Flash maneja bien este tipo de tareas.

### Cambio

```typescript
// svgStructureService.ts, función structureSVG()

// Antes
model: "gemini-3-pro-preview"

// Después
model: "gemini-2.5-flash"
```

### Variantes a evaluar

| Variante | Modelo | Temperatura |
|----------|--------|-------------|
| C0 (actual) | gemini-3-pro-preview | default |
| C1 | gemini-2.5-flash | default |
| C2 | gemini-2.5-flash | 0.2 (más determinístico) |

Para C2: un temperature bajo tiene sentido aquí porque la tarea es determinística — no queremos variación creativa, queremos consistencia en la asignación de paths.

### Resultado esperado
- Latencia: reducción del 50–70%
- Costo API: reducción del 80–90%
- Calidad: probablemente indistinguible para pictogramas simples; posible degradación en casos con >5 elementos superpuestos del mismo color

---

## Experimento D — IDs semánticos derivados del grupo contenedor

**Riesgo: bajo. No afecta la llamada a Gemini — es post-proceso local.**

### Problema

vtracer genera `<path id="el-abc1234">` con hashes aleatorios. Después de ESTRUCTURAR, el SVG tiene:

```xml
<g id="cabeza">
  <path id="el-abc1234" ... />
  <path id="el-xyz9876" ... />
</g>
```

Esto hace el SVG opaco para la edición posterior, los overrides CSS son ilegibles (`#el-abc1234.red { ... }`), y el árbol de capas en el SVGEditorModal muestra hashes en lugar de nombres significativos.

### Solución: paso post-estructuración (sin API)

```typescript
// utils/svgUtils.ts — nueva función

/**
 * Renombra los hijos directos de cada <g> semántico usando el ID del grupo
 * como prefijo. Actualiza también las referencias en los override rules del <style>.
 *
 * Ejemplo:
 *   <g id="cabeza">
 *     <path id="el-abc1234"> → <path id="cabeza-1">
 *     <path id="el-xyz9876"> → <path id="cabeza-2">
 *   </g>
 *
 * Para grupos anidados:
 *   <g id="cabeza">
 *     <g id="ojo">          → id se mantiene (ya es semántico)
 *       <path id="el-...">  → <path id="ojo-1">
 *     </g>
 *   </g>
 */
export function deriveChildIdsFromGroups(svgString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Mapa oldId → newId para actualizar overrides después
  const renames = new Map<string, string>();

  // Solo procesar <g> con ID semántico (no hashes)
  const semanticGroups = Array.from(doc.querySelectorAll('g[id]'))
    .filter(g => !g.id.startsWith('el-'));

  for (const group of semanticGroups) {
    let counter = 1;
    for (const child of Array.from(group.children)) {
      // Solo renombrar paths (no sub-grupos que ya son semánticos)
      if (child.tagName === 'path' || child.tagName === 'circle' || child.tagName === 'rect') {
        const oldId = child.getAttribute('id');
        if (oldId) {
          const newId = `${group.id}-${counter++}`;
          child.setAttribute('id', newId);
          renames.set(oldId, newId);
        }
      }
    }
  }

  let result = new XMLSerializer().serializeToString(doc);

  // Actualizar referencias en override rules del <style>
  for (const [oldId, newId] of renames) {
    // Reemplaza #old-id.clase → #new-id.clase en el bloque <style>
    result = result.replace(
      new RegExp(`#${oldId}\\.`, 'g'),
      `#${newId}.`
    );
  }

  return result;
}
```

Este paso se aplica en `svgStructureService.ts` después de `cleanSVGResponse()` y `sanitizeSVG()`:

```typescript
let svgContent = cleanSVGResponse(text);
svgContent = sanitizeSVG(svgContent);
svgContent = deriveChildIdsFromGroups(svgContent);  // ← nuevo
```

### Resultado esperado
- Sin impacto en latencia (proceso local, <10ms)
- SVG semánticamente navegable: árbol de capas legible
- Overrides CSS interpretables: `#cabeza-1.main { fill: ... }`
- Exportación más limpia para distribución AAC

---

## Experimento E — Accesibilidad y SSoT: SVG de trabajo vs SVG de distribución

**Esta es una decisión de diseño, no solo una optimización técnica.**

### El problema de fondo

El SVG estructurado actualmente intenta servir dos contextos con requisitos opuestos:

| Contexto | Requisitos |
|----------|-----------|
| **SVGEditorModal** (edición) | `tabindex="0"` en grupos para selección por teclado, `role="group"` con `aria-label` para navegación semántica del árbol de capas |
| **Distribución AAC** (uso real como pictograma) | Sin `tabindex` en grupos internos, `aria-hidden` en paths decorativos, IDs únicos por instancia, `<desc>` en lenguaje natural |

El mismo archivo no puede optimizar ambos a la vez.

### Propuesta: dos representaciones con un paso de "bake"

```
structuredSvg (en IndexedDB)      →  SVG de trabajo  →  edición en SVGEditorModal
                                   ↓
                               exportSvg()           →  SVG de distribución
                               (paso local, sin API)     (para AAC, web, impresión)
```

El paso `exportSvg()` aplica transformaciones ligeras:

```typescript
// utils/svgExport.ts — nueva función

interface ExportOptions {
  instanceId?: string;          // para hacer IDs únicos en páginas con múltiples SVGs
  inlineContext?: 'img' | 'inline' | 'standalone';
  naturalLanguageDesc?: string; // descripción para AT
}

export function exportSvgForDistribution(
  svgString: string,
  utterance: string,
  options: ExportOptions = {}
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg')!;
  const suffix = options.instanceId ?? shortHash(utterance);

  // 1. IDs únicos por instancia
  const title = doc.getElementById('title');
  const desc = doc.getElementById('desc');
  if (title) title.id = `title-${suffix}`;
  if (desc) desc.id = `desc-${suffix}`;
  svg.setAttribute('aria-labelledby', `title-${suffix} desc-${suffix}`);

  // 2. Descripción en lenguaje natural (no glosa NSM)
  if (desc && options.naturalLanguageDesc) {
    desc.textContent = options.naturalLanguageDesc;
  }

  // 3. Eliminar tabindex de grupos internos (mantener solo en root si inline)
  svg.querySelectorAll('g[tabindex]').forEach(g => g.removeAttribute('tabindex'));

  if (options.inlineContext === 'img') {
    // Como <img src="...svg">: AT lee el alt del img, no el SVG interno
    svg.removeAttribute('tabindex');
    svg.removeAttribute('focusable');
    svg.setAttribute('aria-hidden', 'true');
  } else if (options.inlineContext === 'inline') {
    // Inline en HTML: el SVG root debe ser focusable, pero los grupos internos son decorativos
    svg.setAttribute('tabindex', '0');
    svg.querySelectorAll('g[role="group"]').forEach(g => {
      g.setAttribute('aria-hidden', 'true');
    });
  }

  // 4. aria-hidden en paths individuales (son piezas decorativas del shape)
  svg.querySelectorAll('path, circle, rect, ellipse').forEach(el => {
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      el.setAttribute('aria-hidden', 'true');
    }
  });

  return new XMLSerializer().serializeToString(doc);
}
```

### E1 — Descripción `<desc>` en lenguaje natural

El `<desc>` actual viene de `accessibility.visualDescription` en el metadata, que construye `buildMetadataJSON()` combinando campos de `visual_guidelines`:

```typescript
// Actual (en buildMetadataJSON):
visualDescription: `${focus_actor} ${action_core} ${object_core}`
// Resultado: "perfil_humano beber vaso_agua" — técnico, no natural
```

Propuesta: generar la descripción desde la NLU de manera más natural:

```typescript
// svgStructureService.ts — nueva función
function buildNaturalDescription(nlu: NLUData, utterance: string): string {
  // Usar frame_label si existe (ej: "Ingestión de líquido")
  // + visual_guidelines para descripción de lo que se ve
  const vg = nlu.visual_guidelines;
  if (nlu.frame_label && vg) {
    return `${utterance}. Se muestra: ${vg.focus_actor} realizando ${vg.action_core}${vg.object_core ? ` con ${vg.object_core}` : ''}.`;
  }
  return utterance;
}

// En buildMetadataJSON():
accessibility: {
  cognitiveDescription: utterance,
  visualDescription: buildNaturalDescription(input.nlu, input.utterance)
}
```

### E2 — Separación entre prompt de Gemini y el cambio de arquitectura

El cambio de `tabindex` y `aria-hidden` **no debe ir en el prompt a Gemini**. La system instruction ya es densa. El rol de Gemini es estructurar semánticamente el SVG; el ajuste de accesibilidad para distribución es responsabilidad del cliente.

Esto también significa que el prompt puede simplificarse: eliminar las instrucciones de `tabindex`, `focusable`, `role="img"` en el root (eso lo hace el cliente en `exportSvgForDistribution()`).

---

## Plan de implementación

### Branch: `exp/optimize-structure`

```
Semana 1 — Experimentos A + C (sin riesgo)
  A: CSS mínimo (utils/cssUtils.ts + svgStructureService.ts)
  C: Cambio de modelo a gemini-2.5-flash con temperature=0.2

Semana 2 — Corpus de evaluación y Experimento B
  Construir corpus de 10 pictogramas de referencia con sus rawSvg
  Correr variantes B0, B1, B2, B3 sobre el corpus
  Medir: latencia, calidad de agrupación (manual), tamaño payload

Semana 3 — Experimentos D + E (post-proceso)
  D: deriveChildIdsFromGroups() (local, sin API)
  E1: buildNaturalDescription() para <desc>
  E2: exportSvgForDistribution() + decisión inline/img context
  Auditoría axe-core sobre SVGs de distribución resultantes

Semana 4 — Integración y documentación
  Merge de los experimentos exitosos a main
  Actualizar ARCHITECTURE.md y CSS_STYLING_ARCHITECTURE.md
  Documentar heurístico final de decision de bitmap (Experimento B)
```

### Criterios de aceptación por experimento

| Experimento | Métrica de éxito |
|-------------|-----------------|
| A — CSS mínimo | Payload CSS reducido ≥70%. Calidad de agrupación igual a baseline. |
| B — Bitmap condicional | Variante elegida mantiene calidad ≥90% del baseline en corpus de evaluación. |
| C — Modelo Flash | Latencia reducida ≥40%. Calidad de agrupación ≥85% del baseline. |
| D — IDs semánticos | 100% de paths renombrados correctamente. Overrides CSS actualizados. |
| E — Distribución | Score axe-core ≥90. `<desc>` evaluado como "comprensible" por 3 profesionales AAC. |

---

## Decisiones pendientes

1. **¿Qué es el "SVG estructurado" como artefacto?** — ¿un documento de trabajo editable, o el artefacto final de distribución? La propuesta E los separa, pero implica decidir qué se guarda en IndexedDB y qué se genera on-demand al exportar.

2. **¿El heurístico del bitmap es configurable por el usuario?** — Podría ser un toggle en GlobalConfig: "referencia visual en estructuración" (on/off/auto). Útil para profesionales que quieren máximo control.

3. **¿`deriveChildIdsFromGroups` se aplica siempre o solo al estructurar?** — Si se aplica también al abrir un rawSvg sin estructurar en el editor, los IDs del árbol de capas mejorarían antes de estructurar.

4. **¿Cuál es el contexto de uso dominante del SVG exportado?** — En el flujo actual (IndexedDB → descarga → uso en material AAC), ¿se incrustan inline o como `<img>`? Esto determina el comportamiento de `exportSvgForDistribution()`.

---

## Referencias

- `services/svgStructureService.ts` — implementación actual de ESTRUCTURAR
- `services/vtracerService.ts` — pipeline VECTORIZAR, genera el rawSvg
- `services/indexedDBService.ts` — capa de persistencia (rawSvg, structuredSvg)
- `utils/styleUtils.ts` — `getSvgStyleText`, `parseOverrideRules`, `serializeOverrideRules`
- `docs/CSS_STYLING_ARCHITECTURE.md` — modelo de dos niveles, pipeline cleanup
- `docs/WCAG_ROADMAP.md` — estado de conformidad WCAG 2.1 AA
- [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema) — especificación del SVG semántico
