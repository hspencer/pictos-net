# PictoNet 2.9.0

## PRODUCIR

- QuiverAI Arrow 2 entra como modelo de PRODUCIR que dibuja SVG nativo. El estilo de la librería viaja aparte del contenido, con un lienzo fijo de 512 y muestreo sobrio. Cada pictograma tarda entre 30 y 60 segundos y cuesta cerca de US$0,07. El lote del servidor admite hasta 10 filas con este modelo. Evidencia en `research/2026-11-10_quiver-arrow2`.
- La respuesta de Quiver llega limpia: sin el comentario de créditos y sin los rectángulos blancos de fondo.
- Se retira Recraft V4 Styles también cuando se envía un estilo.

## ESTRUCTURAR

- Los círculos, elipses, rectángulos y polígonos se convierten en trazados al entrar. Las cabezas que Quiver dibuja como círculos ya no se pierden: la pérdida de tinta bajó de 11,8 % a 0 %.
- Una respuesta ilegible de la detección de entidades ya no se lee como "nada dibujado": el flujo sigue sin cajas, como antes de la detección.

## Editor vectorial

- Mover una selección múltiple mueve todas las piezas en un solo gesto, y Cmd+Z las devuelve juntas.
- Cmd-clic (Ctrl-clic en Windows) agrega o quita piezas igual que Shift, en el dibujo y en el árbol. Todas las filas seleccionadas del árbol se marcan en azul.
- Los estilos que trae el SVG se respetan al abrirlo. Las clases que la paleta de la librería no tiene se agregan a ella y quedan disponibles para los demás pictogramas; las que la paleta define distinto quedan como variante local. Editar la paleta aplica al pictograma abierto solo las clases cambiadas.
- Las clases que el SVG define y la librería no tiene ya no se pierden en la primera edición.
- El color propio de cada forma, que asigna ESTRUCTURAR, se ve en el panel y se puede quitar. Asignar una clase lo quita, para que la clase se vea. "Limpiar estilos inline" quita también esos colores y las reglas inline convertidas.
- Una forma sin clase dentro de un grupo con clase indica de qué grupo hereda y permite seleccionarlo.

## Filas

- El bitmap generado se puede borrar, con confirmación. Producir de nuevo lo repone.
- El botón de descarga del bitmap dice "Descargar PNG".
- El tablero puede grabar audio en los sitios publicados.

## Lotes

- Solo quien creó un lote puede consultar sus resultados.
- Cada fila fallida devuelve su unidad de cuota una vez, también con Gemini.
- Regenerar en bloque tras cambiar de modelo conserva la imagen anterior si la fila no se genera.

## Librerías y estudios

- PICTOS - Señalética reemplaza a PICMIL.
- Los estudios y benchmarks quedan versionados en `research/`, con un índice navegable y las instrucciones para verlos y repetirlos en `research/README.md`.

## API v1

- pictos-api-schema 1.1.0: el campo `model` de ambas peticiones acepta un identificador del catálogo; todos los valores de la 1.0.0 estaban retirados.

## Interfaz

- Varios textos con variables, en lotes, registro y cambio de modelo, mostraban los números entre llaves. Ahora muestran el valor.

## Desarrollo local

- `npm run dev` vuelve a abrir la app en el puerto 9001: borra `dist/` al iniciar y la política de seguridad admite el preámbulo de React de Vite.
