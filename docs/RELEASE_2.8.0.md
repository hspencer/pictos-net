# PictoNet 2.8.0

## Modelos

- Cada fase ofrece los modelos que salieron del benchmark del 1 de noviembre (`docs/BENCHMARK_MODELOS_2026-11.md`): Claude Haiku 5.5 para COMPRENDER y COMPONER, GPT Image 2.5 Flare por defecto en PRODUCIR y Claude Sonnet 4.6 en ESTRUCTURAR. El costo por pictograma bajó de US$0,052 a US$0,0069.
- Gemini 2.5 Flash Image se retira (errores 429 con concurrencia). Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image) entra como alternativa de Google en PRODUCIR. Comparte la cuota de imagen de Vertex, que Google fija en 2 peticiones por minuto y no se puede ampliar.
- Vuelve la familia Recraft V4.1 completa como opción de PRODUCIR: vector y raster, en Standard, Utility, Pro y Utility Pro. Recraft V4 Styles sigue fuera porque exige un estilo creado antes en Recraft.
- COMPONER nombra los elementos en el idioma de la librería. El ejemplo de la instrucción estaba fijo en español y las librerías en inglés mezclaban nombres como `persona`.

## Librerías de ejemplo

- Todas firmadas por MediaFranca con licencia CC0. Las de español están en Viña del Mar (Trámites, en Santiago) y las de inglés en Auckland.
- La portada muestra solo las librerías del idioma de la interfaz.
- Siete librerías en inglés: Idiomatic, Kitchen y Modern Illustration, más las traducciones de Tablero (Core Board), Q • Blake, Inclusión Laboral (Workplace Inclusion) y Escena descriptiva (Descriptive Scene).
- Nombres de archivo planos y sin fecha, con sufijo `.en.json` para inglés. Las copias hechas antes del cambio siguen recuperando sus imágenes.
- El NLU de los ejemplos cumple el contrato 1.1.0 y las tarjetas muestran el número de secuencias.

## Trazado

- "Simplificar colores" reduce la imagen a una paleta y quita el grano antes de trazar: en un pictograma de ilustración, de 60 a 28 trazados.
- Las barras "Original" y "Resultado SVG" tienen la misma altura.

## ESTRUCTURAR y certificación

- Un borrador editado se puede certificar sin volver a ESTRUCTURAR. La lista del borrador muestra todo lo que falta, nombrado por elemento: formas fuera de los grupos, elementos sin dibujo, campos del NLU o conceptos por confirmar. El botón Certificar y el guardado en el editor certifican cuando no queda nada.
- Una acción sin dibujo propio se puede marcar como implícita de quien la realiza.
- Volver a ESTRUCTURAR sobre una edición manual pide confirmación.
- La reparación automática del NLU usa el mismo perfil que la certificación y quita textos vacíos.
- Antes de asignar regiones, Gemini 3.8 Flash ubica con una caja cada entidad del árbol que está dibujada. Las regiones se asignan con esa evidencia, lo no dibujado no recibe regiones y una acción no dibujada pasa a ser implícita de quien la realiza. Un elemento no dibujado se puede quitar de la composición desde la lista del borrador.
- Dentro de cada entidad se unen las formas del mismo color que se tocan y las astillas de color parecido. Si la unión altera el dibujo, se descarta. En "slice the onion": de 547 a 210 formas.
- En el editor, al editar vértices la figura editada sigue visible (antes quedaba atenuada con su grupo).
