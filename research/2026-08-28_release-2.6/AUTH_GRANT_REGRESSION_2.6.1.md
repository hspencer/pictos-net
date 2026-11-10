# Regresión de autorización de workers — 28 agosto 2026

Reporte: `ejecución:32e0c98f`, trabajo `gemini-1787924512992-1gytkiw`,
`Unauthorized (no valid authorization grant)` en PRODUCIR de `pictos.net`.

## Diagnóstico reproducido

El commit 2.6.0 activó `consistency: strong` en `consumeAuthGrant`. El adaptador
`connectLambda` de `@netlify/blobs` 10.7.9 reconstruye el contexto con `edgeURL`,
pero omite `uncachedEdgeURL`, aunque Netlify entrega `url_uncached`. El SDK lanza
`BlobsConsistencyError` antes de hacer la petición; `consumeAuthGrant` captura el
error y devuelve `null`, que Gemini presenta como el Unauthorized reportado.

No se recuperaron logs históricos del trabajo original. La reproducción usa el
SDK real instalado, desactiva NETLIFY_DEV y simula únicamente transporte y Vertex.
Antes del parche produjo exactamente el error reportado; después pasa desde la
emisión síncrona del permiso hasta la respuesta del worker. No se hizo ninguna
generación pagada ni se alteró la biblioteca del usuario.

## Cambio y pruebas

- Commit: `351a1d8dea1be0de982b711a82382086b686f2a8`, versión 2.6.1.
- Se conserva `url_uncached` en el contexto de almacenamiento compartido. No se
  sustituye por una URL inventada ni se degrada a consistencia eventual.
- 198 pruebas correctas, incluidas 5 nuevas con SDK real; 18 pruebas de esquemas
  y 8 fixtures; TypeScript y build correctos.
- Allium: 0 errores y 0 hallazgos, 7 advertencias existentes en los cinco archivos
  revisados. Las advertencias hacen que `check` salga con código 1.
- Secreto real escaneado contra los seis archivos del commit: 0 coincidencias.
- No se cambiaron claves, cuotas, modelos, permisos IAM ni contratos canónicos.

Las pruebas de desarrollo anteriores sustituyeron almacenamiento y autorización,
por lo que no cubrieron esta incompatibilidad del SDK. El nuevo test queda en CI.

## Despliegue

Ambas ramas remotas apuntan a `351a1d8dea1be0de982b711a82382086b686f2a8`.

| Comprobación | Resultado |
| --- | --- |
| CI dev | [33177033629](https://github.com/hspencer/pictos-net/actions/runs/33177033629): success |
| CI main | [33177149937](https://github.com/hspencer/pictos-net/actions/runs/33177149937): success |
| Pages main | 33177148713: success |
| Netlify next | `6a919178043dcf00086beecb`: ready, SHA del parche confirmado |
| Netlify producción | `6a9191d4bd19b40008bf2ff4`: ready, SHA del parche confirmado |
| Navegador en ambos sitios | Versión 2.6.1 visible, sin errores de consola observados |
| Git local | dev limpio y sincronizado; main publicado sin reescribir historial |

### Comprobación de worker desplegado, sin permiso ni consumo de IA

Se envió a `next.pictos.net` un único trabajo sintético
`auth-smoke-096551e4-bfc7-447c-b34c-8addf1e200e6` **sin emitir un permiso**.
El endpoint respondió 202 y el log del worker confirmó `missing auth grant`
para ese identificador. Esto demuestra que la lectura fuerte llegó al
almacenamiento real y recibió ausencia de permiso, en vez de fallar por
`uncachedEdgeURL`. El worker rechaza antes de la cuota y de Google.

No es una prueba de generación autenticada exitosa. La conexión de logs usó la
sesión administrativa existente de la CLI sin imprimir sus credenciales.
Se confirmó el resultado Unauthorized almacenado y se eliminó únicamente ese
registro sintético mediante la API administrativa; no se tocaron otros trabajos.

## Alcance

Este parche cubre la lectura de autorización y staging en el adaptador compartido.
No demuestra disponibilidad del proveedor ni elimina todos los posibles motivos
de rechazo de un permiso (ausencia, vencimiento o uso previo). Tampoco convierte
la operación leer/borrar en una transacción atómica entre workers concurrentes.
La comprobación final del pictograma requiere reintentar PRODUCIR en una sesión
autenticada; no se ejecuta un benchmark ni se usa el corpus para pruebas pagadas.
