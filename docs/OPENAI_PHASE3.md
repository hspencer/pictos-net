# OpenAI en PRODUCIR (fase 3)

Revisión: 27 de agosto de 2026. Integración para pruebas locales; sin despliegue.

## Compatibilidad del prompt

La API de imágenes acepta un `prompt` textual de hasta 32.000 caracteres. Puede
contener párrafos, instrucciones, secciones o estructuras tipo JSON, pero no
interpreta nuestro árbol como un esquema de salida obligatorio. Los identificadores
y relaciones espaciales son instrucciones visuales, no garantías geométricas.

Se conserva el prompt de Gemini para comparar proveedores con el mismo enunciado,
contexto NLU, jerarquía de elementos, composición espacial y estilo. No se reejecutan
COMPRENDER ni COMPONER al generar solamente el paso 3. No se corta un prompt largo:
se rechaza explícitamente si supera el límite.

Se usa `POST /v1/images/generations`: una imagen, 1024×1024, PNG, fondo opaco.
No hacen falta Responses, mensajes de chat ni otro modelo para reescribir el prompt.
El resultado es bitmap: VTracer sigue siendo necesario para obtener SVG y luego
estructurarlo. No se añade edición con imágenes de referencia en esta integración.

## Modelo y costo

| Modelo / calidad | Salida 1024×1024, USD | Uso propuesto |
| --- | ---: | --- |
| GPT Image 2 / baja | 0,006 | Primera comparación y pruebas económicas |
| GPT Image 2 / media | 0,053 | Comparar escenas con más relaciones o detalles |
| GPT Image 2 / alta | 0,211 | Evaluación explícita; no seleccionada automáticamente |

Son estimaciones redondeadas de **salida**, no precios totales garantizados.
Se suma el texto de entrada: USD 5 por millón de tokens. La salida se factura
a USD 30 por millón de tokens de imagen; el registro de uso conserva los tokens
reales devueltos por OpenAI, sin inferirlos del tamaño del PNG.

GPT Image 1 Mini (salida baja USD 0,005) y GPT Image 1.5 (baja USD 0,009) todavía
figuran en la documentación, pero están deprecados y se retiran el 1 de diciembre
de 2026. GPT Image 1 se retira el 23 de octubre de 2026. No se agregan como nuevas
opciones recomendadas. DALL·E 2/3 ya alcanzaron su fecha de retiro.

La calidad es un parámetro separado del identificador real `gpt-image-2`.
Por defecto se usa `low` cuando no hay calidad guardada; el modelo existente de
cada biblioteca se conserva. La calidad usada queda registrada por imagen.

## Acceso y pruebas locales

La clave vive únicamente en el servidor: `PICTOS_OPENAI_KEY` (opcional, prioridad)
o `OPENAI_API_KEY`. Nunca usar una variable `VITE_` para claves privadas.
El alias propio evita interferencias con gateways que sustituyan variables estándar.

Iniciar `netlify dev --offline --no-open` y abrir `http://localhost:3000`.
Vite ya redirige `/.netlify` al backend en `http://localhost:9001`.
En esta verificación, abrir la interfaz directamente en 9001 provocó un error
previo del proxy con los módulos de Vite; en 3000 la interfaz carga correctamente.
Seleccionar GPT Image 2 en Configuración avanzada → PRODUCIR y elegir calidad baja.
«Verificar» consulta el modelo, sin generar imágenes; no garantiza que la
organización haya completado la verificación requerida para generar.

Para una comparación controlada, usar la misma fila con fases 1 y 2 completadas;
cambiar solamente proveedor/calidad y ejecutar PRODUCIR. Revisar presencia de cada
elemento, acción y relaciones, ausencia de texto accidental, legibilidad a tamaño
de tablero y facilidad de vectorización. La equivalencia semántica requiere revisión
humana; una respuesta HTTP correcta no la demuestra.

El lote completo de PictoNet usa llamadas normales, sin descuento OpenAI Batch.
El lote diferido de Vertex sigue limitado a Gemini y no sustituye silenciosamente
OpenAI por Gemini. Un error de cuota externa detiene las filas siguientes y conserva
los pasos 1 y 2; las unidades PictoNet sin imagen se devuelven una sola vez.
Esa devolución no implica un reembolso de la factura de OpenAI.

## Verificación realizada

- 118 pruebas automáticas sin llamadas de pago: parámetros, errores, permisos,
  resultado individual, lote completo simulado y devolución de unidades.
- TypeScript, traducciones (761 claves), compilación Vite y `git diff --check`
  correctos. La clave configurada no aparece en los 298 archivos de `dist`.
  La compilación conserva advertencias previas de tamaño, WASM y JSZip.
- Cuatro especificaciones: cero errores y cero hallazgos de `allium analyse`.
  `allium check` termina con código 1 por siete advertencias de referencias a
  entidades externas, además de avisos informativos; no es una validación sin avisos.
- Navegador: modelo y precios visibles, calidad baja inicial, cambio a media
  conservado tras recargar. Se dejó baja nuevamente, sin regenerar la biblioteca.
- Una llamada real al worker y su endpoint de consulta generó «Quiero beber agua»:
  PNG 1024×1024 en aproximadamente 16 segundos, 119 tokens de entrada y 196 de
  imagen. Costo calculado con la tarifa publicada: **USD 0,006475**, no una factura.

La muestra contiene una persona bebiendo, sin texto, pero incluye degradados pese
a solicitar rellenos planos. Falta evaluar consistencia de estilo, fidelidad
semántica en más enunciados y vectorización. No se generaron imágenes reales en
calidad media/alta ni se ejecutó un lote de pago. Para empezar, usar filas
individuales: el lote conserva el límite existente de 15 minutos por función y
no se ha medido su capacidad con OpenAI. No hubo despliegue.

## Fuentes oficiales

- [Guía de generación y tabla de costos](https://developers.openai.com/api/docs/guides/image-generation)
- [Prompts de GPT Image](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [Contrato de la API de imágenes](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Precios por token](https://developers.openai.com/api/docs/pricing)
- [Fechas de retiro](https://developers.openai.com/api/docs/deprecations)
