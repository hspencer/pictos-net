# Investigación

Evidencia de los estudios de PICTOS: protocolos, corridas de benchmark, diagnósticos y verificaciones de versión. La carpeta está versionada y el repositorio es público: no guardar aquí credenciales ni datos personales de participantes. Quedan fuera de Git las librerías importables (`*/librerias/`, de 14 a 48 MB cada una), el rescate del NLU (`2026-10-23_f5-rescate-nlu/`, 651 MB de copias de librerías) y `references/` (copias de documentación de terceros).

## Cómo ver los estudios

Las hojas de comparación son HTML estáticos: no hay nada que ejecutar. Desde la raíz del repositorio:

```sh
python3 -m http.server 8765 -d research
```

y abrir http://localhost:8765/, la portada con enlaces a todos los estudios (`index.html`). También sirve abrir un `index.html` directamente con `open research/<estudio>/index.html`; el servidor solo hace falta para navegar las carpetas que no tienen hoja.

## Cómo correr un estudio

Todos los benchmarks son pagados y llaman a los proveedores directamente con las claves de `.env` (sin Netlify ni cuota). `--max-calls` es obligatorio siempre, y en las fases de texto también `--budget-usd`. Escriben siempre en una carpeta nueva `research/AAAA-MM-DD_tema/`.

```sh
# COMPRENDER o COMPONER: un modelo por corrida (--phase 1 o 2)
node --env-file=.env scripts/benchmark-models.mjs --cases scripts/eval/cases/pipeline-es-419.json \
  --phase 1 --models claude-haiku-5-5 --repairs 2 --max-output-tokens 4096 \
  --max-calls 40 --budget-usd 5 --run --out research/AAAA-MM-DD_benchmark-modelos/p1-comprender/es/claude-haiku-5-5

# PRODUCIR con modelos del catálogo, sobre composiciones congeladas
node --env-file=.env scripts/eval/benchmark-images.mjs \
  --compositions research/2026-11-01_benchmark-modelos/corpus/compositions-8.json \
  --models gpt-image-2.5-flare,gemini-3.1-flash-lite-image --max-calls 20 --out research/AAAA-MM-DD_tema/p3-producir

# Resumen por modelo (validez, latencia p50 y p95, costo, caché)
node scripts/eval/summarize-benchmark.mjs research/AAAA-MM-DD_benchmark-modelos/p1-comprender/es/*
```

Sin `--run`, `benchmark-models.mjs` solo muestra el plan y el costo estimado. Las 8 composiciones de `2026-11-01_benchmark-modelos/corpus/compositions-8.json` son el corpus fijo de PRODUCIR: usarlas siempre permite comparar estudios entre sí.

Los modelos que aún no están en el catálogo se prueban con un script propio dentro de la carpeta del estudio, que reutiliza `netlify/functions/_shared/imagePrompts.js`. Ejemplo: `2026-11-10_quiver-arrow2/bench-quiver.mjs`, que se corre desde la raíz con las variantes como argumentos y retoma los casos ya hechos:

```sh
node research/2026-11-10_quiver-arrow2/bench-quiver.mjs research/2026-11-01_benchmark-modelos/corpus/compositions-8.json A B C
```

ESTRUCTURAR se corre en el navegador con `runEval` de `scripts/eval/vectorizarEstructurarEval.ts`, desde http://localhost:3000 con `npm run dev` en marcha.

Al terminar un estudio: una hoja `index.html` si hay imágenes que comparar, una fila en la tabla de abajo, un enlace en `index.html` de esta carpeta y, si cambia una decisión, la conclusión en `docs/BENCHMARK_MODELOS_2026-11.md`.

Las conclusiones que gobiernan el código viven en `docs/` (versionado). Esta carpeta guarda los datos crudos que las respaldan.

## Convención

Una carpeta por estudio: `AAAA-MM-DD_tema`, con la fecha de inicio del estudio. Dentro, una subcarpeta por fase o variante cuando hace falta (`p1-comprender/es/<modelo>`, `p3-producir/8`). Los scripts de benchmark escriben siempre dentro de `research/`.

## Estudios

| Carpeta | Pregunta | Resultado |
|---|---|---|
| `2026-08-27_plan-modelos-cuotas/` | Qué modelos, costos y cuotas comparar; protocolo de pipeline escalonado frente a prompt directo | Plan y casos sintéticos iniciales |
| `2026-08-28_release-2.6/` | Verificación de las versiones 2.6.0 a 2.6.2 y sus regresiones (autorización, trazas NLU, admisión de estructuración) | Registros de CI, despliegue y pruebas |
| `2026-08-28_vertex-cuotas/` | Auditoría de proyectos y cuotas de Vertex AI | `VERTEX_ACCOUNT_QUOTA_AUDIT_2026-08-28.md` y JSON de cuotas |
| `2026-10-22_diagnostico-generacion/` | Por qué fallaba la generación (modelos retirados, imágenes vacías, Recraft) | `docs/archivo/DIAGNOSTICO_GENERACION_2026-10-22.md` |
| `2026-10-22_f4-variantes-recraft/` | Comparación de variantes vectoriales de Recraft V4.1 (frente F4) | Vector se queda; Pro y Utility se retiran |
| `2026-10-23_f5-rescate-nlu/` | Rescate del NLU guardado al contrato vigente (frente F5) | `scripts/migrate-nlu.mjs` y equivalencias aprobadas |
| `2026-11-01_benchmark-modelos/` | Qué modelo por fase: COMPRENDER, COMPONER, PRODUCIR y ESTRUCTURAR | `docs/BENCHMARK_MODELOS_2026-11.md` |
| `2026-11-06_benchmark-producir/` | Candidatos nuevos para PRODUCIR (GPT Image 2.6 y SVG, Nano Banana, fal.ai) en cuatro estilos | Abrir `index.html`; librerías importables en `librerias/` |
| `2026-11-07_segmentacion-semantica/` | Quién reconoce las entidades del árbol en el bitmap: ruta actual (VTracer + Sonnet), SAM 3 (fal) o Gemini 3.8 Flash (Vertex) | Abrir `index.html`; Gemini con cajas 90 % en 3 s y US$0,002 por pictograma |
| `2026-11-10_quiver-arrow2/` | Quiver Arrow 2 (SVG nativo) en PRODUCIR: prompt actual, configuración según la documentación y referencias de estilo de la librería | Abrir `index.html`; con dos pictogramas de la librería como referencia adopta su estilo, US$0,08 y unos 30 s por pictograma |
| `references/` | Copias locales de fuentes oficiales, con manifiesto de procedencia y hashes | |

## Estructura del benchmark de noviembre

```
2026-11-01_benchmark-modelos/
  corpus/           composiciones congeladas y NLU de entrada
  logs/             salida de consola de cada corrida y run-phase.sh
  p1-comprender/    es/, es2/ (repetición), en/  → una carpeta por modelo
  p2-componer/      una carpeta por modelo
  p3-producir/      8/, 4pro/, all/, retry/
  p4-estructurar/   resultados del piloto ICAP por modelo
```
