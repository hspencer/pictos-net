# COMPRENDER y COMPONER: candidatos Gemini y valores predeterminados

Fecha: 12 de noviembre de 2026. Base: PictoNet 2.9.0 (`e2cfdb5`).

## Decisión

GPT-6 Luna pasa a ser el valor predeterminado de COMPRENDER y COMPONER. En las series completas terminó 48/48 intentos válidos por fase, con menor costo y menos reparaciones que Haiku 5.5. En COMPRENDER la mediana fue prácticamente igual; en COMPONER Haiku fue más rápido. Haiku sigue como alternativa de otro proveedor. PRODUCIR conserva GPT Image 2.5 Flare y ESTRUCTURAR conserva Sonnet 4.6.

Los candidatos Gemini no se ofrecen en estas dos fases: Flash-Lite 3.1 falló el contrato de COMPRENDER; Flash-Lite 3.5 volvió a truncar y falló contratos; Flash 3.8 cuesta más y tiene colas de latencia largas; Argon y Carbon no completaron sus pruebas iniciales. Flash 3.8 conserva su función de detección de entidades antes de ESTRUCTURAR. `benchmarkPhases` permite repetir los experimentos sin admitir candidatos en los endpoints de producción.

Los valores se resuelven desde `DEFAULT_MODELS`: las librerías nuevas y las que no fijan modelo siguen el cambio. Las elecciones explícitas de modelos admitidos se conservan. No se modifican pictogramas, sus atribuciones ni bibliotecas guardadas.

## Método

24 casos sintéticos es-419, dos repeticiones (48 intentos previstos por serie), mismos constructores y validación canónica de producción, hasta dos reparaciones y 4096 tokens máximos de salida. COMPONER recibe NLU congelado del corpus del benchmark. Los planes guardan los hashes de entradas, prompts y contratos, tarifas y límites. Las series completas tuvieron límite de 60 intentos y US$3 por serie.

Se comparan las series completas más recientes (`-r2` cuando existe). Las originales interrumpidas se conservan y se describen abajo: no se mezclan con las repeticiones ni se consideran completadas. Los costos son estimaciones con las tarifas guardadas en cada plan y la caché observada; no son cobros confirmados. La validez es estructural: esta ronda no evalúa calidad semántica ni eficacia comunicativa con personas.

## COMPRENDER

| Modelo | Intentos | Válidos | Primer intento | p50 | p95 | US$/intento | US$ conocido total |
|---|---:|---:|---:|---:|---:|---:|---:|
| gpt-6-luna | 48 | 48/48 | 92 % | 4.2 s | 8.5 s | 0.00025 | 0.012043 |
| claude-haiku-5-5 | 48 | 48/48 | 79 % | 4.2 s | 9.2 s | 0.00059 | 0.028312 |
| gemini-3.1-flash-lite | 48 | 46/48 | 54 % | 3.4 s | 8.8 s | 0.00191 | 0.091713 |
| gemini-3.5-flash-lite (parcial) | 6 | 4/6 | 17 % | 7.3 s | 18.6 s | 0.00354 | 0.017690 |
| gemini-3.8-flash | 48 | 48/48 | 100 % | 6.4 s | 27.6 s | 0.00321 | 0.154000 |

## COMPONER

| Modelo | Intentos | Válidos | Primer intento | p50 | p95 | US$/intento | US$ conocido total |
|---|---:|---:|---:|---:|---:|---:|---:|
| gpt-6-luna | 48 | 48/48 | 100 % | 3.3 s | 5.4 s | 0.00016 | 0.007790 |
| claude-haiku-5-5 | 48 | 48/48 | 90 % | 2.2 s | 4.8 s | 0.00035 | 0.016747 |
| gemini-3.1-flash-lite | 48 | 48/48 | 88 % | 2.2 s | 4.5 s | 0.00080 | 0.038368 |
| gemini-3.5-flash-lite | 48 | 47/48 | 92 % | 1.6 s | 3.8 s | 0.00070 | 0.033516 |
| gemini-3.8-flash | 48 | 48/48 | 100 % | 4.2 s | 41.7 s | 0.00157 | 0.075420 |

En la serie parcial de Flash-Lite 3.5 hay un intento sin uso conocido: su costo no entra en la media ni en la suma. La reserva pendiente se conserva en `estimatedExposureUsd` del resultado.

## Interrupciones y repeticiones

- GPT-6 Luna P1: la original se detuvo tras un `fetch failed` (0/1 válido); `-r2` completó 48/48. La falla original sigue siendo evidencia operacional y no demuestra por sí sola un defecto persistente del modelo.
- Haiku P2: la original se detuvo por `Request timed out.` (0/1 válido); `-r2` completó 48/48.
- Gemini 3.8 P1: la original se detuvo por `Provider request deadline exceeded` (17/18 válidos); `-r2` completó 48/48, pero con p95 de 27,6 s. P2 tuvo p95 de 41,7 s.
- Gemini 3.5 Flash-Lite P1: ambas corridas se interrumpieron tras seis intentos por `MAX_TOKENS`, con uso incierto; 3/6 y 4/6 válidos. P2 terminó con 47/48: un prompt refería un elemento desconocido.
- Gemini 3.1 Flash-Lite P1: 46/48; dos errores de `/lang` para `saludo`.
- Gemini 4 Argon y Carbon: la prueba P1 del benchmark (carpeta `smoke/`) agotó el plazo de producción de 75 s en ambos. Una sonda aparte, con el mismo pedido de COMPRENDER y 180 s de plazo (`g4-probe.mjs`), muestra que sí responden con la herramienta y un NLU, pero lentos: Carbon 69,8 s con razonamiento LOW y 86,7 s sin configurarlo; Argon 96,6 s con LOW y más de 180 s sin configurarlo. Ninguno acepta MINIMAL (400). Con unos 500 tokens de salida, eso es del orden de 5 a 7 tokens por segundo: quedan fuera por latencia, no por calidad, que no se midió. Conviene repetir la sonda cuando Google publique cambios de rendimiento.

No se atribuyen las interrupciones de red a un proveedor con certeza, ni se presenta ninguna corrida repetida como garantía de ausencia de fallas futuras.

## Evidencia y reproducción

Cada carpeta de modelo contiene `plan.json`, `attempts.jsonl` (reservas y resultados individuales) y `results.json`. Las carpetas `-r2` son ejecuciones nuevas, con el mismo plan, conservando las anteriores.

```sh
node scripts/eval/summarize-benchmark.mjs research/2026-11-12_benchmark-texto/p1-comprender/gpt-6-luna-r2 research/2026-11-12_benchmark-texto/p1-comprender/claude-haiku-5-5
node scripts/eval/summarize-benchmark.mjs research/2026-11-12_benchmark-texto/p2-componer/gpt-6-luna research/2026-11-12_benchmark-texto/p2-componer/claude-haiku-5-5-r2
```

Para repetir una serie pagada, seguir las instrucciones de [investigación](../README.md), con el corpus `scripts/eval/cases/pipeline-es-419.json` para P1 y `research/2026-11-01_benchmark-modelos/corpus/phase2-es-419.json` para P2; usar una carpeta nueva. Los nombres exactos de los corpus utilizados se verifican con sus hashes en los planes.

## Disponibilidad en Vertex

`vertex-models.mjs` lista los modelos de Google publicados en Vertex (34 el 12-11-2026). La lista no prueba que un modelo responda: incluye modelos 2.5 que Google anunció como retirados. Una llamada mínima a cada candidato de texto respondió 200 en `gemini-4-argon`, `gemini-4-carbon`, `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` y también `gemini-2.5-flash`, que el catálogo mantiene retirado. `gemini-3.5-flash` y `gemini-3.7-flash` no se midieron: los reemplaza 3.8 Flash y no tienen precio publicado en la página de la API de Gemini.

Los precios de los candidatos salen de la página de la API de Gemini (`aistudio.google.com/docs/pricing`); la de Vertex se carga con JavaScript y no pudo leerse. Gemini 4 duplica su precio desde el 1 de diciembre de 2026.

```sh
node --env-file=.env research/2026-11-12_benchmark-texto/vertex-models.mjs
node --env-file=.env research/2026-11-12_benchmark-texto/g4-probe.mjs gemini-4-argon none LOW
```

## Verificación del cambio

- `npm test`: 290 pruebas aprobadas, 5 omitidas, 0 fallidas.
- `node --test scripts/benchmark-models.test.mjs`: 9 aprobadas.
- `npm run build`: compilación completada.
- `npm run typecheck`: siguen dos errores en `services/rowSerialization.test.ts:104-105` (acceso a propiedades sobre `string | NLUData`), archivo sin cambios respecto de la base.
- Hashes de ambos corpus comprobados contra todos los planes de su fase.
- No se realizaron nuevas llamadas pagadas ni verificación en navegador en esta continuación.
