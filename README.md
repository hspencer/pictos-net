# [PICTOS.NET](https://pictos.net)

**Pictogramas generativos para la Comunicación Aumentativa y Alternativa (CAA)**

* [![Netlify Status](https://api.netlify.com/api/v1/badges/24f068d3-f368-4526-a503-2f09af1def0b/deploy-status)](https://app.netlify.com/projects/pictos/deploys)
* ![version](https://img.shields.io/badge/version-2.3.0-violet)
* ![opensource](https://img.shields.io/badge/opensource--always-available-blue)

PICTOS.NET transforma intenciones comunicativas expresadas en lenguaje natural en pictogramas mediante un pipeline de razonamiento semántico. Es parte de la investigación doctoral de [Herbert Spencer](https://herbertspencer.net/cc) y de **[MediaFranca](https://github.com/mediafranca)** — una iniciativa de código abierto de bien público para la CAA.

La rama de desarrollo `dev` contiene la siguiente versión:

* ver: [next.PICTOS.net](https://next.pictos.net)
* [![Netlify Status](https://api.netlify.com/api/v1/badges/c3a0cb25-110a-49a6-9d9b-05ccf7a72347/deploy-status)](https://app.netlify.com/projects/pictos-next/deploys)

## Cómo funciona

El sistema implementa un pipeline de tres fases automáticas más una de post-procesamiento opcional. Cada fase es visible, editable y regenerable de forma independiente:

**(1) Comprender** (Claude Haiku) — Análisis lingüístico profundo basado en Natural Semantic Metalanguage (NSM): 65 primitivos semánticos universales. Usa tool use forzado para garantizar JSON válido. Produce un esquema estructurado con intención comunicativa, dominio, roles semánticos (FrameNet) e instrucciones visuales.

**(2) Componer** (Claude Haiku) — Traduce el análisis NLU a una jerarquía de elementos visuales (`elements`) y una descripción de articulación espacial (`prompt`). Cada elemento lleva un `concept` semántico (Agent, Action, Object, Context) derivado de los roles de frame del NLU, que viaja hasta el `data-concept` del SVG final. Si el usuario edita los elementos, puede regenerar solo el prompt sin repetir toda la composición.

**(3) Producir** (Recraft V4.1 Vector) — Genera el pictograma como SVG nativo a partir del contexto semántico, los elementos, el prompt espacial y el estilo visual configurado. No hay bitmap intermedio: el resultado es un SVG vectorial directamente editable.

**(4) Estructurar** (Claude Sonnet, opcional) — Reorganiza los paths del SVG crudo en grupos semánticos congruentes con la jerarquía de la fase 2, embebiendo metadatos de accesibilidad según [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema). Combina medición geométrica local (anclas reales por `getBBox` + CTM, candidatos de fusión pre-calculados), una sola llamada de visión (set-of-marks con anti-colisión y líneas guía), ensamblaje local con redes de seguridad y pulido geométrico determinístico: la geometría nunca sale del navegador ni la escribe el modelo. Documentación detallada en [docs/ESTRUCTURAR.md](docs/ESTRUCTURAR.md).

La cascada automática (1 → 2 → 3) se ejecuta al crear una nueva frase o presionar Play. La fase 4 es opcional y la inicia el usuario manualmente. Los pictogramas pueden evaluarse con el marco [ICAP](https://github.com/mediafranca/ICAP).

## Esquema detallado

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#e8f0fe',
    'primaryTextColor': '#1a1a2e',
    'primaryBorderColor': '#4a6fa5',
    'lineColor': '#888',
    'fontSize': '13px',
    'fontFamily': 'Lexend, system-ui, sans-serif'
  },
  'flowchart': {
    'padding': 20,
    'nodeSpacing': 35,
    'rankSpacing': 45,
    'curve': 'basis'
  }
}}%%
flowchart TD
    UTT["<b>utterance</b><br><i>intención comunicativa</i>"]

    subgraph CFG["<b>GlobalConfig</b>"]
        direction TB
        cfg_lang["lang · geoContext<br>annotatedContext"]
        cfg_visual["visualStylePrompt"]
        cfg_css["svgStyleDefs · svgKeyframes"]
    end

    subgraph F1["<b>(1) COMPRENDER</b> — Claude Haiku"]
        direction TB
        f1_proc["NSM Schema Engine<br>65 primos universales<br>nlu-schema v1.0<br>tool use forzado"]
        f1_out["<b>NLUData</b><br>domain · frames · frame_label<br>nsm_explications<br>visual_guidelines · pragmatics"]
    end

    subgraph F2["<b>(2) COMPONER</b> — Claude Haiku"]
        direction TB
        f2a["Visual Topology Node<br><i>genera elements + prompt<br>en una sola llamada</i>"]
        f2b["Spatial Articulation Node<br><i>solo en regeneración manual<br>cuando usuario edita elements</i>"]
        f2_elem["<b>elements</b><br>VisualElement tree<br><i>concept por nodo desde<br>roles de frame NLU</i>"]
        f2_prompt["<b>prompt</b><br>composición espacial"]
    end

    subgraph F3["<b>(3) PRODUCIR</b> — Recraft V4.1 Vector"]
        direction TB
        f3_merge["<b>fullPrompt</b> combina:<br>utterance + NLU context<br>+ elements + prompt<br>+ visualStylePrompt"]
        f3_gen["recraftv4_1_vector<br>sin texto · fondo blanco"]
        f3_out["<b>rawSvg</b><br>SVG vectorial nativo"]
    end

    subgraph POST["Post-procesamiento — manual, opcional · ver docs/ESTRUCTURAR.md"]
        direction TB
        subgraph F4["<b>(4) ESTRUCTURAR</b> — Claude Sonnet Vision"]
            direction TB
            f4_measure["Medición local<br><i>anclas reales getBBox + CTM<br>candidatos de fusión (IoU bbox)</i>"]
            f4_marks["Set-of-marks<br><i>marcas numeradas con anti-colisión<br>y líneas guía al ancla</i>"]
            f4_vision["Claude vision<br><i>asigna paths a elementos<br>confirma fusiones · tool use forzado</i>"]
            f4_assemble["Ensamblaje local<br><i>uniones booleanas + redes de seguridad<br>geometría nunca sale del browser</i>"]
            f4_polish["Pulido determinístico<br><i>refit selectivo a curvas<br>redondeo de coordenadas</i>"]
            f4_out["<b>structuredSvg</b><br>mf-svg-schema · grupos semánticos<br>data-concept congruente con NLU<br>metadatos de accesibilidad"]
        end
    end

    subgraph ROW["<b>RowData</b> — estado acumulativo por fila"]
        direction LR
        r1["NLU"]
        r2["elements<br>prompt"]
        r3["rawSvg"]
        r4["structuredSvg"]
    end

    UTT ==> F1
    cfg_lang --> F1
    f1_proc --> f1_out

    f1_out ==> F2
    cfg_css -.->|availableClasses| F2
    f2a --> f2_elem
    f2a --> f2_prompt
    f2b -.->|"regenera solo prompt"| f2_prompt

    f2_elem ==> F3
    f2_prompt ==> F3
    cfg_visual --> f3_merge
    f1_out -.->|"intent · domain · focus"| f3_merge
    UTT -.->|contexto original| f3_merge
    f3_merge --> f3_gen --> f3_out

    f3_out -.->|"usuario inicia"| POST
    f2_elem -.->|"estructura DOM + concept"| f4_vision
    cfg_css -->|generateStylesheet| f4_assemble
    f4_measure --> f4_marks --> f4_vision --> f4_assemble --> f4_polish --> f4_out

    f1_out --> r1
    f2_elem --> r2
    f2_prompt --> r2
    f3_out --> r3
    f4_out --> r4

    style UTT fill:#fff3cd,stroke:#e6a800,stroke-width:2px,color:#664d00
    style CFG fill:#f5f5f5,stroke:#aaa,stroke-width:1px,color:#555
    style cfg_lang fill:#e9e9e9,stroke:#bbb,color:#444
    style cfg_visual fill:#e9e9e9,stroke:#bbb,color:#444
    style cfg_css fill:#e9e9e9,stroke:#bbb,color:#444

    style F1 fill:#dbeafe,stroke:#3b82f6,stroke-width:2px
    style f1_proc fill:#eff6ff,stroke:#93c5fd,color:#1e40af
    style f1_out fill:#bfdbfe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f

    style F2 fill:#d1fae5,stroke:#10b981,stroke-width:2px
    style f2a fill:#ecfdf5,stroke:#6ee7b7,color:#065f46
    style f2b fill:#ecfdf5,stroke:#6ee7b7,color:#065f46,stroke-dasharray: 5 5
    style f2_elem fill:#a7f3d0,stroke:#10b981,stroke-width:2px,color:#064e3b
    style f2_prompt fill:#a7f3d0,stroke:#10b981,stroke-width:2px,color:#064e3b

    style F3 fill:#ffedd5,stroke:#f97316,stroke-width:2px
    style f3_merge fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style f3_gen fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style f3_out fill:#fed7aa,stroke:#f97316,stroke-width:2px,color:#7c2d12

    style POST fill:#f8f8ff,stroke:#999,stroke-width:1px,stroke-dasharray: 8 4
    style F4 fill:#fce7f3,stroke:#ec4899,stroke-width:2px
    style f4_measure fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_marks fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_vision fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_assemble fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_polish fill:#fdf2f8,stroke:#f9a8d4,color:#831843
    style f4_out fill:#fbcfe8,stroke:#ec4899,stroke-width:2px,color:#831843

    style ROW fill:#fafafa,stroke:#333,stroke-width:3px
    style r1 fill:#bfdbfe,stroke:#3b82f6,color:#1e3a5f
    style r2 fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style r3 fill:#fed7aa,stroke:#f97316,color:#7c2d12
    style r4 fill:#fbcfe8,stroke:#ec4899,color:#831843
```

### Modelo de retroalimentación

Cada campo es editable. Al modificar un dato, los pasos posteriores se marcan como `outdated` y el usuario puede regenerarlos selectivamente:

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#fafafa',
    'primaryTextColor': '#1a1a2e',
    'lineColor': '#888',
    'fontSize': '12px',
    'fontFamily': 'Lexend, system-ui, sans-serif'
  },
  'flowchart': { 'curve': 'basis' }
}}%%
flowchart LR
    subgraph EDIT["Edición del usuario"]
        e1["Edita <b>utterance</b>"]
        e2["Edita <b>NLU</b>"]
        e3["Edita <b>elements</b>"]
        e4["Edita <b>prompt</b>"]
    end

    subgraph INVALIDATION["Campos invalidados"]
        nlu_out["NLU outdated"]
        vis_out["visual outdated"]
        svg_out["rawSvg outdated"]
    end

    subgraph REGEN["Regeneración disponible"]
        r1["Regenerar NLU"]
        r2["Regenerar composición"]
        r2b["Regenerar solo prompt"]
        r3["Regenerar SVG"]
        r_all["Cascada completa"]
    end

    e1 --> nlu_out & vis_out & svg_out
    e2 --> vis_out & svg_out
    e3 --> svg_out
    e3 -.->|"botón Regenerar Prompt"| r2b
    e4 --> svg_out
    e4 -.->|"botón Producir"| r3

    nlu_out --> r1 --> r_all
    vis_out --> r2
    svg_out --> r3

    style EDIT fill:#fff3cd,stroke:#e6a800
    style INVALIDATION fill:#fef3c7,stroke:#f59e0b
    style REGEN fill:#ecfdf5,stroke:#10b981
    style nlu_out fill:#fde68a,stroke:#f59e0b,color:#92400e
    style vis_out fill:#fde68a,stroke:#f59e0b,color:#92400e
    style svg_out fill:#fde68a,stroke:#f59e0b,color:#92400e
```

### Parámetros de configuración global

| Parámetro | Fase | Estado | Descripción |
|---|---|---|---|
| `lang` | 1, 2, 4 | Activo | Idioma del análisis NLU y de los IDs de elementos |
| `uiLang` | — | Activo | Idioma de la interfaz (independiente del NLU) |
| `geoContext` | 1, 4 | Activo | Región geográfica para contextualización y metadatos a11y |
| `annotatedContext` | 1 | Activo | Contexto adicional anotado por el usuario (inyectado en el prompt NLU) |
| `visualStylePrompt` | 3 | Activo | Descripción de estilo visual inyectada en el prompt de Recraft |
| `svgStyleDefs` | 2, 4 | Activo | Definiciones CSS del SVG (clases disponibles en composición y en estructuración) |
| `svgKeyframes` | 4 | Activo | Keyframes de animación para el SVG estructurado |
| `aspectRatio` | — | Inactivo | Era el aspect ratio de Gemini Image; Recraft V4.1 usa tamaño fijo |
| `imageModel` | — | Inactivo | Era el selector flash/pro de Gemini; eliminado del pipeline |

---

## Filosofía

Los pictogramas son más que ilustraciones: son actos comunicativos. PICTOS propone que para generar un buen pictograma hay que primero *comprender profundamente* qué se quiere comunicar, antes de decidir cómo visualizarlo.

El proyecto nace de una convicción: **la comunicación visual debe ser explicable y accesible, basada en el contexto**.

Los pictogramas generados buscan reducir barreras cognitivas, facilitar la expresión de necesidades básicas y contribuir a la autonomía de personas con diversidad funcional.

---

## Ecosistema MediaFranca

PICTOS.NET es parte de [MediaFranca](https://github.com/mediafranca), un conjunto de esquemas abiertos para la comunicación aumentativa y alternativa:

| Repositorio | Descripción |
|---|---|
| [nlu-schema](https://github.com/mediafranca/nlu-schema) | Esquema de análisis lingüístico profundo basado en NSM |
| [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema) | Estándar para pictogramas SVG semánticos y autocontenidos |
| [ICAP](https://github.com/mediafranca/ICAP) | Marco de evaluación de pictogramas (6 dimensiones cognitivas) |
| [pictos.cl](https://pictos.cl) | Plataforma de apoyos visuales para servicios públicos (Núcleo Accesibilidad PUCV) |

`nlu-schema` y `mf-svg-schema` se incluyen como git submodules en este repositorio.

---

## Uso

**Aplicación web**: [pictos.net](https://pictos.net)

Los pictogramas y datos se almacenan **localmente en el navegador** (IndexedDB + localStorage). Para respaldar tu trabajo usa **Exportar Librería** — genera un JSON con todas las imágenes y metadatos del pipeline.

Puedes compartir tu grafo exportado con comentarios a [contact@pictos.net](mailto:contact@pictos.net).

---

## Desarrollo local

```bash
git clone --recurse-submodules https://github.com/hspencer/pictos-net.git
cd pictos-net
cp .env.example .env        # agrega ANTHROPIC_API_KEY y RECRAFT_API_KEY
npm install
npm run dev                 # → http://localhost:9001 (netlify dev)
```

Las API keys necesarias:
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com)
- `RECRAFT_API_KEY` — [recraft.ai](https://www.recraft.ai/api)
- `GITHUB_TOKEN` — para la función de compartir pictogramas (opcional)

Ver [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) para instrucciones completas.

---

## Stack

- React 19 + TypeScript 5.8
- Vite 6 + Tailwind CSS 3.4
- Zustand (estado SVG editor)
- Anthropic SDK — Claude Haiku 4.5 (fases 1 y 2) + Claude Sonnet 4.6 (fase 4, visión)
- Recraft V4.1 Vector (fase 3, SVG nativo)
- Netlify Functions (proxy API con JWT) + Netlify Identity
- IndexedDB v3 + localStorage (persistencia dual)

---

## Documentación

### Arquitectura y desarrollo

| Documento | Descripción |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Arquitectura técnica, modelos de datos, servicios |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Guía de desarrollo, submodules, i18n, deployment |
| [docs/SECURITY.md](./docs/SECURITY.md) | Gestión de API keys, consideraciones de seguridad |
| [docs/PIPELINE_MIGRATION_CLAUDE_RECRAFT.md](./docs/PIPELINE_MIGRATION_CLAUDE_RECRAFT.md) | Notas de la migración Gemini → Claude + Recraft (v1.x → v2.0) |

### Interfaz de usuario

| Documento | Descripción |
|---|---|
| [docs/UI_MAP.md](./docs/UI_MAP.md) | Mapa estructural de la UI: todos los IDs semánticos |
| [docs/UI_CONVENTIONS.md](./docs/UI_CONVENTIONS.md) | Convenciones de diseño: colores, tipografía, z-index |
| [docs/CSS_STYLING_ARCHITECTURE.md](./docs/CSS_STYLING_ARCHITECTURE.md) | Modelo de dos niveles para estilos SVG (clases + overrides locales) |
| [docs/WCAG_ROADMAP.md](./docs/WCAG_ROADMAP.md) | Estado de conformidad WCAG 2.1 AA y roadmap de accesibilidad |

---

## Comunidad

PICTOS invita a **lingüistas** a refinar el análisis NLU y NSM, **diseñadores** a mejorar la composición visual, a **educadores y sicólogos** a imaginar nuevos escenarios de uso, **investigadores** a validar métricas de calidad, y **desarrolladores** a extender las funcionalidades.

Las contribuciones son bienvenidas. Reporta bugs, propone features o abre un Pull Request en GitHub.

---

## Citar

```
Spencer, H. (2026). PICTOS.NET: Pictogramas generativos para la accesibilidad cognitiva.
MediaFranca. https://pictos.net
```

*Licencia: Apache 2.0 (código) · CC-BY-4.0 (pictogramas generados, según elección del usuario)*
