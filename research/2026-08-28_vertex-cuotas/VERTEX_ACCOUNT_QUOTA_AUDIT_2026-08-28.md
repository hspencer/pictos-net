# Vertex: auditoría de proyecto, facturación y capacidad

Fecha: 2026-08-28. Estado inicial: diagnóstico de solo lectura. **Actualización posterior autorizada por el usuario: entornos unificados en `pictos-vertex-gmail`**, ver cierre operativo al final. No se generaron imágenes ni se contrataron servicios de capacidad.

## Evidencia actual

| Superficie | Observado | Alcance de la conclusión |
| --- | --- | --- |
| Arc / consola Google Cloud | Proyecto `pictos-vertex-gmail`, número `291690492595` | Proyecto abierto por el usuario. |
| Google Cloud CLI | `pictos-vertex-gmail` ACTIVE; billingEnabled=true; aiplatform.googleapis.com habilitada | Facturación vinculada y API habilitada. No acredita capacidad ni acceso a cada modelo. |
| Consola de facturación | Etiqueta «Cuenta pagada» | No es evidencia de un límite de gasto ni de rendimiento garantizado. El panel de presupuestos quedó cargando; no se verificaron topes. |
| Proyecto `pictos-vertex` | Consulta rechazada para la cuenta personal autenticada | Puede faltar acceso; no implica que el proyecto esté suspendido o eliminado. |
| `.env` local | Credencial perteneciente a `pictos-vertex`; ubicación por defecto `global` | Solo configuración local, no prueba de producción. Solo se extrajo project_id; no se imprimió la credencial. |
| Netlify `pictos.net` | Rama main; credencial legible del contexto dev pertenece a `pictos-vertex` | La credencial de producción no fue legible. No inferir su proyecto a partir del contexto dev. |
| Netlify `next.pictos.net` | Rama dev; credencial legible del contexto dev pertenece a `pictos-vertex-gmail` | El contexto dev de Netlify no equivale a la rama dev desplegada: cada sitio puede tener su rama principal en contexto production. Credencial de producción no verificada. |
| Cloud Quotas API en `pictos-vertex-gmail` | SERVICE_DISABLED | Impide esta consulta administrativa. No es causa demostrada de errores de generación. No se habilitó. |
| Cloud Logging, últimos 7 días | Sin entradas devueltas para errores de auditoría aiplatform | No demuestra ausencia de errores: no se verificó cobertura de registros de acceso a datos. |

La CLI tenía `spencer-finance` como selección global. No se cambió; las consultas de recursos se hicieron con proyecto explícito.

`netlify env:get` devolvió objetos vacíos y no sirve aquí como prueba de ausencia de configuración: su implementación captura errores de Envelope y devuelve una lista vacía. La consulta directa con el identificador de cuenta Netlify permitió leer metadatos y valores del contexto dev. Los valores no legibles de producción no se clasificaron como JSON inválido ni se intentó eludir su protección.

## Documentación oficial revisada

- [Standard PayGo](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo), actualización indicada 2026-08-27: capacidad compartida; endpoint global y distribución de solicitudes en el tiempo recomendados. Los modelos de imágenes Gemini 2.5 Flash Image, 3 Pro Image y 3.1 Flash Image soportan Standard PayGo, pero no sus niveles por gasto. Un 429 de este mecanismo puede ser contención temporal, no una cuota fija agotada.
- [Cuota de capacidad](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/resources/throughput-quota): diferencia entre pago por uso y Provisioned Throughput. No existe una garantía de capacidad ilimitada por tener tarjeta vinculada.
- [Consulta de cuotas por CLI](https://docs.cloud.google.com/docs/quotas/gcloud-cli-examples): proyecto de consulta explícito. La versión local requiere `gcloud beta quotas info list`; no tiene el grupo estable `gcloud quotas`.

## Próximo paso necesario

1. Confirmar con el usuario qué cuenta administra `pictos-vertex` y cuál proyecto debe ser el definitivo. No migrar ni reemplazar credenciales sobre una inferencia.
2. Confirmar proyecto y ubicación efectivos de cada despliegue sin exponer claves. La evidencia del contexto dev no basta.
3. Con autorización, habilitar Cloud Quotas API solo en el proyecto correspondiente para inspección administrativa. No confundir esta acción con un aumento de capacidad.
4. Identificar un error real: modelo, proyecto, endpoint, código Google, detalles de cuota, hora y concurrencia. Separar cuota de PictoNet, capacidad Google, autenticación y Netlify Blobs.
5. Dimensionar una prueba acotada de concurrencia con presupuesto aprobado y métricas de latencia/429/reintentos. Mantener las 50 generaciones diarias por usuario. No comprar Provisioned Throughput sin estimación y confirmación expresa.

La factura mensual baja no permite concluir por sí sola que exista un plan limitado. Falta contrastar gasto por proyecto y servicio, créditos y tráfico efectivo.

## Cierre operativo autorizado

El usuario confirmó: «todo debe apuntar a pictos-vertex-gmail, déjalo así».

- Se reutilizó la cuenta de servicio existente de ese proyecto; no se creó otra ni se ampliaron roles IAM. El rol `roles/aiplatform.user` se comprobó en la política del proyecto.
- Se verificó OAuth y `countTokens` de `gemini-2.5-flash-image` contra el endpoint global: HTTP 200, cinco tokens para un texto sintético de prueba. Esta operación es gratuita y no demuestra generación de imágenes ni capacidad concurrente.
- Se mantuvo `GOOGLE_SERVICE_ACCOUNT_JSON` como secreto en ambos sitios Netlify y se actualizó en todos sus contextos existentes. Se fijaron `VERTEX_PROJECT_ID=pictos-vertex-gmail` y `VERTEX_LOCATION=global` para todos los contextos, con scope Functions.
- Se actualizó `.env` local. El original quedó en una copia privada dentro de `.netlify/vertex-audit/`, excluida de Git; no se imprimieron credenciales.
- Se reiniciaron únicamente los procesos Netlify/Vite de este repositorio. Local responde HTTP 200 en el puerto 3000.
- Se habilitó `cloudquotas.googleapis.com`, únicamente para administración/consulta de cuotas. La propagación fue intermitente inicialmente; se verificó su estado habilitado y se obtuvo la consulta completa.
- Se redesplegó exclusivamente el commit remoto ya publicado `351a1d8dea1be0de982b711a82382086b686f2a8`. Las correcciones locales de SVG no se publicaron.

| Sitio | Despliegue | Estado comprobado |
| --- | --- | --- |
| next.pictos.net | `6a91a786a673aa3f37f7afa6` | ready, publicado 2026-08-28 15:22:39 UTC, HTTP 200 |
| pictos.net | `6a91a813d9c963b1fefb47c7` | ready, publicado 2026-08-28 15:24:52 UTC, HTTP 200 |

### Cuotas: lo que sí y lo que no demuestra la consulta

Consulta completa local: `research/vertex-quotas-20260828.json` (13 registros de cuotas GenerateContent; contiene metadatos administrativos, no prompts ni claves).

Existe la cuota `GenerateContentImageGenRequestsPerMinutePerProjectPerBaseModel`, con valor regional 2/minuto y una entrada explícita `base_model=gemini-experimental` en `us-central1`. Sus ubicaciones aplicables no incluyen `global`, y figura elegible para solicitar aumento. **No se demostró que esa cuota limite los modelos GA de imágenes usados por PictoNet en global**. No se solicitó aumentar una cuota ajena al tráfico efectivo.

La documentación oficial de [Gemini 2.5 Flash Image](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image) indica Standard PayGo y Provisioned Throughput, sin modalidad de cuota fija. La de Standard PayGo excluye explícitamente a los modelos de imágenes de sus niveles basados en gasto. Subir gasto mensual por sí solo no asegura más capacidad de imágenes.

No se contrató capacidad reservada ni se cambió el límite diario propio de PictoNet. Falta una prueba de generación/concurrencia con costo acotado autorizado y un error real del proveedor para decidir una solicitud de soporte o capacidad. HTTP 200 del sitio y countTokens no son esa prueba.

### Facturación, primera comprobación

La consola mostró gasto estimado del proyecto Gmail de NZD 3.45 para 1–28 agosto 2026. La cuenta activa tiene vinculados actualmente `pictos-vertex-gmail`, `spencer-finance`, `next-pictos-vertex` y `gen-lang-client-0167983259`. No figura `pictos-vertex` en esa lista. También hay una cuenta cerrada sin proyectos vinculados devueltos. Nada de esto prueba ausencia de cargos históricos: la descarga de facturas está pendiente de revisar el historial accesible en consola.

El usuario pidió descargar las facturas del proyecto anterior. **No se descargaron archivos**: el acceso CLI al proyecto `pictos-vertex` está rechazado para la sesión Gmail; el listado de facturas de consola no llegó a inspeccionarse, y el control de Arc se interrumpió repetidamente por cambios de la pestaña activa. Queda pendiente abrir Facturación con la cuenta administradora del proyecto anterior. No se deben atribuir al proyecto anterior las facturas de la cuenta actual sin comprobar su desglose histórico; los vínculos actuales de facturación no prueban los históricos.
