# PICTOS.NET

## Pictogramas Generativos para la Accesibilidad Cognitiva

**PICTOS** es una herramienta de investigación que explora la generación automática de pictogramas a partir de intenciones comunicativas expresadas en lenguaje natural. El proyecto investiga cómo transformar el significado profundo del lenguaje en representaciones visuales universales que faciliten la comunicación para personas con diversidad cognitiva.

---

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
```

Esta arquitectura permite:
- **Trazabilidad completa**: Desde la intención original hasta la imagen final
- **Iteración experimental**: Regenerar cualquier paso sin perder el contexto
- **Evaluación sistemática**: Medir la calidad de los pictogramas según criterios objetivos
- **Exportación de datasets**: Construir corpus de pictogramas para investigación

### Accesibilidad e Inclusión

El proyecto nace de una convicción: **la comunicación visual debe ser universal y accesible**. Los pictogramas generados por PICTOS buscan:

- Reducir barreras cognitivas en la comunicación
- Facilitar la expresión de necesidades básicas
- Promover la autonomía de personas con diversidad funcional
- Contribuir a entornos más inclusivos

### Tecnología al Servicio del Significado

PICTOS utiliza modelos de lenguaje e imagen de última generación (Google Gemini 3 Pro) no como un fin en sí mismo, sino como **instrumentos para explorar la relación entre lenguaje y representación visual**. La herramienta es un laboratorio donde investigadores, lingüistas y diseñadores pueden experimentar con diferentes estrategias de visualización.

---

## El Vocabulario Base VCSCI

El proyecto incluye un módulo de investigación con **20 frases de intenciones comunicativas básicas**, cuidadosamente seleccionadas para representar necesidades fundamentales en situaciones cotidianas:

- "Quiero beber agua"
- "Necesito ir al baño"
- "Tengo dolor"
- "Quiero comer algo"
- [... y 16 más]

Este vocabulario base sirve como **benchmark** para evaluar y comparar diferentes enfoques de generación de pictogramas.

---

## Casos de Uso

### Investigación Lingüística
Explorar cómo diferentes lenguas expresan conceptos universales y cómo estos se pueden visualizar de manera transcultural.

### Diseño de Sistemas de Comunicación Aumentativa
Generar rápidamente prototipos de pictogramas para sistemas AAC (Augmentative and Alternative Communication).

### Educación Especial
Crear materiales visuales personalizados adaptados a las necesidades específicas de cada estudiante.

### Evaluación de Pictogramas Existentes
Usar los criterios VCSCI para analizar y mejorar pictogramas de bibliotecas existentes (ARASAAC, Mulberry, etc.).

### Desarrollo de Corpus Visuales
Construir datasets de pictogramas para entrenar modelos de IA o realizar estudios de percepción visual.

---

## Principios de Diseño

1. **Transparencia Semántica**: Cada paso del pipeline es visible y editable
2. **Neutralidad Cultural**: Los pictogramas buscan ser comprensibles más allá de fronteras lingüísticas
3. **Simplicidad Compositiva**: Elementos visuales mínimos pero expresivos
4. **Coherencia Estilística**: Uniformidad visual en toda la biblioteca generada
5. **Trazabilidad Completa**: Rastrear cada decisión desde el utterance hasta el píxel final

---

## Tecnología

- **Frontend**: React + TypeScript + Vite
- **Procesamiento Lingüístico**: Google Gemini 3 Pro (análisis NSM)
- **Generación de Imágenes**: Gemini 2.5 Flash Image / Gemini 3 Pro Image
- **Arquitectura**: Cliente-lado con almacenamiento local (localStorage)
- **Internacionalización**: Soporte para inglés (UK) y español (Latinoamérica)
- **Licencia**: MIT (código) / CC-BY-4.0 (imágenes generadas)

### Esquemas y Módulos Externos

PICTOS integra esquemas de investigación como **git submodules**, permitiendo versionado explícito y reproducibilidad científica:

- **[NLU Schema](https://github.com/mediafranca/nlu-schema)** - Esquema MediaFranca para análisis lingüístico profundo basado en NSM (Natural Semantic Metalanguage). Define la estructura para la fase "Comprender".

- **[VCSCI](https://github.com/mediafranca/VCSCI)** - Visual Communication Semiotic Construction Index. Marco de evaluación multidimensional para pictogramas (6 métricas: Semantics, Syntactics, Pragmatics, Clarity, Universality, Aesthetics). Usado en la fase "Evaluar".

- **[MF-SVG Schema](https://github.com/mediafranca/mf-svg-schema)** - Esquema para pictogramas vectoriales estructurados. Define la composición jerárquica de elementos visuales y su articulación espacial. Fundamento para la futura fase "Componer SVG".

Cada esquema evoluciona de forma independiente, permitiendo actualizaciones controladas sin afectar la estabilidad de PICTOS.

---

## Comenzar a Usar PICTOS

- **Aplicación web**: [pictos.net](https://pictos.net)
- **Para desarrolladores**: Consulta [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Consideraciones de seguridad**: Lee [SECURITY.md](./SECURITY.md)
- **Arquitectura técnica**: Ver [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Citar este Proyecto

Si usas PICTOS en tu investigación, considera citarlo como:

```
PICTOS.NET (2025). Pictogramas Generativos para la Accesibilidad Cognitiva.
Sistema de generación automática basado en NSM y evaluación VCSCI.
Disponible en: https://pictos.net
```

---

## Roadmap

### v2.6 (Actual)
- ✅ Pipeline completo: Understand → Compose → Produce → Evaluate
- ✅ Interfaz bilingüe (ES/EN)
- ✅ Evaluación VCSCI integrada
- ✅ Exportación con imágenes embebidas

### Próximas Versiones
- 🔄 Soporte para más idiomas (FR, PT, CA)
- 🔄 Integración con bibliotecas de pictogramas existentes
- 🔄 Modos de generación alternativos (SVG, animaciones)
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

---

## Reconocimientos

Este proyecto se inspira en el trabajo de:

- **Anna Wierzbicka** y **Cliff Goddard** (Natural Semantic Metalanguage)
- **ARASAAC** (Proyecto aragonés de pictogramas)
- La comunidad de Comunicación Aumentativa y Alternativa (AAC)
- Investigadores en accesibilidad cognitiva y diseño universal

---

## Contacto

Para preguntas, sugerencias o colaboraciones:

- Abre un issue en GitHub
- Reporta bugs en el repositorio
- Propone nuevas funcionalidades mediante Pull Requests

---

*PICTOS.NET - Transformando intenciones en pictogramas, una frase a la vez.*

**Versión 2.6** | Optimizado para investigación en lingüística aplicada y accesibilidad cognitiva.
