# API de máquina v1 — un endpoint por fase

API para que otros servicios (el primero es Vera) soliciten fases sueltas del pipeline de PICTOS con contratos estrictos. Cada endpoint hace una sola transformación, valida su resultado contra un JSON Schema versionado y declara quién lo produjo.

Estado: `comprender` y `componer` implementados. `producir` y `estructurar` tienen el contrato publicado como borrador y no tienen endpoint.

## Principios

- **Mismo código que la app.** Los endpoints envuelven `runPhase1` / `runPhase2` (`netlify/functions/_shared/pipelineRunner.js`), que usan los mismos prompts, esquemas de herramienta y fronteras de aceptación que el navegador y el batch (`_shared/pipelineContracts.js`). No hay una copia de los prompts para la API.
- **Nada se repara en silencio.** Si el modelo devuelve algo que no cumple el contrato, la respuesta es `output_contract_invalid` con los `issues` y sin artefacto. No hay reintento pagado automático.
- **Contratos nativos de PICTOS.** La salida de `comprender` es NLU (`pictonet-nlu-generation-1.1.0`); la de `componer` es la composición aceptada (`pictogram-composition-0.1.0`) con la raíz determinista `pictograma`/`pictogram` construida por PICTOS, nunca por el modelo. El schema `pictogram-composition-provider-0.1.0` sigue siendo el contrato interno con el modelo. Los tipos reducidos de otros sistemas (por ejemplo `PictosMeaning`/`PictosPlan` en Vera) se adaptan del lado del cliente.
- **Solo servidor a servidor.** No se emiten cabeceras CORS; un navegador no puede usar la API. La credencial nunca llega a un navegador.

## Endpoints

| Método y ruta | Función | Entrada | Salida (`output`) |
|---|---|---|---|
| `POST /api/v1/comprender` | `api-v1-comprender` | enunciado + `config` (`lang`, `geoContext.region`, `domainContext`, `visualStylePrompt`) + `model` opcional | NLU validada contra `pictonet-nlu-generation-1.1.0` |
| `POST /api/v1/componer` | `api-v1-componer` | `nlu` (documento NLU 1.1.0 válido) + `config.domainContext` + `model` opcional | composición aceptada `pictogram-composition-0.1.0` |

Ambos son síncronos y responden dentro del límite de 60 s de Netlify. El presupuesto de red con el proveedor es de 45 s y un reintento (`PROVIDER_BUDGET` en `_shared/apiV1.js`).

`model` acepta los modelos de texto del catálogo para esa fase. Si se omite, se usa `claude-haiku-4-5-20251001`.

## Contratos publicados

Fuente en `schemas/pictos-api/`. Se publican en `https://<sitio>/schemas/pictos-api/` mediante `scripts/copy-submodule-data.sh`.

| Schema | Rol |
|---|---|
| `pictos-api-common-1.0.0` | envelope común: metadatos de éxito, evidencia, cupo, errores |
| `pictos-api-comprender-request-1.0.0` / `-response-1.0.0` | contrato de `comprender` |
| `pictos-api-componer-request-1.0.0` / `-response-1.0.0` | contrato de `componer` |
| `pictos-api-producir-0.1.0-draft` | frontera futura de `producir` (borrador) |
| `pictos-api-estructurar-0.1.0-draft` | frontera futura de `estructurar` (borrador) |

Hay ejemplos en `schemas/pictos-api/examples/`, generados ejecutando los handlers reales y validados por los tests.

## Respuesta exitosa

```json
{
  "api_version": "v1",
  "executor": "pictos.net",
  "request_id": "uuid (también en la cabecera X-Request-Id)",
  "idempotency_key": "vera:block-7f3a:rev-2 | null",
  "replayed": false,
  "process": { "name": "comprender", "version": "nlu-1.1.0" },
  "schema": { "id": "https://pictos.net/schemas/pictonet-nlu-generation-1.1.0.schema.json", "version": "1.1.0" },
  "model": { "requested": "claude-haiku-4-5-20251001", "actual": "…", "provider": "anthropic" },
  "evidence": { "contract_hash": "…", "prompt_hash": "…", "input_hash": "…", "output_hash": "…", "usage": {}, "duration_ms": 3120, "provider_request_id": null },
  "quota": { "used": 1, "limit": 200 },
  "output": { }
}
```

`evidence` contiene hashes SHA-256 de JSON canónico: permiten demostrar qué contrato, qué prompt y qué entrada produjeron el artefacto sin que la API devuelva el prompt.

## Errores

Siempre `{ api_version, executor, request_id, process, error: { code, message, retryable, issues?, retry_after_ms? } }`.

| `code` | HTTP | Cuándo |
|---|---|---|
| `invalid_request` | 400 | cuerpo no JSON, envelope fuera del schema, modelo no permitido, `Idempotency-Key` mal formada |
| `unauthorized` | 401 | credencial ausente, desconocida, incorrecta o revocada (no se distinguen) |
| `forbidden` | 403 | la credencial no tiene el proceso entre sus `scopes` |
| `method_not_allowed` | 405 | método distinto de POST |
| `idempotency_in_progress` | 409 | la misma clave todavía se está ejecutando |
| `idempotency_key_reused` | 422 | la misma clave con otro cuerpo |
| `input_contract_invalid` | 422 | el artefacto de entrada (la `nlu` de `componer`) no cumple su schema |
| `quota_exceeded` | 429 | se agotó el cupo diario del principal |
| `output_contract_invalid` | 502 | el modelo respondió, pero su artefacto fue rechazado |
| `provider_error` | 502 | error del proveedor no reintentable |
| `provider_unavailable` | 503 | error del proveedor transitorio (reintentable) |
| `internal_error` | 500 | falla inesperada de PICTOS |

Los cuerpos de error del proveedor nunca se copian a la respuesta porque pueden repetir el prompt.

## Autenticación de máquina

La cabecera es `Authorization: Bearer pk_<keyId>_<secret>` (también se acepta `X-Pictos-Key`).

- Cada credencial pertenece a un **principal de servicio** (`service:vera`), tiene `scopes` (`comprender`, `componer`) y un **cupo diario de llamadas** propio (por defecto 200, día UTC).
- Solo se guarda `sha256(secret)` en el store de Blobs `service-credentials` (`keys/<keyId>`), por sitio de Netlify. Revocar marca `revoked_at` y rige desde la siguiente petición, sin redeploy.
- No hay secretos en Git ni en el bundle del navegador. El token se imprime una sola vez.

```sh
# next.pictos.net y pictos.net son sitios distintos: usa el Site ID del que corresponda
export NETLIFY_AUTH_TOKEN=…   # token personal de Netlify
node scripts/service-credentials.mjs issue  --site <siteId> --principal service:vera --label "Vera server" --daily-limit 200
node scripts/service-credentials.mjs list   --site <siteId>
node scripts/service-credentials.mjs revoke --site <siteId> --key <keyId>
```

Las llamadas de texto siguen costando 0 unidades del cupo de imágenes de los usuarios humanos. El cupo del principal limita el número de llamadas, es decir, el costo. Cuenta toda llamada que llega al modelo, aunque su salida se rechace; las repeticiones idempotentes y las peticiones rechazadas antes de llamar al modelo no cuentan. Cada llamada queda en el registro de auditoría (`logCall`) con el principal como identidad.

### Desarrollo local

`node scripts/service-credentials.mjs issue --local` imprime una línea `PICTOS_DEV_SERVICE_TOKEN=pk_…` para el `.env` (ignorado por Git). Con `netlify dev` (`NETLIFY_DEV=true`), ese token se acepta como `service:dev`. Fuera de `netlify dev` se ignora.

## Idempotencia

La cabecera opcional `Idempotency-Key` debe cumplir `^[A-Za-z0-9._:-]{8,128}$`. Se sugiere derivarla del bloque y la revisión de entrada, por ejemplo `vera:<blockId>:<rev>`.

- Tiene alcance por principal y por proceso, y se conserva 24 h.
- La misma clave con el mismo cuerpo devuelve el resultado guardado (`replayed: true`, cabecera `Idempotent-Replayed: true`, mismo `request_id` original) sin volver a llamar al modelo ni cobrar cupo.
- Solo se guardan los éxitos. Tras un error, la misma clave puede reintentarse.

## Frontera de Producir y Estructurar (borradores)

**Producir** será asíncrono (job más polling, como `api-authorize` → worker → poll). Su artefacto es una unión etiquetada, porque depende del proveedor:

```json
{ "kind": "bitmap", "mime_type": "image/png", "artifact": "<base64>" }
{ "kind": "svg", "mime_type": "image/svg+xml", "artifact": "<svg…>" }
```

El camino habitual y de mejor calidad es `bitmap`. Recraft puede entregar `svg` directo, pero obedece mal el prompt y no resuelve la coherencia semántica. Un `svg` de Producir no es un SVG estructurado.

**Estructurar** será un cuarto endpoint separado y opcional. Recibe el artefacto producido, la NLU y la composición aceptada. Devuelve un SVG conforme a `mf-svg-schema` (`metadata-2.0.0-draft.1`) junto con `losses`, `orphan_marks`, `ambiguous_assignments` y `provenance`. Cuando la fuente es un bitmap, `provenance.reconstruction` vale `vectorized_from_bitmap`: la agrupación semántica es una propuesta, no un hecho recuperado. Reconstruir estructura desde un bitmap sigue siendo un problema abierto.

`PROCESSES` en `_shared/apiV1.js` ya registra ambos procesos como no implementados. `createV1Handler` se niega a servirlos.

## Límites conocidos

- Netlify Blobs no tiene incremento atómico ni compare-and-set. El cupo puede excederse en tantas llamadas como haya en paralelo, y dos primeras peticiones simultáneas con la misma `Idempotency-Key` pueden ejecutarse ambas.
- No hay límite de frecuencia por minuto; solo cupo diario.
