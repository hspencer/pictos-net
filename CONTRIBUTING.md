# Guía de Contribución y Desarrollo

Esta guía contiene instrucciones técnicas para desarrolladores que deseen contribuir al proyecto o ejecutarlo localmente.

## Configuración Inicial

### 1. Clonar el Repositorio con Submodules

```bash
git clone --recurse-submodules https://github.com/hspencer/pictos-net.git
cd pictos-net
```

Si ya clonaste el repositorio sin submodules, inicialízalos:

```bash
git submodule update --init --recursive
```

**Submodules incluidos:**

- `schemas/nlu-schema` - Esquema MediaFranca para análisis NLU
- `schemas/VCSCI` - Framework de evaluación VCSCI
- `schemas/mf-svg-schema` - Esquema para pictogramas SVG estructurados


### 2. Instalación de Dependencias

```bash
npm install
```

Este comando también:
- Inicializa submodules automáticamente (via `postinstall` hook)
- Copia archivos necesarios de submodules a `public/schemas/`

### 3. Configuración de Variables de Entorno

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Obtén tu API key de Google Gemini en: <https://aistudio.google.com/app/apikey>

Edita el archivo `.env` y reemplaza `your_gemini_api_key_here` con tu API key real:

```env
GEMINI_API_KEY=tu_api_key_aquí
```

**IMPORTANTE - SEGURIDAD:**

- **NUNCA** subas el archivo `.env` a Git (ya está en `.gitignore`)
- **NO COMPARTAS** tu API key públicamente
- **ADVERTENCIA**: Esta aplicación expone la API key en el código del cliente (navegador). Para más detalles, consulta [SECURITY.md](./SECURITY.md)

### 3. Ejecutar el Proyecto

#### Modo Desarrollo (Local)

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:5173`

Este comando ejecuta Vite en modo desarrollo con:

- Hot Module Replacement (HMR)
- Acceso desde cualquier dispositivo en la red local
- Las APIs de Gemini funcionarán normalmente si tu API key está configurada

#### Build para Producción

```bash
npm run build
```

Genera los archivos optimizados en el directorio `dist/`:

- JavaScript minificado y bundled
- Assets optimizados
- **NOTA**: La API key seguirá expuesta en el código compilado (ver [SECURITY.md](./SECURITY.md))

#### Vista Previa del Build

```bash
npm run preview
```

Sirve la versión de producción localmente para probar el build antes de desplegar.

#### Validación de Traducciones

```bash
npm run validate-i18n
```

Verifica que los archivos de traducción en `/locales/` tengan las mismas claves.

## Despliegue en GitHub Pages

El proyecto incluye un workflow de GitHub Actions (`.github/workflows/deploy.yml`) que despliega automáticamente a GitHub Pages desde la rama `local-dev`.

### Configuración inicial:

1. **Habilitar GitHub Pages**:
   - Ve a Settings → Pages en tu repositorio
   - En "Source", selecciona "GitHub Actions"

2. **Configurar el secreto GEMINI_API_KEY**:
   - Ve a Settings → Secrets and variables → Actions
   - Crea un nuevo "Repository secret" llamado `GEMINI_API_KEY`
   - Pega tu API key de Google Gemini como valor

3. **Configurar dominio personalizado** (opcional):
   - Edita el archivo `/public/CNAME` con tu dominio
   - Configura los registros DNS de tu dominio para apuntar a GitHub Pages

4. **Desplegar**:
   - Haz push a la rama `local-dev`
   - El workflow se ejecutará automáticamente
   - La aplicación estará disponible en tu dominio o en `https://<tu-usuario>.github.io/pictos-net/`

También puedes ejecutar el workflow manualmente desde la pestaña "Actions" en GitHub.

**NOTA DE SEGURIDAD**: Aunque la API key está configurada como secreto de GitHub, seguirá siendo visible en el código JavaScript compilado del navegador. Consulta [SECURITY.md](./SECURITY.md) para más información.

## Verificación de Servicios de IA

Para verificar que los servicios de Gemini funcionan correctamente en local:

1. Asegúrate que tu archivo `.env` contiene una API key válida
2. Ejecuta `npm run dev`
3. Abre `http://localhost:5173` en tu navegador
4. Ingresa un utterance de prueba (ej: "Quiero beber agua")
5. El sistema debería generar:
   - Análisis NLU (usando Gemini 3 Pro)
   - Blueprint visual con elementos jerárquicos
   - Imagen final (usando Gemini 3 Pro Image o Gemini 2.5 Flash Image)

Si encuentras errores de API, verifica:

- La API key está correctamente configurada en `.env`
- La API key es válida en [Google AI Studio](https://aistudio.google.com/app/apikey)
- Tienes conexión a internet
- No has excedido tu cuota de API

## Arquitectura del Proyecto

### Estructura de Directorios

```
pictos-net/
├── src/
│   ├── App.tsx              # Componente principal
│   ├── types.ts             # Definiciones TypeScript
│   ├── services/
│   │   └── geminiService.ts # Integración con Gemini API
│   ├── data/
│   │   └── canonicalData.ts # Dataset VCSCI (20 utterances)
│   ├── hooks/
│   │   └── useTranslation.ts # Hook personalizado i18n
│   ├── utils/
│   │   └── i18nHelpers.ts   # Utilidades de internacionalización
│   └── locales/
│       ├── en-GB.json       # Traducciones inglés británico
│       └── es-419.json      # Traducciones español latinoamericano
├── public/
│   └── CNAME                # Configuración dominio personalizado
├── scripts/
│   └── validateTranslations.cjs # Script de validación i18n
└── .github/
    └── workflows/
        └── deploy.yml       # GitHub Actions deployment
```

### Pipeline de Procesamiento

El sistema implementa un pipeline de 4 fases:

1. **Understand (NLU)**: Análisis lingüístico profundo basado en Natural Semantic Metalanguage (NSM)
2. **Compose (Visual)**: Generación de elementos jerárquicos y lógica de articulación espacial
3. **Produce (Bitmap)**: Renderizado de imagen PNG usando Gemini Image Generation
4. **Evaluate (VCSCI)**: Evaluación del pictograma según 6 métricas de calidad

### Consistencia Transversal

La aplicación utiliza un esquema de datos unificado:

- **UTTERANCE**: El texto de entrada (intención comunicativa)
- **NLU**: El esquema semántico MediaFranca (JSON), incluyendo análisis NSM detallado basado en 65 primitivos universales
- **elements**: Una estructura jerárquica de componentes visuales que define la composición del pictograma
- **prompt**: La estrategia de articulación espacial que describe cómo se relacionan los elementos (generada en el idioma del utterance)
- **bitmap**: La imagen final generada (Base64 PNG)
- **evaluation**: Métricas VCSCI (Semantics, Syntactics, Pragmatics, Clarity, Universality, Aesthetics)

## Formato de Intercambio (JSON)

El proyecto se exporta en un único archivo JSON que contiene tanto la configuración como los datos completos (incluyendo las imágenes generadas).

```json
{
  "version": "2.6",
  "config": {
    "lang": "es",
    "uiLang": "es-419",
    "aspectRatio": "square",
    "imageModel": "flash",
    "author": "PICTOS.NET",
    "license": "CC-BY-4.0",
    "visualStylePrompt": "..."
  },
  "rows": [
    {
      "id": "R_001",
      "UTTERANCE": "Quiero beber agua",
      "NLU": { "...": "..." },
      "elements": [
        { "id": "perfil_humano" },
        {
          "id": "vaso",
          "children": [
            { "id": "nivel_liquido" }
          ]
        }
      ],
      "prompt": "La composición se centra en un `perfil_humano`...",
      "bitmap": "data:image/png;base64,iVBORw0KGgoAAA...",
      "evaluation": {
        "semantics": 4,
        "syntactics": 5,
        "pragmatics": 4,
        "clarity": 5,
        "universality": 3,
        "aesthetics": 4,
        "humanReasoning": "..."
      }
    }
  ]
}
```

## Trabajar con Submodules

### Actualizar Submodules a la Última Versión

```bash
git submodule update --remote
npm run copy-schemas
```

Esto actualizará todos los submodules a sus últimas versiones en sus respectivas ramas principales.

### Actualizar un Submodule Específico

```bash
cd schemas/VCSCI
git checkout main
git pull origin main
cd ../..
npm run copy-schemas
git add schemas/VCSCI
git commit -m "chore: Update VCSCI submodule to latest version"
```

### Freezar una Versión Específica

Para reproducibilidad científica, puedes freezar submodules a commits específicos:

```bash
cd schemas/VCSCI
git checkout v1.2.3  # o un commit hash específico
cd ../..
npm run copy-schemas
git add schemas/VCSCI
git commit -m "chore: Pin VCSCI to version 1.2.3"
```

### Desarrollo Local en Submodules

Si necesitas hacer cambios en un esquema mientras trabajas en PICTOS:

1. Haz cambios en `schemas/[submodule]/`
2. Commitea los cambios dentro del submodule
3. Haz push al repo del submodule (necesitas permisos)
4. Actualiza la referencia en PICTOS:

```bash
cd schemas/VCSCI
git add .
git commit -m "feat: Add new evaluation metric"
git push origin main
cd ../..
git add schemas/VCSCI
git commit -m "chore: Update VCSCI submodule"
```

### Scripts Disponibles para Submodules

- `npm run copy-schemas` - Copia archivos de submodules a `public/schemas/`
- Los scripts `dev` y `build` automáticamente ejecutan `copy-schemas`

## Internacionalización (i18n)

El proyecto implementa un sistema de internacionalización personalizado que soporta:

- **Inglés Británico** (`en-GB`)
- **Español Latinoamericano** (`es-419`)

### Agregar nuevas traducciones

1. Edita ambos archivos: `/locales/en-GB.json` y `/locales/es-419.json`
2. Usa la misma estructura de keys en ambos archivos
3. Ejecuta `npm run validate-i18n` para verificar consistencia
4. Usa interpolación de variables con `{variable}` cuando sea necesario

Ejemplo:

```json
{
  "messages": {
    "importSuccess": "Imported {count} phrases from file."
  }
}
```

Uso en código:

```typescript
const { t } = useTranslation();
addLog('success', t('messages.importSuccess', { count: phrases.length }));
```

## Stack Tecnológico

- **React 19** - UI framework
- **TypeScript 5.8** - Type safety
- **Vite 6** - Build tool y dev server
- **Tailwind CSS** (via CDN) - Styling
- **Lucide React** - Iconografía
- **Google Gemini API** - Procesamiento de lenguaje natural e generación de imágenes
  - Gemini 3 Pro (Text)
  - Gemini 3 Pro Image / Gemini 2.5 Flash Image

## Contribuir

### Flujo de trabajo

1. Fork el repositorio
2. Crea una rama para tu feature: `git checkout -b feature/mi-feature`
3. Realiza tus cambios y commits con mensajes descriptivos
4. Ejecuta `npm run build` para verificar que no hay errores
5. Ejecuta `npm run validate-i18n` si modificaste traducciones
6. Push a tu fork: `git push origin feature/mi-feature`
7. Abre un Pull Request a la rama `local-dev`

### Convenciones de código

- Usa TypeScript con tipos explícitos
- Componentes funcionales con hooks
- Nombres de componentes en PascalCase
- Funciones y variables en camelCase
- Traduce todos los strings de UI (no hardcodear textos)
- Commits semánticos: `feat:`, `fix:`, `docs:`, `refactor:`, etc.

## Recursos Adicionales

- [SECURITY.md](./SECURITY.md) - Consideraciones de seguridad
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Arquitectura detallada del sistema
- [Google Gemini API Docs](https://ai.google.dev/docs)
- [NSM Homepage](https://nsm-approach.net/)

## Soporte

Para reportar bugs o solicitar features, abre un issue en el repositorio de GitHub.

---

*Esta guía está diseñada para facilitar la contribución al proyecto. Si encuentras alguna información desactualizada o faltante, por favor abre un issue.*
