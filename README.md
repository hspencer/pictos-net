
# PictoNet: Semantic Pictogram Architect (v2.5 Hierarchical)

**PictoNet** es una herramienta profesional diseñada para transformar enunciados de lenguaje natural en esquemas de pictogramas e imágenes finales (Bitmaps) semánticos de alta fidelidad, utilizando un motor de análisis lingüístico avanzado basado en NSM (Natural Semantic Metalanguage) y la potencia generativa de Gemini 2.5/3.0.

## Configuración Inicial

### 1. Instalación de Dependencias

```bash
npm install
```

### 2. Configuración de Variables de Entorno

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
- **ADVERTENCIA**: Esta aplicación expone la API key en el código del cliente (navegador). Para producción, considera implementar un backend proxy que maneje las llamadas a la API de Gemini de forma segura.

### 3. Ejecutar el Proyecto

#### Modo Desarrollo (Local)

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`

Este comando ejecuta Vite en modo desarrollo con:

- Hot Module Replacement (HMR)
- Acceso desde cualquier dispositivo en la red local (`0.0.0.0`)
- Las APIs de Gemini funcionarán normalmente si tu API key está configurada

#### Build para Producción

```bash
npm run build
```

Genera los archivos optimizados en el directorio `dist/`:

- JavaScript minificado y bundled
- Assets optimizados
- **NOTA**: La API key seguirá expuesta en el código compilado (ver advertencia de seguridad arriba)

#### Vista Previa del Build

```bash
npm run preview
```

Sirve la versión de producción localmente para probar el build antes de desplegar.

### Despliegue en GitHub Pages

El proyecto incluye un workflow de GitHub Actions (`.github/workflows/deploy.yml`) que despliega automáticamente a GitHub Pages desde la rama `local-dev`.

#### Configuración inicial:

1. **Habilitar GitHub Pages**:
   - Ve a Settings → Pages en tu repositorio
   - En "Source", selecciona "GitHub Actions"

2. **Configurar el secreto GEMINI_API_KEY**:
   - Ve a Settings → Secrets and variables → Actions
   - Crea un nuevo "Repository secret" llamado `GEMINI_API_KEY`
   - Pega tu API key de Google Gemini como valor

3. **Desplegar**:
   - Haz push a la rama `local-dev`
   - El workflow se ejecutará automáticamente
   - La aplicación estará disponible en: `https://<tu-usuario>.github.io/pictos-net/`

También puedes ejecutar el workflow manualmente desde la pestaña "Actions" en GitHub.

**NOTA DE SEGURIDAD**: Aunque la API key está configurada como secreto de GitHub, seguirá siendo visible en el código JavaScript compilado del navegador. Para entornos de producción públicos, considera implementar un backend proxy.

### Verificación de Servicios de IA

Para verificar que los servicios de Gemini funcionan correctamente en local:

1. Asegúrate que tu archivo `.env` contiene una API key válida
2. Ejecuta `npm run dev`
3. Abre `http://localhost:3000` en tu navegador
4. Ingresa un utterance de prueba (ej: "Quiero beber agua")
5. El sistema debería generar:
   - Análisis NLU (usando Gemini 3 Pro)
   - Blueprint visual
   - Imagen final (usando Gemini 3 Pro Image o Gemini 2.5 Flash Image)

Si encuentras errores de API, verifica:

- La API key está correctamente configurada en `.env`
- La API key es válida en Google AI Studio
- Tienes conexión a internet
- No has excedido tu cuota de API

## Consistencia Transversal

La aplicación utiliza un esquema de datos unificado en todo el pipeline:

- **UTTERANCE**: El texto de entrada (intención comunicativa).
- **NLU**: El esquema semántico MediaFranca (JSON), incluyendo análisis NSM detallado basado en 65 primitivos universales.
- **elements**: Una estructura jerárquica de componentes visuales que define la composición del pictograma.
- **prompt**: La estrategia de articulación espacial que describe cómo se relacionan los elementos (generada en el idioma del utterance).
- **bitmap**: La imagen final generada (Base64 PNG).

## Formato de Intercambio (JSON)

El proyecto se exporta en un único archivo JSON que contiene tanto la configuración como los datos completos (incluyendo las imágenes generadas).

```json
{
  "version": "2.5",
  "config": { ... },
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
      "bitmap": "data:image/png;base64,iVBORw0KGgoAAA..."
    }
  ]
}
```

## Funcionalidades Clave

- **Motor NSM Estricto**: Análisis semántico alineado con los 65 primitivos semánticos de Wierzbicka/Goddard.
- **Generación Multi-idioma**: Detección automática del idioma del utterance para generar identificadores y prompts coherentes.
- **Batch Processing**: Ejecución en cascada desde la intención hasta la imagen final.
- **Workbench Editable**: Permite corregir cada paso del pipeline, marcando los pasos subsecuentes como desactualizados para garantizar consistencia.
- **Gestión de Librería**: Menú unificado para importar/exportar proyectos completos con imágenes incrustadas.
- **Semantic Monitor**: Seguimiento en tiempo real de las llamadas a la API de Gemini.

---
*Optimizado para investigación en lingüística aplicada y accesibilidad cognitiva.*
