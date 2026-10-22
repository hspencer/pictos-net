# Plan de trabajo: fiabilidad y fluidez de la generación

Rama de trabajo: `dev`. Base: `4c9a49f` (2.6.3). Fuente: [DIAGNOSTICO_GENERACION_2026-10-22.md](DIAGNOSTICO_GENERACION_2026-10-22.md).

Este plan convierte el diagnóstico en tareas de ingeniería ancladas en el código actual. Cada hallazgo usado aquí se volvió a comprobar en el repositorio el 22 de octubre de 2026; los que dependen de llamadas a proveedores se toman del diagnóstico sin repetirlas.

## Objetivo

Que una persona facilitadora pueda conducir un taller con un perfil de modelos fijo, sabiendo que un fallo se presenta con su causa real, que no obliga a repetir fases ya resueltas y que no consume unidades sin entregar resultado. Los datos existentes no se pierden en ningún paso.

Criterio de cierre global, tomado del diagnóstico: al menos 95 % de recorridos completos al primer intento en el ensayo de taller, cero pérdida de datos, cero cobros internos sin entrega y P95 de duración por recorrido igual o menor a 60 s.

## Hallazgos verificados en el código

| Hallazgo | Ubicación | Consecuencia |
|---|---|---|
| Siete listas de modelos admitidos, independientes del catálogo | `api-claude.js:25`, `api-gemini-nlu.js:21`, `api-gemini-structure.js:20`, `api-gemini-structure-background.js:21`, `api-gemini-worker-background.js:16`, `api-batch-create.js:26`, `services/batchService.ts:28` | Retirar un modelo exige tocar siete sitios; por eso Gemini 2.5 Pro sigue admitido pese a su 404. |
| El catálogo no tiene estado de ciclo de vida | `netlify/functions/_shared/modelCatalog.js` (`MODEL_CATALOG`) | No hay forma de marcar «retirado» o «experimental» ni de derivar el selector de esa marca. |
| El lote admite el modelo de imagen que falla | `api-batch-create.js:26`, `batchService.ts:28`: solo `gemini-2.5-flash-image` y `gemini-3.1-flash-image` | El lote ofrece Gemini 3.1 Flash Image, con 9 de 38 respuestas sin imagen. |
| Respuesta sin imagen: se cobra, no se reembolsa y se pierde la causa | `api-gemini-worker-background.js:115-125` | Registra `units_charged: 1`, sale con `return` antes del `catch` (que solo reembolsa 429) y descarta `finishReason`, `finishMessage` y `promptFeedback`. |
| El razonamiento de Gemini usa una regla de la familia 2.5 | `_shared/geminiTranslate.js:94` (`thinkingBudgetFor`), `:125` | Gemini 3.8 exige `thinkingLevel`; no se habilita cambiando el nombre. |
| Los endpoints de texto registran éxito antes de la validación del contrato | `api-claude.js:170`, `api-gemini-nlu.js:134`, `api-openai-text.js:28`, `api-openai-text-background.js:40` | El informe administrativo cuenta como `ok` respuestas que el navegador rechaza después. |
| COMPONER valida el NLU antes de llamar al proveedor | `_shared/pipelineContracts.js:204-205`, `:248` | Con 826 de 829 filas históricas incompatibles, ningún cambio de modelo desbloquea COMPONER. |
| Exportar y duplicar desde la portada omiten los binarios | `services/libraryService.ts:138` (`duplicateLibrary`), `:229` (`exportLibraryJson`), ambos sobre `getLibraryRows` | Leen solo los metadatos de localStorage; bitmaps y SVG viven en IndexedDB. |
| Recraft se extiende por 35 archivos | Catálogo, servicios, funciones, tipos, locales y pruebas | El retiro decidido requiere un recorrido completo, no un cambio de selector. |
| Los `$id` de tres familias de schemas no resuelven | `https://pictos.net/schemas/pictonet-nlu-1.1.0.schema.json` devuelve el `index.html` de la SPA | `copy-submodule-data.sh` publica en `/schemas/<producto>/`, pero los `$id` apuntan a `/schemas/`. Solo `pictos-api` resuelve. |

## Secuencia

```mermaid
flowchart LR
  F0[F0 Respaldo íntegro] --> F1[F1 Catálogo único]
  F1 --> F2[F2 Diagnóstico y unidades]
  F2 --> F3[F3 Mensajes por causa]
  F1 --> F4[F4 Retiro de Recraft]
  F0 --> F5[F5 Rescate del corpus]
  F2 --> F6[F6 Modelos nuevos]
  F3 --> F7[F7 Ensayo de taller]
  F5 --> F7
  F6 --> F7
  S[S Schemas de referencia] -.-> F5
```

F0 va primero porque la migración del corpus (F5) y el retiro de Recraft (F4) tocan datos que hoy no tienen una copia de seguridad fiable. F1 es la base de F2, F4 y F6: sin un catálogo único, cada cambio de modelo vuelve a abrir siete listas. El frente S es independiente y puede avanzar en paralelo.

## F0. Respaldo íntegro de librerías

**Problema.** `exportLibraryJson` y `duplicateLibrary` leen `getLibraryRows`, que solo devuelve metadatos. La única ruta que reúne binarios es `exportProject` desde la librería abierta (`createGraphDump`).

**Tareas.**

1. Hacer que `exportLibraryJson` y `duplicateLibrary` hidraten bitmap, `rawSvg` y `structuredSvg` desde IndexedDB, reutilizando la hidratación que ya usa `openLibrary` en lugar de escribir una nueva.
2. `duplicateLibrary` debe copiar también los registros de IndexedDB bajo el nuevo ID de librería.
3. Prueba de regresión con una librería cuyos medios existen solo en IndexedDB, sin plantilla remota de respaldo: exportar, importar en un ID distinto y comparar número de filas, frases y hash de cada medio.

**Cierre.** La exportación desde la portada y desde la librería abierta producen el mismo inventario de medios. Ningún paso posterior se ejecuta sobre una librería sin una exportación verificada.

## F1. Catálogo único con ciclo de vida

**Problema.** Siete listas de admisión independientes y un catálogo sin estado.

**Tareas.**

1. Agregar a cada entrada de `MODEL_CATALOG` un campo `status` con cuatro valores: `workshop` (perfil de taller), `active`, `experimental` y `retired`, con `retiredAt` y `replacement` cuando corresponda.
2. Exportar desde `modelCatalog.js` una función `allowedModels({ phase, provider, includeExperimental })` y reemplazar con ella las siete listas. `services/batchService.ts` debe consumir el mismo catálogo, no una constante propia.
3. Estados iniciales, según el diagnóstico:

| Modelo | Estado | Motivo |
|---|---|---|
| `claude-haiku-4-5-20251001` | `workshop` | Fases 1 y 2 verificadas; 154 llamadas sin error. |
| `claude-sonnet-4-6` | `active` | Recorrido completo verificado; latencia de COMPRENDER 26 s. |
| `claude-opus-4-6` | `active` | Solo ESTRUCTURAR; sin prueba funcional. |
| `gemini-2.5-pro` | `retired` | 404 reproducido; retiro publicado. |
| `gemini-2.5-flash` | `retired` | Retiro publicado el 20-10-2026, aunque hoy respondió. |
| `gpt-5.6-luna` | `experimental` | Fases 1 y 2 verificadas; visión no. |
| `gpt-5.6-terra`, `gpt-5.6-sol` | `experimental` | Sin prueba. |
| `gemini-2.5-flash-image` | `workshop` | 34 llamadas sin error; retiro anunciado para 15-03-2027. |
| `gpt-image-2` | `active` | Recorrido completo en 32 s, calidad baja. |
| `gemini-3-pro-image` | `active` | Recorrido completo en 57,3 s; cuota diaria baja. |
| `gemini-3.1-flash-image` | `experimental` | 9 de 38 sin imagen; sale del lote. |
| `recraftv4_1*` (ocho variantes) | `retired` | Decisión de producto; ver F4. |

4. Configuraciones guardadas: si `GlobalConfig` referencia un modelo `retired`, el selector lo muestra como retirado y pide un reemplazo antes de la próxima generación. No se sustituye en silencio ni se reescribe la procedencia de filas ya generadas.
5. El selector de fase 3 del lote deja de ofrecer `gemini-3.1-flash-image` por defecto.

**Cierre.** Una prueba recorre cada endpoint y confirma que acepta exactamente los modelos que el catálogo admite para su fase. Retirar un modelo pasa a ser un cambio de una línea.

## F2. Diagnóstico de intentos y unidades coherentes

**Tareas.**

1. **Respuesta sin imagen** en `api-gemini-worker-background.js:115`: conservar `candidates[0].finishReason`, `finishMessage`, `promptFeedback.blockReason` y la lista de tipos de partes recibidas, sin guardar la imagen ni el texto. Reembolsar con `refundUnitsOnce(email, 1, 'gemini:${jobId}', 'no_image')`, que ya es idempotente. Aplicar el mismo tratamiento a los workers de OpenAI.
2. **Separar éxito del proveedor y éxito de la tarea.** El registro de texto pasa de `ok` a dos campos: `provider_ok` (HTTP correcto con herramienta invocada) y `contract_ok` (validación canónica aprobada). El navegador informa el resultado de la validación con el mismo `request_id`, o la validación se mueve al servidor, que ya la tiene disponible en `pipelineContracts.js`. Lo segundo es más simple y evita una llamada extra; es la opción recomendada.
3. **Registro de intento exportable**, sin contenido comunicativo: ID de ejecución, fase, modelo solicitado y devuelto, hash del prompt y del contrato, HTTP, duración, reintentos, `finishReason` y resultado de validación. Botón de exportación en la consola para la persona facilitadora.
4. Unificar la numeración de ESTRUCTURAR: la interfaz dice fase 4 y los registros usan fase 5.

**Cierre.** Ante cada fallo de la ventana del diagnóstico, el registro permite distinguir bloqueo de seguridad, finalización distinta de `STOP`, contrato inválido, indisponibilidad del modelo y error local. Ningún intento sin entrega queda con una unidad cobrada.

## F3. Mensajes por causa y recuperación por fase

**Tareas.**

1. Mensajes i18n distintos para: modelo no disponible, respuesta sin imagen (con `finishReason` traducido), datos guardados que requieren revisión (con las rutas incompatibles), SVG no admitido por el estructurador y tiempo agotado. Cada uno ofrece una acción concreta.
2. Un fallo en PRODUCIR conserva el NLU y la composición y ofrece reintentar solo PRODUCIR, o reintentar con el modelo de respaldo del perfil.
3. El estado de error persiste tras recargar. Ensayar cambio de librería, pérdida de conexión, sesión caducada y cierre de pestaña a mitad de una fase.

**Cierre.** Ningún mensaje de error de generación queda sin causa ni sin acción. Ninguna fase ya resuelta se repite por un fallo posterior.

## F4. Retiro de Recraft

Sigue el alcance del diagnóstico. Con F1 resuelto, el catálogo deja de admitir las ocho variantes y el resto es eliminación de código.

**Tareas.**

1. Resolver o expirar los trabajos Recraft en curso antes de retirar `api-recraft-poll`.
2. Eliminar `api-recraft-worker-background`, `api-recraft-poll`, `_shared/recraftImage.js`, `services/recraftService.ts`, el despacho en `imageGenerationService.ts` y `aiClient.ts`, los ajustes de `style_id` y las claves i18n que queden sin uso (`validate-i18n` lo detecta).
3. Actualizar `schemas/pictos-api/pictos-api-common-1.0.0.schema.json`, que enumera Recraft. Es un contrato publicado: el cambio exige versión nueva (1.1.0) o una nota de compatibilidad, no editar 1.0.0 en su lugar.
4. Conservar la lectura y exportación de los SVG ya generados, sus IDs y su procedencia. No borrar almacenes históricos ni registros de uso.
5. Retirar `RECRAFT_API_KEY` del entorno de Netlify después del despliegue, no antes.

**Cierre.** No se puede iniciar ningún trabajo nuevo con Recraft por ninguna ruta (selector, lote, API v1). Los SVG existentes siguen abriéndose en el editor.

## F5. Rescate del corpus histórico

Depende de F0. Sigue la reparación por capas del diagnóstico; aquí se fija solo la parte de ingeniería.

**Tareas.**

1. Script de migración en `scripts/`, compatible con Node 18, que trabaja sobre una copia exportada y produce un diff por fila. Nunca escribe sobre la librería original.
2. Capa mecánica: equivalencias exactas por mayúsculas (812 campos en 435 filas, según la simulación del diagnóstico). Conserva el valor original en un campo de procedencia de la migración.
3. Tabla de equivalencias semánticas propuestas (`AHORA` a `immediate`, `Futuro cercano` a `near_future`) que requiere aprobación explícita antes de aplicarse.
4. Las descripciones libres de intención se archivan íntegras y se clasifican aparte; no se descartan para conseguir un esquema válido.
5. Piloto de diez filas en una librería del taller antes de cualquier ampliación.

**Cierre.** Las filas del piloto pasan COMPONER sin regenerar sus imágenes, con los mismos bytes de medios y los mismos IDs de fila.

## F6. Modelos nuevos

Ningún modelo entra al perfil de taller por esta vía sin pasar por F7.

**Tareas.**

1. `geminiTranslate.js`: emitir `thinkingLevel` para las familias 3.x y conservar `thinkingBudget` solo para 2.5. Parametrizar por modelo en el catálogo, no por prefijo de nombre.
2. Integrar GPT-6 Luna y GPT Image 2.5 Flare como `experimental`, con tarifas y fecha de verificación en el catálogo.
3. Gemini 3.8 Flash como alternativa de texto de Google, condicionado a la tarea 1.
4. Nano Banana 2.1 como respaldo de imagen, solo en fase 3: no admite function calling.
5. Haiku 5.5 y Sonnet 5.5 quedan fuera hasta resolver sus bloqueos documentados: la enumeración incumplida de Haiku y el rechazo de `tool_choice` forzado en Sonnet. Este último exige cambiar la estrategia del cliente, que hoy depende de la herramienta forzada en todas las fases.
6. La actualización del SDK de Anthropic y de su versión de API (2026-10-21) va en un cambio separado con sus propias regresiones.

**Cierre.** Cada modelo integrado pasa las fases que declara en las rutas reales de Pictos (individual, lote y API v1 cuando corresponda), no solo en sondas directas.

## F7. Ensayo de taller

Sigue los puntos 8 a 12 del diagnóstico: corpus sintético de 20 frases revisado con facilitadores, dos repeticiones por frase, comparación entre el perfil base (Haiku, Haiku, Gemini 2.5 Flash Image) y un candidato, y ensayo de concurrencia con el número real de equipos.

**Fluidez.** El cambio con más efecto sobre la latencia percibida es el perfil por defecto: COMPRENDER con Sonnet tarda 26 s y con Haiku 11,3 s en la misma frase. El perfil de taller debe fijarse con Haiku en las fases 1 y 2 salvo que el ensayo muestre una diferencia de calidad que lo justifique.

**Cierre.** El criterio global de este plan.

## S. Schemas de referencia

Desde `eb3849a` (marzo de 2026), `pictos-net/schemas/` es la fuente canónica: los submódulos se absorbieron con la indicación de actualizarlos desde aquí. Los repositorios de `github.com/mediafranca` quedaron como espejos sin actualizar.

| Producto | Local | Repositorio de referencia | Estado |
|---|---|---|---|
| `nlu-schema` | 1.1.0, con perfil de generación | 1.0.0, último cambio 13-12-2025 | Obsoleto. Conflicto en 1.0.1 (ver abajo). |
| `mf-svg-schema` | 2.0.0-draft.1 | Sin `package.json`, último cambio 27-01-2026 | Obsoleto. Release congelado `schemas/metadata.schema.json` idéntico en ambos. |
| `pictogram-composition-schema` | 0.1.0 | No existe, aunque su `package.json` lo declara | Falta crear. |
| `pictos-api` | 1.0.0 y dos borradores 0.1.0 | No existe; no tiene `package.json` | Falta decidir si tendrá repositorio propio. |

**Conflicto en NLU 1.0.1.** Hay dos documentos distintos con el mismo `$id` `https://pictos.net/schemas/pictonet-nlu-1.0.1.schema.json`. El del repositorio de referencia es del 29-10-2025; el local, registrado en `FROZEN_RELEASES.json` con hash `e5747f45`, agrega `domain`, `frame_label` y otros campos. Proviene de cambios hechos en el submódulo que no se publicaron antes de absorberlo. Lo que sirve pictos.net es la versión local. Sincronizar el espejo sobrescribe un release publicado; el historial de Git conserva el anterior, pero quien lo haya descargado tiene otro contrato bajo el mismo identificador.

**`$id` que no resuelven.** Los `$id` de NLU, composición y MF-SVG apuntan a `/schemas/<archivo>`, pero el build publica en `/schemas/<producto>/<archivo>`. Hoy esas URLs devuelven el `index.html` de la SPA con estado 200. Los `$id` congelados no pueden cambiar, así que la corrección es una regla de reescritura en `netlify.toml` que sirva cada `/schemas/<archivo>` desde su carpeta de producto con estado 200. Conviene hacerlo antes de publicar los espejos, para que el identificador de cada schema sea dereferenciable.

**Procedimiento de sincronización propuesto.**

1. `scripts/publish-schemas.sh`: copia unidireccional de cada `schemas/<producto>` a su espejo, con las mismas exclusiones de seguridad que `copy-submodule-data.sh`. Corre las pruebas del producto antes de publicar y rechaza la publicación si cambió el hash de un release congelado respecto del espejo, salvo autorización explícita.
2. Un commit por versión y una etiqueta `v<versión>` en el espejo. Las versiones intermedias no se reconstruyen: el commit del espejo dice desde qué commit de pictos-net se publicó.
3. El README de cada espejo declara que la fuente canónica es pictos-net y que los cambios se proponen allí.
4. Se ejecuta en cada release que toque `schemas/`; se agrega a la lista de verificación de release.

**Cierre.** Cada `$id` publicado devuelve su schema con `application/json`, y cada espejo coincide byte a byte con `schemas/<producto>` en la versión etiquetada.

## Decisiones pendientes

1. **NLU 1.0.1:** sobrescribir el espejo con la versión local, con nota en el changelog, o conservar la versión publicada como `1.0.1` y renombrar la local. Lo primero es coherente con lo que ya sirve pictos.net; lo segundo protege a quien haya usado el espejo.
2. **Repositorios nuevos:** crear `mediafranca/pictogram-composition-schema` (su `package.json` ya lo declara) y decidir si `pictos-api` tiene repositorio propio o se publica solo desde pictos.net.
3. **Validación de contratos en el servidor** (F2, tarea 2): recomendada sobre el informe desde el navegador.
4. **Perfil de taller definitivo:** se fija después de F7, no antes.

Existe además `mediafranca/pictos-net`, con último cambio el 26-06-2026, distinto del repositorio activo `hspencer/pictos-net`. Queda fuera del alcance de este plan, pero conviene archivarlo o declararlo espejo para que no se tome por la versión vigente.
