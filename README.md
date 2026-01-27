# PICTOS.NET

## Pictogramas Generativos para la Accesibilidad Cognitiva

**PICTOS** es una herramienta de [investigación doctoral](http://herbertspencer.net/cc) que explora la generación automática de pictogramas a partir de intenciones comunicativas expresadas en lenguaje natural. El proyecto investiga cómo transformar el significado profundo del lenguaje en representaciones visuales universales que faciliten la comunicación para personas con diversidad cognitiva.

Este proyecto avanza sobre [PICTOS.cl](https://pictos.cl) desarrollado por el [Núcleo de Accesibilidad e Inclusión PUCV](https://accesibilidad-inclusion.cl/) enfocado en el desarrollo de apoyos visuales y procedimentales para la interacción accesible con los servicios públicos en Chile.


## Cómo Funciona PICTOS.NET

### Almacenamiento Local

⚠️ **Importante**: Todos los pictogramas y datos se almacenan **localmente en el navegador** usando `localStorage`. Esto significa:

- Los datos persisten entre sesiones en el mismo navegador
- Si limpias los datos del navegador, **perderás todo tu trabajo**
- Para respaldar tu trabajo, usa la función **Exportar Grafo** en el menú de Librería
- Los archivos JSON exportados contienen toda la información, incluyendo las imágenes en Base64 y las evaluaciones.

💡 **Contribuye al proyecto**: Puedes enviar tu grafo exportado con tus comentarios y recomendaciones a [hspencer@ead.cl](mailto:hspencer@ead.cl). De esta forma ayudarás a mejorar esta herramienta de comunicación de código abierto.

![código abierto](https://img.shields.io/badge/opensource--always-available-blue)

#### Arquitectura de Almacenamiento: Bitmaps + SVGs

PICTOS implementa un sistema de **almacenamiento dual** que mantiene tanto versiones bitmap como vectoriales:

##### Bitmaps (RowData)

- Almacenados como parte del grafo principal en `RowData.bitmap`
- Formato: Base64 data URLs (PNG)
- Incluyen: NLU, elementos visuales, prompts, evaluación VCSCI
- Exportables como JSON con toda la trazabilidad del pipeline

##### SVGs (Biblioteca Separada)

- Almacenados en una biblioteca independiente (`SVGLibrary`)
- Principio **Single Source of Truth (SSoT)**: cada SVG es autosuficiente
- Incluyen metadatos embebidos: NSM, conceptos semánticos, VCSCI, accesibilidad
- Referencia al RowData original mediante `sourceRowId` (relación 1:1)
- Cumplen con el estándar [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema)

Esta arquitectura permite:

- Mantener bitmaps para iteración rápida del pipeline generativo
- Generar SVGs solo para pictogramas de alta calidad (VCSCI ≥ 4.0)
- Exportar SVGs como artefactos independientes con toda su semántica embebida
- Interoperar con otras herramientas que consuman mf-svg-schema

### Generando Pictogramas

Hay dos formas de generar un pictograma a partir de una intención comunicativa:

#### 1. Modo Cascada (Automático)

Presiona el botón **▶ Play** en la barra de cada utterance para ejecutar el pipeline completo automáticamente:

```
Utterance → NLU → Visual → Bitmap
```

Este modo procesa las tres fases secuencialmente sin intervención manual. Ideal para generación rápida.

#### 2. Modo Paso a Paso (Control Total)

Expande la barra del utterance para revelar los **3 bloques interiores**:

1. **Comprender (NLU)**: Análisis semántico basado en NSM de 65 primitivos
2. **Componer (Visual)**: Elementos jerárquicos y lógica de articulación espacial
3. **Producir (Bitmap)**: Renderizado de la imagen final

Cada bloque tiene su propio botón de regeneración, permitiéndote:
- Inspeccionar y editar los resultados intermedios
- Regenerar solo una fase específica
- Experimentar con diferentes configuraciones

La **evaluación VCSCI** (cuarto bloque) es siempre manual, permitiendo valorar la calidad del pictograma generado según 6 dimensiones.

### Generación de Pictogramas Vectoriales (SVG)

Una vez completadas las fases principales y la evaluación VCSCI, los pictogramas con calificación **≥ 4.0** pueden convertirse a formato vectorial estructurado:

#### Proceso de Vectorización en Dos Etapas

1. **Trace (Vectorizar)**: Convierte el bitmap PNG a SVG vectorial usando vtracer (WASM)
   - Genera un SVG "crudo" con paths optimizados
   - Permite previsualizar y descargar el SVG sin procesar
   - Usa algoritmos de ajuste de curvas spline para suavidad óptima

2. **Format (Estructurar)**: Transforma el SVG crudo en un SVG semántico usando Gemini Pro
   - Agrupa elementos según roles semánticos (Agent, Patient, Theme, Action)
   - Embebe metadatos completos: NSM primes, conceptos, accesibilidad, VCSCI
   - Aplica el esquema [mf-svg-schema](https://github.com/mediafranca/mf-svg-schema) para máxima interoperabilidad
   - Genera estilos CSS configurables y clases reutilizables

Los SVGs generados son **autocontenidos** e incluyen toda la información semántica, permitiendo su uso independiente en cualquier contexto.

### Importación y Exportación

#### Grafos (RowData)

- **Exportar Grafo**: Genera un archivo JSON con todos los nodos, incluyendo imágenes bitmap en Base64
- **Importar Grafo**: Carga un archivo JSON previamente exportado (se pedirá confirmación si hay datos existentes)

#### SVGs Individuales

- **Descargar SVG**: Cada pictograma vectorial puede descargarse como archivo `.svg` independiente
- Los SVGs descargados son **autocontenidos** e incluyen:
  - Metadatos semánticos (NSM, conceptos, roles)
  - Información de accesibilidad (ARIA labels, descriptions)
  - Datos de evaluación VCSCI
  - Información de proveniencia (generador, fecha, licencia)
  - Estilos CSS embebidos y configurables


## Filosofía del Proyecto

### Del Lenguaje Natural a la Imagen

Los pictogramas son más que ilustraciones: son sistemas de comunicación visual que deben capturar la **esencia semántica** de un mensaje. PICTOS propone un enfoque generativo que atraviesa tres dimensiones fundamentales:

1. **Comprender**: Análisis lingüístico profundo basado en Natural Semantic Metalanguage (NSM)
2. **Componer**: Definición de elementos visuales jerárquicos y su lógica de articulación espacial
3. **Producir**: Renderizado final de la imagen mediante inteligencia artificial generativa

Este pipeline reconoce que la comunicación visual efectiva requiere primero **comprender profundamente** qué se quiere comunicar, antes de decidir **cómo visualizarlo**.

### Fundamentos Teóricos

El proyecto se apoya en dos pilares conceptuales:

**Natural Semantic Metalanguage (NSM)**
Un enfoque lingüístico desarrollado por Anna Wierzbicka y Cliff Goddard que identifica 65 conceptos semánticos universales presentes en todas las lenguas humanas. Estos primitivos semánticos permiten descomponer el significado de cualquier enunciado en sus elementos más básicos, facilitando una representación visual culturalmente neutra.

**Visual Communication Semiotic Construction Index (VCSCI)**
Un marco de evaluación multidimensional que mide la calidad de los pictogramas según seis ejes:
- **Semantics**: Precisión del significado
- **Syntactics**: Composición visual
- **Pragmatics**: Adecuación al contexto
- **Clarity**: Legibilidad
- **Universality**: Neutralidad cultural
- **Aesthetics**: Atractivo visual

### Arquitectura como Investigación

PICTOS implementa una **arquitectura de grafo semántico** donde cada nodo representa un utterance (intención comunicativa) y sus transformaciones sucesivas:

```
Utterance → Análisis NSM → Blueprint Visual → Imagen PNG → Evaluación VCSCI
                                                      ↓
                                          [Si VCSCI ≥ 4.0]
                                                      ↓
                                    Vectorización (vtracer) → SVG crudo
                                                      ↓
                              Estructuración semántica (Gemini) → SVG mf-schema
```

Esta arquitectura permite:

- **Trazabilidad completa**: Desde la intención original hasta la imagen final (bitmap o SVG)
- **Iteración experimental**: Regenerar cualquier paso sin perder el contexto
- **Evaluación sistemática**: Medir la calidad de los pictogramas según criterios objetivos
- **Exportación de datasets**: Construir corpus de pictogramas para investigación
- **Formatos múltiples**: Mantener bitmaps para iteración y generar SVGs para producción
- **Semántica embebida**: Los SVGs son artefactos autocontenidos con metadatos completos

### Accesibilidad e Inclusión

El proyecto nace de una convicción: **la comunicación visual debe ser universal y accesible**. Los pictogramas generados por PICTOS buscan:

- Reducir barreras cognitivas en la comunicación
- Facilitar la expresión de necesidades básicas
- Promover la autonomía de personas con diversidad funcional
- Contribuir a entornos más inclusivos

### Tecnología al Servicio del Significado

PICTOS utiliza modelos de lenguaje e imagen de última generación (Google Gemini 3 Pro) no como un fin en sí mismo, sino como **instrumentos para explorar la relación entre lenguaje y representación visual**. La herramienta es un laboratorio donde investigadores, lingüistas y diseñadores pueden experimentar con diferentes estrategias de visualización.


## El Vocabulario Base VCSCI

El proyecto incluye un módulo de investigación con **20 frases de intenciones comunicativas básicas**, cuidadosamente seleccionadas para representar necesidades fundamentales en situaciones cotidianas:

- "Quiero beber agua"
- "Necesito ir al baño"
- "Tengo dolor"
- "Quiero comer algo"
- [... y 16 más]

Este vocabulario base sirve como **benchmark** para evaluar y comparar diferentes enfoques de generación de pictogramas.


## Casos de Uso

### Investigación Lingüística

Explorar cómo diferentes lenguas expresan conceptos universales y cómo estos se pueden visualizar de manera transcultural. Los SVGs semánticos permiten analizar la correspondencia entre primitivos NSM y elementos visuales.

### Diseño de Sistemas de Comunicación Aumentativa

Generar rápidamente prototipos de pictogramas para sistemas AAC (Augmentative and Alternative Communication). Los SVGs escalables garantizan legibilidad en cualquier dispositivo, desde tablets hasta pantallas grandes.

### Educación Especial

Crear materiales visuales personalizados adaptados a las necesidades específicas de cada estudiante. Los SVGs permiten ajustar estilos, colores y tamaños sin pérdida de calidad.

### Evaluación de Pictogramas Existentes

Usar los criterios VCSCI para analizar y mejorar pictogramas de bibliotecas existentes (ARASAAC, Mulberry, etc.). Comparar pictogramas generados automáticamente con estándares establecidos.

### Desarrollo de Corpus Visuales

Construir datasets de pictogramas para entrenar modelos de IA o realizar estudios de percepción visual. Los SVGs con metadatos embebidos facilitan el análisis computacional de características semánticas.

### Interoperabilidad y Publicación

Exportar pictogramas vectoriales con metadatos completos para integración en aplicaciones web, sistemas AAC comerciales, o publicación como recursos educativos abiertos (OER).


## Principios de Diseño

1. **Transparencia Semántica**: Cada paso del pipeline es visible y editable
2. **Neutralidad Cultural**: Los pictogramas buscan ser comprensibles más allá de fronteras lingüísticas
3. **Simplicidad Compositiva**: Elementos visuales mínimos pero expresivos
4. **Coherencia Estilística**: Uniformidad visual en toda la biblioteca generada
5. **Trazabilidad Completa**: Rastrear cada decisión desde el utterance hasta el píxel final


## Tecnología

- **Frontend**: React + TypeScript + Vite
- **Procesamiento Lingüístico**: Google Gemini 3 Pro (análisis NSM)
- **Generación de Imágenes**: Gemini 2.5 Flash Image / Gemini 3 Pro Image
- **Vectorización**: VTracer WASM (bitmap → SVG)
- **Estructuración SVG**: Gemini 3 Pro (aplicación de mf-svg-schema)
- **Arquitectura**: Cliente-lado con almacenamiento local (localStorage)
- **Almacenamiento Dual**: Bitmaps (RowData) + SVGs (Biblioteca independiente)
- **Internacionalización**: Soporte para inglés (UK) y español (Latinoamérica)
- **Licencia**: MIT (código) / CC-BY-4.0 (imágenes generadas)

### Esquemas y Módulos Externos

PICTOS integra esquemas de investigación como **git submodules**, permitiendo versionado explícito y reproducibilidad científica:

- **[NLU Schema](https://github.com/mediafranca/nlu-schema)** - Esquema MediaFranca para análisis lingüístico profundo basado en NSM (Natural Semantic Metalanguage). Define la estructura para la fase "Comprender".

- **[VCSCI](https://github.com/mediafranca/VCSCI)** - Visual Communication Semiotic Construction Index. Marco de evaluación multidimensional para pictogramas (6 métricas: Semantics, Syntactics, Pragmatics, Clarity, Universality, Aesthetics). Usado en la fase "Evaluar".

- **[MF-SVG Schema](https://github.com/mediafranca/mf-svg-schema)** - Esquema para pictogramas vectoriales estructurados. Define la composición jerárquica de elementos visuales y su articulación espacial. Fundamento para la futura fase "Componer SVG".

Cada esquema evoluciona de forma independiente, permitiendo actualizaciones controladas sin afectar la estabilidad de PICTOS.


## Comenzar a Usar PICTOS

- **Aplicación web**: [pictos.net](https://pictos.net)
- **Para desarrolladores**: Consulta [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Consideraciones de seguridad**: Lee [SECURITY.md](./SECURITY.md)
- **Arquitectura técnica**: Ver [ARCHITECTURE.md](./ARCHITECTURE.md)


## Citar este Proyecto

Si usas PICTOS en tu investigación, considera citarlo como:

```
PICTOS.NET (2025). Pictogramas Generativos para la Accesibilidad Cognitiva.
Sistema de generación automática basado en NSM y evaluación VCSCI.
Disponible en: https://pictos.net
```

---

## Roadmap

### v2.8 (Actual - SVG Generation)

- ✅ Generación de pictogramas vectoriales (SVG)
- ✅ Pipeline de vectorización en dos etapas: Trace + Format
- ✅ Integración con vtracer (WASM) para conversión bitmap→SVG
- ✅ Estructuración semántica con Gemini Pro según mf-svg-schema
- ✅ Biblioteca SVG independiente con almacenamiento SSoT
- ✅ Sistema de estilos CSS configurable para SVGs
- ✅ Metadatos embebidos: NSM, conceptos, VCSCI, accesibilidad
- ✅ Exportación e importación de SVGs individuales
- ✅ Filtro de elegibilidad VCSCI ≥ 4.0 para generación SVG

### v2.7

- ✅ Integración de esquemas de investigación como git submodules
- ✅ Documentación completa de workflow con submodules
- ✅ Mejoras en sistema de ayuda de evaluación VCSCI
- ✅ Enlaces corregidos a repositorios externos

### v2.6

- ✅ Pipeline completo: Understand → Compose → Produce → Evaluate
- ✅ Interfaz bilingüe (ES/EN)
- ✅ Evaluación VCSCI integrada
- ✅ Exportación con imágenes embebidas

### Próximas Versiones

- 🔄 Soporte para más idiomas (FR, PT, CA)
- 🔄 Integración con bibliotecas de pictogramas existentes (ARASAAC, Mulberry)
- 🔄 Editor visual de SVG con manipulación directa de grupos semánticos
- 🔄 Exportación masiva de SVGs como dataset
- 🔄 Animaciones SVG basadas en roles semánticos
- 🔄 Colaboración multi-usuario en tiempo real
- 🔄 API pública para integración con otros sistemas

---

## Comunidad y Contribuciones

PICTOS es un proyecto abierto que invita a:

- **Lingüistas** a refinar el análisis NSM
- **Diseñadores** a mejorar la composición visual
- **Investigadores** a validar los criterios VCSCI
- **Desarrolladores** a extender las funcionalidades
- **Usuarios finales** a reportar necesidades reales

Las contribuciones son bienvenidas. Por favor lee [CONTRIBUTING.md](./CONTRIBUTING.md) antes de comenzar.


## Reconocimientos

Este proyecto se inspira en el trabajo de:

- **Anna Wierzbicka** y **Cliff Goddard** (Natural Semantic Metalanguage)
- **ARASAAC** (Proyecto aragonés de pictogramas)
- La comunidad de Comunicación Aumentativa y Alternativa (AAC)
- Investigadores en accesibilidad cognitiva y diseño universal


## Contacto

Para preguntas, sugerencias o colaboraciones:

- Abre un issue en GitHub
- Reporta bugs en el repositorio
- Propone nuevas funcionalidades mediante Pull Requests
- Esta aplicación es el sitio de investigación doctoral de [Herbert Spencer](https://herbertspencer.net).

---

*PICTOS.NET - es una iniciativa de código abierto de MediaFranca.*

**Versión 2.8** | Pictogramas vectoriales semánticos para investigación en lingüística aplicada y accesibilidad cognitiva.
