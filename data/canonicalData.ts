
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
 * Fallback: Static ICAP-50 base corpus (for offline usage)
 * This is kept as a fallback if the external endpoint is unavailable
 * Source: schemas/ICAP/frases.json v2.0.0
 */
export const ICAP_MODULE_FALLBACK: GraphModule = {
  id: "icap-50-base",
  namespace: "mediafranca.graph.dataset",
  version: "2.0.0",
  description: "Corpus Base ICAP-50 para evaluación de pictogramas en CAA (50 frases base - FALLBACK)",
  data: [
    // SOLICITAR (6 frases)
    { "id": "SOL-01", "UTTERANCE": "Quiero ir al baño", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOL-02", "UTTERANCE": "Quiero comer pizza", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOL-03", "UTTERANCE": "Necesito tomar mi medicina", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOL-04", "UTTERANCE": "Tengo sed, quiero beber agua", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOL-05", "UTTERANCE": "Quiero jugar en el patio", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOL-06", "UTTERANCE": "Ayúdame con la tarea", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // RECHAZAR (5 frases)
    { "id": "REC-01", "UTTERANCE": "No quiero tomar la sopa", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "REC-02", "UTTERANCE": "No quiero usar la chaqueta", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "REC-03", "UTTERANCE": "No ahora", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "REC-04", "UTTERANCE": "No necesito ayuda", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "REC-05", "UTTERANCE": "Basta ya", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // DIRIGIR (6 frases)
    { "id": "DIR-01", "UTTERANCE": "Ven aquí", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "DIR-02", "UTTERANCE": "Mira esto", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "DIR-03", "UTTERANCE": "Dame la mano", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "DIR-04", "UTTERANCE": "Pon el libro en la mesa", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "DIR-05", "UTTERANCE": "Vamos a jugar", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "DIR-06", "UTTERANCE": "No corras", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // ACEPTAR (6 frases)
    { "id": "ACE-01", "UTTERANCE": "Sí, quiero eso", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "ACE-02", "UTTERANCE": "Está bien", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "ACE-03", "UTTERANCE": "De acuerdo", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "ACE-04", "UTTERANCE": "Me gusta eso", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "ACE-05", "UTTERANCE": "Sí, por favor", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "ACE-06", "UTTERANCE": "Genial", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // INTERACCIÓN SOCIAL (6 frases)
    { "id": "SOC-01", "UTTERANCE": "Hola", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOC-02", "UTTERANCE": "Adiós", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOC-03", "UTTERANCE": "Por favor", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOC-04", "UTTERANCE": "¿Quieres jugar?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOC-05", "UTTERANCE": "Lo siento", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "SOC-06", "UTTERANCE": "Bien hecho", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // EMOCIÓN (5 frases)
    { "id": "EMO-01", "UTTERANCE": "Te quiero", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "EMO-02", "UTTERANCE": "Estoy feliz", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "EMO-03", "UTTERANCE": "Estoy triste", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "EMO-04", "UTTERANCE": "Tengo miedo", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "EMO-05", "UTTERANCE": "Me duele la barriga", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // COMENTAR (6 frases)
    { "id": "COM-01", "UTTERANCE": "Está lloviendo", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "COM-02", "UTTERANCE": "Hace frío", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "COM-03", "UTTERANCE": "Es hora de comer", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "COM-04", "UTTERANCE": "Tengo hambre", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "COM-05", "UTTERANCE": "El perro es grande", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "COM-06", "UTTERANCE": "Está roto", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },

    // PREGUNTAR (7 frases)
    { "id": "PRE-01", "UTTERANCE": "¿Dónde está el baño?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-02", "UTTERANCE": "¿Qué es esto?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-03", "UTTERANCE": "¿Quién es ella?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-04", "UTTERANCE": "¿Cuándo vamos al parque?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-05", "UTTERANCE": "¿Quién viene?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-06", "UTTERANCE": "¿Dónde está mamá?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" },
    { "id": "PRE-07", "UTTERANCE": "¿Qué vamos a comer?", "status": "idle", "nluStatus": "idle", "visualStatus": "idle", "bitmapStatus": "idle" }
  ]
};
