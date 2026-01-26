
import { RowData } from "../types";

// Module Definition: Vocabulary of Core Semantic Communicative Intentions
// Namespace: mediafranca/vcsci-core
// Type: Semantic Graph Node (Dataset)

export interface GraphModule {
  id: string;
  namespace: string;
  version: string;
  description: string;
  data: Partial<RowData>[];
}

export const VCSCI_MODULE: GraphModule = {
  id: "vcsci-core",
  namespace: "mediafranca.graph.dataset",
  version: "1.0.0",
  description: "Vocabulary of Core Semantic Communicative Intentions (20 functional nodes)",
  data: [
    // 1. PETICIONES FISIOLÓGICAS Y BÁSICAS
    {
      "id": "VCSCI_01",
      "UTTERANCE": "Quiero beber agua",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_02",
      "UTTERANCE": "Quiero comer algo",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_03",
      "UTTERANCE": "Necesito ir al baño",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_04",
      "UTTERANCE": "Quiero descansar (dormir)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 2. REGULACIÓN DE LA ACCIÓN (CONTROL)
    {
      "id": "VCSCI_05",
      "UTTERANCE": "Ayúdame, por favor",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_06",
      "UTTERANCE": "Para (detente ahora)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_07",
      "UTTERANCE": "Quiero más",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_08",
      "UTTERANCE": "Ya he terminado (acabado)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 3. EXPRESIÓN DE PREFERENCIA Y RECHAZO
    {
      "id": "VCSCI_09",
      "UTTERANCE": "Me gusta esto",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_10",
      "UTTERANCE": "No me gusta esto",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_11",
      "UTTERANCE": "No quiero (rechazo)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 4. ESTADOS FÍSICOS Y EMOCIONALES
    {
      "id": "VCSCI_12",
      "UTTERANCE": "Me duele (tengo dolor)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_13",
      "UTTERANCE": "Estoy feliz",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_14",
      "UTTERANCE": "Estoy triste",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 5. OBTENCIÓN DE INFORMACIÓN (INTERROGATIVOS)
    {
      "id": "VCSCI_15",
      "UTTERANCE": "¿Qué es eso?",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_16",
      "UTTERANCE": "¿Dónde está?",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 6. INTERACCIÓN SOCIAL
    {
      "id": "VCSCI_17",
      "UTTERANCE": "Hola (saludo)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_18",
      "UTTERANCE": "Adiós (despedida)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_19",
      "UTTERANCE": "Gracias",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "VCSCI_20",
      "UTTERANCE": "Vamos a jugar",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    }
  ]
};
