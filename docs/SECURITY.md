# Consideraciones de Seguridad

Este documento cubre credenciales, autenticación, cuota y encabezados. La topología de funciones, el flujo de permisos y los stores de Blobs están en [ARCHITECTURE.md, sección 8](./ARCHITECTURE.md#8-servidor-funciones-autenticación-y-cuota).

## Arquitectura de API Keys

El proyecto nunca expone API keys al navegador. Todas las llamadas a servicios externos pasan por Netlify Functions que actúan como proxy autenticado (`services/aiClient.ts` siempre llama a `/.netlify/functions/*`).

**Desarrollo local (`npm run dev`):**
- Las keys se leen desde `.env` e inyectan en las Netlify Functions vía `netlify dev`
- El bundle del navegador no contiene ninguna key
- `NETLIFY_DEV=true` desactiva la verificación de identidad para iterar sin login (el usuario queda como `dev`)

**Producción (Netlify):**
- Las keys están en Netlify > Settings > Environment variables (server-side)
- Cada función verifica la identidad antes de reenviar cualquier solicitud
- Los cuerpos de error del proveedor no se copian a la respuesta; el cliente recibe un resumen normalizado (`_shared/providerError.js`)

## Autenticación de las funciones

- **Funciones síncronas** (`api-claude`, `api-openai-text`, `api-gemini-detect`, `api-authorize`, `api-pipeline-batch-create`, `api-structure-stage`, `api-check`): leen el usuario de `context.clientContext.user`, que Netlify ya verificó contra el JWT de Netlify Identity. Sin usuario responden 401.
- **Funciones en segundo plano** (`api-*-worker-background`, `api-pipeline-batch-background`, `api-openai-text-background`, `api-gemini-structure-background`): no pueden verificar un JWT. Consumen un permiso de un solo uso (`consumeAuthGrant` en `_shared/identity.js`) que escribió en el store `auth-grants` `api-authorize` (vence a los 2 minutos) o una función "create". El permiso se borra al leerlo, así que no se puede repetir. Solo las funciones escriben Blobs, así que un token falso no puede crear un permiso.
- **Roles**: se leen en vivo desde GoTrue (`fetchFreshRoles`) en los puntos de decisión de cuota, de modo que un rol asignado en el panel de Identity aplica sin volver a iniciar sesión. Si la lectura falla se usa la copia del JWT.
- **CORS**: las funciones que emiten cabeceras CORS solo admiten `https://pictos.net`, `https://next.pictos.net` y `https://pictos-next.netlify.app`. El resto no emite cabeceras CORS y queda limitado al mismo origen.

## Funciones

### `api-claude.js` (fases 1, 2 y 4: COMPRENDER, COMPONER, ESTRUCTURAR)

- **Admisión de modelos**: `modelAllowed(model, 'claude', [1, 2, 5])` contra el catálogo (`_shared/modelCatalog.js`). Hoy admite `claude-haiku-5-5` (fases 1 y 2) y `claude-sonnet-4-6` (ESTRUCTURAR, id interno 5). Los modelos retirados (`claude-haiku-4-5-20251001`, `claude-opus-4-6`) se rechazan con 400.
- **Cuota**: 0 unidades.
- **Key**: `PICTOS_ANTHROPIC_KEY`, con `ANTHROPIC_API_KEY` como respaldo.

### `api-openai-text.js` (fases 1 y 2 con GPT-6 Luna)

- Admisión por `modelSupportsPhase` y proveedor `openai` (`_shared/openaiText.js`). Cuota: 0 unidades.

### PRODUCIR (fase 3): workers en segundo plano

| Worker | Poll | Proveedor |
|---|---|---|
| `api-openai-worker-background.js` | `api-openai-poll.js` | OpenAI (`gpt-image-2.5-flare`) |
| `api-gemini-worker-background.js` | `api-gemini-poll.js` | Vertex AI (`gemini-3.1-flash-lite-image`) |
| `api-recraft-worker-background.js` | `api-recraft-poll.js` | Recraft V4.1 (vector y raster) |

- **Auth**: permiso de un solo uso de `api-authorize`.
- **Cuota**: cada worker cobra 1 unidad (`checkAndCharge`) y la devuelve una sola vez si la generación falla (`refundUnitsOnce`, con clave idempotente por trabajo).
- **Resultado**: queda en el store del trabajo (`openai-jobs`, `gemini-jobs`, `recraft-jobs`) hasta que el poll lo entrega; entonces se borra.

### `api-pipeline-batch-create.js` + `-background.js` + `-poll.js` (lote 1 → 2 → 3)

- `create` es síncrona: verifica al usuario, cobra 1 unidad por fila al crear y deja el permiso para el worker. Si el lote no llega a iniciarse, devuelve las unidades (`refundUnits`). Durante el lote, una fila que falla en las fases 1 o 2, o en la imagen con OpenAI o Recraft, recupera su unidad una vez. Un 429 de cualquier proveedor detiene el lote y devuelve las unidades de las filas pendientes. Un fallo de imagen con Gemini que no sea 429 no se devuelve.

### `api-gemini-detect.js` (detección de entidades antes de ESTRUCTURAR)

- Síncrona, Vertex AI, modelo `DEFAULT_MODELS.detect` (`gemini-3.8-flash`), admisión por rol de catálogo `detect`. Cuota: 0 unidades.

### Rutas dormidas

`api-gemini-nlu`, `api-gemini-structure`, `api-gemini-structure-background` + poll, `api-structure-stage`, `api-openai-text-background` + poll y el Vertex Batch (`api-batch-*`) se conservan, pero el catálogo no admite hoy ningún modelo para ellas. Ver [ARCHITECTURE.md, sección 15](./ARCHITECTURE.md#15-código-dormido-y-deuda-conocida).

### API de máquina v1 (`api-v1-comprender`, `api-v1-componer`)

- Solo servidor a servidor: no emite cabeceras CORS.
- Credenciales de servicio revocables `pk_<keyId>_<secret>` (`Authorization: Bearer` o `X-Pictos-Key`). Solo se guarda `sha256(secret)` en el store `service-credentials`; revocar rige desde la siguiente petición.
- Cada credencial tiene `scopes` (`comprender`, `componer`) y un límite diario de llamadas propio (200 por defecto). No consume unidades de la cuota de usuarios.
- `Idempotency-Key` opcional, con alcance por principal y proceso, durante 24 h.
- Referencia completa: [API_V1.md](./API_V1.md).

### `api-usage-report.js`

- Acceso con un usuario de Identity cuyo correo es `ADMIN_EMAIL`, o con `Authorization: Bearer <ADMIN_API_KEY>`. Cualquier otro caso responde 401.

### `share-pictogram.js`

- Envía un `repository_dispatch` a `hspencer/pictogram-collector` con `GITHUB_TOKEN`. Requiere usuario de Identity. Hoy ningún flujo del cliente la llama.

## Variables de Entorno

Todas son server-side. Ninguna lleva prefijo `VITE_`.

| Variable | Uso |
|---|---|
| `PICTOS_ANTHROPIC_KEY` | Claude (fases 1, 2 y 4). Tiene prioridad sobre `ANTHROPIC_API_KEY` porque Netlify CLI puede reemplazar esta última en desarrollo |
| `ANTHROPIC_API_KEY` | Respaldo de la anterior |
| `PICTOS_OPENAI_KEY` | OpenAI (texto e imagen). Tiene prioridad sobre `OPENAI_API_KEY` |
| `OPENAI_API_KEY` | Respaldo de la anterior |
| `RECRAFT_API_KEY` | Recraft V4.1 (fase 3) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Cuenta de servicio de Vertex AI, en una sola línea (Nano Banana 2 Lite y detección) |
| `VERTEX_PROJECT_ID` | Opcional; por defecto el `project_id` de la cuenta de servicio |
| `VERTEX_LOCATION` | Opcional; por defecto `global` |
| `DAILY_LIMIT_PER_USER` | Cuota diaria de unidades (por defecto en código 50; producción 50, preview 100) |
| `ADMIN_EMAIL` | Correo con acceso a `api-usage-report` |
| `ADMIN_API_KEY` | Bearer alternativo para `api-usage-report` desde scripts |
| `GITHUB_TOKEN` | `share-pictogram` (sin uso desde el cliente) |
| `VERTEX_BATCH_BUCKET` | Bucket de Vertex Batch (dormido) |
| `PICTOS_DEV_SERVICE_TOKEN` | Credencial de API v1 aceptada solo con `netlify dev` |

`URL`, `DEPLOY_PRIME_URL`, `SITE_NAME`, `NETLIFY_DEV` y `NETLIFY_BLOBS_CONTEXT` las define Netlify.

**Hacer:**
- Usar `.env` para desarrollo local
- Mantener `.env` en `.gitignore` (ya configurado)
- Proporcionar `.env.example` sin valores reales

**No hacer:**
- Commitear archivos `.env` a Git
- Incluir keys directamente en el código fuente

## Autenticación (Netlify Identity)

- Login lazy: la app es accesible sin autenticación
- Se requiere login solo para llamar a los servicios de IA
- Google SSO como método principal, email/password como alternativa
- El JWT se obtiene del widget de Netlify Identity y se envía como `Authorization: Bearer`
- El rol `superuser` omite el límite diario

## Modelo de Cuota

- Cada generación de imagen de la fase 3 cobra 1 unidad, sea OpenAI, Gemini o Recraft; se devuelve una vez si falla
- El lote del pipeline cobra 1 unidad por fila al crearse
- Texto (Claude, OpenAI), detección de entidades y API v1 cuestan 0 unidades; la API v1 tiene su propio límite diario por credencial
- Límite configurable por `DAILY_LIMIT_PER_USER`; los cambios llegan a las funciones en el siguiente deploy
- Contadores (`quota/{email}/{fecha}`) y auditoría (`audit/{fecha}/…`) viven en el store `pictonet-usage` (`_shared/usage.js`)

## Headers de Seguridad (`netlify.toml`)

- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains`
- `X-Frame-Options`: `SAMEORIGIN`
- `X-Content-Type-Options`: `nosniff`
- `X-XSS-Protection`: `1; mode=block`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Permissions-Policy`: `camera=(), microphone=(self), geolocation=()`. El micrófono queda permitido solo para el propio sitio, porque los tableros graban audio por celda
- `Content-Security-Policy`: bloquea scripts inline; `unsafe-inline` solo en `style-src` (requerido por el editor SVG); `wasm-unsafe-eval` para VTracer WASM; `connect-src` admite además Nominatim (autocompletado de lugar) y los dos dominios de PICTOS (`admin.html`)

## Configuración Local

1. Copia `.env.example` a `.env`:

   ```bash
   cp .env.example .env
   ```

2. Obtén las keys en [Anthropic Console](https://console.anthropic.com), [OpenAI Platform](https://platform.openai.com) y [Recraft](https://www.recraft.ai); la cuenta de servicio de Vertex en Google Cloud Console
3. Edita `.env` con tus keys
4. Ejecuta `npm run dev`

## Monitoreo

- Uso diario: `GET /.netlify/functions/api-usage-report?date=YYYY-MM-DD` (o `admin.html`)
- Cuotas de proveedor: Anthropic Console, OpenAI Platform, panel de Recraft, Google Cloud Console > Quotas

### Rotación de Keys

1. Generar nueva key en el proveedor correspondiente
2. Actualizar la variable de entorno en Netlify (Settings > Environment variables)
3. El cambio aplica en el próximo deploy; no requiere código
4. Verificar que la app funciona
5. Revocar la key antigua

Las credenciales de API v1 no necesitan deploy: se emiten y revocan con `scripts/service-credentials.mjs`.

## Recursos

- [CONTRIBUTING.md](./CONTRIBUTING.md): setup y desarrollo
- [ARCHITECTURE.md](./ARCHITECTURE.md): arquitectura del sistema
- [API_V1.md](./API_V1.md): API de máquina
- [PRIVACY.md](./PRIVACY.md): qué datos salen del dispositivo
- [CLAUDE.md](../CLAUDE.md): pipeline completo y convenciones
- [Netlify Identity Docs](https://docs.netlify.com/security/secure-access-to-sites/identity/)
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/)
