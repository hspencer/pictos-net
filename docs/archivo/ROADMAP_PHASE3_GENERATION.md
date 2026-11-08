# Roadmap: Fase 3 (PRODUCIR) — Modelos y Consistencia Visual

Creado: 2026-06-08
Estado: Referencia activa (algunas líneas de trabajo abiertas)

## Contexto

Desde v2.0.1 la Fase 3 soporta múltiples modelos de generación: Recraft V4.1 (vector y raster) y Gemini (Flash 2.5, Flash 3.1, Pro 3). Este documento registra las exploraciones de optimización, las restricciones confirmadas, y las líneas de trabajo abiertas.

---

## Estado actual (v2.0.2)

| Modelo | Familia | Parámetros activos | Quota |
|--------|---------|-------------------|-------|
| `recraftv4_1_vector` | vector | prompt, size (1:1), controls.colors | 1 u/llamada |
| `recraftv4_1` | bitmap | prompt, size (1:1), controls.colors | 1 u/llamada |
| `gemini-3.1-flash-image` | bitmap | prompt, generationConfig.imageConfig (1:1, 1K) | 1 u/llamada |
| `gemini-3-pro-image` | bitmap | ídem | 1 u/llamada |
| `gemini-2.5-flash-image` | bitmap | ídem (legacy, mantenido por compatibilidad) | 1 u/llamada |

Default activo: `gemini-2.5-flash-image`

---

## Restricciones confirmadas

### Recraft V4.1 no soporta estilos por referencia

Confirmado en docs oficiales de Recraft (2026-06):

> "Styles are not supported on V4 and V4.1 models (including their Pro, Utility, and Vector variants)."

- Los parámetros `style`, `style_id` y `custom_style_id` solo funcionan con modelos V2 y V3.
- Los estilos creados vía `POST /v1/styles` (con imágenes de referencia) quedan ligados al modelo/estilo base con que se crearon — también V2/V3.
- **Conclusión**: en V4.1 la consistencia visual de serie depende exclusivamente del prompt (`visualStylePrompt`) y la paleta (`controls.colors`).

### Gemini imagen no soporta negative prompt

Documentado en Firebase/Vertex: `negativePrompt` fue removido de la Gemini Developer API para Imagen 3.x y los modelos Nano Banana. Control alternativo: incluir restricciones en el prompt positivo ("no text, no labels, white background, no gradients").

---

## Líneas de trabajo abiertas

### 1. Gemini multimodal — imagen de referencia como ancla de estilo

**Factibilidad**: alta. La API Gemini `generateContent` acepta `inlineData` (imagen base64) en el array `contents`.

**Idea**: enviar 1–3 pictogramas de la propia biblioteca como imágenes de referencia junto al prompt de generación. El modelo las usa como ancla visual, aproximando el efecto de style conditioning sin `style_id`.

```javascript
// Payload tentativo en api-gemini-worker-background.js
contents: [{
  parts: [
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: referenceBase64 } },
    // hasta 3 imágenes de referencia
  ]
}]
```

**Cambios requeridos**:
- `GlobalConfig.geminiReferenceImages?: string[]` — data URLs de referencia (max 3)
- UI en panel de configuración para seleccionar pictogramas de la biblioteca como referencias
- `api-gemini-worker-background.js`: aceptar `referenceImages` en el payload y construir el array `parts`
- `geminiService.ts`: pasar las imágenes al worker si están configuradas
- Estimación de tamaño: 3 imágenes PNG 1024×1024 ≈ 3×100–400 KB en base64 — dentro del límite de Gemini

**Prioridad**: alta — es la alternativa más directa a style_id para series coherentes.

---

### 2. Recraft V3 + VTracer — rama de estilo por referencia

**Factibilidad**: media. Requiere activar `recraftv3` como modelo alternativo.

**Flujo**:
```
recraftv3 + style_id → imagen PNG → VTracer WASM (ya disponible) → rawSvg
```

**Ventajas**: máximo control de estilo visual mediante imágenes de referencia propias.
**Desventajas**: VTracer produce SVG de baja semántica (paths numéricos), calidad vectorial inferior a V4.1, pipeline más largo.

**Estado**: VTracer WASM ya está integrado (`services/vtracerService.ts`, `VectorizerModal.tsx`). Solo faltaría:
- Añadir `recraftv3` al `GenerationModel` type
- Crear la ruta V3 en `api-recraft-worker-background.js`
- UI para subir imagen de referencia → `POST /v1/styles` → guardar `style_id` en `GlobalConfig`

**Prioridad**: baja — solo si el flujo Gemini multimodal no da resultados satisfactorios.

---

### 3. A/B: Haiku 3.5 vs Haiku 4.5 en fases 1–2

**Contexto**: fases 1 (COMPRENDER) y 2 (COMPONER) usan `claude-haiku-4-5-20251001`. Haiku 3.5 cuesta ~20–25% menos.

**Diferencias clave**:
- Haiku 4.5: mejor en tool use estructurado, multilingüe (~96.4% del inglés en español), más robusto en inputs no estándar (AAC telegráfico, errores ortográficos)
- Haiku 3.5: suficiente para NLU estructurado en español estándar; ahorra ~$1.20/1M tokens blended

**Estrategia sugerida**: mantener 4.5 como default; activar 3.5 como opción de bajo costo si se valida que las tareas NLU típicas del corpus AAC no degradan.

**Métricas a capturar en A/B**:
- Tasa de tool invocation exitosa (fase 1 y 2)
- Tasa de validación de esquema NLU (campos requeridos completos)
- Coherencia semántica de los `elements` generados (evaluación humana)

**Prioridad**: media — no urgente, pero relevante si el volumen de usuarios crece.

---

### 4. Prompt caching — monitoreo de ahorro real

**Estado**: implementado en v2.0.2 para fases 1 y 2 (`cache_control: ephemeral` en system block y último tool).

**Pendiente**: verificar en los logs de Anthropic que los campos `cache_read_input_tokens` / `cache_creation_input_tokens` aparecen en las respuestas. El mínimo cacheable para Haiku es ~2048 tokens — el system de fase 1 (con NSM primes) probablemente lo supera; el de fase 2 podría no alcanzarlo.

**Acción**: revisar en el dashboard de Anthropic o agregar logging de `response.usage.cache_read_input_tokens` en `api-claude.js`.

---

### 5. Parámetros Gemini aún no expuestos en GUI

Disponibles en la API pero no en la interfaz:

| Parámetro | Descripción | Prioridad |
|-----------|-------------|-----------|
| `imageConfig.aspectRatio` | Actualmente fijo en `1:1`. Opciones: `3:4`, `4:3`, `16:9`, `9:16` | media |
| `imageConfig.imageSize` | Actualmente `1K`. Opciones: `512`, `2K`, `4K` (preview) | baja |
| `generationConfig.temperature` | Diversidad/artefactos. Default `1.0`, rango `0.0–2.0` | baja |

Para AAC el `1:1` es generalmente correcto. Podría ser útil `3:4` para pictogramas verticales o `4:3` para escenas.

---

## Historial de versiones de Phase 3

| Versión | Fecha | Cambios |
|---------|-------|---------|
| v1.x | — | Solo Gemini Flash/Pro (sync, sin proxy) |
| v2.0.0 | 2026-06-05 | Recraft V4.1 vector como único modelo (siempre-proxy) |
| v2.0.1 | 2026-06-07 | Multi-modelo: Gemini + Recraft raster + modelo configurable |
| v2.0.2 | 2026-06-08 | IDs Gemini estables, imageConfig, prompt caching fases 1–2 |
