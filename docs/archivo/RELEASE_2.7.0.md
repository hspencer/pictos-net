# PictoNet 2.7.0

## Estructurar desde el bitmap

Un bitmap con su árbol de COMPONER se estructura ahora en un solo paso: la acción **Estructurar** traza el bitmap en regiones dentro del navegador y una sola llamada de visión asigna cada región a una entidad del árbol. Con un trazado existente, **Estructurar trazado** sigue el camino anterior y **Estructurar desde el bitmap** lo reemplaza. TRAZAR queda como **Solo trazar**.

- Trazado por regiones con el núcleo VTracer 1.0 (`1.0.0-alpha.4`, commit `2500df7`) y un binding propio para el navegador (`lib/vtracer-web`): partición en mosaico sin rendijas, huecos reales, procedencia explícita de cada path y color tomado de los píxeles que cada región muestra.
- Contrato `restructure_regions`: el modelo asigna, protege, propone descartes, pide separaciones o deja regiones sin resolver. Nada se borra de la partición y la duda queda visible en un borrador.
- La geometría nunca la escribe el modelo; solo un resultado que cumple pictos-svg-schema se certifica.
- Los paths llevan el nombre de su entidad: `lugar-forma` si es una sola forma, `mamá-1`, `mamá-2` si son varias.

En un piloto de 10 casos de ICAP 50 V2 (`docs/eval/`), frente al trazado antiguo más ESTRUCTURAR, con el mismo modelo: 1,0 % de píxeles erróneos frente a 4,7 %, la mitad de tokens de entrada, SVG un 64 % más liviano. La ruta antigua alteraba el orden de pintura al reagrupar. El tiempo humano de retoque no se ha medido.

## ESTRUCTURAR conserva lo que dibuja

- La respuesta del modelo se valida contra los paths y nodos reales; ya no se le pide forzar una forma dudosa al nodo más parecido.
- Una fusión ya no elimina los demás paths del grupo y conserva su color; no se fusionan pinturas distintas; las transformaciones se aplican completas y los huecos siguen la regla de relleno.
- El ensamblado inmediato y el revisado pasan por la misma verificación, que también mide los borradores, distingue "no medible" de "correcto" y detecta un detalle pequeño perdido.
- La llamada de la fase 4 a Claude tiene un presupuesto de 50 s (antes 30 s), suficiente para los pictogramas más complejos.

## Editor vectorial

- Selección por geometría visible, no por cajas; un clic fuera deselecciona; Supr/Retroceso borra la selección múltiple; presionar y arrastrar una forma no seleccionada la mueve en un solo gesto.
- Transformaciones no destructivas: el gesto se previsualiza y se hornea una sola vez al confirmarlo.
- Paneles laterales plegables.
- Protección de la estructura semántica: en un SVG estructurado, el editor rechaza las ediciones que rompen el vínculo entre una entidad y su grupo (vaciar o borrar un grupo, booleanas entre grupos, sacar formas de su grupo, desagrupar o renombrar un grupo) y explica por qué. Mover formas entre grupos está permitido.
- Las booleanas dejan el resultado en el ancestro común de los operandos, no en la raíz.
- Guardar: el editor se cierra solo cuando el guardado termina bien; si no, queda abierto con la edición y el motivo. Los colores por forma y el estilo de foco se conservan al editar; antes, guardar recoloreaba el pictograma.

## Bibliotecas y valores por defecto

- Una sola migración (`libraryConfigMigration.js`) para toda configuración que entra a la app: un modelo retirado o desconocido se quita y la fase vuelve al valor por defecto, con aviso; los campos antiguos se eliminan y los estilos `svgStyles` se convierten respetando sus colores.
- Las plantillas ya no fijan modelos y una biblioteca no guarda un modelo igual al valor por defecto: siguen los defaults de la versión que las abre. Cinco plantillas fijaban el modelo retirado Gemini 2.5 Flash y no podían ejecutar COMPRENDER ni COMPONER.

## Pendiente

- Una acción del árbol sin dibujo propio solo se certifica con un enlace implícito suministrado, que hoy nada en la app produce; esos casos quedan como borrador.
- La respuesta semántica varía entre corridas con el mismo prompt; la evaluación necesita varias corridas por caso.
- Corpus de evaluación completo y medición de tiempo humano.

Detalle técnico en `docs/ESTRUCTURAR.md` y `docs/PLAN_VECTORIZAR_ESTRUCTURAR_2026-10-29.md`.
