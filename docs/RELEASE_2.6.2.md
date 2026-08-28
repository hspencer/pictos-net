# PictoNet 2.6.2

## Correcciones

- ESTRUCTURAR admite un trazado y elementos visuales utilizables aunque el NLU
  histórico no cumpla el perfil canónico actual. La validación completa sigue
  siendo obligatoria para certificar el resultado como MF-SVG.
- Los borradores conservan la geometría no asignada sin inventar significados,
  quedan disponibles para edición y descarga y no sustituyen el trazado ni una
  revisión canónica anterior. Se rechazan resultados tardíos si cambió la fila.
- El editor abre y guarda el artefacto elegido. Abrir un borrador no aplica la
  paleta de la biblioteca ni elimina automáticamente su fondo.
- Los rechazos de certificación, asignación y proveedor se presentan mediante
  mensajes traducidos. Cuando un intento histórico no conservó la causa, la
  interfaz lo reconoce en vez de inventarla. Se elimina el pie contradictorio
  «Trazado listo» cuando ya existe un borrador.
- El cambio de idioma alcanza todos los componentes montados. Los controles
  NLU muestran valores históricos fuera del vocabulario sin alterarlos.

La inspección de seguridad SVG se comparte entre borradores y revisiones
canónicas: scripts, recursos externos y referencias inválidas siguen rechazados.
No se migran bibliotecas ni se concede aptitud para entrenamiento automáticamente.

## Verificación

- 193 pruebas unitarias de servicios, funciones y renderizado de interfaz.
- 19 pruebas de contratos, ocho casos documentales NLU y sincronización de los
  contratos incorporados correctos.
- TypeScript, 809 claves i18n y compilación completa correctos. Se mantienen
  advertencias previas de tamaño de bundles y resolución WASM.
- Allium: sin errores ni hallazgos; persisten los avisos previos sobre el origen
  de la entidad externa Editor y su identificador no utilizado. Las anotaciones
  no constituyen una prueba formal de ejecución.
- En navegador local se abrió, editó y guardó un borrador con los componentes
  reales y geometría de prueba, conservando el trazado y sin certificarlo.

Las pruebas que llaman a proveedores se excluyeron de esta publicación. Esta
verificación no demuestra disponibilidad o cuota de Google ni identifica la
causa exacta de un intento histórico cuyo diagnóstico no se conservó.
La evidencia operativa y de despliegue permanece local en `research/`.
