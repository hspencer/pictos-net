
import { GoogleGenAI, Type } from "@google/genai";
import { NLUData, GlobalConfig, RowData, VisualElement, EvaluationMetrics } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const cleanJSONResponse = (text: string): string => {
  if (!text) return '{}';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json|svg|xml)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  let start = -1; let end = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace; end = lastBrace;
  } else if (firstBracket !== -1) {
    start = firstBracket; end = lastBracket;
  }
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.substring(start, end + 1);
  }
  return cleaned;
};

export const generateNLU = async (utterance: string): Promise<NLUData> => {
  const ai = getAI();
  const systemInstruction = `**Contexto de Arquitectura:**
Operas como el nodo de procesamiento "NLU Schema Engine" dentro de la arquitectura de grafo PictoNet.
Tu tarea es instanciar el esquema JSON definido oficialmente en el repositorio **\`mediafranca/nlu-schema\`**.

**Función del Nodo:**
Recibes una intención comunicativa (\`utterance\`) y debes mapearla al grafo semántico utilizando la ontología NSM (65 primos universales).

**Ontología NSM (mediafranca/nsm-core):**
Debes aplicar rigurosamente estos 65 primitivos para las explicaciones:
*   **Substantives:** I, YOU, SOMEONE, SOMETHING, PEOPLE, BODY
*   **Determiners:** THIS, THE SAME, OTHER
*   **Quantifiers:** ONE, TWO, SOME, ALL, MUCH/MANY, LITTLE/FEW
*   **Evaluators:** GOOD, BAD
*   **Descriptors:** BIG, SMALL
*   **Verbs:** DO, HAPPEN, MOVE, EXIST, THINK, SAY, WANT, FEEL, SEE, HEAR
*   **Propositions:** KNOW, UNDERSTAND
*   **Connectors:** AND, NOT, MAYBE, CAN, BECAUSE, IF
*   **Intensifiers:** VERY, MORE
*   **Similarity:** LIKE~AS~WAY
*   **Time:** WHEN~TIME, NOW, BEFORE, AFTER, A LONG TIME, A SHORT TIME, FOR SOME TIME, MOMENT
*   **Space:** WHERE~PLACE, HERE, ABOVE, BELOW, FAR, NEAR, SIDE, INSIDE, TOUCH
*   **Possession:** (IS) MINE
*   **Life/Death:** LIVE, DIE
*   **Parts:** PART
*   **Kind:** KIND

**Esquema de Salida (mediafranca/nlu-schema v1.0):**
Tu salida debe adherirse *estrictamente* a este esquema.

\`\`\`json
{
  "utterance": "string",
  "lang": "string",
  "metadata": {
    "speech_act": "string",
    "intent": "string"
  },
  "frames": [
    {
      "frame_name": "string (FrameNet compatible)",
      "lexical_unit": "string",
      "roles": {
        "RoleName": {
          "type": "string",
          "ref": "string",
          "surface": "string"
        }
      }
    }
  ],
  "nsm_explications": {
    "KEY_CONCEPT": "string (usando SOLO primos NSM)"
  },
  "logical_form": {
    "event": "string",
    "modality": "string"
  },
  "pragmatics": {
    "politeness": "string",
    "formality": "string",
    "expected_response": "string"
  },
  "visual_guidelines": {
    "focus_actor": "string",
    "action_core": "string",
    "object_core": "string",
    "context": "string",
    "temporal": "string"
  }
}
\`\`\`

**Reglas de Ejecución:**
1.  Retorna SOLO el JSON.
2.  Analiza la pragmática y semántica profunda, no solo la superficie.
3.  Asegura JSON válido.`;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `UTTERANCE: "${utterance}"`,
    config: {
      systemInstruction,
    }
  });

  return JSON.parse(cleanJSONResponse(response.text)) as NLUData;
};

export const generateVisualBlueprint = async (nlu: NLUData, config: GlobalConfig): Promise<Partial<RowData>> => {
  const ai = getAI();
  const targetLang = nlu.lang || config.lang || 'en';

  const systemInstruction = `You are the "Visual Topology Node" in the PictoNet graph.
Your function is to translate the semantic graph (NLU) into a hierarchical visual graph (Elements & Spatial Logic).

**Language Context:**
The "utterance" language is: **${targetLang}**.
You MUST generate Element IDs and the prompt logic in **${targetLang}**.

**Output Graph Schema:**

1.  **"elements" (Visual Hierarchy):**
    *   A recursive list of visual nodes.
    *   IDs must be \`snake_case\` nouns in **${targetLang}**.

2.  **"prompt" (Spatial Edges):**
    *   Describes the edges/relationships between visual nodes in space incorporating visual metaphors.
    *   Write in **${targetLang}**.
    *   **Focus exclusively on TOPOLOGY and COMPOSITION** (relative position, size relations, connections).
    *   Do NOT define style (handled by the Global Style Node).

**Final Output:** A single valid JSON object containing \`elements\` and \`prompt\`.`;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `NLU Semantics: ${JSON.stringify(nlu)}`,
    config: {
      systemInstruction,
    }
  });

  return JSON.parse(cleanJSONResponse(response.text));
};

export const generateImage = async (elements: VisualElement[], prompt: string, row: any, config: GlobalConfig): Promise<string> => {
  const ai = getAI();
  
  // Combine the specific spatial articulation prompt with the global style prompt and author
  const fullPrompt = `
    Create a pictogram image based on these instructions:
    
    STYLE (STRICT):
    ${config.visualStylePrompt}
    
    METADATA & CONTEXT:
    - Author/Creator: ${config.author}
    
    COMPOSITION / CONTENT:
    ${prompt}
    
    Important: The image should be clean, with no text, on a plain background (white or transparent if possible). High contrast.
  `;

  // Select model based on config.
  // 'pro' maps to gemini-3-pro-image-preview (NanoBanana Pro / High Quality)
  // 'flash' maps to gemini-2.5-flash-image (NanoBanana / Fast)
  const modelName = config.imageModel === 'pro' 
    ? 'gemini-3-pro-image-preview' 
    : 'gemini-2.5-flash-image';

  const response = await ai.models.generateContent({
    model: modelName,
    contents: {
      parts: [
        { text: fullPrompt }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: config.aspectRatio // Usamos el valor seleccionado por el usuario ('1:1', '3:4', etc.)
      }
    }
  });

  // Extract image from response
  let base64Image = "";
  
  if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        base64Image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }
  }

  if (!base64Image) {
    throw new Error("No image generated.");
  }

  return base64Image;
};
