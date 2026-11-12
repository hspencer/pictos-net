# Guía de Contribución y Desarrollo

Esta guía contiene instrucciones técnicas para desarrolladores que deseen contribuir al proyecto o ejecutarlo localmente.

## Configuración Inicial

### 1. Clonar el repositorio

```bash
git clone https://github.com/hspencer/pictos-net.git
cd pictos-net
```

Los cuatro productos canónicos se editan dentro de `schemas/pictos-nlu-schema`,
`schemas/pictos-composition-schema`, `schemas/pictos-svg-schema` y
`schemas/pictos-api-schema`, como directorios
normales con el mismo flujo de exportación trazable. No se inicializan submódulos ni se importa la copia hermana
`../pictos-nlu-schema`.

### 2. Instalación de Dependencias

```bash
npm install
```

Este comando también:
- Copia únicamente contratos JSON públicos desde `schemas/` a `public/schemas/`.
- Genera el índice de bibliotecas públicas existente; no publica los productos.

### 3. Configuración de Variables de Entorno

```bash
cp .env.example .env
```

Edita `.env` con tus API keys:

```env
PICTOS_ANTHROPIC_KEY=tu_key_aquí
OPENAI_API_KEY=tu_key_aquí
RECRAFT_API_KEY=tu_key_aquí
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

- `PICTOS_ANTHROPIC_KEY` (o `ANTHROPIC_API_KEY`): obtenla en [Anthropic Console](https://console.anthropic.com). Fase 4 y Claude Haiku 5.5 en las fases 1 y 2
- `OPENAI_API_KEY`: obtenla en [OpenAI Platform](https://platform.openai.com). COMPRENDER, COMPONER (GPT-6 Luna) y PRODUCIR por defecto
- `RECRAFT_API_KEY`: obtenla en [Recraft](https://www.recraft.ai). Modelos Recraft V4.1 en PRODUCIR
- `GOOGLE_SERVICE_ACCOUNT_JSON`: cuenta de servicio de Vertex AI en una sola línea. Nano Banana 2 Lite en PRODUCIR y detección de entidades antes de ESTRUCTURAR

`.env.example` documenta las variables opcionales. La lista completa está en [SECURITY.md](./SECURITY.md#variables-de-entorno).

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
npm test               # pruebas node --test de funciones y servicios
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
2. **Variables de entorno**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RECRAFT_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` y `DAILY_LIMIT_PER_USER` configuradas como variables server-side (scope: Functions); ver [SECURITY.md](./SECURITY.md#variables-de-entorno)
3. **Netlify Functions**: se despliegan automáticamente desde `netlify/functions/`; el mapa está en [ARCHITECTURE.md](./ARCHITECTURE.md#8-servidor-funciones-autenticación-y-cuota)

## Verificación de Servicios de IA

Para verificar que el pipeline funciona en local:

1. Asegúrate de que `.env` contiene las API keys válidas
2. Ejecuta `npm run dev`
3. Abre `http://localhost:9001`
4. Ingresa un utterance de prueba (ej: "Quiero beber agua")
5. El sistema debería generar:
   - Análisis NLU (fase 1, GPT-6 Luna por defecto)
   - Elementos visuales y prompt espacial (fase 2, GPT-6 Luna por defecto)
   - Imagen (fase 3, GPT Image 2.5 Flare por defecto: bitmap; un modelo Recraft vectorial entrega SVG)

Si encuentras errores de API:
- Verifica que las keys estén correctamente configuradas en `.env`
- Confirma que `netlify dev` está corriendo (no `vite` directamente)
- Revisa la consola de la función en la terminal de `netlify dev`

## Trabajar con los esquemas canónicos

1. Modifica el producto dentro de `schemas/` junto con sus pruebas y documentación.
2. Conserva versiones publicadas; crea una versión nueva si cambia el contrato.
3. Ejecuta `npm run test:schemas` y las pruebas de integración sin proveedores.
4. Prepara una preview local o una exportación desde un commit concreto siguiendo
   [SCHEMA_PUBLICATION.md](SCHEMA_PUBLICATION.md).

Los cambios externos se revisan e incorporan primero a PICTOS. Nunca ejecutar
`git submodule update --remote` para actualizar estos productos.

`npm run copy-schemas` copia los contratos JSON públicos y prepara recursos locales;
los scripts `dev` y `build` lo ejecutan automáticamente. No copia ejemplos, pruebas,
licencias, credenciales ni corpus privados al directorio público.

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
- **Claude Haiku 5.5**: COMPRENDER y COMPONER (alternativa: OpenAI GPT-6 Luna)
- **OpenAI GPT Image 2.5 Flare**: PRODUCIR por defecto (bitmap). Alternativas: Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`, Vertex AI) y la familia Recraft V4.1 (Standard, Utility, Pro y Utility Pro, en vector o raster)
- **Claude Sonnet 4.6**: ESTRUCTURAR
- **Gemini 3.8 Flash (Vertex AI)**: detección de entidades antes de ESTRUCTURAR
- **VTracer** (WASM): trazado local del bitmap

El catálogo de modelos (`netlify/functions/_shared/modelCatalog.js`) es la única fuente de esta lista.

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
- [API_V1.md](./API_V1.md) — API de máquina v1
- [archivo/](./archivo/) — planes y diseños históricos, ya no vigentes
- [Anthropic API Docs](https://docs.anthropic.com)
- [NSM Homepage](https://nsm-approach.net/)
