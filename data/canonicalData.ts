
import { RowData } from "../types";

// Module Definition: Vocabulary of Core Semantic Communicative Intentions
// Namespace: mediafranca/icap-core
// Type: Semantic Graph Node (Dataset)
// Source: https://mediafranca.github.io/ICAP/frases.json

export interface GraphModule {
  id: string;
  namespace: string;
  version: string;
  description: string;
  data: Partial<RowData>[];
}

/**
 * ICAP Phrase structure from external JSON
 */
interface ICAPPhrase {
  id: string;
  category: string;
  phrase_es: string;
  nsm_primitives: string[];
  semantic_role: string;
  domain: string;
}

/**
 * ICAP Corpus structure from external JSON
 */
interface ICAPCorpus {
  project: string;
  corpus_name: string;
  version: string;
  description: string;
  phrases: ICAPPhrase[];
}

/**
 * ICAP endpoint URL (GitHub Pages)
 */
const ICAP_ENDPOINT = 'https://mediafranca.github.io/ICAP/frases.json';

/**
 * Fetch ICAP phrases from external endpoint
 * Returns the full ICAP-50 corpus (50 phrases across 8 categories)
 */
export async function fetchICAPModule(): Promise<GraphModule> {
  try {
    const response = await fetch(ICAP_ENDPOINT);

    if (!response.ok) {
      throw new Error(`Failed to fetch ICAP module: ${response.status}`);
    }

    const corpus: ICAPCorpus = await response.json();

    // Transform ICAP phrases to RowData format
    const data: Partial<RowData>[] = corpus.phrases.map((phrase) => ({
      id: phrase.id,
      UTTERANCE: phrase.phrase_es,
      status: 'idle',
      nluStatus: 'idle',
      visualStatus: 'idle',
      bitmapStatus: 'idle'
    }));

    return {
      id: "icap-50",
      namespace: "mediafranca.graph.dataset",
      version: corpus.version,
      description: corpus.description,
      data
    };
  } catch (error) {
    console.error('Error fetching ICAP module:', error);
    throw error;
  }
}

/**
 * Legacy fallback: Static ICAP-20 module (for offline usage)
 * This is kept as a fallback if the external endpoint is unavailable
 */
export const ICAP_MODULE_FALLBACK: GraphModule = {
  id: "icap-core",
  namespace: "mediafranca.graph.dataset",
  version: "1.0.0",
  description: "Vocabulary of Core Semantic Communicative Intentions (20 functional nodes - FALLBACK)",
  data: [
    // 1. PETICIONES FISIOLÓGICAS Y BÁSICAS
    {
      "id": "ICAP_01",
      "UTTERANCE": "Quiero beber agua",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_02",
      "UTTERANCE": "Quiero comer algo",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_03",
      "UTTERANCE": "Necesito ir al baño",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_04",
      "UTTERANCE": "Quiero descansar (dormir)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 2. REGULACIÓN DE LA ACCIÓN (CONTROL)
    {
      "id": "ICAP_05",
      "UTTERANCE": "Ayúdame, por favor",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_06",
      "UTTERANCE": "Para (detente ahora)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_07",
      "UTTERANCE": "Quiero más",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_08",
      "UTTERANCE": "Ya he terminado (acabado)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 3. EXPRESIÓN DE PREFERENCIA Y RECHAZO
    {
      "id": "ICAP_09",
      "UTTERANCE": "Me gusta esto",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_10",
      "UTTERANCE": "No me gusta esto",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_11",
      "UTTERANCE": "No quiero (rechazo)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 4. ESTADOS FÍSICOS Y EMOCIONALES
    {
      "id": "ICAP_12",
      "UTTERANCE": "Me duele (tengo dolor)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_13",
      "UTTERANCE": "Estoy feliz",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_14",
      "UTTERANCE": "Estoy triste",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 5. OBTENCIÓN DE INFORMACIÓN (INTERROGATIVOS)
    {
      "id": "ICAP_15",
      "UTTERANCE": "¿Qué es eso?",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_16",
      "UTTERANCE": "¿Dónde está?",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },

    // 6. INTERACCIÓN SOCIAL
    {
      "id": "ICAP_17",
      "UTTERANCE": "Hola (saludo)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_18",
      "UTTERANCE": "Adiós (despedida)",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_19",
      "UTTERANCE": "Gracias",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    },
    {
      "id": "ICAP_20",
      "UTTERANCE": "Vamos a jugar",
      "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle"
    }
  ]
};
