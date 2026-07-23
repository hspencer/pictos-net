# Guía de Contribución y Desarrollo

Esta guía contiene instrucciones técnicas para desarrolladores que deseen contribuir al proyecto o ejecutarlo localmente.

## Configuración Inicial

### 1. Clonar el Repositorio con Submodules

```bash
git clone --recurse-submodules https://github.com/hspencer/pictos-net.git
cd pictos-net
```

Si ya clonaste el repositorio sin submodules:

```bash
git submodule update --init --recursive
```

**Submodules incluidos:**

- `schemas/nlu-schema` — NLU v1.0 JSON schema + tests
- `schemas/ICAP` — Corpus ICAP-50 y framework de evaluación
- `schemas/mf-svg-schema` — Esquema para pictogramas SVG estructurados

### 2. Instalación de Dependencias

```bash
npm install
```

Este comando también:
- Inicializa submodules automáticamente (via `postinstall` hook)
- Copia archivos necesarios de submodules a `public/schemas/`

### 3. Configuración de Variables de Entorno

```bash
cp .env.example .env
```

Edita `.env` con tus API keys:

```env
ANTHROPIC_API_KEY=tu_key_aquí
RECRAFT_API_KEY=tu_key_aquí
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

- `ANTHROPIC_API_KEY`: obtenla en [Anthropic Console](https://console.anthropic.com)
- `RECRAFT_API_KEY`: obtenla en [Recraft](https://www.recraft.ai)
- `GOOGLE_SERVICE_ACCOUNT_JSON`: service account de Vertex AI (para modelos Gemini alternativos)

**Seguridad:** Las keys viven solo en el servidor (Netlify Functions). El bundle del cliente no las contiene. Ver [SECURITY.md](./SECURITY.md).

### 4. Ejecutar el Proyecto

```bash
npm run dev
```

La aplicación estará disponible en **`http://localhost:9001`** (no 3000 — las Netlify Functions solo están disponibles a través de `netlify dev`).

Vite interno corre en el puerto 3000 y el proxy reenvía `/.netlify/*` a 9001, así que ambos puertos funcionan para la UI, pero las llamadas a las funciones requieren el 9001.

#### Build para Producción

```bash
npm run build
```

Genera los archivos optimizados en `dist/`.

#### Validación de Tipos y Traducciones

```bash
npx tsc --noEmit       # verificación de tipos
npm run validate-i18n  # consistencia de traducciones
```

## Despliegue en Netlify

El proyecto se despliega automáticamente desde Netlify:

| Branch | URL |
|--------|-----|
| `main` | pictos.net (producción) |
| `dev` | next.pictos.net (preview) |

Flujo de trabajo: `dev` → `main` (fast-forward merge).

### Configuración en Netlify:

1. **Netlify Identity**: Habilitado con Google SSO
2. **Variables de entorno**: `ANTHROPIC_API_KEY`, `RECRAFT_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` configuradas como variables server-side (scope: Functions)
3. **Netlify Functions**: `api-claude.js` y funciones relacionadas se despliegan automáticamente desde `netlify/functions/`

## Verificación de Servicios de IA

Para verificar que el pipeline funciona en local:

1. Asegúrate de que `.env` contiene las API keys válidas
2. Ejecuta `npm run dev`
3. Abre `http://localhost:9001`
4. Ingresa un utterance de prueba (ej: "Quiero beber agua")
5. El sistema debería generar:
   - Análisis NLU (fase 1 — Claude Haiku)
   - Elementos visuales y prompt espacial (fase 2 — Claude Haiku)
   - SVG vectorial (fase 3 — modelo seleccionado en configuración)

Si encuentras errores de API:
- Verifica que las keys estén correctamente configuradas en `.env`
- Confirma que `netlify dev` está corriendo (no `vite` directamente)
- Revisa la consola de la función en la terminal de `netlify dev`

## Trabajar con Submodules

### Actualizar Submodules a la Última Versión

```bash
git submodule update --remote
npm run copy-schemas
```

### Actualizar un Submodule Específico

```bash
cd schemas/ICAP
git checkout main
git pull origin main
cd ../..
npm run copy-schemas
git add schemas/ICAP
git commit -m "chore: update ICAP submodule"
```

### Scripts de Submodules

- `npm run copy-schemas` — Copia archivos de submodules a `public/schemas/`
- Los scripts `dev` y `build` ejecutan `copy-schemas` automáticamente

## Internacionalización (i18n)

El proyecto soporta:

- **Inglés Británico** (`en-GB`)
- **Español Latinoamericano** (`es-419`)

### Agregar nuevas traducciones

1. Edita ambos archivos: `locales/en-GB.json` y `locales/es-419.json`
2. Usa la misma estructura de keys en ambos archivos
3. Ejecuta `npm run validate-i18n` para verificar consistencia

```json
{
  "messages": {
    "importSuccess": "Se importaron {count} frases del archivo."
  }
}
```

Uso en código:

```typescript
const { t } = useTranslation();
addLog('success', t('messages.importSuccess', { count: phrases.length }));
```

## Stack Tecnológico

- **React 19** — UI framework
- **TypeScript 5.8** — Type safety
- **Vite 6** — Build tool y dev server (via `netlify dev`)
- **Tailwind CSS 3.4** — Styling
- **Lucide React** — Iconografía
- **Anthropic Claude** (Haiku 4.5 / Sonnet 4.6) — Fases 1, 2, 4 del pipeline
- **Recraft V4.1 Vector** — Fase 3 (SVG generativo)
- **Gemini (Vertex AI)** — Alternativo en fase 3 (imagen) y fase 4 (structuring)

## Convenciones de código

- TypeScript con tipos explícitos
- Componentes funcionales con hooks
- Nombres de componentes en PascalCase
- Funciones y variables en camelCase
- Todos los strings de UI deben pasar por `useTranslation()` — no hardcodear textos en español ni inglés
- Commits semánticos: `feat:`, `fix:`, `docs:`, `refactor:`, etc.
- Código y commits en inglés; textos de UI en español (es-419)

## Flujo de Contribución

1. Crea una rama desde `dev`: `git checkout -b feat/mi-feature`
2. Realiza tus cambios
3. Verifica: `npx tsc --noEmit` + `npm run validate-i18n`
4. Push a tu fork
5. Abre un Pull Request a la rama `dev`

## Recursos

- [SECURITY.md](./SECURITY.md) — Modelo de seguridad y API keys
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura detallada del sistema
- [ESTRUCTURAR.md](./ESTRUCTURAR.md) — Fase 4: pipeline interno de estructuración SVG
- [Anthropic API Docs](https://docs.anthropic.com)
- [NSM Homepage](https://nsm-approach.net/)
