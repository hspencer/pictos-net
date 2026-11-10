# ESTRUCTURAR: separar borrador de certificación

2026-08-28. Cambios locales sobre 2.6.1, aún sin commit ni publicación.
Este diagnóstico amplía `TRACE_NLU_UI_REGRESSION.md`: recuperar los controles no bastaba.

## Medición del bloqueo

Se recorrieron los JSON de `public/libraries`, considerando las 824 filas que tienen NLU y elementos visuales. El conteo incluye apariciones en distintas bibliotecas, no pictogramas únicos. Para aislar la admisión semántica se supuso un trazado disponible; no se generaron 824 SVG ni se llamó a proveedores.

- Filtro anterior: 824 rechazos por NLU; ninguna admisión.
- Perfil NLU de generación: 0 conformes. Perfil documental NLU: también 0. Cambiar únicamente de perfil no resuelve esta colección histórica.
- Composición canónica: 111 conformes.
- Nuevo filtro operativo: 811 admitidas para estructurar un borrador; 13 rechazos por identificadores duplicados, todos en `pictos.json`.

No se reescribió ninguna biblioteca ni se inventaron valores para satisfacer enumeraciones.

## Comportamiento aplicado

**Admisión operativa:** requiere trazado y árbol de elementos con identificadores utilizables y únicos. Los datos históricos, el NLU ausente o las convenciones antiguas del prompt no impiden intentar una asignación visual.

**Ensamblado:** produce un borrador visible y descargable incluso si el NLU no satisface el perfil actual o faltan correspondencias. La geometría no asignada se conserva sin atribuirle un concepto Context inventado. La recursión conserva descendientes de más de dos niveles.

**Certificación:** las comprobaciones MF-SVG completas permanecen intactas. Un borrador no recibe referencia canónica ni reemplaza una revisión aceptada. El NLU y la composición suministrados viajan intactos en sus metadatos de borrador. No se declara aptitud para entrenamiento ni revisión humana.

**Seguridad y concurrencia:** borradores y revisiones canónicas comparten la inspección de XML, contenido activo y referencias externas. Una respuesta tardía no puede sobrescribir cambios posteriores en los datos de origen. Una asignación vacía o un SVG activo siguen rechazándose.

**i18n:** los errores de validación, asignación, autorización, cuota y conexión se convierten a claves traducidas. Los detalles internos no son el mensaje predeterminado. Los componentes, incluidas las filas memorizadas, observan el mismo idioma; se verificó el cambio en caliente sin recarga.

## Evidencia y límites

Resultado final: 204 pruebas unitarias y 19 pruebas de contratos pasan; TypeScript, i18n (800 claves), compilación Vite y `git diff --check` correctos. La compilación conserva sus advertencias previas de tamaño de bundles.

- Pruebas unitarias de regresión: admisión histórica, certificación estricta, ausencia de NLU, identificadores duplicados, conservación de revisión previa, rechazo de borradores tardíos e i18n.
- Pruebas de renderizado del componente real en ambos diseños y ambos idiomas: ESTRUCTURAR queda habilitado para la fila histórica y conserva el aviso de certificación.
- Prueba de ensamblado real en navegador: `structure-draft-check.html` y `structure-draft-check.js` en esta carpeta. Usa NLU/composición de la fila reportada, geometría pequeña y asignaciones explícitas de prueba. Comprueba conservación de trazos, ausencia de conceptos inventados, preservación exacta de NLU, borrador con NLU incompatible o ausente, rechazo de contenido activo y producción canónica con datos conformes del ejemplo oficial del repositorio.
- La prueba de ensamblado no es un benchmark de modelos ni una generación con IA. No acredita que un proveedor produzca asignaciones correctas.
- Aplicación real en `http://127.0.0.1:3002/`: fila «Abro la app de delivery en mi teléfono» abierta con ESTRUCTURAR habilitado; diagnóstico y controles cambian de idioma sin recargar.
- Allium `check`/`analyse`: sin errores ni findings; persisten advertencia del origen de la entidad externa Editor y aviso de su campo no utilizado. Las anotaciones en prosa no constituyen una prueba formal de ejecución.

Se mantiene la revisión humana previa a cualquier commit, incremento de versión o despliegue. La reparación de los 13 identificadores duplicados y la reconciliación semántica de la colección requieren decisiones explícitas; no se hicieron migraciones silenciosas.


## Segunda regresión: borrador sin acceso al editor (28 de agosto, 11:42)

La captura posterior muestra un borrador ya ensamblado acompañado por «No se pudo estructurar el SVG». Se confirmaron tres defectos de código: el editor sólo admitía `raw`/`structured`, el pie mostraba «Trazado listo» aunque hubiera borrador, y varios rechazos MF-SVG (atributos de grupos, accesibilidad y metadatos) caían en `structureFailed`. La fila conservaba sólo esa clave, sin el mensaje original. No se dispone del SVG/JSON exacto de ese intento; no se atribuye su rechazo particular a un campo ni a un proveedor.

Corrección local:

- El borrador ofrece «Editar borrador SVG». Se abre su propio contenido y se guarda exclusivamente en `structuredSvgDraft`; no se sobrescriben trazado ni revisión canónica. El editor conserva la apariencia al abrirlo, sin inyectar la paleta de la biblioteca ni eliminar automáticamente un fondo.
- Se separan el resultado obtenido y el motivo de certificación pendiente. Los intentos históricos sin detalle se reconocen como tales; no se inventa una causa. Los rechazos conocidos tienen claves i18n específicas y campos cuando el validador los aporta.
- La edición sigue siendo un borrador: no acredita certificación ni aprobación para entrenamiento. El estado y los mensajes se actualizan sin anunciar otra vez «Trazado listo».
- El snapshot de concurrencia incluye el borrador: una generación tardía no pisa ediciones posteriores. Cambiar solamente un borrador no invalida una referencia canónica existente. Si la fila cambia durante la edición, el editor conserva los cambios sin guardar y permite exportarlos.
- La especificación Allium amplía estas obligaciones y elimina una precondición contradictoria que exigía NLU completo para ensamblar borradores.

Verificación de esta corrección: `node --test 'services/**/*.test.ts' scripts/svg-generator-ui.test.mjs`: 108 pasan, 5 de integración con servidor omitidas. Contrato MF-SVG: 10 pasan. TypeScript, i18n (809 claves), Vite y `git diff --check` correctos; Vite conserva advertencias de bundles y resolución WASM. Allium sin errores ni findings, con las advertencias previas de Editor.

En `http://localhost:3000/research/structure-draft-check.html` se usaron el componente y el editor reales, NLU/composición históricos y dos trazos explícitos de prueba. Se abrió el borrador, seleccionó y eliminó un trazo y guardó: el borrador editado persistió en el estado de prueba, el trazado original quedó intacto y no apareció una referencia canónica. Mensajes verificados en español e inglés. Esta prueba no usa la fila privada de la captura ni acredita persistencia IndexedDB de esa fila; las transiciones de guardado compartidas con App también están cubiertas por pruebas unitarias.

No se llamó a proveedores, no se consumieron créditos y no se hizo commit ni despliegue.


## Publicación autorizada

El usuario autorizó commit y push a dev/main. Publicado como 2.6.2, commit `d5a121ddcaf7c50b60d9de0604726173eacc7fa5`, en ambas ramas mediante avance sin reescritura del historial. CI correcto en ambas ramas. Netlify confirmó los dos despliegues `ready` del mismo commit; `next.pictos.net` y `pictos.net` respondieron HTTP 200 y mostraron v2.6.2 en el navegador. No se hicieron generaciones pagadas. Detalle en `release-2.6.2-deploy-status.json`. El checkout quedó limpio en dev; research y credenciales siguen excluidos de Git.
