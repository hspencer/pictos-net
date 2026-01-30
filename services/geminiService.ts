
import { GoogleGenAI } from "@google/genai";
import { NLUData, GlobalConfig, RowData, VisualElement } from "../types";

// SECURITY WARNING: API key is exposed in client-side code
// This is acceptable for development/research, but for production
// you should use a backend proxy to protect your API credentials
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

export const generateNLU = async (utterance: string, onLog?: (type: 'info' | 'error' | 'success', msg: string) => void): Promise<NLUData> => {
  const ai = getAI();
  onLog?.('info', `[NLU] Iniciando análisis semántico de: "${utterance.substring(0, 50)}..."`);
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

  onLog?.('info', `[NLU] Enviando solicitud a Gemini 3 Pro...`);
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `UTTERANCE: "${utterance}"`,
    config: {
      systemInstruction,
    }
  });

  onLog?.('info', `[NLU] Respuesta recibida, parseando JSON...`);
  const result = JSON.parse(cleanJSONResponse(response.text)) as NLUData;
  onLog?.('success', `[NLU] Análisis semántico completado. Detectado: ${result.metadata?.intent || 'N/A'}`);
  return result;
};

export const generateVisualBlueprint = async (nlu: NLUData, config: GlobalConfig, onLog?: (type: 'info' | 'error' | 'success', msg: string) => void): Promise<Partial<RowData>> => {
  const ai = getAI();
  const targetLang = nlu.lang || config.lang || 'en';

  onLog?.('info', `[VISUAL] Iniciando generación de blueprint visual (idioma: ${targetLang})...`);
  onLog?.('info', `[VISUAL] Contexto semántico: ${nlu.metadata?.intent || 'N/A'}`);

  const systemInstruction = `You are the "Visual Topology Node" in the PictoNet graph.
Your function is to translate the semantic graph (NLU) into a hierarchical visual graph (Elements & Spatial Logic).

**Language Context:**
The "utterance" language is: **${targetLang}**.
You MUST generate Element IDs and the prompt logic in **${targetLang}**.

**Output Graph Schema:**

1.  **"elements" (Visual Hierarchy):**
    *   A recursive list of visual nodes.
    *   The root element must always be \`pictograma\`, representing the entire scene.
    *   IDs must be **simple nouns** in **${targetLang}**.
    *   For compound names, use \`snake_case\` (e.g., \`persona_corriendo\`, \`casa_grande\`).

2.  **"prompt" (Spatial Edges):**
    *   Describes the edges/relationships between visual nodes in space incorporating visual metaphors.
    *   Write in **${targetLang}**.
    *   **IMPORTANT:** When referencing elements in the prompt, always wrap their IDs in single quotes (e.g., 'pictograma', 'persona', 'casa').
    *   **Focus exclusively on TOPOLOGY and COMPOSITION** (relative position, size relations, connections).
    *   Do NOT define style (handled by the Global Style Node).

**Final Output:** A single valid JSON object containing \`elements\` and \`prompt\`.`;

  onLog?.('info', `[VISUAL] Enviando contexto NLU a Gemini 3 Pro...`);
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `NLU Semantics: ${JSON.stringify(nlu)}`,
    config: {
      systemInstruction,
    }
  });

  onLog?.('info', `[VISUAL] Respuesta recibida, parseando blueprint...`);
  const result = JSON.parse(cleanJSONResponse(response.text));

  // Validate that elements is an array
  if (!Array.isArray(result.elements)) {
    onLog?.('error', `[VISUAL] Error: 'elements' no es un array. Tipo recibido: ${typeof result.elements}. Retornando array vacío.`);
    result.elements = [];
  }

  onLog?.('success', `[VISUAL] Blueprint completado. Elementos: ${result.elements.length}, Prompt: ${result.prompt?.substring(0, 50) || 'N/A'}...`);
  return result;
};

export const generateSpatialPrompt = async (nlu: NLUData, elements: VisualElement[], config: GlobalConfig, onLog?: (type: 'info' | 'error' | 'success', msg: string) => void): Promise<string> => {
  const ai = getAI();
  const targetLang = nlu.lang || config.lang || 'en';

  onLog?.('info', `[PROMPT] Generando prompt de articulación espacial (idioma: ${targetLang})...`);

  // Helper function to format elements hierarchy as readable text
  const formatElements = (els: VisualElement[], depth = 0): string => {
    if (!Array.isArray(els)) {
      return '  (error: not an array)';
    }
    return els.map(el => {
      const indent = '  '.repeat(depth);
      const children = el.children && Array.isArray(el.children) ? '\n' + formatElements(el.children, depth + 1) : '';
      return `${indent}- ${el.id}${children}`;
    }).join('\n');
  };

  const systemInstruction = `You are the "Spatial Articulation Node" in the PictoNet graph.
Your function is to generate a descriptive prompt that explains how visual elements should be spatially arranged and composed.

**Language Context:**
The "utterance" language is: **${targetLang}**.
You MUST generate the prompt in **${targetLang}**.

**Input:**
- Semantic context (NLU analysis)
- Hierarchical visual elements structure

**Task:**
Generate a detailed spatial composition description that explains:
1. How elements are positioned relative to each other
2. Size relationships between elements
3. Visual metaphors and symbolic representations
4. Compositional guidelines for the pictogram

**IMPORTANT:** When referencing elements in the prompt, always wrap their IDs in single quotes (e.g., 'pictograma', 'persona', 'casa').

**Output:**
A single descriptive text (NOT JSON) in **${targetLang}** that describes the spatial articulation.
Focus exclusively on TOPOLOGY and COMPOSITION (relative position, size relations, connections).
Do NOT define style (that's handled elsewhere).`;

  const elementsText = formatElements(elements);
  const nluText = JSON.stringify(nlu, null, 2);

  onLog?.('info', `[PROMPT] Enviando contexto (NLU + ${elements.length} elementos) a Gemini 3 Pro...`);
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
NLU SEMANTIC CONTEXT:
${nluText}

VISUAL ELEMENTS HIERARCHY:
${elementsText}

Generate a spatial composition prompt that describes how these elements should be arranged to represent the communicative intent.`,
    config: {
      systemInstruction,
    }
  });

  onLog?.('info', `[PROMPT] Respuesta recibida, extrayendo prompt...`);
  const prompt = response.text.trim();

  onLog?.('success', `[PROMPT] Prompt espacial generado: ${prompt.substring(0, 80)}...`);
  return prompt;
};

export const generateImage = async (elements: VisualElement[], prompt: string, row: any, config: GlobalConfig, onLog?: (type: 'info' | 'error' | 'success', msg: string) => void): Promise<string> => {
  const ai = getAI();

  // Validate that elements is actually an array
  if (!Array.isArray(elements)) {
    const errorMsg = `[BITMAP] Error: 'elements' debe ser un array, recibido: ${typeof elements}`;
    onLog?.('error', errorMsg);
    throw new Error(errorMsg);
  }

  onLog?.('info', `[BITMAP] Iniciando generación de imagen...`);
  onLog?.('info', `[BITMAP] Elementos a renderizar: ${elements.length}`);

  // Helper function to format elements hierarchy as readable text
  const formatElements = (els: VisualElement[], depth = 0): string => {
    if (!Array.isArray(els)) {
      return '  (error: not an array)';
    }
    return els.map(el => {
      const indent = '  '.repeat(depth);
      const children = el.children && Array.isArray(el.children) ? '\n' + formatElements(el.children, depth + 1) : '';
      return `${indent}- ${el.id}${children}`;
    }).join('\n');
  };

  // Format NLU context if available
  const nluContext = row.NLU && typeof row.NLU === 'object' ? `
    SEMANTIC CONTEXT (from Step 1 - UNDERSTAND):
    Utterance: "${row.NLU.utterance || row.UTTERANCE}"
    Intent: ${row.NLU.metadata?.intent || 'N/A'}
    Speech Act: ${row.NLU.metadata?.speech_act || 'N/A'}
    Focus: ${row.NLU.visual_guidelines?.focus_actor || 'N/A'}
    Core Action: ${row.NLU.visual_guidelines?.action_core || 'N/A'}
    Core Object: ${row.NLU.visual_guidelines?.object_core || 'N/A'}
  ` : '';

  // Combine the specific spatial articulation prompt with the global style prompt and author
  const fullPrompt = `
    Create a pictogram image based on these instructions:

    CONTEXT FROM PIPELINE:
    Original communicative intent: "${row.UTTERANCE}"
    ${nluContext}

    HIERARCHICAL ELEMENTS (from Step 2 - COMPOSE):
    ${formatElements(elements)}

    SPATIAL COMPOSITION (from Step 2 - COMPOSE):
    ${prompt}

    GRAPHIC STYLE (from Global Config):
    ${config.visualStylePrompt}

    CRITICAL CONSTRAINTS:
    1. Follow the HIERARCHICAL ELEMENTS structure exactly - each element must be visually present
    2. Apply the SPATIAL COMPOSITION description for layout and relationships
    3. Use the GRAPHIC STYLE for visual treatment
    4. NO TEXT of any kind (no labels, no signatures, no watermarks)
    5. PURE VISUAL REPRESENTATION only
    6. FLAT DESIGN ideal for vectorization (solid colors, clear distinct shapes, consistent stroke widths)
    7. Plain white background
  `;

  // Select model based on config.
  // 'pro' maps to gemini-3-pro-image-preview (NanoBanana Pro / High Quality)
  // 'flash' maps to gemini-2.5-flash-image (NanoBanana / Fast)
  const modelName = config.imageModel === 'pro'
    ? 'gemini-3-pro-image-preview'
    : 'gemini-2.5-flash-image';

  onLog?.('info', `[BITMAP] Modelo seleccionado: ${modelName} (${config.aspectRatio})`);
  onLog?.('info', `[BITMAP] Enviando prompt completo a Gemini...`);

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

  onLog?.('info', `[BITMAP] Respuesta recibida, extrayendo imagen...`);

  // Extract image from response
  let base64Image = "";

  if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        base64Image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        onLog?.('success', `[BITMAP] Imagen generada exitosamente (${part.inlineData.mimeType})`);
        break;
      }
    }
  }

  if (!base64Image) {
    onLog?.('error', `[BITMAP] No se pudo generar la imagen`);
    throw new Error("No image generated.");
  }

  return base64Image;
};
