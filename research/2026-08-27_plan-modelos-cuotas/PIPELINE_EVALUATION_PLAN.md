# Evaluar el proceso escalonado frente al prompt directo

Fecha: 2026-08-27. Estado: protocolo propuesto, **experimento no ejecutado**.

## Juicio e hipótesis

La separación entre comprensión, composición y producción ofrece puntos de
inspección e intervención que una única solicitud de imagen no expone por sí
sola. Esto es una propiedad del diseño. Que produzca imágenes más ajustadas a la
intención comunicativa es una hipótesis empírica, todavía no un resultado de
PictoNet. Tampoco se identifica ajuste semántico con belleza, conformidad JSON,
accesibilidad o facilidad de aprendizaje.

Para «ayúdame a beber», reconocer vaso y agua no basta: hay una petición y una
relación de ayuda. El NLU puede explicitar esa diferencia; la composición decide
qué se hace visible. No toda distinción pragmática podrá comunicarse mediante un
pictograma aislado: deben registrarse las que dependen del tablero, del texto o
del contexto de uso. Un metadato correcto no prueba que la imagen lo comunique.

Las salidas intermedias son representaciones externas utilizadas por el sistema;
no constituyen acceso al razonamiento interno del modelo. Su valor depende de que
se conserven, se consuman realmente y se pueda comprobar el efecto de corregirlas.
Modificar NLU o composición debe invalidar derivados y producir una nueva revisión,
sin confundir la revisión anterior con la actual.

## Evidencia pertinente y sus límites

- [GenEval, Ghosh et al., 2023](https://arxiv.org/abs/2310.11513) evalúa objetos,
  cantidades, posiciones y atributos por separado. Es una referencia para no
  reducir la evaluación a una puntuación global de similitud; no evalúa CAA.
- [CompAgent, Wang et al., 2024](https://arxiv.org/abs/2401.15688) presenta mejoras
  en generación composicional mediante descomposición, planificación espacial,
  herramientas y corrección. Su control del generador difiere de enviarle un
  prompt compuesto: sus resultados no demuestran el desempeño de PictoNet.
- [Jaiswal et al., 2026, prepublicación](https://arxiv.org/abs/2601.15286) reportan
  mejoras mediante correcciones visuales iterativas frente a muestreo paralelo
  con cómputo equiparado. Es evidencia para estudiar realimentación, no para
  concluir que cualquier cadena de pasos mejora una imagen.
- [Alonso Rodríguez et al., 2024](https://riull.ull.es/xmlui/handle/915/40250)
  estudian transparencia y translucidez de 1.525 pictogramas ARASAAC con 521
  participantes. Distinguen inferir el significado sin referente y valorar la
  relación con un referente presentado. Esas tareas orientan la evaluación, pero
  no sustituyen una prueba con las personas y contextos destinatarios de PictoNet.

## Comparación principal

| Condición | Entrada y proceso | Pregunta que permite responder |
| --- | --- | --- |
| A: directo | Intención original + mismo contexto disponible + instrucciones de estilo cuidadas | Referencia sencilla y competitiva, no un prompt deliberadamente pobre |
| B: prompt expandido | Un modelo convierte la misma entrada en una descripción visual, sin contratos intermedios | ¿La mejora procede solo de ampliar el prompt? |
| C: PictoNet automático | NLU → composición → mismo modelo de imagen | ¿La estructura intermedia mejora el resultado sin intervención humana? |
| D: PictoNet intervenido | Misma cadena, con corrección explícita en fases identificadas | ¿La intervención mejora el resultado y facilita corregir errores? |

Una comparación de usabilidad separada debe permitir corregir también la condición
directa, con igual tiempo disponible. Comparar D con A sin permitir correcciones en
A mezclaría el efecto de la arquitectura con el del trabajo humano adicional.

Mantener iguales modelo y versión de imagen, calidad, dimensiones, instrucciones
de estilo, referencias visuales y contexto disponible. Registrar diferencias
inevitables. Repetir generaciones; fijar semillas solo si el proveedor las admite.
Informar dos comparaciones: mismo número de imágenes y mismo presupuesto total
(incluidos análisis, reintentos y edición). Medir coste y latencia reales, no solo
precios nominales. Las versiones y hashes de todos los contratos quedan congelados
para cada experimento.

## Casos y medidas

Comenzar con casos sintéticos revisados: objetos simples, acciones, intercambio de
agente/paciente, negación, petición frente a descripción, relaciones espaciales,
emociones y contexto cultural. Usar pares mínimos, como «quiero beber», «no quiero
beber» y «ayúdame a beber». No dar por supuesto que cada intención admite una
representación autónoma en un único pictograma. El piloto sirve para depurar tareas
y estimar variabilidad; el tamaño del estudio confirmatorio se decide después.

1. **Ajuste semántico:** agentes y destinatarios correctos, acción, objeto, relaciones,
   negación, omisiones y adiciones. Diferenciar lo visible de lo disponible solo en
   metadatos. Registrar errores críticos, no solo promedios.
2. **Comprensión:** interpretación sin mostrar el enunciado y correspondencia con
   referente después; confusiones entre pares mínimos. Evaluación pertinente con
   personas usuarias de CAA, con las autorizaciones de investigación necesarias.
3. **Intervención:** localizar el origen del error, tiempo y acciones para corregir,
   éxito de la corrección y regresiones en contenido que antes era correcto.
4. **Operación:** coste, tiempo, tasas de rechazo contractual y resultados ausentes.
   No excluir del denominador los fallos del pipeline ni seleccionar solo imágenes
   exitosas. Separar intentos de resultados finales.

Presentación aleatoria y evaluación ciega respecto al método; orden contrabalanceado
para evitar aprendizaje del significado. No mostrar metadatos ni etiquetas durante
la tarea de transparencia. Usar criterios acordados antes de generar y evaluadores
independientes del generador; un juez automático puede ayudar al diagnóstico, no
sustituir la evaluación humana de CAA. Informar acuerdo entre evaluadores,
incertidumbre y agrupación por intención y participante, sin tratar réplicas como
observaciones independientes.

## Intervenciones y estudios de componentes

Comparar C con variantes que retiren un componente cada vez (por ejemplo, NSM o
metadatos pragmáticos) manteniendo lo demás fijo. Una representación más extensa no
es necesariamente más útil. Comprobar si las correcciones de roles o relaciones
cambian el prompt enviado y la imagen resultante; validar solo el JSON no demuestra
esa influencia. La cadena actual llega al generador de imágenes principalmente
como descripción textual: no impone por sí sola restricciones geométricas duras.

Evaluar la imagen de fase 3 y el SVG final por separado: vectorizar, reagrupar o
redibujar puede alterar legibilidad o contenido. El SVG canónico permite vincular
intención, decisiones externas y revisión exacta; no certifica eficacia cognitiva.

## Relación con el corpus soberano

Guardar éxitos, fallos y correcciones con sus versiones y hashes, sin convertir una
salida automática en etiqueta humana. Mantener familias de derivados y duplicados
en una misma partición de datos. Las bibliotecas históricas son material para
diagnóstico, no un conjunto de entrenamiento autorizado o validado por defecto.

Resultado esperado del estudio: identificar **para qué intenciones, personas y
condiciones** compensa la cadena escalonada. Si para un objeto simple el prompt
directo resulta igual de comprensible y más económico, se registra como tal. La
arquitectura debe permitir aprender de esa evidencia, no proteger una conclusión.
