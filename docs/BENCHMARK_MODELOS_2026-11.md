# Benchmark de modelos por fase y optimización del pipeline

Fecha: 1 de noviembre de 2026. Rama: `feat/vectorizar-estructurar`. Base: `8486bdf` (2.7.2).

Objetivo: reducir errores, latencia y costo del pipeline generativo comparando los modelos disponibles en cada fase con casos sintéticos, y dejar en el catálogo solo los que se justifican. Las personas usuarias no tienen cómo elegir entre modelos, así que el criterio fue ofrecer el menor número de opciones posible: una por defecto y, como mucho, una alternativa con razón de ser.

## Resumen

| Fase | Antes (por defecto) | Ahora (por defecto) | Alternativas que quedan |
|---|---|---|---|
| 1 COMPRENDER | Claude Haiku 4.5 | **Claude Haiku 5.5** | GPT-6 Luna (otro proveedor) |
| 2 COMPONER | Claude Haiku 4.5 | **Claude Haiku 5.5** | GPT-6 Luna |
| 3 PRODUCIR | Gemini 2.5 Flash Image | **GPT Image 2.5 Flare** | Gemini 2.5 Flash Image (lote Vertex), Recraft V4.1 Vector (SVG nativo) |
| 4 ESTRUCTURAR | Claude Sonnet 4.6 | **Claude Sonnet 4.6** | ninguna |

Los selectores pasan de 8, 18 y 6 opciones a 2, 3 y 1.

Costo y latencia por pictograma (medianas medidas, fases 1 a 3):

| Perfil | US$ por pictograma | US$ por 1000 | Latencia sumada (p50) |
|---|---|---|---|
| Anterior (Haiku 4.5, Haiku 4.5, Gemini 2.5 Flash Image) | 0,052 | 51,94 | 20,2 s |
| Nuevo (Haiku 5.5, Haiku 5.5, GPT Image 2.5 Flare) | 0,0069 | 6,87 | 15,6 s |

Es 7,5 veces más barato y unos 4,6 s más rápido, con igual o mejor validez. El recorrido completo por las rutas reales de la aplicación (proxy, worker y sondeo incluidos) tardó 19,1 s con el perfil nuevo.

## Método

- **Corpus sintético** (`scripts/eval/cases/`): 24 frases en es-419 y 4 en en-GB, escritas para cubrir los rasgos que más fallan en CAA: peticiones, cuerpo y dolor, emociones con causa, preguntas de lugar y tiempo, negación, pasado y futuro, tres actores con dativo, abstracción ("Es mi turno"), regionalismos chilenos ("tomar once", "la micro"), dominios (hospital, cocina, colegio), advertencias ("¡Para! Viene un auto"), condición y permiso, frases de una palabra ("Agua", "Ayuda") y discapacidad con instrumento ("silla de ruedas"). No es un patrón oro revisado por personas.
- **Fases 1 y 2**: `scripts/benchmark-models.mjs`, con las mismas peticiones y la misma validación canónica que producción y el bucle de reparación de contrato (`--repairs 2`). COMPONER recibe para todos los modelos el mismo NLU congelado, salido de la corrida de GPT-5.6 Sol, el único válido al primer intento en los 24 casos. Se registra la validez final, la validez al primer intento, las llamadas por caso, la latencia, los tokens, la caché y el costo.
- **Fase 3**: `scripts/eval/benchmark-images.mjs`, con los mismos constructores de prompt y adaptadores de proveedor que producción, sobre 8 composiciones de Haiku 5.5 y el estilo por defecto de las bibliotecas es-419. Revisión visual de cada imagen en hojas de contacto.
- **Fase 4**: harness del navegador `scripts/eval/vectorizarEstructurarEval.ts`, variante D (Estructurar desde el bitmap), sobre el piloto ICAP de 10 casos (`docs/eval/icap-pilot-10.json`), cambiando solo el modelo.
- **Ruta real**: una frase nueva ("¿Puedo ir al patio a jugar?") recorrió COMPRENDER, COMPONER y PRODUCIR por los servicios del cliente y las funciones de Netlify, sin modelos fijados en la configuración.

Gasto total del ensayo: unos US$10 (US$2,56 en 537 llamadas de texto, US$6,10 en 69 imágenes y cerca de US$1 en Estructurar). Los datos crudos están en `research/2026-11-01_benchmark-modelos/` (una subcarpeta por fase y modelo). Portada de todos los estudios y cómo verlos y repetirlos: [research/README.md](../research/README.md). La ronda del 06-11-2026 sobre PRODUCIR está en `research/2026-11-06_benchmark-producir/`.

## Resultados

### Fase 1: COMPRENDER (24 frases es-419)

Primera corrida, con el prompt anterior:

| Modelo | Válido | 1.er intento | Llamadas/caso | p50 | p95 | US$/caso | Caché leída |
|---|---|---|---|---|---|---|---|
| GPT-6 Luna | 100 % | 92 % | 1,08 | 3,6 s | 6,0 s | 0,00024 | 91 % |
| GPT-5.6 Luna | 100 % | 92 % | 1,08 | 5,8 s | 9,4 s | 0,00070 | 88 % |
| Gemini 3.8 Flash | 100 % | 100 % | 1,00 | 5,6 s | 10,8 s | 0,00316 | 0 % |
| GPT-5.6 Terra | 100 % | 92 % | 1,08 | 5,6 s | 9,5 s | 0,00772 | 88 % |
| GPT-5.6 Sol | 100 % | 100 % | 1,00 | 5,0 s | 8,7 s | 0,01158 | 88 % |
| Claude Sonnet 4.6 | 100 % | 96 % | 1,04 | 16,0 s | 22,5 s | 0,01868 | 82 % |
| Claude Haiku 5.5 | 96 % | 75 % | 1,33 | 4,0 s | 8,6 s | 0,00064 | 90 % |
| Claude Haiku 4.5 (anterior) | 88 % | 79 % | 1,33 | 7,5 s | 18,8 s | 0,00917 | 0 % |

Con el prompt corregido (ver "temporal" más abajo) y 2 repeticiones, 48 intentos por modelo:

| Modelo | Válido | 1.er intento | p50 | p95 | US$/caso |
|---|---|---|---|---|---|
| GPT-6 Luna | 100 % | 96 % | 4,1 s | 6,2 s | 0,00025 |
| Claude Haiku 5.5 | 100 % | 79 % | 3,7 s | 6,8 s | 0,00056 |
| Claude Haiku 4.5 | 100 % | 77 % | 7,7 s | 21,5 s | 0,00916 |

En en-GB (4 frases × 2), Haiku 5.5 dio 100 % válido y 100 % al primer intento, con p50 de 3,3 s.

En calidad semántica no apareció ninguna diferencia que justifique pagar más. Todos leen "once" como merienda y "micro" como bus, y marcan "¡Para! Viene un auto" como `directive/warning`. Haiku 5.5 da salidas breves y correctas. Gemini 3.8 Flash es el más visual pero verboso. GPT-5.6 Sol puso un primo NSM (`TÚ~USTED`) como actor de "Ayuda".

### Fase 2: COMPONER (24 NLU congelados)

| Modelo | Válido | 1.er intento | p50 | p95 | US$/caso |
|---|---|---|---|---|---|
| Claude Haiku 5.5 | 100 % | 100 % | 2,1 s | 2,7 s | 0,00031 |
| GPT-6 Luna | 100 % | 92 % | 2,4 s | 5,2 s | 0,00024 |
| GPT-5.6 Luna | 100 % | 100 % | 2,7 s | 3,1 s | 0,00048 |
| Claude Haiku 4.5 | 100 % | 100 % | 3,1 s | 3,6 s | 0,00378 |
| GPT-5.6 Terra | 100 % | 96 % | 3,6 s | 5,3 s | 0,00610 |
| GPT-5.6 Sol | 100 % | 96 % | 2,6 s | 3,8 s | 0,00957 |
| Claude Sonnet 4.6 | 100 % | 96 % | 7,4 s | 10,3 s | 0,01129 |
| Gemini 3.8 Flash | 89 % | 89 % | 3,6 s | 75,0 s | 0,00153 |

COMPONER es fácil para todos; la diferencia está en costo y latencia. Gemini 3.8 Flash se colgó 75 s en una llamada, hasta agotar el plazo: 1 cuelgue en 33 llamadas.

### Fase 3: PRODUCIR (8 composiciones)

| Modelo | Entregadas | p50 | US$/imagen | Observación visual |
|---|---|---|---|---|
| GPT Image 2.5 Flare | 8/8 | 9,8 s | 0,006 | Claro y coherente en los 8; el mejor equilibrio |
| GPT Image 2 | 8/8 | 11,5 s | 0,006 | Muy bueno, trazo lineal; Flare lo supera al mismo precio |
| Recraft V4.1 Vector | 8/8 | 10,3 s | 0,08 | Siluetas AIGA sólidas; ambiguo en "no verduras" y "once"; único SVG nativo |
| Recraft V4.1 Utility Vector | 8/8 | 13,4 s | 0,08 | Parecido a Vector, más lento |
| Recraft V4.1 Pro / Utility Pro Vector | 4/4 cada uno | 10,7 / 19,0 s | 0,30 | No mejor que Vector a 3,75 veces el precio |
| Gemini 2.5 Flash Image | 8/8 * | 9,4 s | 0,039 | Bueno; rotuló "¿Dónde está mamá?" con los IDs de los elementos |
| Gemini 3.1 Flash Image | 8/8 * | 12,1 s | 0,067 | Irregular ("dolor de cabeza" débil), marcos de fondo |
| Gemini 3 Pro Image | 8/8 * | 21,6 s | 0,134 | Buena calidad; escribió "deseo" en la imagen; lento y con poca cuota |
| Gemini Nano Banana 2.1 | 8/8 * | 28,4 s | 0,034 | El más expresivo de Google, pero el más lento |

\* Seis llamadas a Gemini devolvieron 429 `RESOURCE_EXHAUSTED` con cuatro modelos Gemini en paralelo sobre el mismo proyecto de Vertex. Se repitieron en serie y todas entregaron. Esto pesa para los talleres: con varios equipos a la vez, el cuello de botella es la cuota de imagen de Vertex (2 peticiones por minuto por modelo base según `CLAUDE.md`), no el modelo. OpenAI no comparte esa cuota.

### Fase 4: ESTRUCTURAR (piloto ICAP, 10 casos)

| Modelo | Completados | Nodos cubiertos | Regiones sin resolver/caso | p50 | US$/caso (sin caché) |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 9/10 † | 98,0 % | 0,2 | 10,2 s | 0,028 |
| Claude Opus 4.6 | 10/10 | 98,2 % | 9,5 | 13,7 s | 0,053 |
| GPT-5.6 Luna | 10/10 | 75,4 % | 6,2 | 9,0 s | 0,002 |
| GPT-5.6 Terra | 8/10 (2 mapeos inválidos) | 75,0 % | 0,4 | 12,4 s | 0,020 |
| Claude Haiku 5.5 | 10/10 | 59,6 % | 1,3 | 3,6 s | 0,001 |

La fidelidad geométrica es la misma para todos (0,69 a 0,75 % de píxeles erróneos a 512 px) porque la geometría se calcula localmente y ningún modelo la escribe. Lo que cambia es la asignación semántica. Haiku 5.5 pierde nodos con contenido ("persona", "barriga", "sensación de dolor") y deja hasta un 33 % de trazados sin asignar. Opus 4.6 cubre lo mismo que Sonnet, pero deja muchas más regiones sin resolver, es decir, más trabajo manual, y cuesta el doble.

† El caso fallido fue un corte del entorno local, no del modelo: `api-claude` corta a los 30 s en Netlify Dev, y el pictograma más grande ("Hoy me siento sobrecargado"), con cinco corridas en paralelo, superó ese límite.

## Cambios de software

### Costo y errores

1. **Modelo por defecto en una sola línea.** `DEFAULT_MODELS` y `configuredModelId` en `netlify/functions/_shared/modelCatalog.js` reemplazan el modelo de texto escrito a mano en siete sitios (`types.ts`, tres constructores de petición, dos funciones de lote) y el de imagen en otros tres.
2. **Regla de `temporal` en COMPRENDER.** Haiku 4.5 y 5.5 devolvían `"present"` para estados actuales ("Tengo miedo", "Me siento orgulloso"), y el enum congelado de NLU 1.1.0 no tiene ese valor. Cada caso costaba una reparación, es decir, otra llamada completa. El prompt ahora dice que un estado presente es `immediate`. No se tocó el schema publicado.
3. **Caché efectiva.** El prefijo cacheable de COMPRENDER ronda los 2.900 tokens, por debajo del mínimo de 4.096 de Haiku 4.5, así que su `cache_control` no hacía nada (0 % de lectura). Haiku 5.5 cachea desde 512 tokens: 90 a 93 % de los tokens de entrada se leen de caché a 0,1 veces el precio.
4. **Imágenes sin texto filtrado.** Los IDs de elementos son snake_case y la composición los cita entre comillas (`'persona_que_pregunta'`). Gemini los dibujaba como rótulos. El prompt de imagen ahora los recibe como palabras (`persona que pregunta`). En los dos casos que fallaban, la fuga desapareció. La composición guardada en la fila no cambia.
5. **Un solo constructor de prompts de imagen.** `netlify/functions/_shared/imagePrompts.js` reemplaza dos pares de funciones duplicadas, en el cliente (`geminiService`, `recraftService`) y en el servidor (`pipelineRunner`). Ya habían divergido: en el servidor, el prompt de Recraft salía siempre en español.

### Bugs encontrados al medir

1. **Cuota cobrada a modelos Claude nuevos.** `api-claude.js` cobraba `UNITS_BY_MODEL[model] ?? 1`. Cualquier modelo Claude fuera del mapa (Haiku 5.5, por ejemplo) habría consumido 1 unidad por llamada de texto, contra la regla de que Claude cuesta 0 unidades. Ahora es 0 sin tabla por modelo.
2. **Lote completo con otro modelo por defecto.** `api-pipeline-batch-background.js` usaba Recraft Vector cuando la configuración no fijaba modelo, mientras que `api-pipeline-batch-create.js` validaba contra Gemini y la aplicación usaba Gemini. Además despachaba OpenAI comparando con el id fijo `gpt-image-2`, así que GPT Image 2.5 Flare habría ido a Gemini. Ahora ambos resuelven con el catálogo y despachan por proveedor.
3. **PRODUCIR sin modelo explícito hacia OpenAI.** `imageGenerationService.ts` resolvía el modelo, pero enviaba `config.generationModel` (vacío en bibliotecas sin modelo fijado). No se notaba porque la rama de Gemini volvía a resolverlo. Se detectó al hacer el recorrido real con Flare por defecto.
4. **`temperature` y Haiku 5.5.** Estructurar envía `temperature: 0`, que Haiku 5.5 rechaza con 400. El catálogo declara `fixedSampling` y el proxy solo reenvía `temperature` a los modelos que lo aceptan.
5. **API v1 y modelos retirados.** El enum congelado de la API 1.0.0 lista modelos hoy retirados. Pedirlos lanzaba un error genérico en `runPhase1`. Ahora la respuesta es un 400 `invalid_request` que pide omitir `model` para usar el modelo por defecto.

### Herramientas

- `scripts/benchmark-models.mjs`: tarifa la caché de Claude (antes se detenía en la primera llamada con caché, o sea, en todas las de Claude) y reproduce el bucle de reparación de producción con `--repairs`, separando la validez al primer intento de la validez final.
- `scripts/eval/benchmark-images.mjs`: benchmark de PRODUCIR con los adaptadores de producción.
- `scripts/eval/summarize-benchmark.mjs`: una fila por modelo con validez, latencia p50 y p95, costo y caché.
- `scripts/eval/cases/`: corpus sintético versionado.

## Listado de modelos

Estado en `MODEL_CATALOG` desde esta fecha. Los retirados no se ofrecen ni se admiten; siguen en el catálogo para que las configuraciones guardadas y las filas generadas conserven su etiqueta. La migración de configuración elimina el modelo retirado y la fase pasa al modelo por defecto.

| Modelo | Fases | Estado | Motivo |
|---|---|---|---|
| `claude-haiku-5-5` | 1, 2 | workshop (por defecto) | 100 % válido, el más rápido y 15 veces más barato que Haiku 4.5 |
| `gpt-6-luna` | 1, 2 | active | Alternativa de otro proveedor si Anthropic falla; 100 % válido, el más barato |
| `claude-sonnet-4-6` | 4 | workshop (por defecto) | El único con 98 % de nodos y casi ninguna región sin resolver |
| `gpt-image-2.5-flare` | 3 | workshop (por defecto) | 8/8 claras, 9,8 s, US$0,006, fuera de la cuota de Vertex |
| `gemini-2.5-flash-image` | 3 | retired (05-11-2026) | 429 `RESOURCE_EXHAUSTED` con peticiones en paralelo (cuota de imagen de Vertex), 6,5 veces el precio de Flare y Google lo retira el 15-03-2027. El lote Vertex queda sin modelo |
| `recraftv4_1_vector` | 3 | active | Única ruta de SVG nativo |
| `gemini-3.1-flash-lite-image` | 3 | active (06-11-2026) | Nano Banana 2 Lite: alternativa de Google, 32/32 en cuatro estilos, p50 3,4 s, sin tokens de razonamiento, ~US$0,034 |
| `claude-haiku-4-5-20251001` | 1, 2 | retired | Más caro, más lento, menos válido y sin caché efectiva |
| `claude-sonnet-4-6` en fases 1 y 2 | 1, 2 | retirado de esas fases | 30 veces el costo de Haiku 5.5 y 4 veces más lento, sin mejora visible |
| `claude-opus-4-6` | 4 | retired | Igual cobertura que Sonnet, más regiones sin resolver, doble costo |
| `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol` | 1, 2, 4 | retired | Superados por GPT-6 Luna en texto; 75 % de nodos en Estructurar |
| `gemini-3.8-flash` | 1, 2 | retired | 5 veces el costo de Haiku 5.5, verboso, un cuelgue de 75 s |
| `gpt-image-2` | 3 | retired | Flare es igual o mejor al mismo precio |
| `gemini-3.1-flash-image` | 3 | retired | Historial de respuestas sin imagen, más caro, irregular |
| `gemini-3-pro-image` | 3 | retired | 22 veces el precio de Flare, lento, cuota baja, filtra texto |
| `gemini-nano-banana-2.1` | 3 | retired | Buena calidad, pero 3 veces más lento que Flare y sujeto a la cuota de Vertex |
| Otras 11 variantes Recraft (raster, Utility, Pro, V4 Styles) | 3 | retired | Las raster no aportan sobre Flare; las Pro no superan a Vector; Styles exige un `style_id` previo que nadie tiene. **07-11-2026:** las 7 variantes V4.1 vuelven a `active` a pedido del usuario; V4 Styles sigue retirado |
| `gemini-2.5-flash`, `gemini-2.5-pro` | 1, 2, 4 | retired | Retirados por Google (sin cambios) |

Modelos actuales que no entran:

- **Claude Sonnet 5.5, Opus 5.5 y Fable 5.1** rechazan el `tool_choice` forzado del que dependen las cuatro fases (400). Requerirían otra estrategia de cliente (`auto` con `strict: true` o salidas estructuradas). Ningún resultado sugiere que haga falta en las fases 1 y 2. En la fase 4 podría compensar más adelante, como experimento aparte.
- **Haiku 5.5 en Estructurar**: medido y descartado (59,6 % de nodos).

## Riesgos y pendientes

- **Privacidad.** Con PRODUCIR en OpenAI por defecto, el texto de la frase y la composición van a OpenAI en lugar de Google. `docs/PRIVACY.md` ya nombra a OpenAI para imágenes; se ajustó para decir que el análisis lingüístico también puede ir a OpenAI si se elige GPT-6 Luna.
- **Clientes de la API v1** que envían `model` explícito: todos los valores del enum 1.0.0 están retirados, así que deben omitir `model`. Ofrecer Haiku 5.5 o GPT-6 Luna por nombre requiere la versión 1.1.0 de la API.
- **Plazo de las funciones.** `api-claude` usa un presupuesto de 50 s en Estructurar (`maxTotalMs`), pero `netlify.toml` no le declara `timeout`, y en local corta a los 30 s. Conviene fijar el plazo explícitamente y alinearlo.
- **Lote Vertex.** `services/batchService.ts` (`submitLibraryBatch`) no tiene consumidores en la interfaz; el lote visible usa el pipeline completo del servidor. Es candidato a eliminarse.
- **Netlify Dev.** Tras editar el catálogo con el servidor corriendo, la recarga en caliente dejó `api-openai-worker-background` roto (`module is not defined in ES module scope`) y el cliente sondeó sin fin y sin error. Reiniciar `npm run dev` lo resolvió. No afecta a producción, pero el cliente debería abandonar un trabajo de fondo que nunca escribe resultado.
- **Calidad visual.** La revisión de imágenes fue de una persona (este análisis), sin evaluación ciega ni facilitadores. Antes de un taller conviene una revisión con personas de apoyo de CAA sobre el perfil nuevo.
- **Tamaño de muestra.** 24 frases y 8 imágenes por modelo bastan para descartar opciones claramente peores, no para afirmar diferencias pequeñas entre las que quedan.

## Cómo repetirlo

```sh
# Fase 1 o 2 por modelo (pagado; los topes son obligatorios)
node --env-file=.env scripts/benchmark-models.mjs --cases scripts/eval/cases/pipeline-es-419.json \
  --phase 1 --models claude-haiku-5-5 --repairs 2 --max-output-tokens 4096 \
  --max-calls 40 --budget-usd 5 --run --out research/<AAAA-MM-DD>_benchmark-modelos/p1-comprender/es/claude-haiku-5-5

# Fase 3 sobre composiciones exportadas de una corrida de fase 2
node --env-file=.env scripts/eval/benchmark-images.mjs --compositions research/<AAAA-MM-DD>_benchmark-modelos/corpus/compositions-8.json \
  --models gpt-image-2.5-flare,gemini-2.5-flash-image --max-calls 20 --out research/<AAAA-MM-DD>_benchmark-modelos/p3-producir/8

# Resumen
node scripts/eval/summarize-benchmark.mjs research/<AAAA-MM-DD>_benchmark-modelos/p1-comprender/es/*
```

La fase 4 se corre en el navegador con `runEval` de `scripts/eval/vectorizarEstructurarEval.ts`, desde `http://localhost:3000` (Netlify Dev en el 9001 sirve `index.html` en lugar del módulo), con un manifiesto que cambie solo `model`.

## Cadencia recomendada

El catálogo cambia seguido, pero no hace falta repetir todo cada vez.

| Cuándo | Qué | Costo aproximado |
|---|---|---|
| Antes de cada taller | Recorrido real de una o dos frases con el perfil por defecto | menos de US$0,05 |
| Mensual | Fase 1 con los 24 casos para los modelos ofrecidos, más 8 imágenes por modelo de imagen ofrecido | cerca de US$1 |
| Cuando un proveedor anuncia un modelo, un retiro o un cambio de precio en una familia que usamos | Benchmark completo de la fase afectada, con el candidato contra el modelo por defecto | US$1 a 5 |
| Trimestral | Ensayo completo como este, incluida la fase 4 | cerca de US$10 |

Señales para adelantar una corrida: un aumento de `contract_errors` en el informe de uso, respuestas sin imagen o 429 frecuentes, o una fecha de retiro publicada (Gemini 2.5 Flash Image se retira el 15-03-2027).

## Ronda del 06-11-2026: candidatos de PRODUCIR

Mismas 8 composiciones, cuatro estilos de librerías de ejemplo (AIGA/DOT por defecto, Tablero con colores clave, Q • Blake en acuarela, ICAP 50 V2) y diez variantes: GPT Image 2.5 Flare (referencia), GPT Image 2.6 Flare en bitmap con complejidad baja y en SVG (`output_format: svg`, autor GPT-6 Luna), Nano Banana 2.1, Nano Banana 2 Lite, y en fal.ai FLUX.2 [dev] y [pro], Seedream 5.0 Lite, Ideogram 4 Turbo e Ideogram Vector. Datos en `research/2026-11-06_benchmark-producir/` (abrir `index.html`).

| Variante | Entregadas | p50 | US$/imagen | Observación |
|---|---|---|---|---|
| GPT Image 2.5 Flare | 32/32 | 10 s | 0,007 | Sigue por defecto: el más barato y parejo en los cuatro estilos |
| GPT Image 2.6 Flare, bitmap | 32/32 | 6 s | 0,026 | Bueno y rápido; 3,5 veces el costo sin ventaja clara |
| GPT Image 2.6 Flare, SVG | 29/32 | 21 s | 0,028 | SVG nativo que obedece los estilos; candidato a reemplazar a Recraft (pendiente comparación directa) |
| Nano Banana 2.1 | 32/32 | 18 s | ~0,034 + razonamiento | Expresivo; ~1.700 tokens de razonamiento por imagen |
| Nano Banana 2 Lite | 32/32 | 3 s | ~0,034 | **Admitido como alternativa de Google**; a veces cuela rótulos o marcos |
| FLUX.2 [dev] y [pro] (fal) | 64/64 | 11-20 s | 0,012-0,03 | Escriben texto en casi todas las imágenes |
| Seedream 5.0 Lite (fal) | 32/32 | — | 0,035 | Correcto, sin ventaja sobre Flare y suma un proveedor |
| Ideogram 4 Turbo (fal) | 30/32 | 10 s | 0,0075 | Figuras diminutas; su filtro de seguridad bloqueó frases de CAA con niños |
| Ideogram Vector (fal) | 32/32 | 29 s | 0,13 | Composiciones pobres y el más caro |

Gasto: unos US$7 en fal.ai (US$4,29 de Ideogram Vector), unos US$3 entre OpenAI y Vertex. La cuota de imagen de Vertex (2 por minuto por modelo base) obliga a espaciar las llamadas; antes de un taller hay que pedir un aumento para `gemini-3.1-flash-lite-image`.

