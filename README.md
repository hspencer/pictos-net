
# PictoNet: Semantic Pictogram Architect (v2.4 Hierarchical)

**PictoNet** es una herramienta profesional diseñada para transformar enunciados de lenguaje natural en esquemas de pictogramas SVG semánticos de alta fidelidad, utilizando un motor de análisis lingüístico avanzado basado en NSM (Natural Semantic Metalanguage).

## Consistencia Transversal
La aplicación utiliza un esquema de datos unificado en todo el pipeline:
- **UTTERANCE**: El texto de entrada (intención comunicativa).
- **NLU**: El esquema semántico MediaFranca (JSON), incluyendo análisis NSM.
- **elements**: Una estructura jerárquica de componentes visuales que define la composición del pictograma.
- **prompt**: La estrategia de articulación espacial que describe cómo se relacionan los elementos.
- **SVG**: El código final listo para producción.

## Formato de Intercambio (JSON)
Para evitar problemas de escape en bloques complejos de NLU y SVG, la aplicación opera exclusivamente con **archivos JSON**. 

```json
[
  {
    "id": "R_001",
    "UTTERANCE": "Quiero beber agua",
    "NLU": { "...": "..." },
    "elements": [
      { "id": "perfil_humano" },
      {
        "id": "vaso",
        "children": [
          { "id": "nivel_liquido" },
          { "id": "gota" },
          { "id": "lineas_cineticas" }
        ]
      }
    ],
    "prompt": "La composición se centra en un `perfil_humano` simplificado...",
    "SVG": "<svg>...</svg>"
  }
]
```

## Funcionalidades Clave
- **Motor NSM**: Análisis semántico profundo para una mayor precisión conceptual.
- **Batch Processing**: Ejecución en cascada desde la intención hasta el SVG.
- **Workbench Editable**: Permite corregir cada paso del pipeline, marcando los pasos subsecuentes como desactualizados para garantizar consistencia.
- **Editor Visual Interactivo**: Modo de enfoque para el SVG con selección de bloques sincronizada.
- **SVG Export**: Descarga de archivos SVG individuales con nomenclatura optimizada.
- **Semantic Monitor**: Seguimiento en tiempo real de las llamadas a la API de Gemini.

---
*Optimizado para investigación en lingüística aplicada y accesibilidad cognitiva.*