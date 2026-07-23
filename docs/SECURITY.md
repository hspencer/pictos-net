# Consideraciones de Seguridad

## Arquitectura de API Keys

El proyecto nunca expone API keys al navegador. Todas las llamadas a servicios externos pasan por Netlify Functions que actúan como proxy autenticado.

**Desarrollo local (`npm run dev`):**
- Las keys se leen desde `.env` e inyectan en las Netlify Functions via `netlify dev`
- El bundle del navegador no contiene ninguna key
- `NETLIFY_DEV=true` desactiva la validación JWT para iterar sin login

**Producción (Netlify):**
- Las keys están en Netlify > Settings > Environment variables (server-side)
- El proxy valida el JWT de Netlify Identity antes de reenviar cualquier solicitud
- Los errores no exponen detalles internos al cliente

## Funciones Proxy

### `api-claude.js` (fases 1, 2, 4 — COMPRENDER, COMPONER, ESTRUCTURAR)

- **JWT**: Solo usuarios autenticados vía Netlify Identity
- **CORS**: `pictos.net`, `next.pictos.net`, `pictos-next.netlify.app`
- **Modelo allowlist**:
  - `claude-haiku-4-5-20251001` (fases 1+2)
  - `claude-sonnet-4-6` (fase 4, default)
  - `claude-opus-4-6` (fase 4, alternativo)
- **Quota**: 0 unidades — todas las llamadas a Claude son gratuitas en el modelo de cuota

### `api-recraft-worker-background.js` + `api-recraft-poll.js` (fase 3 — PRODUCIR)

- **JWT**: Validación vía `context.clientContext.user`
- **CORS**: mismos tres orígenes
- **Quota**: 1 unidad por llamada — este es el único servicio que consume cuota diaria
- **Modelo**: `recraftv4_1_vector` y variantes (`recraftv4_1_pro_vector`, `recraftv4_1_utility_vector`)

### `api-gemini-structure.js` + `api-gemini-nlu.js` (alternativo — Vertex AI)

- **Auth**: Service account OAuth via `_shared/vertex.js` — sin API key estática
- **JWT**: misma validación de Netlify Identity
- **Quota**: 0 unidades (igual que Claude)

### `api-usage-report.js`

- Solo accesible por el owner (verificado contra el rol en GoTrue)
- Endpoint de uso interno; no documentado públicamente

## Variables de Entorno

| Variable | Uso | Scope |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API (fases 1, 2, 4) | server-side |
| `RECRAFT_API_KEY` | Recraft V4.1 Vector (fase 3) | server-side |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Vertex AI service account (Gemini alternativo) | server-side |
| `VERTEX_PROJECT_ID` | Google Cloud project ID (opcional, default en vertex.js) | server-side |
| `VERTEX_LOCATION` | Región Vertex (opcional, default `global`) | server-side |
| `DAILY_LIMIT_PER_USER` | Cuota diaria de unidades (default 50; prod=50, preview=100) | server-side |

**Hacer:**
- Usar `.env` para desarrollo local
- Mantener `.env` en `.gitignore` (ya configurado)
- Proporcionar `.env.example` sin valores reales

**No hacer:**
- Commitear archivos `.env` a Git
- Incluir keys directamente en el código fuente

## Autenticación (Netlify Identity)

- Login lazy: la app es completamente accesible sin autenticación
- Se requiere login solo para generar pictogramas (llamadas a los proxies)
- Google SSO como método principal, email/password como alternativa
- JWT se obtiene del widget de Netlify Identity y se envía como `Authorization: Bearer`
- Los roles se leen en vivo desde GoTrue en cada decisión de cuota — un rol asignado en el panel de Identity aplica sin re-login
- Ciertos roles conceden cuota extendida (configurado en Netlify Identity)

## Modelo de Cuota

- Solo las llamadas a Recraft (fase 3) consumen 1 unidad
- Todas las llamadas a Claude y Gemini consumen 0 unidades
- Los lotes no iniciados devuelven las unidades via `refundUnits`
- Límite configurable por `DAILY_LIMIT_PER_USER` (env var; los cambios aplican en el próximo deploy)

## Headers de Seguridad (`netlify.toml`)

- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains`
- `X-Frame-Options`: `SAMEORIGIN`
- `X-Content-Type-Options`: `nosniff`
- `X-XSS-Protection`: `1; mode=block`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Permissions-Policy`: cámara, micrófono y geolocalización deshabilitados
- `Content-Security-Policy`: bloquea scripts inline; `unsafe-inline` solo en `style-src` (requerido por el editor SVG); `wasm-unsafe-eval` para VTracer WASM

## Configuración Local

1. Copia `.env.example` a `.env`:

   ```bash
   cp .env.example .env
   ```

2. Obtén las keys en [Anthropic Console](https://console.anthropic.com) y [Recraft](https://www.recraft.ai)
3. Edita `.env` con tus keys
4. Ejecuta `npm run dev`

## Monitoreo

- Uso diario: endpoint de administración interno (requiere rol owner)
- Cuotas Anthropic: [Anthropic Console](https://console.anthropic.com)
- Cuotas Recraft: panel de Recraft
- Vertex AI / Gemini: Google Cloud Console > Quotas

### Rotación de Keys

1. Generar nueva key en el proveedor correspondiente
2. Actualizar la variable de entorno en Netlify (Settings > Environment variables)
3. El cambio aplica en el próximo deploy — no requiere código
4. Verificar que la app funciona
5. Revocar la key antigua

## Recursos

- [CONTRIBUTING.md](./CONTRIBUTING.md) — Setup y desarrollo
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura del sistema
- [CLAUDE.md](../CLAUDE.md) — Pipeline completo y convenciones
- [Anthropic API Docs](https://docs.anthropic.com)
- [Netlify Identity Docs](https://docs.netlify.com/security/secure-access-to-sites/identity/)
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/)
