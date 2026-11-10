/**
 * Recraft Service — Phase 3 (PRODUCIR), Recraft models only.
 *
 * Non-default fallback: invoked only when config.generationModel starts with 'recraft'.
 * Default Phase 3 is handled by geminiService.ts (Gemini image via Vertex AI).
 * Calls the api-recraft Netlify function; returns SVG (vector models) or bitmap (raster models).
 */

import { GlobalConfig, VisualElement, Phase3Result, GenerationModel, getModelFamily } from "../types";
import { callRecraft } from "./aiClient";
import { MODEL_CATALOG } from "../netlify/functions/_shared/modelCatalog.js";
import { composeRecraftPrompt } from "../netlify/functions/_shared/imagePrompts.js";

/**
 * Normalize SVG dimensions so it scales to its container.
 * Recraft returns SVGs with explicit pixel width/height; we strip those
 * and ensure a viewBox is present so the SVG is resolution-independent.
 */
export function normalizeSvgDimensions(svg: string): string {
    return svg.replace(/(<svg\b)([\s\S]*?)>/, (_match, tagStart, attrs) => {
        const hasViewBox = /viewBox\s*=/.test(attrs);
        const wm = attrs.match(/\bwidth\s*=\s*["']([0-9.]+)/);
        const hm = attrs.match(/\bheight\s*=\s*["']([0-9.]+)/);
        let out = attrs;
        // Construct viewBox from width/height if absent
        if (!hasViewBox && wm && hm) {
            out = ` viewBox="0 0 ${wm[1]} ${hm[1]}"` + out;
        }
        // Remove explicit width and height so SVG scales to its container
        out = out.replace(/\s+width\s*=\s*["'][^"']*["']/g, '');
        out = out.replace(/\s+height\s*=\s*["'][^"']*["']/g, '');
        return `${tagStart}${out}>`;
    });
}

type LogFn = (type: 'info' | 'error' | 'success', msg: string) => void;


/**
 * Phase 3 (PRODUCIR): Generate a pictogram using Recraft V4.1.
 *
 * Routes to vector (recraftv4_1_vector → SVG) or raster (recraftv4_1 → bitmap)
 * based on config.generationModel.
 *
 * @param elements  VisualElement[] from phase 2
 * @param prompt    Spatial composition prompt from phase 2
 * @param row       RowData (for utterance and NLU context)
 * @param config    GlobalConfig (reads generationModel and paletteColors)
 * @param onLog     Progress callback
 * @returns         Phase3Result with svg XOR bitmap, plus generationModel provenance
 */
export const generateImage = async (
    elements: VisualElement[],
    prompt: string,
    row: { UTTERANCE: string; NLU?: any },
    config: GlobalConfig,
    onLog?: LogFn,
): Promise<Phase3Result> => {
    const model = config.generationModel?.startsWith('recraft')
        ? (config.generationModel as Extract<GenerationModel, `recraft${string}`>)
        : 'recraftv4_1_vector';

    onLog?.('info', `[PRODUCIR] Iniciando generación con Recraft (${model})…`);
    onLog?.('info', `[PRODUCIR] Elementos: ${elements.length}`);

    const fullPrompt = composeRecraftPrompt(elements, prompt, row.UTTERANCE, row.NLU, config);
    const styleId = config.recraftStyleId?.trim();
    if (MODEL_CATALOG[model].requiresStyle && !styleId) {
        throw new Error('Recraft V4 Styles requires an existing style ID.');
    }
    if (styleId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(styleId)) {
        throw new Error('Recraft style ID must be a UUID.');
    }

    onLog?.('info', '[PRODUCIR] Enviando prompt a Recraft…');
    const colors = config.paletteColors?.filter(c => /^#[0-9a-fA-F]{6}$/.test(c));
    // onStatus: narra los reintentos del worker (429 del proveedor) en el log
    // de la UI, para que la espera larga no parezca un cuelgue silencioso.
    const response = await callRecraft({ prompt: fullPrompt, model, ...(styleId ? { style_id: styleId } : {}), ...(colors?.length ? { colors } : {}) }, msg => onLog?.('info', msg));

    if (getModelFamily(model) === 'vector') {
        if (!response.svg?.includes('<svg')) {
            throw new Error('Recraft no devolvió un SVG válido');
        }
        const normalized = normalizeSvgDimensions(response.svg);
        onLog?.('success', `[PRODUCIR] SVG recibido (${(normalized.length / 1024).toFixed(1)} KB)`);
        return { svg: normalized, generationModel: model };
    } else {
        if (!response.bitmap) {
            throw new Error('Recraft no devolvió imagen bitmap');
        }
        onLog?.('success', '[PRODUCIR] Imagen bitmap recibida de Recraft');
        return { bitmap: response.bitmap, generationModel: model };
    }
};
