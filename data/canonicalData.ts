
import { RowData } from "../types";

export const CANONICAL_DATA: Partial<RowData>[] = [
  {
    "UTTERANCE": "Quiero beber agua",
    "NLU": {
      "utterance": "I want to drink water",
      "lang": "en",
      "metadata": {
        "speech_act": "directive",
        "intent": "desire_expression"
      },
      "frames": [
        {
          "frame_name": "Ingestion",
          "lexical_unit": "drink",
          "roles": {
            "Ingestor": { "type": "Agent", "ref": "speaker", "surface": "I" },
            "Ingestibles": { "type": "Object", "surface": "water", "lemma": "water", "definiteness": "indefinite" }
          }
        },
        {
          "frame_name": "Desire",
          "lexical_unit": "want",
          "roles": {
            "Experiencer": { "type": "Agent", "ref": "speaker", "surface": "I" },
            "DesiredEvent": { "type": "Event", "ref_frame": "Ingestion", "surface": "to drink water" }
          }
        }
      ],
      "nsm_explications": {
        "WANT": "Someone feels something. This person thinks: ‘I want this to happen’",
        "DRINK": "Someone puts water or another liquid inside their body through the mouth",
        "WATER": "Something. People drink it. It is clear. It is not a thing someone made"
      },
      "logical_form": {
        "event": "drink(I, water)",
        "modality": "want(I, event)"
      },
      "pragmatics": {
        "politeness": "neutral",
        "formality": "neutral",
        "expected_response": "none (self-expression)"
      },
      "visual_guidelines": {
        "focus_actor": "speaker",
        "action_core": "drink",
        "object_core": "water",
        "context": "everyday activity",
        "temporal": "immediate"
      }
    },
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
    "prompt": "La composición se centra en un `perfil_humano` simplificado, orientado hacia la derecha. Frente a la zona oral se encuentra un `vaso` inclinado 45 grados. Dentro del vaso, `nivel_liquido` indica contenido. Una `gota` estilizada está suspendida sobre el borde. Dos `lineas_cineticas` curvas sugieren el movimiento ascendente del vaso."
  },
  {
    "id": "C_002",
    "UTTERANCE": "Ayúdame a hacer la cama"
  }
];
