# Pictos.net: diagnóstico de generación y preparación de talleres

**Alcance confirmado por el usuario:** documentar hallazgos y un plan de acción propuesto en este mismo archivo. No modificar código ni bibliotecas. **Decisión de producto: retirar Recraft**; su reparación como proveedor deja de ser una tarea propuesta. Las imágenes existentes, su autoría y su procedencia deben conservarse.

Fecha: 22 de octubre de 2026, hora de Chile. Producción observada: **2.6.3**. Código local: `4c9a49fd12727c979bf8e4fb21a10de696c7c1e5`, rama `dev`.

## Dictamen

Pictos puede generar pictogramas hoy, pero **el conjunto de opciones expuesto no constituye una combinación de modelos y fases certificada para talleres**. Hay fallos distintos que la experiencia presenta como una generación fallida:

1. **Modelo indisponible:** Gemini 2.5 Pro devuelve HTTP 404 en COMPRENDER. Su retiro está publicado por Google. Debe excluirse de las fases de texto y visión hasta migrarlo y probar el reemplazo.
2. **Imagen ausente:** Gemini 3.1 Flash Image acumula 9 respuestas sin imagen en 38 llamadas registradas durante la ventana examinada. El servidor pierde el motivo detallado de finalización. No hay evidencia para atribuir esos nueve casos a un esquema, cuota o moderación concretos.
3. **Datos históricos incompatibles:** de 829 apariciones de filas con NLU en las bibliotecas locales publicables, 826 incumplen el contrato documental actual. COMPONER valida el NLU antes de llamar al proveedor: cambiar de modelo no supera ese bloqueo.
4. **SVG rechazado localmente:** Recraft V4.1 Vector produjo un SVG, pero ESTRUCTURAR lo rechazó en el preprocesamiento local, antes de llamar al modelo de visión. Generación vectorial y admisión al estructurador son capacidades diferentes.
5. **Reemplazos nuevos comprobados:** con credenciales locales, GPT-6 Luna y Gemini 3.8 Flash validaron las fases 1/2; GPT Image 2.5 Flare y Gemini Nano Banana 2.1 entregaron imágenes. Sonnet 5.5 rechazó la herramienta forzada; Haiku 5.5 entregó un NLU que incumplió una enumeración. Los modelos nuevos necesitan admisión individual.
6. **Rescate viable, con respaldo completo primero:** 824 de las 826 filas incompatibles tienen un bitmap no vacío en los archivos examinados. La exportación desde la portada y la duplicación no reúnen los binarios de IndexedDB; no deben usarse como única copia de seguridad.

No se reprodujo un rechazo general de los esquemas enviados a los proveedores. Sonnet, Haiku, Gemini Flash y OpenAI Luna aceptaron solicitudes reales de texto y devolvieron resultados que pasaron la validación canónica en la muestra sintética. Esto acredita compatibilidad puntual, no fiabilidad estadística ni calidad comunicativa.

## Alcance y evidencia

- Se usó la sesión autenticada existente en **Chrome, https://pictos.net/**.
- Se creó una sola fila nueva: «Prueba diagnóstica: quiero una taza de agua», ID `R_MANUAL_1792692349050`. Las regeneraciones se realizaron en esa fila; se conserva su último resultado en la librería A mano. El prefijo diagnóstico forma parte de la frase y afecta la interpretación: esta muestra no equivale a un corpus representativo de CAA.
- Se cambiaron temporalmente los modelos para las pruebas y se restauraron **Sonnet / Sonnet / Gemini 3 Pro Image**, con Sonnet para ESTRUCTURAR. No se regeneraron las filas originales.
- Se consultaron el informe administrativo de producción y los registros de Netlify Blobs del **15 al 22 de octubre**, ambos inclusive. La copia de registros se tomó a las **15:11:56 de Chile**: contiene 237 llamadas e incluye pruebas de esta investigación. No incluye los ensayos posteriores a esa hora.
- Se recorrieron los JSON de `public/libraries` con los validadores actuales, sin reescribirlos. Son apariciones de filas, con posibles duplicados entre bibliotecas, no personas ni pictogramas únicos.
- Se consultó documentación oficial de Google, Anthropic, OpenAI y Recraft. La evidencia técnica y visual está en `research/diagnostico-2026-10-22/`, carpeta excluida de Git.
- No se modificó código de la aplicación, no se hizo commit ni despliegue. Hubo llamadas reales de generación con posible consumo de API y unidades internas.

## Pruebas en producción

| Prueba | Resultado observado | Tiempo en interfaz |
|---|---|---:|
| Sonnet 4.6: COMPRENDER | Salida validada | 26,0 s |
| Sonnet 4.6: COMPONER | Composición validada | 7,8 s |
| Gemini 3 Pro Image: PRODUCIR | Bitmap recibido y visible | 23,4 s |
| Recorrido Sonnet → Sonnet → Gemini 3 Pro Image | Completo | **57,3 s** |
| Gemini 2.5 Flash: COMPRENDER | Salida validada | 5,6 s |
| Gemini 2.5 Flash: COMPONER | Composición validada | 2,4 s |
| Gemini 2.5 Pro: COMPRENDER | **HTTP 404**, no reintentable | Backend: 100 ms |
| GPT-5.6 Luna: COMPRENDER | Salida validada | 9,1 s |
| GPT-5.6 Luna: COMPONER | Composición validada | 4,3 s |
| Recraft V4.1 Vector: PRODUCIR | SVG recibido, aproximadamente 32 KB | 16,7 s |
| ESTRUCTURAR ese SVG, Sonnet seleccionado | **Rechazo local antes de la llamada al modelo** | Inmediato |
| Haiku 4.5: COMPRENDER | Salida validada | 11,3 s |
| Haiku 4.5: COMPONER | Composición validada | 3,4 s |
| GPT Image 2, calidad baja: PRODUCIR | Bitmap recibido y visible | 17,3 s |
| Recorrido Haiku → Haiku → GPT Image 2 | Completo | **32,0 s** |

El 404 reproducido tiene referencia `47f7b4de-9732-480c-bbd0-86dc16561f1b`. No debe interpretarse el tiempo retenido de una ejecución anterior como duración del intento fallido: el registro servidor conserva la duración de ese intento.

También se realizó una **sonda directa separada** con Gemini 3.1 Flash Image, usando credenciales locales y una frase sintética breve: HTTP 200, `finishReason: STOP`, imagen PNG presente, 9,468 s. No pasó por el worker ni por el prompt completo de la librería. Demuestra que el modelo no está universalmente roto; no explica ni desmiente los nueve fallos de producción.

## Fallos y causas

### A. Catálogo que sigue ofreciendo modelos retirados

Google publica el retiro de **Gemini 2.5 Pro y Gemini 2.5 Flash de texto el 20 de octubre de 2026**. El catálogo, los tipos y las listas de los endpoints siguen admitiendo ambos. Pro produjo 404 en la sesión real. Flash todavía funcionó en las dos pruebas realizadas; esa diferencia debe conservarse como evidencia, sin prometer continuidad de acceso.

La tabla de Google propone familias 3.8/3.5 como reemplazo. Agregar sus nombres al selector no basta: hay que revisar endpoint, región, herramientas y configuración de razonamiento. El adaptador actual calcula `thinkingBudget` mediante una regla Flash/Pro de Gemini 2.5; no debe trasladarse automáticamente a nuevas familias. [Ciclo de vida oficial de Google](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions).

**Cerco:** excluir Pro de COMPRENDER, COMPONER y ESTRUCTURAR; retirar Flash 2.5 de los perfiles de taller por su ciclo de vida, aunque haya respondido hoy. Esto no se aplica a **Gemini 2.5 Flash Image**, que tiene otro ciclo de vida: Google publica retiro el 15 de marzo de 2027.

### B. Gemini 3.1 Flash Image: respuesta válida de transporte, sin imagen utilizable

Los nueve registros de error son del **20 de octubre, entre 15:15 y 15:30 de Chile**, con el mismo mensaje: `No image data in Gemini response`. Duraron entre 6,993 y 9,678 segundos. Representan **23,7 % de las 38 llamadas registradas de ese modelo** en la ventana; no una tasa general del servicio.

En `netlify/functions/api-gemini-worker-background.js`, después de un HTTP correcto se busca una imagen en `candidates[0].content.parts`. Si no aparece, se escribe un error genérico y se retorna. Se pierden `promptFeedback`, `finishReason`, `finishMessage` y la clasificación por presencia/tipo de partes. Por eso **no se puede reconstruir si hubo bloqueo de seguridad, otra finalización o una respuesta incompleta**.

Además, ese retorno registra **una unidad interna cobrada** y no pasa por el reembolso del `catch`, que está limitado a errores HTTP 429. Son unidades de Pictos; esto no acredita cuánto facturó Google. Los tokens registrados como cero en esa rama tampoco demuestran consumo real cero.

PRODUCIR envía texto y configuración de imagen; **no envía los esquemas NLU o de composición como herramientas al generador de imagen**. La hipótesis de un rechazo de esos esquemas no explica directamente estos nueve casos. La sonda separada confirma que `responseModalities: ['IMAGE']` y tamaño `1K` pueden funcionar con 3.1; no hay base para cambiarlos a ciegas.

**Cerco:** Gemini 3.1 Flash Image queda fuera del perfil de taller hasta tener diagnóstico de finalización y un ensayo satisfactorio con los prompts completos. [Ficha oficial del modelo](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image).

### C. La validación de datos históricos bloquea fases posteriores

Resultados locales actuales:

| Criterio | Conformes / filas con NLU |
|---|---:|
| NLU documental | 3 / 829 |
| NLU de generación | 3 / 829 |
| Composición documental, usando elementos y prompt guardados | 114 / 829 |

Las rutas de error más frecuentes son `/metadata/intent` (825 apariciones), `/visual_guidelines/temporal` (819), `/pragmatics/expected_response` (811) y `/metadata/speech_act` (777). Una fila puede tener varios errores. Estos conteos no dicen que las imágenes existentes estén inutilizables ni que 826 nuevas llamadas a IA hayan fallado.

La fila antigua abierta en Chrome mostraba una intención libre con aviso «valor guardado; revisar». Es consistente con el problema del corpus, pero no se exportó y validó íntegramente esa fila privada.

`buildCompositionRequest` en `netlify/functions/_shared/pipelineContracts.js` ejecuta `validateNluDocument` **antes** de preparar la solicitud. El rechazo ocurre en la aplicación y es independiente del modelo elegido. Los cambios de enumeraciones y las restricciones de roles/referencias necesitan reconciliación explícita, no reemplazar valores por una opción arbitraria.

**Cerco:** permitir consultar y editar material histórico; exigir NLU documental válido al pasar a COMPONER; ofrecer diagnóstico de campos y regeneración explícita de COMPRENDER cuando sea necesaria. Mantener copia de los datos anteriores. No etiquetar esas filas como fallos del proveedor.

### D. Recraft genera un SVG que ESTRUCTURAR no admite

Recraft V4.1 Vector completó PRODUCIR. Después, la consola mostró «Pre-procesando SVG local…» y el rechazo «El SVG está mal formado o contiene referencias o contenido no permitido». No llegó al mensaje de inventario ni al envío al modelo.

En `services/svgStructureService.ts:1840`, la ruta pasa por `canStructureSVG` e `inspectPassiveSVG` antes de inventariar y llamar al modelo de visión. Ese inspector comprueba XML, elementos permitidos, IDs, CSS y referencias internas. **Está confirmado el lugar del rechazo, no el atributo o elemento concreto que lo causó.** La exportación del SVG original no pudo recuperarse mediante el control de descarga durante esta sesión; no corresponde inventar una causa específica ni acusar al SVG de contener código malicioso.

Existe otra limitación visible en el código: el ensamblado entiende paths y advierte que otras primitivas pueden quedar fuera. Su presencia en el SVG de esta prueba no se verificó.

**Decisión actual:** retirar Recraft de las nuevas generaciones. Se conserva este fallo como evidencia histórica, pero no se propone invertir en reparar su integración. Los SVG ya producidos deben seguir pudiendo preservarse y exportarse; su eventual importación al editor sigue sujeta a los controles de seguridad generales.

### E. Observabilidad que mezcla éxito del proveedor con éxito de la tarea

Los endpoints de texto pueden registrar `ok: true` tras recibir una respuesta del proveedor y **antes de que el navegador valide el contrato**. El informe administrativo no incluye todos los rechazos locales, fallos de IndexedDB o errores del ensamblado SVG. Por tanto, «cero errores» en el informe significa cero errores registrados por esa vía, no cero tareas fallidas.

El registro de ediciones estaba pausado en la librería observada. No sustituye un registro de intentos. Las nuevas ejecuciones aceptadas guardan procedencia, pero el diagnóstico de intentos rechazados necesita un mecanismo propio y exportable.

## Cercos operativos propuestos

### Modelos

| Modelo / familia | Fases admitidas por el catálogo actual | Estado para talleres |
|---|---|---|
| Haiku 4.5 | 1, 2 | **Candidato principal**: ambas fases verificadas y 154 llamadas históricas sin error servidor en la copia consultada. Falta ensayo representativo. |
| Sonnet 4.6 | 1, 2, ESTRUCTURAR | **Alternativa para 1/2**: recorrido completo probado. ESTRUCTURAR queda condicionado a admisión del SVG; no hubo llamada de visión exitosa en esta sesión. |
| Opus 4.6 | ESTRUCTURAR | Documentado y admitido por catálogo; sin prueba funcional aquí. Mantener avanzado. |
| Gemini 2.5 Pro, texto/visión | 1, 2, ESTRUCTURAR | **Excluir**: 404 reproducido y retiro publicado. |
| Gemini 2.5 Flash, texto/visión | 1, 2, ESTRUCTURAR | **Fuera del perfil de taller**: 1/2 funcionaron hoy, pero retiro publicado. |
| GPT-5.6 Luna | 1, 2, ESTRUCTURAR | **Alternativa experimental para 1/2**: ambas verificadas. Visión no verificada. |
| GPT-5.6 Terra / Sol | 1, 2, ESTRUCTURAR | No probados en esta sesión; no presentarlos como equivalentes certificados de Luna. |
| Gemini 2.5 Flash Image | 3, bitmap | **Candidato principal de imagen**: 34 llamadas registradas sin error; falta recorrido nuevo y ensayo de taller. |
| GPT Image 2, calidad baja | 3, bitmap | **Alternativa de imagen verificada** en recorrido completo de 32 s. Otras calidades no probadas. |
| Gemini 3 Pro Image | 3, bitmap | **Alternativa verificada** en recorrido completo de 57,3 s; muestra pequeña. |
| Gemini 3.1 Flash Image | 3, bitmap | **Fuera del perfil de taller**: nueve respuestas sin imagen. Sonda breve exitosa no levanta el cerco. |
| Recraft V4.1 Vector | 3, vector | **Retiro decidido**. Conservar los archivos y la procedencia de generaciones anteriores. |
| Otros Recraft V4.1 / Utility / Pro | 3 | **Retiro decidido**. No forman parte del catálogo futuro propuesto. |
| Recraft V4 Styles | 3 | **Retiro decidido**, incluidos sus ajustes de estilo. |

**Ningún modelo recibe aquí la etiqueta “sin problemas garantizados”.** Los perfiles provisionales son Haiku → Haiku → GPT Image 2 baja, y Sonnet → Sonnet → Gemini 3 Pro Image: ambos completaron una muestra en Chrome. Para el perfil principal definitivo, comparar Haiku → Haiku → Gemini 2.5 Flash Image con el primero usando el corpus de taller.

### Límites entre fases

| Transición | Condición de admisión | Conducta ante fallo |
|---|---|---|
| Frase → COMPRENDER | Modelo activo y disponible; salida NLU de generación validada, frase preservada | Detener esa fase, conservar intento y motivo. |
| NLU → COMPONER | NLU documental válido; árbol y prompt de salida validados | Mostrar rutas incompatibles; no llamar a otro modelo para eludir la validación. |
| Composición → PRODUCIR | Composición aprobada para el flujo; parámetros propios del modelo de imagen | Conservar NLU/composición y ofrecer reintentar solo PRODUCIR. |
| Bitmap → TRAZAR | Imagen decodificable | VTracer local; no requiere llamar a un LLM. |
| SVG → ESTRUCTURAR | SVG pasivo admitido, IDs y árbol utilizables | Separar rechazo local, error de visión y fallo de certificación. Conservar geometría original. |
| Borrador → SVG canónico | Contratos semánticos, referencias, accesibilidad y fidelidad | Mantener borrador editable y revisión humana; no confundirlo con aprobación comunicativa. |

La interfaz denomina ESTRUCTURAR «fase 4» en ajustes; internamente usa fase **5**, con el trazado como paso intermedio. Conviene unificar esa identificación en informes y registros.

## Documentación y compatibilidad de solicitudes

- **Google:** su documentación actual de herramientas enumera soporte para `anyOf`, `$ref` y `$defs`, entre otros campos. El adaptador local mantiene una proyección acotada y convierte mapas dinámicos en cadenas JSON. Eso reduce restricciones expresables y exige la validación canónica posterior; no constituye por sí solo prueba de un rechazo. Actualizar el comentario de compatibilidad y probar la proyección con cada familia nueva. [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling).
- **OpenAI:** Responses permite `strict: false`, que el adaptador usa explícitamente. Por ello no garantiza conformidad, aunque Luna pasó las dos validaciones de la muestra. Activar `strict: true` requiere proyectar objetos con `additionalProperties: false` y campos requeridos; no basta cambiar el booleano sobre un contrato con mapas dinámicos. [Function calling](https://developers.openai.com/api/docs/guides/function-calling). GPT Image 2 sigue documentado; los parámetros actuales de calidad baja y 1024×1024 funcionaron en producción. [Modelo de imagen](https://developers.openai.com/api/docs/models/gpt-image-2), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
- **Anthropic:** Haiku 4.5, Sonnet 4.6 y Opus 4.6 figuran activos en la tabla consultada. No hay motivo observado para cambiar los modelos que completaron las pruebas. Una migración futura debe revisar restricciones de herramientas y parámetros de la familia destino. [Estado de modelos](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- **Recraft:** V4.1 sigue documentado con salida raster/vector, prompt de hasta 10.000 caracteres y tamaños por relación de aspecto; el adaptador usa `1:1`. Los parámetros consultados no explican el rechazo posterior local del SVG. [V4.1](https://www.recraft.ai/docs/api-reference/models/recraft-v4-1), [límites](https://www.recraft.ai/docs/api-reference/appendix).

## Plan de mejora antes de los talleres

### Prioridad 0: quitar bloqueos y obtener diagnóstico útil

1. **Cerrar el catálogo por fase.** Excluir Pro 2.5, retirar Flash 2.5 de los perfiles de taller y retirar Recraft de las nuevas generaciones; comprobar configuraciones guardadas, frontend, endpoints individuales, lote y API v1. Una configuración guardada debe mostrar el modelo retirado y pedir elección de reemplazo, sin sustituirlo silenciosamente. Admitir modelos nuevos solo tras las comprobaciones descritas más abajo.
2. **Registrar intentos completos sin contenido comunicativo por defecto.** ID de ejecución, fase, modelo solicitado/devuelto, versión y hash de contrato/prompt, HTTP, duración, reintentos y resultado de validación. Para Gemini, conservar `finishReason`, bloqueo y tipos de partes, sin guardar imagen, frase ni respuesta textual privada automáticamente. Exportación local de diagnóstico para el facilitador.
3. **Separar mensajes.** «Modelo no disponible», «respuesta sin imagen», «datos guardados requieren revisión», «SVG no admitido» y «tiempo agotado» deben ofrecer una acción concreta. Un proveedor disponible por metadatos no recibe un indicador de generación funcional.
4. **Revisar unidades internas.** Definir y probar la devolución idempotente cuando no se entrega imagen. El registro debe distinguir reserva, entrega y devolución; nunca inferir factura externa a partir de unidades de Pictos.

### Prioridad 1: preservar trabajo y recuperar bibliotecas

5. **Reconciliar el corpus histórico.** Exportar copia, diagnosticar por campo y versión, revisar equivalencias semánticas, conservar valores originales y pedir aprobación para las correcciones. Empezar por las bibliotecas concretas del taller. Regenerar COMPRENDER solo mediante acción explícita cuando no exista equivalencia fiable. No regenerar automáticamente todas las imágenes.
6. **Retirar Recraft sin perder trabajo.** Aplicar el alcance de retiro descrito más abajo: catálogo, selectores, rutas y trabajos nuevos, configuración y pruebas. Conservar imágenes, SVG, IDs y procedencia histórica. La eliminación del proveedor no debe eliminar archivos ni afirmar que sus SVG ya son canónicos.
7. **Conservar resultados por fase y errores.** Un fallo de imagen no debe obligar a repetir comprensión/composición; un error local debe persistir después de recargar. Verificar recuperación al cambiar de librería, pérdida de conexión, sesión caducada y cierre accidental. Los flujos existentes tienen mecanismos de reintento, pero no se ensayaron todos esos casos aquí.

### Prioridad 2: ensayo y admisión del perfil de taller

8. **Corpus sintético revisado:** 20 frases con acciones simples, negación, dolor, emociones, deixis, ambigüedad local y relaciones entre personas/objetos. Revisar pertinencia y accesibilidad con facilitadores. Evitar datos personales de participantes en el ensayo técnico.
9. **Comparar el perfil existente con un candidato nuevo**, con dos repeticiones por frase y medición por fase. Base: Haiku 4.5 / Haiku 4.5 / GPT Image 2 baja, ya observado en producción. Candidato: GPT-6 Luna / GPT-6 Luna / GPT Image 2.5 Flare baja, con componentes probados directamente pero aún sin integración completa. Evaluar Nano Banana 2.1 como respaldo de imagen y Gemini 3.8 Flash como alternativa de texto, sin multiplicar todas las combinaciones. Acordar presupuesto antes de la campaña ampliada.
10. **Criterio de aceptación propuesto:** al menos 95 % de recorridos técnicos completos al primer intento en el ensayo; cero pérdida de datos, cobros internos terminales incoherentes o bloqueos sin diagnóstico; P95 de duración definido con el equipo —objetivo inicial de 60 s—. Medir por separado tasa de validación y adecuación comunicativa; la revisión humana decide esta última.
11. **Ensayo de concurrencia real:** reproducir número de equipos y ritmo esperado del taller. Comenzar con concurrencia acotada y aumentarla mientras se miden 429, colas y latencia. Revisar límites compartidos de la cuenta, no solo la cuota de cada participante. No se hizo prueba de carga en esta sesión.
12. **Operación del taller:** perfil fijado y visible; respaldo ya probado; precarga de una selección de pictogramas y exportación local de las librerías. Ante error, conservar frase y fases previas, informar al facilitador y cambiar al respaldo explícitamente. Un modo sin generación debe permitir continuar la conversación y edición con material disponible.

## Validación técnica y límites

- `npm test`: **214 pruebas, 209 pasan, 5 omitidas, 0 fallos**.
- `npm run test:schemas`: pasan las pruebas de NLU, composición y MF-SVG, incluyendo sincronización de contratos embebidos.
- Se completaron dos recorridos de tres fases en producción y pruebas puntuales de dos proveedores adicionales de texto y generación vectorial.
- No se ensayaron todas las combinaciones ni calidad media/alta de OpenAI, todas las variantes Recraft, Terra/Sol, Opus o una estructuración exitosa con visión. No hubo prueba de carga ni revisión participativa del significado de las imágenes.
- El motivo exacto de los nueve finales sin imagen no es recuperable de los registros actuales. El atributo concreto que produjo el rechazo del SVG sintético tampoco se conservó. Ambos límites se traducen en tareas verificables del plan, no en causas supuestas.
- La carpeta `research/` está excluida de Git: sus evidencias requieren conservación separada si se comparte o versiona este informe.

## Ampliación: documentación actual y disponibilidad de modelos nuevos

### Qué se verificó y qué significa disponibilidad

Comprobaciones del 22 de octubre de 2026, entre aproximadamente 15:31 y 15:35 de Chile. Se utilizaron las credenciales de la configuración local del proyecto. **No se compararon nuevamente con las credenciales desplegadas en producción**; los resultados de esta sección corresponden a llamadas directas, sin pasar por los endpoints de Netlify, los selectores ni la persistencia de Pictos.

Se distinguen cuatro niveles:

1. **Documentado:** el proveedor publica el modelo y sus capacidades.
2. **Visible o accesible con estas credenciales:** listado autenticado de modelos o countTokens satisfactorio. No acredita cuota de generación ni respuesta útil.
3. **Probado puntualmente:** se obtuvo salida válida para una fase o una imagen real en una muestra sintética.
4. **Admitido para taller:** requiere integración, ensayo representativo, concurrencia y revisión humana. Ningún modelo nuevo alcanzó este nivel durante la investigación.

OpenAI y Anthropic respondieron HTTP 200 a sus listados autenticados. Vertex respondió 200 a countTokens para Gemini 3.8 Flash, 3.5 Flash, 3.5 Flash-Lite, 4 Argon, Nano Banana 2.1 y 3.1 Flash-Lite Image; volvió a responder 404 para 2.5 Pro. No se generaron imágenes durante esa comprobación de disponibilidad.

Después se hicieron ocho comprobaciones acotadas: una validación de solicitud con count_tokens de Anthropic, cinco generaciones de texto y dos de imagen. No hubo reintentos para buscar un resultado exitoso. Se detuvo la cadena de Haiku 5.5 cuando falló su primera validación.

Evidencia local: research/modelos-2026-10-22/disponibilidad.json y smoke-results.json. Incluyen fechas, modelo solicitado/devuelto, HTTP, consumo disponible, latencia y resultado de validación. No contienen credenciales. El valor concreto incorrecto de temporalidad de Haiku no quedó conservado; sí la ruta y el diagnóstico del validador.

### Matriz de candidatos nuevos

| Modelo | Disponibilidad comprobada con credenciales locales | Prueba funcional realizada | Decisión propuesta |
|---|---|---|---|
| GPT-6 Luna, gpt-6-luna | Figura en Models API | COMPRENDER válido: 9,624 s; COMPONER válido: 4,205 s | Primer candidato de texto para ensayo integrado. |
| GPT-6.1 Sol, gpt-6.1-sol | Figura en Models API | No se generó texto en esta investigación | Candidato de mayor capacidad para evaluación posterior, especialmente visión; no añadirlo como opción certificada. |
| GPT-6 Astra, gpt-6-astra | Figura en Models API | No probado funcionalmente | No necesario para el perfil mínimo de taller. |
| Claude Haiku 5.5, claude-haiku-5-5 | Figura en Models API, con capacidades y límites | HTTP 200, herramienta invocada, 3,180 s; NLU rechazado por /visual_guidelines/temporal | Mantener en evaluación; conservar Haiku 4.5 como base hasta corregir y medir la conformidad. |
| Claude Sonnet 5.5, claude-sonnet-5-5 | Figura en Models API | count_tokens con la solicitud forzada actual: HTTP 400 | Bloqueado por incompatibilidad del adaptador; no basta cambiar el ID. |
| Claude Opus 5.5 / Fable 5.1 | Figuran en Models API | Sin generación ni prueba de contrato local | No prioritarios; la documentación también rechaza herramienta forzada. |
| Gemini 3.8 Flash, gemini-3.8-flash | countTokens: 200 | Con thinkingLevel LOW: COMPRENDER válido en 13,406 s y COMPONER válido en 25,185 s | Reemplazo de texto de Google a ensayar con adaptación explícita; medir latencia. |
| Gemini 3.5 Flash / 3.5 Flash-Lite | countTokens: 200 | Sin generación | Alternativas de evaluación; no se comprobó el contrato de Pictos. |
| Gemini 4 Argon | countTokens: 200 | Sin generación | Disponible para explorar, sin necesidad acreditada para el taller. |
| GPT Image 2.5 Flare, gpt-image-2.5-flare | Figura en Models API, incluido snapshot fechado | Imagen PNG real, calidad baja, 1024×1024: 8,501 s | Primer candidato nuevo de imagen. |
| GPT Image 2.5 Sunburst, gpt-image-2.5-sunburst | Figura en Models API, incluido snapshot fechado | Sin generación | Evaluar si se necesita edición precisa; no incorporarlo al perfil mínimo solo por novedad. |
| Gemini Nano Banana 2.1, gemini-nano-banana-2.1 | countTokens: 200 | PNG real a 1K, HTTP 200, STOP: 14,561 s | Candidato de imagen de otro proveedor para respaldo. |
| Gemini 3.1 Flash-Lite Image | countTokens: 200 | Sin generación | Candidato económico pendiente de prueba de imagen. |

Los tiempos son de una llamada por fase y no incluyen Netlify ni interfaz. Las dos pruebas de imagen usaron el mismo prompt sintético breve, no el prompt completo de una librería ni las salidas de las nuevas fases 1/2. **No se suman esos tiempos para afirmar un nuevo recorrido completo validado.**

Las imágenes se inspeccionaron visualmente: muestran una persona, un recipiente con agua y el gesto solicitado, sin texto visible. Eso no certifica el significado para usuarios de CAA ni la distinción taza/vaso. Archivos: research/modelos-2026-10-22/gpt-image-2.5-flare.png y gemini-nano-banana-2.1.png.

### Cambios documentados que afectan la integración

**Sonnet 5.5: ruptura de la herramienta forzada.** La guía de migración rechaza tool_choice de tipo tool o any. Se reprodujo el error exacto con la solicitud NLU de Pictos en count_tokens: «tool_choice: type "tool" and "any" are not supported for this model». La propuesta del proveedor es auto con herramienta estricta o salidas estructuradas. Auto puede producir texto sin herramienta; el cliente actual exige el bloque de herramienta. Se necesita una adaptación explícita y pruebas de rechazo, no modificar solo el catálogo. Su razonamiento también viene activado de forma predeterminada y consume parte de max_tokens. [Guía de migración de Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide).

**Haiku 5.5: acepta la solicitud, pero no garantiza el contrato.** Su guía permite herramienta forzada, que omite el razonamiento previo. La prueba confirmó que se aceptó, pero la salida incumplió una enumeración canónica. La fase 2 no se ejecutó. La migración debe revisar restricciones de salida y ejemplos, sin ensanchar las enumeraciones solo para aceptar respuestas incorrectas. El nuevo tokenizer también cambia el consumo del mismo texto. [Guía de Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide).

**Nueva versión de API de Anthropic.** La documentación publica la versión 2026-10-21, que elimina temperature, top_p y top_k. El SDK instalado envía por defecto 2023-06-01; esa fue también la versión utilizada en las sondas. Pictos no envía esos parámetros de muestreo en el proxy leído, por lo que no se identificó aquí ese cambio como causa del fallo actual. Actualizar SDK y versión API debe ser una tarea separada con regresiones, no un cambio implícito al seleccionar modelos. [Historial de versiones](https://platform.claude.com/docs/en/api/versioning).

**Gemini 3.8 Flash: razonamiento por nivel.** La guía requiere sustituir el presupuesto entero por thinking_level; LOW, MEDIUM y HIGH están admitidos, MINIMAL no. La solicitud REST probada usó thinkingConfig.thinkingLevel: LOW, conservando las herramientas y la proyección de esquemas existentes. Las fases 1/2 pasaron. El adaptador de Pictos sigue emitiendo thinkingBudget, así que no está preparado para habilitar 3.8 mediante un simple cambio de nombre. [Guía oficial de Gemini 3.8](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash).

**GPT-6: Responses sigue siendo la ruta apropiada.** Pictos ya usa Responses y esfuerzo low, compatibles con el candidato probado. La prueba preparó el cuerpo con el adaptador existente y sustituyó el ID únicamente en la sonda directa; no cambió su lista de admisión. GPT-6.1 Sol no acepta esfuerzo none y requiere Responses para herramientas. Mantener parámetros por modelo y validar la respuesta canónica sigue siendo necesario. [GPT-6](https://developers.openai.com/api/docs/guides/latest-model), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

**Imagen nueva de OpenAI.** Flare y Sunburst están documentados y listados para estas credenciales; Flare respondió a la misma forma básica de solicitud que usa GPT Image 2. Los nuevos modelos ofrecen calidades adicionales, pero eso no obliga a exponerlas: baja a 1024×1024 es el candidato acotado probado. El adaptador actual solo admite gpt-image-2. [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).

**Nano Banana 2.1 es un modelo de imagen, no de análisis NLU.** Su ficha no admite function calling ni structured output. Es candidato para PRODUCIR; no debe aparecer en COMPRENDER, COMPONER o ESTRUCTURAR por tratarse de un modelo Gemini. No admite seed, temperature, topK, topP ni logprobs; la sonda omitió esos campos y generó imagen. [Ficha oficial](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1).

Esta revisión contrasta la documentación vigente con el catálogo local, cuyas tarifas estaban fechadas el 27 de agosto. No se dispone de una instantánea completa de aquellas páginas para atribuir cada cambio documental a un día concreto.

### Costos relevantes para decidir

Referencias estándar consultadas el 22 de octubre, en USD; no son factura ni garantía de costo por tarea:

| Modelo | Entrada / salida de texto, por millón de tokens | Condición relevante |
|---|---|---|
| GPT-6 Luna | 0,10 / 0,50 | Caché, contexto y consumo efectivo se calculan aparte. |
| GPT-6.1 Sol | 2 / 10 | No hace falta pagar este nivel para todas las frases sin compararlo antes. |
| Haiku 5.5 | 0,10 / 0,50 | Hasta 100.000 tokens de prompt; por encima se publican 0,50 / 2,50. La tarifa menor no compensa una salida inválida. |
| Sonnet 5.5 | 2 / 10 | Menor tarifa base que Sonnet 4.6, con una migración de contrato necesaria. |
| Gemini 3.8 Flash, global | 0,75 / 3,75 hasta el 31-12-2026 | La tabla anuncia 1,50 / 7,50 desde el 01-01-2027; incluir la fecha en el catálogo. |

[Tarifas Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [tarifas Google](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Flare publica 5 USD por millón de tokens de texto de entrada y 30 USD por millón de tokens de imagen de salida. Su muestra informó 60 y 196 tokens respectivamente: unos **0,00618 USD estimados**, sin impuestos. Nano Banana 2.1 publica aproximadamente 0,034 USD de salida de imagen a 1K, más entrada y eventual razonamiento; la muestra incluyó 960 tokens de pensamiento. No usar solo el costo de imagen como costo total ni extender estas muestras a otra calidad o resolución.

## Retiro propuesto de Recraft

Se elimina de la propuesta futura, no de la historia del trabajo. **No se ha ejecutado este retiro.**

Alcance que debe cubrir una futura implementación:

- Catálogo y tipos de modelos, selectores, precios, configuración de style_id y mensajes de interfaz.
- Despacho de generación en services/imageGenerationService.ts y services/aiClient.ts; servicio Recraft y generador compartido.
- Endpoints api-recraft-worker-background y api-recraft-poll, diagnóstico api-check y autorización de trabajos.
- Rutas de lote y pipeline del servidor, contratos publicados de API, fixtures y pruebas que hoy admiten Recraft.
- Configuraciones guardadas: reconocer un modelo retirado y solicitar un reemplazo para generaciones futuras. No regenerar imágenes ni cambiar su etiqueta histórica.
- Conservar lectura/exportación de SVG e imágenes existentes, IDs de filas y enlaces de secuencias y tableros. Mantener los controles generales de SVG.
- Resolver trabajos en curso antes de retirar su lectura de resultados; después revisar credenciales y configuración de despliegue. No borrar almacenes históricos como parte de quitar el proveedor.

La búsqueda estructural local encontró referencias en catálogo, App.tsx, tipos, servicios, funciones, configuración, locales y pruebas; también en schemas/pictos-api/pictos-api-common-1.0.0.schema.json. No se propone borrar documentación histórica, registros de uso ni bibliotecas para conseguir una búsqueda sin coincidencias.

El recorrido de vector futuro puede seguir siendo imagen → VTracer local → revisión/edición → estructuración cuando proceda. Quitar Recraft no obliga a perder el editor ni a regenerar lo ya dibujado.

## Rescate de bibliotecas: reparar antes que regenerar

### El trabajo no está perdido por incumplir el esquema

La revisión adicional de los 21 archivos de biblioteca con filas encontró lo siguiente entre las **826 apariciones con NLU incompatible**:

| Material presente en la fila | Apariciones |
|---|---:|
| Bitmap no vacío | 824 |
| Elementos y prompt no vacíos | 824 |
| SVG crudo en la propia fila | 9 |
| SVG estructurado en la propia fila | 3 |

Las categorías se superponen. No se contaron aquí todos los SVG del contenedor separado ni se decodificaron todos los bitmaps; son indicadores de presencia, no certificados de integridad. Los conteos corresponden a archivos locales, con duplicados entre bibliotecas; no describen automáticamente todo el almacenamiento privado de Chrome.

El conjunto de diagnósticos del validador documental estuvo dominado por enum (6.341 incidencias), seguido por type (239), minProperties (8) y unevaluatedProperties (1). Son incidencias, no filas distintas. Muchos valores contienen decisiones útiles: por ejemplo, una intención expresada en una frase larga no debe perderse al clasificarla en un vocabulario controlado.

Una simulación en memoria, sin guardar cambios, corrigió solo diferencias de mayúsculas en valores que coincidían exactamente con una opción del esquema al ignorar el caso. Detectó **812 campos corregibles en 435 apariciones de filas**. Sin embargo, **ninguna de las 826 filas quedó completamente válida solo con eso**. Habrá que tratar también vocabularios antiguos y descripciones libres.

Ejemplos observados:

- Directive → directive o Informal → informal son candidatos mecánicos claros, siempre preservando el original.
- AHORA / ahora / NOW → immediate y Futuro cercano → near_future son equivalencias propuestas que deben aprobarse antes de aplicarlas.
- Una intención como «Solicitar inversión de la ruta de viaje debido a una parada omitida» requiere clasificar y conservar esa explicación, no reemplazarla a ciegas ni borrarla.
- Una forma antigua como acknowledgement exige revisar el vocabulario actual; no toda diferencia ortográfica o de idioma autoriza una equivalencia semántica.

### Precaución nueva: no todos los respaldos reúnen las imágenes

La inspección del código identificó dos rutas diferentes:

- **Desde la librería abierta, menú Librería → Exportar librería (.json):** exportProject reúne las filas actualmente cargadas, la configuración, SVG, secuencias y tableros mediante createGraphDump. Es la ruta preferible para rescatar el contenido hidratado visible.
- **Descarga desde la portada:** handleDownloadLibrary llama a exportLibraryJson, que lee getLibraryRows desde localStorage y no consulta IndexedDB. El guardado ordinario separa bitmap, rawSvg y structuredSvg de esos metadatos. Por ello esa descarga puede carecer de imágenes propias almacenadas en IndexedDB.
- **Duplicar desde la portada:** duplicateLibrary copia esos metadatos y no copia los almacenes de binarios en la función inspeccionada. No usarla como única copia de rescate. No se hizo un ensayo de duplicación en Chrome para medir eventuales recuperaciones por otras rutas.

Referencias de código: App.tsx, funciones exportProject y handleDownloadLibrary; services/libraryService.ts, funciones exportLibraryJson, duplicateLibrary y getLibraryRows; services/libraryTransferService.ts, createGraphDump. Este es un hallazgo de lectura del código; **no se corrigió**.

Hasta ensayar importación y medios, ni siquiera la exportación de la librería abierta debe darse por respaldo íntegro solo porque terminó una descarga.

### Qué puede hacer el usuario ahora

1. Abrir cada librería importante y esperar a que sus pictogramas sean visibles.
2. Desde esa librería abierta: Librería → Exportar librería (.json). Guardar el archivo con nombre y fecha; conservarlo sin editar.
3. Descargar además los pictogramas y las frases desde el mismo menú. El PDF es un respaldo visual adicional, pero no reemplaza los datos editables.
4. Conservar las copias en una segunda ubicación. No limpiar datos del sitio, borrar la librería ni usar «regenerar todo» durante el rescate.
5. Probar la recuperación en un entorno separado de la biblioteca original: mismo número de filas, frases, imágenes, SVG, secuencias y tableros. La importación de la librería abierta advierte que reemplaza contenido; no ensayarla encima del original.

En esta sesión no se ejecutó ese respaldo completo ni se afirmó que el almacenamiento privado de Chrome esté ya recuperado.

### Reparación por capas, propuesta

| Capa | Acción propuesta | Material que se conserva |
|---|---|---|
| 0. Congelar y verificar | Copia original, inventario y hashes de archivos/medios; prueba de restauración | Todo, sin cambio semántico ni llamada a IA. |
| 1. Corrección mecánica | Aplicar equivalencias exactas y aprobadas en una copia; producir diff por fila | Frase, imágenes, SVG, estilo, IDs y valores previos en el registro de migración. |
| 2. Reconciliación semántica | Clasificar descripciones libres y roles antiguos, con propuesta revisable | Explicaciones originales y decisiones de participantes. |
| 3. Regeneración selectiva de NLU | Solo si no hay una equivalencia fiable; generar una versión candidata desde la frase exacta | El NLU original y todos los medios, sin sobrescribirlos. |
| 4. Composición, si hace falta | Reparar/regenerar una versión candidata de elementos y prompt; comparar IDs y conceptos | Composición original, imagen existente y relaciones con otros artefactos. |
| 5. Imagen, como última opción | Regenerar solo filas cuya imagen falte o cuya comunicación se quiera revisar explícitamente | Original visual y candidata, identificadas por separado. |

Una nueva descripción semántica no acredita que la imagen anterior la represente. Si cambia el NLU o la composición, marcar la relación como pendiente de revisión. Si cambian IDs de elementos, revisar bindings y estructuración; si cambian IDs de filas, se pueden romper secuencias y tableros. La reparación debe conservar los IDs de filas y resolver los de elementos con un mapa explícito cuando corresponda.

Las correcciones mecánicas no deberían requerir IA ni gastar generación. Para la reconciliación semántica, la IA puede proponer una correspondencia, pero el validador solo prueba estructura: la revisión humana decide si preserva la intención. No eliminar campos desconocidos sin archivar primero su contenido ni completar datos inventados para lograr un indicador verde.

### Piloto de rescate antes de procesar todo

- Seleccionar una librería prioritaria del taller y diez filas: casos de mayúsculas, descripciones libres, roles tipados de forma antigua, imágenes valiosas y relaciones con secuencias/tableros.
- Inventariar medios y dependencias; obtener original y copia de trabajo verificadas.
- Generar un informe por fila con antes/después, regla aplicada, campos pendientes y costo de cualquier propuesta de IA. Mantener intentos fallidos.
- Validar contratos documental, de composición y, cuando corresponda, MF-SVG. Revisar visualmente que las imágenes retenidas tengan los mismos bytes y que sus referencias sigan funcionando.
- Aprobar o rechazar cada cambio semántico antes de importar la copia reparada. Medir cuántos casos se resuelven sin imagen nueva.
- Ampliar por lotes pequeños, con registro de migración y posibilidad de volver a la copia anterior.

**Criterio de éxito:** recuperar el uso y la editabilidad del trabajo existente con el menor cambio semántico necesario. No se exige regenerar imágenes para declarar reparados los metadatos; tampoco se declara reconciliada una imagen solo porque pasó un esquema.

## Secuencia de acción propuesta y criterios de cierre

Todas las acciones de esta tabla están **pendientes de implementación o ejecución**, salvo las investigaciones registradas en el cuerpo del informe.

| Orden | Acción | Criterio de cierre |
|---|---|---|
| 1 | Respaldar las librerías prioritarias desde la vista abierta y verificar su restauración | Inventario de frases y medios coincide; original preservado. |
| 2 | Corregir exportación/duplicación para reunir binarios, antes de una migración masiva | Regresión con biblioteca de medios propios en IndexedDB, sin depender de una plantilla remota. |
| 3 | Diagnóstico de intentos, respuestas sin imagen y devolución de unidades internas | El facilitador distingue fallo local, contrato, indisponibilidad y proveedor, con referencia exportable. |
| 4 | Retirar Recraft y los modelos retirados de nuevas generaciones | No se pueden iniciar trabajos nuevos con ellos; archivos anteriores siguen accesibles. |
| 5 | Implementar el piloto de rescate de diez filas | Contratos válidos donde proceda, cambios revisados y medios originales preservados. |
| 6 | Integrar GPT-6 Luna y Flare como candidatos, con parámetros y tarifas por modelo | Endpoints individuales/lote/API que correspondan, selectores y regresiones coherentes; no solo sondas directas. |
| 7 | Adaptar Google a thinkingLevel y evaluar Nano Banana 2.1 | Contrato y generación probados en las rutas reales de Pictos, con errores de finalización conservados. |
| 8 | Dejar Haiku 5.5 y Sonnet 5.5 detrás de sus respectivos cercos | Enumeración de Haiku resuelta y medida; estrategia de contrato compatible para Sonnet, antes de ofrecerlos. |
| 9 | Ensayo representativo y simultáneo del perfil de taller | Cumple criterios de éxito, latencia y recuperación acordados; revisión comunicativa con facilitadores. |
| 10 | Ampliar rescate y desplegar por etapas | Copias verificadas, registro de cambios, respaldo funcional y posibilidad de volver atrás. |

No se ha cambiado código de aplicación, configuraciones desplegadas ni archivos de biblioteca como resultado de esta ampliación. Los resultados directos de modelos nuevos no acreditan por sí solos disponibilidad en producción ni fiabilidad para un taller.

## Brief: consumo, presupuestos y saldos dentro de /admin

**Fecha:** 22 de octubre de 2026. **Estado:** propuesta para implementación; este brief no modifica la aplicación ni activa integraciones de facturación.

### Objetivo y decisiones de producto

Ampliar la página existente /admin para que quien administra Pictos pueda preparar y acompañar un taller sabiendo cuánto se ha gastado, qué presupuesto queda y qué servicios están fallando. La pantalla debe permitir decidir cuándo recargar una cuenta, reducir el ritmo o cambiar a un perfil de modelos previamente validado.

Mantener /admin como punto único de administración, reutilizando su diseño, filtros y reporte de uso. Proveedores activos previstos: OpenAI, Anthropic y Google Vertex AI. Recraft permanece consultable en el historial, sin nuevas integraciones de saldo ni acciones para generar.

La primera entrega debe funcionar con consumo estimado y saldos registrados manualmente. La automatización de facturación se incorpora por proveedor después de verificar capacidades y permisos reales de cada cuenta; no es condición para entregar un panel útil para los talleres.

### Base existente y correcciones necesarias

Inspección estática realizada para este brief:

| Superficie | Lo que ya existe | Trabajo propuesto |
|---|---|---|
| public/admin.html | Acceso administrativo, rangos 7/14/30 días, indicadores, gráfico diario, mapa horario UTC, tablas de modelos y usuarios | Ampliar con resumen financiero, tarjetas por servicio y presupuesto de taller; conservar detalle operativo. |
| public/admin.js: loadData y refresh | Consolida reportes de dominios, llamadas, unidades, errores y latencia media; avisa de datos parciales | Agregar filtros y fuentes financieras sin sumar dos veces registros o cuentas compartidas. Mantener visible la cobertura de datos. |
| netlify/functions/api-usage-report.js: handler | Consulta autenticada por rango; agregados por usuario, modelo, fecha y hora | Extender el contrato de forma compatible para incluir costos y cobertura; mantener autorización en servidor. |
| Registro de uso y rutas de generación descritos en este informe | Eventos de proveedor, con vacíos de observabilidad ya identificados | Correlacionar intento, fase, respuesta y validación final; cubrir respuestas sin imagen y errores del navegador. |

**Corrección concreta:** loadData calcula maxDayUnits usando el total del rango por dominio, aunque la tabla lo presenta como consumo máximo diario. Sustituirlo por el máximo diario real por usuario o cambiar la etiqueta mientras no exista ese dato. No utilizar esta aproximación para límites ni decisiones económicas.

### Pantalla propuesta

Orden de lectura dentro de /admin:

1. **Filtros:** hoy, 7/14/30 días y rango personalizado; entorno/dominio; proveedor; modelo; fase; taller. Zona de presentación America/Santiago, conservando timestamps UTC. Los agregados diarios deben recalcularse para la zona elegida: cambiar solo el texto UTC no basta.
2. **Resumen:** gasto estimado de Pictos en el período, presupuesto restante del taller seleccionado, generaciones completadas y fallidas. Mostrar cobertura del cálculo y actualización de la fuente. Las unidades internas siguen visibles con ese nombre.
3. **Tarjetas de servicio:** gasto estimado atribuible a Pictos; consumo reportado por proveedor cuando exista; saldo o crédito disponible cuando aplique; fuente, alcance de cuenta/proyecto y fecha; estado de sincronización; enlace verificado a la consola del proveedor.
4. **Presupuesto del taller:** nombre, fechas, importe y moneda, gasto atribuible y remanente. Avisos visibles al alcanzar 50 %, 80 % y 100 %. En la primera entrega son avisos, no bloqueos automáticos de generación.
5. **Detalle operativo:** tablas actuales ampliadas por modelo y fase con intentos, éxitos finales, fallos, latencia y costo estimado; historial diario de gasto y listado de errores con referencia diagnóstica. Separar errores locales, de esquema, de proveedor y trabajos sin resultado final conocido.
6. **Exportación:** CSV del resumen y detalle filtrado, con moneda, zona horaria, procedencia, cobertura y fecha de corte. No incluir frases de participantes, prompts, imágenes ni credenciales.

Estados obligatorios: cargando, sin actividad, datos parciales, fuente desconectada, dato desactualizado y no disponible. Un saldo desconocido se muestra como «No disponible», nunca como cero. Una consulta fallida puede conservar el último dato, rotulado con su fecha y estado; no debe aparecer como recién actualizado.

### Qué significa cada cifra

| Concepto | Regla de presentación y cálculo |
|---|---|
| Unidades internas | Contabilidad de límites de Pictos. No equivalen a dólares ni al saldo externo. Registrar débitos y devoluciones por separado. |
| Costo estimado de Pictos | Uso medido por solicitud multiplicado por tarifas aplicables a su modelo, modalidad y fecha. Incluir categorías de caché, razonamiento e imagen cuando sean facturables. Uso ausente queda sin estimación, no con costo cero. |
| Consumo reportado por proveedor | Importe y período recibidos de una fuente de facturación, con su alcance y latencia. Puede incluir otras aplicaciones de la misma cuenta; no sumarlo al costo estimado como si fuera gasto adicional. |
| Saldo del proveedor | Crédito disponible según una fuente y fecha concretas. Admitir cuentas de pago posterior sin saldo prepago: mostrar esa modalidad y el gasto disponible, sin inventar un saldo. |
| Saldo manual | Importe registrado por un administrador, moneda, cuenta, fecha de referencia y autor. Mostrar «Manual». Una proyección descontando gasto posterior debe llamarse «Proyección» y advertir que no contempla usos externos a Pictos. |
| Presupuesto restante | Presupuesto del taller menos costo atribuible calculado sobre una base consistente. Mantener el valor negativo cuando se exceda; no ocultar el exceso. |
| Disponibilidad operativa | Resultado y fecha de llamadas recientes por modelo/fase. Tener crédito no prueba disponibilidad, cuota ni compatibilidad de esquema. |

Usar USD para las estimaciones iniciales de tarifas ya investigadas; preservar la moneda original de saldos y facturas. No sumar monedas distintas. Una conversión a CLP queda fuera de la primera entrega. Identificar si un importe incluye impuestos; no asumirlo. Versionar tarifas para no recalcular silenciosamente el pasado al cambiar precios.

No presentar «pictogramas restantes» como cifra cierta: cada pipeline puede tener fases, reintentos y costos diferentes. Una estimación futura exigiría un perfil y un costo observado representativos.

### Datos mínimos y atribución

Cada intento necesita identificador único y correlación con trabajo y fase; fecha; entorno; proveedor y cuenta/proyecto identificados mediante un alias sin secretos; modelo solicitado y modelo efectivo si se informa; duración; estado del proveedor y estado final de Pictos; categorías de uso; estimación con moneda y versión de tarifa; unidades internas debitadas/devueltas; referencia de error y asociación opcional a taller/biblioteca mediante identificadores opacos.

El registro debe distinguir un reintento nuevo de la repetición del mismo evento: cada llamada real puede costar, pero un poll repetido o una entrega duplicada de telemetría no debe volver a contabilizarla. Registrar una respuesta de proveedor exitosa y un rechazo posterior de esquema como dos estados del mismo intento, sin duplicar su costo. Una devolución de unidades internas no acredita un reembolso externo.

La asociación a talleres requiere capturar un identificador al iniciar nuevos trabajos; un filtro en /admin por sí solo no crea esa información. Los registros anteriores sin atribución quedan como «Sin taller». Para una primera entrega, permitir presupuesto por rango y entorno, claramente rotulado como aproximación que puede incluir otras actividades; habilitar atribución exacta cuando el identificador viaje por todo el pipeline.

Guardar presupuestos y anotaciones manuales en servidor, con persistencia y registro de cambios; no depender del almacenamiento del navegador del administrador. Las credenciales de proveedores y de facturación permanecen en servidor. Reutilizar la autorización administrativa y comprobarla en todas las nuevas lecturas y escrituras. Mantener las bibliotecas y el contenido de participantes fuera del registro financiero.

### Integraciones por servicio: alcance por verificar

Esta tabla es una lista de investigación e implementación, no una afirmación de que las cuentas actuales permitan consultar saldos por API.

| Servicio | Primera entrega | Verificación previa a automatizar |
|---|---|---|
| OpenAI | Uso estimado por modelo; saldo manual opcional; acceso a consola | APIs oficiales de uso/costos y eventual saldo, permisos administrativos, alcance de proyecto/organización, retrasos y paginación. |
| Anthropic | Uso estimado por modelo; saldo manual opcional; acceso a consola | APIs oficiales disponibles para uso/costos y crédito, permisos de cuenta/workspace y retrasos. |
| Google Vertex AI | Uso estimado por modelo/proyecto; modo de facturación y anotación manual de créditos si corresponde | Fuentes oficiales de Cloud Billing, exportación de costos/créditos, permisos de cuenta/proyecto y latencia. Distinguir créditos promocionales, presupuesto y cuotas de modelos. |
| Recraft | Consumo histórico, con calidad del dato indicada | No desarrollar conexión nueva; conservar trazabilidad de lo ya generado. |

Documentar por integración la fuente oficial consultada, fecha, permisos mínimos, costo operativo si lo hubiera y una prueba de lectura con la cuenta real. Si no existe una fuente soportada de saldo, mantener el ingreso manual; no depender de scraping de consolas. Una sincronización financiera no debe generar imágenes ni consumir cuota de generación.

### Plan de entrega

| Etapa | Entregable | Condición para avanzar |
|---|---|---|
| 1. Contabilidad fiable | Corregir máximo diario, definir eventos, correlación, cobertura y tarifas; cerrar vacíos de error prioritarios | Casos reproducibles de éxito, error, reintento, respuesta sin imagen y validación fallida contabilizados correctamente. |
| 2. Dashboard mínimo en /admin | Resumen de costos estimados, tarjetas por servicio, saldos manuales con fecha, presupuesto por período, alertas visibles y CSV | Datos faltantes y monedas distintas tratados explícitamente; persistencia y permisos comprobados. |
| 3. Atribución por taller | Identificador de taller propagado por generación, eventos y filtros; presupuesto exacto para nuevos trabajos | Dos talleres simultáneos pueden distinguirse sin atribuir el gasto de uno al otro. |
| 4. Facturación automática | Conectar únicamente fuentes oficiales verificadas, una por vez; conciliación con estimaciones | Comparación documentada de un período común, diferencias explicadas y fallos de sincronización visibles. |
| 5. Ensayo de taller | Revisión con facilitador y datos representativos | En menos de un minuto puede reconocer gasto, presupuesto, antigüedad del saldo y proveedor/fase con problemas. |

Responsabilidades propuestas: desarrollo mantiene eventos, agregaciones e interfaz; administrador de cuentas verifica permisos y fuentes financieras; responsable del taller define presupuesto y revisa la utilidad de alertas. No se asignan personas ni fechas sin acordarlas.

### Criterios de aceptación

- /admin conserva sus reportes operativos y permite filtrar gasto por proveedor, modelo, fase y entorno; filtro de taller solo ofrece atribución con cobertura explícita.
- Un caso de tres fases muestra una generación final y tres intentos cuando corresponda; un reintento agrega su costo real, no duplica eventos anteriores.
- Una respuesta sin imagen o un NLU rechazado no se presenta como generación completada, aunque el proveedor haya respondido HTTP 200.
- Una tarifa desconocida, fuente caída o saldo ausente no reduce artificialmente el total: se indica cuántos intentos quedaron sin estimar.
- No se duplican gastos al consolidar dominios que leen una misma fuente ni saldos de una cuenta compartida.
- El máximo diario se calcula sobre días reales y el rango respeta America/Santiago, incluidos cambios de horario.
- Un presupuesto de USD 10 con gasto atribuible de USD 8 muestra USD 2 restantes y aviso del 80 %; con USD 11 muestra exceso de USD 1. El aviso no se confunde con un bloqueo.
- Editar un saldo manual conserva autor, fecha y valor anterior; una sincronización fallida no borra el último valor ni actualiza falsamente su fecha.
- El CSV coincide con los filtros y totales visibles e identifica estimaciones y fuentes; las credenciales y contenidos de participantes no aparecen en respuestas ni exportaciones.
- Navegación por teclado, etiquetas accesibles y estados con texto; el significado no depende solo del color.

**Fuera de la primera entrega:** recargas o compras automáticas, bloqueo estricto por presupuesto, notificaciones externas, conversión de monedas y estimación de autonomía en pictogramas. Un bloqueo futuro necesita reservar costo para trabajos concurrentes y resolver solicitudes ya enviadas; una barra de presupuesto no basta.

**Límites de este brief:** se verificó la base de /admin mediante lectura del código. No se probaron APIs de facturación ni saldos de cuentas, no se diseñó una maqueta visual y no se implementó el dashboard. La cobertura incompleta del registro actual impide prometer cifras históricas exhaustivas; el panel deberá mostrar esa limitación desde el inicio.
