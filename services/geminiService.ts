/**
 * Gemini Service — Phase 3 (PRODUCIR) for Gemini image models.
 *
 * Calls Gemini image generation via the api-gemini Netlify function.
 * Returns a Phase3Result with bitmap (base64 PNG data URL).
 */

import { GlobalConfig, VisualElement, Phase3Result, GenerationModel } from "../types";
import { callGemini } from "./aiClient";
import { composeGeminiImagePrompt } from "../netlify/functions/_shared/imagePrompts.js";

type LogFn = (type: 'info' | 'error' | 'success', msg: string) => void;

/**
 * Compose the full Phase 3 prompt for a Gemini (or OpenAI) image model.
 * Delegates to the shared builder, so online, Vertex batch and the
 * server-side pipeline batch send IDENTICAL text.
 */
export const composeGeminiPrompt = (
    elements: VisualElement[],
    prompt: string,
    row: { UTTERANCE: string; NLU?: any },
    config: GlobalConfig,
): string => composeGeminiImagePrompt(elements, prompt, row.UTTERANCE, row.NLU, config);

/**
 * Phase 3 (PRODUCIR): Generate a pictogram image using a Gemini model.
 *
 * @param elements  VisualElement[] from phase 2
 * @param prompt    Spatial composition prompt from phase 2
 * @param row       RowData (for utterance and NLU context)
 * @param config    GlobalConfig (reads generationModel)
 * @param onLog     Progress callback
 * @returns         Phase3Result with bitmap and generationModel provenance
 */
export const generateImage = async (
    elements: VisualElement[],
    prompt: string,
    row: { UTTERANCE: string; NLU?: any },
    config: GlobalConfig,
    onLog?: LogFn,
): Promise<Phase3Result> => {
    const model = config.generationModel as GenerationModel;
    onLog?.('info', `[PRODUCIR] Iniciando generación con Gemini (${model})…`);
    onLog?.('info', `[PRODUCIR] Elementos: ${elements.length}`);

    const fullPrompt = composeGeminiPrompt(elements, prompt, row, config);

    onLog?.('info', `[PRODUCIR] Enviando prompt a Gemini (${fullPrompt.length} chars)…`);
    // onStatus: narra los reintentos del worker (429 de Vertex) en el log de
    // la UI, para que la espera larga no parezca un cuelgue silencioso.
    const response = await callGemini({ prompt: fullPrompt, model }, msg => onLog?.('info', msg));

    if (!response.bitmap) {
        throw new Error('Gemini no devolvió imagen');
    }
    onLog?.('success', '[PRODUCIR] Imagen bitmap recibida de Gemini');
    return { bitmap: response.bitmap, generationModel: model };
};
