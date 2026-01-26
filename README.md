
# PictoNet: Semantic Pictogram Architect (v2.5 Hierarchical)

**PictoNet** es una herramienta profesional diseñada para transformar enunciados de lenguaje natural en esquemas de pictogramas e imágenes finales (Bitmaps) semánticos de alta fidelidad, utilizando un motor de análisis lingüístico avanzado basado en NSM (Natural Semantic Metalanguage) y la potencia generativa de Gemini 2.5/3.0.

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
