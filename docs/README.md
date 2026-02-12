# Documentación PICTOS.NET

Bienvenido a la documentación completa de PICTOS.NET. Aquí encontrarás toda la información necesaria para usar, desarrollar y contribuir al proyecto.


## Índice de Documentación

### Para Usuarios

#### [Tutorial Completo](TUTORIAL.md)
Guía paso a paso en castellano sobre cómo usar PICTOS.NET.

**Contenido:**
- Primeros pasos (cargar ICAP-50, importar frases)
- Configuración del espacio (prompt general, geo-context, modelos)
- Generación en cascada vs paso por paso
- Edición y regeneración de pasos intermedios
- Evaluación ICAP (6 dimensiones)
- Gestión de biblioteca SVG
- Consejos y buenas prácticas


### Para Desarrolladores

#### [Arquitectura](ARCHITECTURE.md)
Documentación técnica completa del sistema.

**Contenido:**
- Arquitectura general del sistema
- Pipeline de 3 fases (Comprender → Componer → Producir)
- Flujo de datos y almacenamiento (localStorage + IndexedDB)
- Integración con APIs de Gemini
- Vectorización y estructuración SVG
- Schemas y tipos TypeScript
- Roadmap técnico

#### [Guía de Contribución](CONTRIBUTING.md)
Todo lo que necesitas saber para contribuir al proyecto.

**Contenido:**
- Setup del entorno de desarrollo
- Estructura del proyecto
- Flujo de trabajo con Git
- Configuración de API keys
- Testing y despliegue
- Convenciones de código
- Proceso de Pull Requests

#### [Seguridad](SECURITY.md)
Políticas de seguridad y consideraciones importantes.

**Contenido:**
- Exposición de API keys (advertencias y mitigaciones)
- Reporte de vulnerabilidades
- Política de divulgación responsable
- Consideraciones de almacenamiento local
- Mejores prácticas de seguridad


## Enlaces Rápidos

- **[README principal](../README.md)** - Visión general del proyecto
- **[Aplicación web](https://pictos.net)** - Usar PICTOS.NET online
- **[Repositorio GitHub](https://github.com/mediafranca/pictos-net)** - Código fuente


## Recursos Externos

### Esquemas de Investigación (Git Submodules)

- **[NLU Schema](https://github.com/mediafranca/nlu-schema)** - Análisis lingüístico basado en NSM
- **[ICAP](https://github.com/mediafranca/ICAP)** - Visual Communication Semiotic Construction Index
- **[MF-SVG Schema](https://github.com/mediafranca/mf-svg-schema)** - Esquema para pictogramas vectoriales estructurados


## Estructura de esta Carpeta

```
docs/
├── README.md           ← Estás aquí (índice de documentación)
├── TUTORIAL.md         ← Guía completa de uso (castellano)
├── ARCHITECTURE.md     ← Documentación técnica del sistema
├── CONTRIBUTING.md     ← Guía para desarrolladores
├── SECURITY.md         ← Políticas de seguridad
└── img/                ← Imágenes para la documentación
    └── (capturas de pantalla del tutorial)
```


## Rutas de Aprendizaje Sugeridas

### Nuevo Usuario
1. Lee el [README principal](../README.md) para entender qué es PICTOS.NET
2. Sigue el [Tutorial Completo](TUTORIAL.md) paso por paso
3. Prueba la [aplicación web](https://pictos.net)

### Nuevo Desarrollador
1. Lee el [README principal](../README.md) y la sección de tecnología
2. Revisa la [Arquitectura](ARCHITECTURE.md) para entender el diseño del sistema
3. Sigue la [Guía de Contribución](CONTRIBUTING.md) para setup del entorno
4. Lee [SECURITY.md](SECURITY.md) antes de trabajar con API keys

### 🔬 Investigador/Lingüista
1. Lee el [README principal](../README.md), sección Filosofía del Proyecto
2. Explora los esquemas externos (NLU Schema, ICAP, MF-SVG)
3. Usa el [Tutorial](TUTORIAL.md) para generar corpus de pictogramas
4. Consulta [ARCHITECTURE.md](ARCHITECTURE.md) para detalles del pipeline NSM


## Contribuir a la Documentación

La documentación también es código. Si encuentras:

- **Errores o imprecisiones**: Abre un issue
- **Secciones confusas**: Sugiere mejoras
- **Contenido faltante**: Propón nuevas secciones

Lee [CONTRIBUTING.md](CONTRIBUTING.md) para el proceso completo.




*Documentación PICTOS.NET v1.0.1 - Enero 2025*
