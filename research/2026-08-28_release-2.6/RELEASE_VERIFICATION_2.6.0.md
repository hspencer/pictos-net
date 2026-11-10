# PictoNet 2.6.0 — registro de verificación

Fecha local del trabajo: **27 de agosto de 2026** (America/Santiago).
Registro local excluido de Git. No contiene valores de credenciales.

## Estado confirmado

El commit de implementación es `a0df2f5cb8afe5bd9f28bbf698f9f730a2b05066`.
El cierre de documentación y corpus es `c555fcb70b585cd89b11239586f559b89216f9a4`.
Ambas ramas remotas, `dev` y `main`, apuntan a este último commit. La evidencia
de implementación y exportación conserva su corte explícito; las comprobaciones
de publicación final se registran al final de este documento.

| Comprobación | Resultado observado |
| --- | --- |
| Suite unitaria y proveedores simulados | 193 pruebas correctas |
| Esquemas independientes | 18 pruebas y 8 fixtures correctos, también fuera del monorepo |
| Allium | 5 especificaciones: 0 errores, 0 hallazgos; 11 advertencias existentes |
| TypeScript | `typecheck` correcto |
| Traducciones | 781 claves validadas |
| Compilación | Build correcto |
| GitHub Actions del commit de implementación | [Ejecución 33128822569](https://github.com/hspencer/pictos-net/actions/runs/33128822569): success |
| Netlify de `next.pictos.net`, commit de implementación | Deploy `6a90d1d7c229aa0009521995`: ready |
| Navegador en `next.pictos.net` | DOM muestra 2.6.0; selectores de modelos y acordeón verificados; 0 errores observados |
| Endpoint protegido `api-check` | Solicitud anónima rechazada con HTTP 401 |
| Corpus al cierre | 20 bibliotecas, 826 filas |

El acordeón conserva los valores: abrir configuración básica cierra avanzada y
viceversa. Los valores predeterminados y modelos guardados no se cambiaron.
Las combinaciones sugeridas en [el plan de modelos](MODELS_AND_QUOTAS_PLAN.md)
son hipótesis para comparar, no resultados empíricos ni preferencias aplicadas.
Recraft solo participa en PRODUCIR, no en COMPONER.

## Exportación independiente de los tres esquemas

Se ejecutó `scripts/export-schema.mjs committed` para cada producto, fijando el
SHA completo `a0df2f5cb8afe5bd9f28bbf698f9f730a2b05066`. En cada directorio temporal
nuevo se ejecutaron `npm ci --offline --ignore-scripts --no-audit --no-fund` y
`npm test`. Las instalaciones usaron la caché local, sin red. Cada entrada pública
`index.js` se importó correctamente y sus dependencias se resolvieron dentro del
`node_modules` del producto exportado. Los archivos incluidos en los manifiestos
conservaron sus hashes después de las pruebas.

| Producto | Pruebas | Hash de contenido del manifiesto |
| --- | --- | --- |
| `@mediafranca/nlu-schema` 1.1.0 | 5 + 8 fixtures | `f1ed594589cd8d5aebbe708688ae7e63439bc5624035ef2dd5e68929f1a610f5` |
| `@mediafranca/pictogram-composition-schema` 0.1.0 | 4 | `d5837bb3cda90359a0b6d7f867fb28ff61470b6e374d0fb5a18e28935c6d5b6f` |
| `@mediafranca/mf-svg-schema` 2.0.0-draft.1 | 9 | `c2429365abdf6070af8e7b01719f11736774ad104a45509834afac56baf11270` |

Directorios temporales de esta ejecución; pueden desaparecer con la limpieza del sistema:

- NLU: `/private/var/folders/dk/b0hdr3g14m58xvch43cw52hm0000gn/T/pictos-nlu-schema-committed-e77b341f-6b3c-4b96-a0cc-0f614c39b0d7`
- Composición: `/private/var/folders/dk/b0hdr3g14m58xvch43cw52hm0000gn/T/pictos-pictogram-composition-schema-committed-1f67c31c-8fb2-40f7-9967-c47b73c7c4ae`
- MF-SVG: `/private/var/folders/dk/b0hdr3g14m58xvch43cw52hm0000gn/T/pictos-mf-svg-schema-committed-300f7cb6-d384-4a33-a8a4-0be32fd2344c`

Esta evidencia demuestra funcionamiento aislado de los contratos y validadores;
no es publicación de paquetes ni actualización de los repositorios externos.
La publicación mediante PR de los productos MediaFranca sigue pendiente.

## Configuración y límites de la evidencia

La tarea principal consultó los metadatos después de configurar `OPENAI_API_KEY`
en ambos sitios y confirmó `secret: true`, alcance exclusivo **Functions** y
contexto **production**:

| Dominio | Sitio Netlify | ID del sitio | Rama de producción |
| --- | --- | --- | --- |
| `next.pictos.net` | `pictos-next` | `c3a0cb25-110a-49a6-9d9b-05ccf7a72347` | `dev` |
| `pictos.net` | `pictos` | `24f068d3-f368-4526-a503-2f09af1def0b` | `main` |

El contexto es `production` también en `pictos-next`, cuya rama de producción es
`dev`; no se confunde con un contexto `branch:dev`. Solo se documenta el nombre
de la variable; no su valor. Esta comprobación no demuestra generación ni
disponibilidad permanente de cada modelo.

No se ejecutaron generaciones pagadas ni el benchmark de calidad. Las pruebas de
proveedores son simuladas, salvo las consultas de acceso/saldo descritas en
[el plan de modelos y cuotas](MODELS_AND_QUOTAS_PLAN.md). No se aumentaron cuotas
de Google ni se cambiaron permisos IAM. Las consultas GCP devolvieron HTTP 403;
por ello no se pudo verificar la frecuencia real de errores mediante métricas.

La revisión en navegador prueba la interfaz desplegada; no prueba un pictograma
generado de extremo a extremo. El vencimiento de entradas de staging es lógico;
el borrado automático de entradas abandonadas sigue siendo una mejora pendiente.

## Cierre de publicación — verificado

La tarea principal verificó las referencias remotas, GitHub Actions, metadatos de
Netlify y el contenido servido por ambos dominios. Todos los resultados finales
corresponden a `c555fcb70b585cd89b11239586f559b89216f9a4`.

| Paso | Estado |
| --- | --- |
| Commit final de cierre/documentación/corpus | `c555fcb70b585cd89b11239586f559b89216f9a4` |
| CI final de `dev` | [33129215151](https://github.com/hspencer/pictos-net/actions/runs/33129215151): completed / success |
| CI final de `main` | [33129304649](https://github.com/hspencer/pictos-net/actions/runs/33129304649) y [33129304094](https://github.com/hspencer/pictos-net/actions/runs/33129304094): completed / success |
| Despliegue final de `next.pictos.net` | `6a90d37924367f00088e6476`: ready, SHA final confirmado, sin error |
| Despliegue final de `pictos.net` | `6a90d3dd00aa24000833b9c6`: ready, SHA final confirmado, sin error |
| Contenido servido en ambos dominios | Índice con 20 bibliotecas; Escena descriptiva con 15 filas; SHA-256 del JSON publicado idéntico al archivo del commit |
| Endpoints nuevos en ambos dominios | POST anónimo a `api-structure-stage` y `api-openai-text`: HTTP 401 |
| Navegador de producción `pictos.net` | Versión 2.6.0, 20 bibliotecas visibles y Escena descriptiva con 15 pictogramas; 0 errores de consola observados |
| Git local | Rama `dev`, árbol de trabajo limpio y sincronizado con `origin/dev`; promoción normal a `main`, sin reescribir historial |

Los archivos de investigación y las credenciales permanecen excluidos de Git.
Este registro local se completa después de verificar el despliegue; no requiere
otro commit ni activa una nueva publicación. No amplía las garantías de generación
o calidad descritas en los límites de la evidencia.
