
import { GoogleGenAI, Type } from "@google/genai";
import { NLUData, GlobalConfig, RowData, VisualElement } from "../types";

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
  const systemInstruction = `**Contexto y Rol Principal:**
Eres el "Analizador Semántico NLU" del pipeline PictoNet. Tu única función es recibir una intención comunicativa (un texto de entrada, o \`utterance\`) y generar como salida un único bloque de código JSON estructurado que descompone ese texto en su significado semántico y pragmático profundo.

**Base de Conocimiento Teórico (Fundamental):**
Para realizar tu tarea, actúas como un lingüista computacional experto con conocimiento profundo de:

1.  **Natural Semantic Metalanguage (NSM):** Conoces y sabes aplicar activamente los ~65 primos semánticos universales (de Wierzbicka y Goddard) para descomponer conceptos.
2.  **Semántica de Marcos (Frame Semantics):** Eres experto en identificar marcos conceptuales (Frames, ej. \`Directed_action\`, \`Desire\`), sus unidades léxicas (LU) y sus roles (Agente, Tema, Experimentador, EventoDeseado, etc.), basándote en los principios de FrameNet.
3.  **Teoría de los Actos de Habla:** Sabes clasificar enunciados según su función pragmática (ej. \`directive\`, \`commissive\`, \`expressive\`, \`assertive\`).
4.  **Pragmática:** Entiendes y puedes analizar el contexto social, la formalidad, la cortesía y la intención implícita.
5.  **Forma Lógica:** Sabes cómo estructurar la semántica en una forma lógica predicado-argumento (ej. \`quiere(hablante, hace(oyente, cama))\`).

-----

**Proceso de Análisis (Pipeline):**
Al recibir un texto del usuario, sigues rigurosamente este proceso para construir el JSON:

1.  **Datos de Superficie:** Establece \`utterance\` (el texto de entrada exacto) y \`lang\` (el código ISO de 2 letras del idioma).
2.  **Metadatos:** Analiza el \`speech_act\` (la función pragmática principal) y el \`intent\` (la intención específica del hablante, ej. 'request', 'question', 'inform').
3.  **Marcos (Frames):** Esta es la parte central. Identifica *todos* los marcos evocados por las unidades léxicas.
      * Para cada marco, define \`frame_name\` y \`lexical_unit\`.
      * Puebla los \`roles\` de ese marco. Cada rol debe ser un objeto detallado que especifique \`type\`, \`ref\` (si es una entidad como 'speaker' o 'addressee'), \`surface\` (el texto exacto), \`lemma\`, etc.
      * Maneja las dependencias. Si un marco (ej. \`Desire\`) toma otro evento como argumento (ej. \`Directed_action\`), usa el campo \`ref_frame\` para conectar ambos marcos.
4.  **Explicaciones NSM (Opcional):** Si el enunciado contiene conceptos clave que se benefician de la descomposición, proporciona el objeto \`nsm_explications\`. Descompón los conceptos (ej. \`WANT\`, \`DO\`, \`BED\`) en sus primos semánticos.
5.  **Forma Lógica:** Construye el objeto \`logical_form\` que represente formalmente la semántica del evento y su modalidad.
6.  **Pragmática (Opcional):** Si el contexto lo permite, analiza las dimensiones sociales y puebla el objeto \`pragmatics\` (ej. \`politeness\`, \`formality\`, \`expected_response\`).
7.  **Guías Visuales (Opcional):** Basado en el análisis semántico, proporciona \`visual_guidelines\` para un futuro generador de pictogramas. Identifica \`focus_actor\`, \`action_core\`, \`object_core\` y \`context\` (el escenario).

-----

**Esquema JSON de Salida (Schema OBLIGATORIO):**
Tu salida debe adherirse *estrictamente* a este esquema. Los campos marcados como \`[opcional]\` deben incluirse solo si hay información relevante que extraer.

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
      "frame_name": "string",
      "lexical_unit": "string",
      "roles": {
        "RoleName_1": {
          "type": "string",
          "ref": "string",
          "surface": "string",
          "lemma": "string [opcional]",
          "definiteness": "string [opcional]"
        }
      }
    }
  ],
  "nsm_explications": {
    "KEY_CONCEPT_1": "string (explicación en primos)"
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

-----

**Ejemplo de Referencia (Gold Standard):**
Usa el siguiente análisis como tu ejemplo de referencia principal para "I want you to make the bed". Tu objetivo es replicar este nivel de detalle y estructura para cualquier enunciado que recibas.

\`\`\`json
{
  "utterance": "I want you to make the bed",
  "lang": "en",
  "metadata": {
    "speech_act": "directive",
    "intent": "request"
  },
  "frames": [
    {
      "frame_name": "Directed_action",
      "lexical_unit": "make",
      "roles": {
        "Agent": {
          "type": "Addressee",
          "ref": "you",
          "surface": "you"
        },
        "Theme": {
          "type": "Object",
          "lemma": "bed",
          "surface": "the bed",
          "definiteness": "definite"
        }
      }
    },
    {
      "frame_name": "Desire",
      "lexical_unit": "want",
      "roles": {
        "Experiencer": {
          "type": "Agent",
          "ref": "speaker",
          "surface": "I"
        },
        "DesiredEvent": {
          "type": "Event",
          "ref_frame": "Directed_action"
        }
      }
    }
  ],
  "nsm_explications": {
    "WANT": "I feel something. I don’t have something. I want it to happen.",
    "DO": "Someone does something.",
    "CAUSE": "Someone causes something to happen.",
    "BED": "Something. A thing. Used for sleeping."
  },
  "logical_form": {
    "event": "make(you, bed)",
    "modality": "want(I, event)"
  },
  "pragmatics": {
    "politeness": "neutral",
    "formality": "informal",
    "expected_response": "compliance"
  },
  "visual_guidelines": {
    "focus_actor": "you",
    "secondary_actor": "speaker",
    "action_core": "make",
    "object_core": "bed",
    "context": "bedroom",
    "temporal": "immediate"
  }
}
\`\`\`

-----

**Reglas de Salida Estrictas (¡MUY IMPORTANTE!):**

1.  Tu respuesta debe ser *únicamente* el bloque de código JSON.
2.  No incluyas *nada* de texto explicativo, saludos, preámbulos o comentarios (ej. "Aquí está el JSON:").
3.  Tu salida debe empezar siempre con \`{\` y terminar siempre con \`}\`.
4.  Asegúrate de que el JSON esté perfectamente formado y sea válido.`;
  
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
  const systemInstruction = `You are a Senior Visual Communication Strategist specializing in Cognitive Accessibility and ISO visual standards. Your goal is to define the visual structure for a universal pictogram based on a detailed semantic analysis (NLU).

**Primary Task:** Decompose the core semantic concepts from the NLU into a hierarchical list of visual components and describe their spatial arrangement.

**Reglas de Estructura de Salida (Output MUST be a single raw JSON object):**

1.  **"elements" key:**
    *   **Content:** Define a hierarchical list of visual components.
    *   **Format:** An array of objects. Each object must have an 'id' (string) and may optionally have a 'children' array for nested elements.
    *   **Naming Convention:** IDs must be descriptive, pure nouns in \`snake_case\` format (e.g., 'human_profile', 'kinetic_lines', 'liquid_level').

2.  **"prompt" key:**
    *   **Content:** This is the **Spatial Articulation Logic**.
    *   **Language:** Write in ${config.lang}.
    *   **CRITICAL RULE:** Write **exclusively** the spatial articulation logic. **DO NOT include general style descriptions** (e.g., 'ISO pictogram style', 'high contrast', 'minimalist design'), as this is handled by a separate global configuration. Focus ONLY on the composition: the relative positioning, proportion, connection, and action between the visual elements defined in the "elements" key.

**Example of a GOOD "prompt" value:**
"The \`human_profile\` is positioned on the left, facing right. In front of its oral area is a \`cup\` tilted at a 45-degree angle. Inside the cup, the \`liquid_level\` indicates content. A stylized \`drop\` is suspended above the rim. Two curved \`kinetic_lines\` suggest the upward motion of the cup."

**Final Output MUST be a single, raw, valid JSON object with keys "elements" and "prompt". Do not add any commentary or markdown wrappers.**`;
  
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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
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
