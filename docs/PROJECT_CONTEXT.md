# PICTOS.NET — Contexto operativo del proyecto

Actualizado: 2026-08-13. Este documento resume el estado observado del repositorio y sirve como punto de entrada para futuras sesiones de trabajo. La implementación vigente y las especificaciones Allium prevalecen cuando la documentación histórica discrepa.

## Propósito

PICTOS.NET es un prototipo de investigación para Comunicación Aumentativa y Alternativa (CAA). Convierte una intención comunicativa en un pictograma explicable, editable y portable. La tesis de diseño es que la representación visual debe partir de una comprensión lingüística y contextual explícita, no solo de un prompt de imagen.

La aplicación es local-first: librerías, pictogramas y estado de trabajo viven en el navegador. Los servicios remotos intervienen al generar o estructurar artefactos, pero no existe una base de datos central con el contenido privado del usuario.

## Stack y ejecución

- React 19.2, TypeScript 5.8, Vite 6 y Tailwind CSS 3.4.
- Zustand gestiona el editor SVG; el resto del estado principal se orquesta en `App.tsx`.
- Netlify Functions es la frontera autenticada hacia Anthropic, Vertex AI/Gemini y Recraft.
- `npm run dev` ejecuta tareas previas y luego `netlify dev`: la aplicación se abre en `http://localhost:9001` y Vite escucha internamente en el puerto 3000.
- `npm test` ejecuta pruebas Node de funciones y servicios; `npm run validate-i18n` comprueba paridad y uso de catálogos.
- Ramas de despliegue: `dev` publica en `next.pictos.net`; `main` publica en `pictos.net`.

## Modelo mental del producto

Una `Library` es el espacio de trabajo aislado. Contiene tres tipos de contenido:

1. `RowData`: un pictograma y todos los artefactos acumulados de su pipeline.
2. `Sequence`: una lista ordenada de pasos que referencia filas existentes o dispara la creación de nuevas filas.
3. `Board`: una cuadrícula fija de celdas que referencia filas, aplica colores Fitzgerald y reutiliza el audio almacenado en cada fila.

Las secuencias y tableros referencian filas; no son propietarios de los pictogramas. El audio es propiedad de `RowData`, por lo que se comparte entre todas las celdas que apuntan a la misma fila.

## Pipeline de generación

El flujo automático tiene tres fases y una cuarta fase opcional iniciada por el usuario:

1. **COMPRENDER**: `claudeService.generateNLU()` analiza el enunciado y produce `NLUData`. El modelo es configurable por fase; Claude usa tool use forzado y Gemini se enruta por su función específica.
2. **COMPONER**: `claudeService.generateVisualBlueprint()` convierte el análisis en un árbol de `VisualElement` y un prompt espacial. Cada elemento conserva un `concept` semántico (`Root`, `Agent`, `Action`, `Object`, `Context`, `Element`).
3. **PRODUCIR**: `App.processStep()` y `App.processCascade()` despachan según `generationModel`. Los modelos Recraft pasan por `recraftService`; los demás modelos de imagen vigentes pasan por `geminiService`. El resultado puede ser `rawSvg` vectorial o `bitmap` raster.
4. **ESTRUCTURAR**: `svgStructureService.structureSVG()` transforma un `rawSvg` en un SVG semántico compatible con mf-svg-schema. El modelo de visión asigna paths a grupos; la geometría, fusiones, rescates y pulido se calculan localmente.

La edición invalida artefactos posteriores: enunciado → NLU → elementos/prompt → imagen/SVG → SVG estructurado. La cascada automática no incluye ESTRUCTURAR.

## Estructuración SVG

Los principios que no deben romperse son:

- El modelo no escribe geometría SVG.
- El árbol final debe ser congruente con COMPRENDER y COMPONER.
- Preservar contenido visible tiene prioridad sobre descartar ruido dudoso.
- Las anclas se miden en DOM con `getBBox` y CTM; el modelo recibe un set-of-marks rasterizado.
- Las fusiones candidatas se detectan localmente y solo se ejecutan tras confirmación del modelo.
- El ensamblado rescata huérfanos, revierte descartes sospechosos y evita resultados vacíos.
- El pulido solo simplifica trazados con firma de polilínea ruidosa y redondea coordenadas de forma determinista.

El estado y los pasos pendientes están en `docs/ESTRUCTURAR.md` y `specs/svg-structuring.allium`.

## Persistencia y soberanía de datos

La arquitectura actual mezcla dos capas:

- `libraryService.ts` usa `localStorage` con claves por librería para índice, configuración, filas serializadas, secuencias, tableros y previews.
- `indexedDBService.ts` conserva el almacenamiento histórico/operativo de filas y artefactos pesados en stores separados (`rows`, `bitmaps`, `svgs`).

Las exportaciones JSON son el mecanismo de respaldo portable; también existen ZIP/PDF para distintos contenidos. Antes de cambiar persistencia hay que revisar migración de librería única, importación/exportación y aislamiento entre librerías.

## Backend, autenticación y cuota

- Ninguna API key debe llegar al bundle del navegador.
- Las llamadas de IA atraviesan Netlify Functions y, fuera de desarrollo local, validan JWT de Netlify Identity.
- El login es lazy: explorar y editar contenido local no lo requiere; generar sí.
- Vertex AI usa OAuth de cuenta de servicio, no una clave estática.
- Existen trabajadores background, polling y Netlify Blobs para operaciones largas y lotes.
- Los roles relevantes se consultan en vivo en GoTrue para decisiones de cuota.
- La documentación de cuota tiene divergencias históricas; verificar `_shared/usage.js`, los handlers vigentes y las variables desplegadas antes de afirmar qué modelos cobran unidades.

## Interfaz y accesibilidad

- La UI es bilingüe `es-419` / `en-GB`; todo texto nuevo debe agregarse a ambos catálogos y validarse.
- Las convenciones de IDs, tokens, modales, tipografía y controles están en `docs/UI_CONVENTIONS.md` y `docs/UI_MAP.md`.
- Los z-index provienen de `styles/variables.css`; no deben inventarse capas mágicas.
- El estado WCAG 2.1 AA está documentado en `docs/WCAG_ROADMAP.md`; foco, teclado, reduced motion y nombres accesibles son requisitos transversales.

## Tableros de comunicación — trabajo local en curso

El árbol de trabajo del 2026-08-13 contiene una implementación todavía no committeada de tableros:

- `BoardList`: catálogo, creación, configuración, duplicación y exportación PDF Carta/Tabloide.
- `BoardEditor`: cuadrícula en modos editar y usar.
- `CellEditor`: color Fitzgerald, vínculo a pictograma y grabación/reproducción de audio.
- `boardPdfService`: PDF horizontal con cuadrícula coloreada, pictogramas y rótulos.
- Persistencia e importación/exportación de `Board[]` por librería en `libraryService`.

El formato portable `pictonet_graph_dump` usa `schemaVersion: 3`: conserva conjuntamente filas —incluido su audio—, secuencias y tableros. Tanto la importación normal como la carga de una biblioteca de ejemplo restauran los tableros y reasignan su `libraryId` a la biblioteca de destino. El ejemplo público `Tablero` contiene el tablero de vocabulario central 6×6 reconstruido, con 36 celdas enlazadas a sus 36 filas con audio.

El ejemplo canónico `public/libraries/tablero_graph_2026-08-13.json` fue consolidado desde la versión mejorada del 2026-08-13: conserva los pictogramas revisados de **No, Ir, Más, Ayuda, Bueno, Arriba y Pequeño**, y recupera los 36 audios desde la exportación anterior. `scripts/consolidate-tablero-example.mjs` permite repetir esta fusión de forma segura, validando IDs, palabras, vínculos y cantidad de celdas antes de reemplazar el canónico.

El modo **usar** es una superficie de pantalla completa. La cuadrícula ocupa el viewport, el encabezado/editor desaparece y un botón pequeño arriba a la izquierda —además de Escape— devuelve al modo **editar**.

La especificación fuente es `specs/boards.allium`. Algunas notas históricas dentro de esa especificación (por ejemplo, exportación inicialmente diferida o modo inicial) pueden requerir consolidación adicional contra el comportamiento ya implementado.

## Fuentes de verdad y documentación con deriva

Orden práctico para resolver contradicciones:

1. Código y pruebas actuales.
2. Especificaciones `specs/*.allium` vigentes.
3. `CLAUDE.md` para referencia operativa reciente.
4. Documentos especializados (`ESTRUCTURAR`, CSS, UI, seguridad, privacidad).
5. `docs/ARCHITECTURE.md`, README y roadmaps históricos.
6. `project-context.json`, que describe una versión antigua del stack y no debe usarse como fuente vigente.

Divergencias conocidas al 2026-08-13:

- Algunos documentos llaman ESTRUCTURAR fase 4 y otros fase 5 por la antigua presencia de VECTORIZAR.
- `docs/ARCHITECTURE.md` todavía presenta Recraft vectorial como camino principal en secciones donde el código y `CLAUDE.md` usan Gemini Image como default.
- `docs/SECURITY.md`, `.env.example` y comentarios de cuota no coinciden completamente sobre qué llamadas consumen unidades.
- La privacidad menciona principalmente Anthropic/Recraft, pero el pipeline vigente también usa Vertex AI/Gemini.
- `project-context.json` conserva versiones React/Vite y una arquitectura anteriores.

## Estado de verificación observado

En la revisión del 2026-08-13:

- `npm test`: 92 pruebas pasan; 5 integraciones se omiten cuando Netlify Dev no está corriendo.
- `npm run validate-i18n`: correcto después de incorporar el modo de pantalla completa (692 claves; 474 referenciadas por código).
- `npx tsc --noEmit`: falla por errores preexistentes y deuda actual, incluidos props `key`, `TFunc`, tipos React del hook de diálogo, `ImportMeta.env`, style-editor y `styleUtils`. El componente nuevo `BoardList` también aporta un error `key` de la misma familia.

## Convenciones de trabajo

- Código y commits en inglés; interfaz en español latinoamericano con traducción inglesa equivalente.
- Conventional Commits.
- No exponer secretos ni llamar proveedores directamente desde el cliente.
- Mantener Node 18 en scripts usados por Netlify.
- Preservar cambios locales: el árbol puede estar sucio y contiene trabajo del usuario.
- Para descubrir código, usar primero el grafo de conocimiento indicado en `AGENTS.md`; usar búsqueda textual para literales, configuración y documentación.
- Antes de cerrar una modificación: ejecutar pruebas proporcionales, `npm run validate-i18n` y revisar el diff exacto de los archivos tocados.
