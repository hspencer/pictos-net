# Modelos, costes, cuotas y benchmark

2026-08-27. Documento local de trabajo; `research/` está ignorado por Git.
Estado inicial: diagnóstico verificado por inspección y pruebas simuladas;
ningún benchmark pagado ni cambio de facturación realizado.

## Decisiones

- Mantener Recraft y las selecciones existentes. El usuario confirma que añadió
  créditos. Incorporar los ocho modelos V4.1 y los cuatro V4 Styles (agosto 2026).
  Styles requiere un `style_id` configurado: se ofrece un campo explícito y se
  rechaza su ausencia antes de cobrar. No se crea un estilo pagado automáticamente.
- Ofrecer GPT-5.6 Luna, Terra y Sol para COMPRENDER, COMPONER y ESTRUCTURAR:
  candidatos económico, intermedio y de referencia, no ganadores medidos.
- Conservar los modelos predeterminados actuales. Comparar antes de sustituirlos.
- Mostrar precios de proveedor, unidad, condiciones y fecha; las unidades internas
  de PictoNet no equivalen a dólares ni hacen gratuitas las fases de texto.
- Reutilizar los contratos NLU/composición completos. OpenAI recibe funciones con
  `strict:false` explícito y selección forzada; la aceptación sigue dependiendo
  del validador canónico. No cambiar mapas semánticos para aparentar compatibilidad
  con el subconjunto de JSON Schema del proveedor.
- Mantener claves únicamente en servidor. No publicar resultados privados,
  cambiar cuentas, comprar créditos ni ejecutar benchmarks sin límites explícitos.

## Fase 0: evidencia

`types.ts`, los selectores de `App.tsx` y `components/SVGGenerator.tsx`,
`services/aiClient.ts`, `_shared/pipelineRunner.js` y `api-check.js` contienen
listas/rutas parcialmente duplicadas. La comprobación OpenAI está fijada a imagen;
la de Gemini verifica Flash aunque se seleccione otro modelo.

`_shared/vertex.js` ya usa OAuth de service account y `global` por defecto.
`_shared/httpRetry.js` limita algunas esperas, pero no cancela peticiones en vuelo
ni respeta el presupuesto temporal en errores de transporte. Recorta Retry-After
a 30 s y no interpreta HTTP-date. Rutas NLU/estructuración pierden metadatos del
error; el circuito de lote solo cubre parte de los proveedores/fases.

CONSUMER_SUSPENDED identifica suspensión del proyecto consumidor. Sin el aviso
original o soporte no sabemos su causa específica. Billing no garantiza capacidad;
Vertex tampoco exime de controles de acceso/política. Las cuotas de texto y de
imagen no deben intercambiarse. No se consultaron aún métricas privadas de GCP.

## Fase 1: contratos Allium

Actualizar configuración, uso y lote antes de runtime: selección válida por fase,
precios fechados y condicionales, proveedor explícito, rechazo de respuestas
incompletas, validación canónica, reintentos acotados, fallo de facturación sin
reintento, conservación de etapas aceptadas y circuito con devolución idempotente.
El benchmark se especifica separado de su eventual ejecución.

Verificación: `allium check` y `allium analyse`, sin equiparar chequeo estructural
con demostración de calidad semántica o disponibilidad del proveedor.

## Fase 2: catálogo e integración

Catálogo ESM compartido y pequeño, sin credenciales; clientes y servidor derivan
los IDs/capacidades. Los selectores usan el mismo precio y notas traducidas.
OpenAI Responses usa `store:false`, esfuerzo explícito `low`, límite de salida,
sin herramientas web ni almacenamiento conversacional. Adaptar texto, imágenes
y argumentos de función al contrato de respuesta existente, preservando consumo
y modelo realmente devuelto. Validar modelo/fase antes de llamar al proveedor.

Verificación: pruebas de rutas individuales/lote, contratos, errores y coste;
TypeScript, traducciones, producción y navegador local. Sin llamadas pagadas.

## Fase 3: resiliencia y Recraft

Presupuesto temporal real, cancelación explícita y Retry-After respetado sin
reintentar antes de tiempo. Evitar que reintentos de cliente multipliquen los del
servidor. Distinguir rate/capacity de facturación, permisos y cuota interna.
No cambiar de modelo, región o proveedor silenciosamente.

Mantener el endpoint Recraft de generación, admitiendo V4.1 y V4 Styles; comprobar credenciales/saldo mediante
GET /v1/users/me, exponiendo solo balance y alcance del chequeo. No inferir que
saldo positivo demuestra generación exitosa. Validar el prompt de hasta 10.000
caracteres de V4.1, sin truncarlo silenciosamente. Recuperar cobros internos de
intentos fallidos de manera idempotente, conforme al contrato acordado.

Verificación: pruebas simuladas con 429 transitorio, facturación agotada, permisos,
timeouts, cancelación, Retry-After largo, lote detenido y conservación de resultados.

## Fase 4: benchmark reproducible

Comparar primero fases 1 y 2 por separado. Para COMPONER, todos reciben el mismo
NLU revisado y congelado; variar simultáneamente comprensión y composición impediría
atribuir diferencias. Conservar versiones, hashes, modelo solicitado/devuelto,
esfuerzo, latencia, tokens, coste estimado, fallos y resultados sin seleccionar solo
los exitosos. Repetir y aleatorizar el orden en el estudio real.

Preparar CLI local con modo de planificación sin red por defecto, límites explícitos
de llamadas/salida/gasto estimado para ejecución y salida dentro de research.
Las métricas automáticas comprueban estructura; la fidelidad semántica y utilidad
CAA requieren evaluación humana. No declarar un mejor modelo antes del experimento.

## Fuentes oficiales consultadas

- https://developers.openai.com/api/docs/models/compare
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/error-codes
- https://platform.claude.com/docs/en/about-claude/pricing
- https://cloud.google.com/vertex-ai/generative-ai/pricing
- https://cloud.google.com/vertex-ai/generative-ai/docs/dynamic-shared-quota
- https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason
- https://www.recraft.ai/docs/api-reference/models/recraft-v4-1
- https://www.recraft.ai/docs/api-reference/models/recraft-v4-styles
- https://www.recraft.ai/docs/api-reference/appendix
- https://www.recraft.ai/docs/api-reference/pricing

## Pendientes externos

Correo Recraft y métricas/error logs del proyecto GCP, disponibilidad
real de generación de modelos OpenAI en esta cuenta y presupuesto del benchmark. La documentación
establece capacidades públicas, no prueba permisos ni capacidad para esta cuenta.

### Consulta real de diagnóstico (27 de agosto)

Se consultaron solo endpoints de lectura, sin generación ni modificación de cuenta.
La configuración efectiva es proyecto `pictos-vertex`, ubicación `global`.
El intento inicial usó un scope de lectura no admitido por estos métodos; tras
usar el mismo scope documentado que el runtime de PictoNet, las respuestas fueron:

- Cloud Quotas: HTTP 403, `PERMISSION_DENIED`, motivo `SERVICE_DISABLED`.
- Cloud Monitoring: HTTP 403, `PERMISSION_DENIED`; no se pudieron leer métricas.

Esto no demuestra agotamiento de cuota ni ausencia de errores. Para contrastar
límites y frecuencia reales hacen falta habilitación de la API de consulta y
permisos de observación apropiados por quien administra GCP, o una exportación
de métricas/errores. No se habilitaron APIs ni se modificaron roles IAM.

## Comprobaciones de acceso locales — 2026-08-27

Verificadas por la tarea principal a través de `api-check`, sin generación:

- Recraft: autenticación y consulta `GET /v1/users/me` correctas; 56.825 unidades
  API disponibles; latencia observada 433 ms. No se expusieron datos de perfil.
- OpenAI GPT-5.6 Luna: acceso a metadatos del modelo correcto; 712 ms.
- Ambos resultados declaran `generationVerified: false`. Un saldo positivo o
  acceso a metadatos no prueba generación, disponibilidad futura ni calidad.

Las comprobaciones de acceso se realizan en la interfaz existente. Para futuras
pruebas pagadas se mantiene una sola CLI: `scripts/benchmark-models.mjs`, con
planificación sin red por defecto y ejecución únicamente con límites explícitos.
No se ejecutó un benchmark ni una generación pagada en esta revisión.

## Selección provisional para probar (no cambia los valores predeterminados)

Estas combinaciones son hipótesis de trabajo, no resultados comparativos.
Los errores de COMPRENDER pueden propagarse a todas las fases posteriores;
por eso el perfil equilibrado reserva Terra también para esa fase.

| Fase | Perfil equilibrado inicial | Perfil económico para comparar |
| ---|---|---|
| COMPRENDER | GPT-5.6 Terra | GPT-5.6 Luna |
| COMPONER | GPT-5.6 Terra | GPT-5.6 Luna |
| PRODUCIR | Recraft V4.1 Utility Vector, si se busca SVG | GPT Image 2, calidad low, para prototipos visuales raster |
| ESTRUCTURAR | GPT-5.6 Terra | Comparar Luna con el mismo SVG/imagen de entrada |

Recraft participa en PRODUCIR, no en COMPONER. Su SVG inicial aún requiere
estructuración y validación MF-SVG. No hay sustitución automática de proveedor
ni cambio de modelos guardados; precio, esquema válido y calidad semántica son
criterios distintos. El benchmark debe incluir también los candidatos existentes.

## Límites de Netlify y transporte de visión

La [configuración oficial de Netlify Functions](https://docs.netlify.com/build/functions/configuration/)
indica 60 segundos para funciones síncronas (no configurable), 15 minutos para
background y límites de payload de 6 MB y 256 KB respectivamente. Se eliminaron
las declaraciones `timeout = 90` que no ampliaban el límite de la plataforma.
Las llamadas síncronas de texto OpenAI/Gemini tienen un presupuesto de proveedor
de 45 segundos; los workers de estructuración tienen 300 segundos.

ESTRUCTURAR con OpenAI y Gemini pasa primero por `api-structure-stage`: verifica
la identidad, modelo y función solicitada, acepta JSON hasta 5 MB y genera un
identificador aleatorio en el servidor. Guarda la entrada ligada a propietario,
proveedor y vencimiento de dos minutos. El worker recibe solamente `{jobId}`,
comprueba el permiso y lee la entrada con consistencia fuerte antes de eliminarla
y ejecutar la llamada. Así las imágenes base64 no viajan en el request background
limitado a 256 KB. Los resultados solo se entregan a su propietario autenticado.

El vencimiento es lógico, no una política automática de borrado físico: una
entrada abandonada antes de iniciar el worker puede permanecer almacenada.
Se necesita una política de limpieza si aparecen abandonos relevantes. Esta
revisión prueba el transporte con dobles locales; no prueba todavía el recorrido
completo con un proveedor de generación real ni la infraestructura desplegada.

## Registro de verificación local

- La revisión de cuotas reportó 83 pruebas simuladas correctas, incluyendo
  clasificación de facturación/cuota, reservas completas de lotes, reintegros,
  protección de trabajos Recraft y cálculo de caché del benchmark.
- Tras el staging de visión, 31 pruebas dirigidas OpenAI/imagen/rutas de proveedor
  pasaron; se agregó después una prueba de identidad firmada y consulta Gemini.
  Las 12 pruebas del archivo OpenAI texto/staging pasaron, sin llamadas reales.
- Se ejercitaron entradas de visión de más de 256 KB, rechazo sobre 5 MB,
  fase/capacidad, expiración, propietario, proveedor, consumo de entrada y replay.
- La tarea principal verificó anteriormente selectores/precios y ausencia de
  errores CSP en navegador; las comprobaciones reales de acceso constan arriba.
- No se ejecutó un benchmark de calidad ni se gastaron créditos de generación.
  La validación integral y la publicación posterior se registran por separado;
  estos resultados locales no se presentan como evidencia de despliegue.

### Comprobación integral anterior al commit

La tarea principal confirmó validación de esquemas (18 pruebas y 8 fixtures),
typecheck, 781 traducciones, build y revisión del acordeón de configuración en
navegador; abrir una sección cierra la otra sin cambiar los modelos guardados.
La ejecución final de la suite integral de 193 pruebas estaba pendiente de cierre
al registrar este punto; no se presenta aún como resultado completo.

La tarea principal confirmó también que la clave OpenAI está configurada como
secreto de alcance Functions en el contexto de producción de ambos sitios Netlify.
No se registran aquí valores de credenciales. Configuración de un secreto no
equivale a una generación verificada; no se ejecutaron generaciones en esta revisión.
