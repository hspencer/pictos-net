/**
 * Recraft Service — Phase 3 (PRODUCIR)
 *
 * Calls Recraft V3 SVG via the api-recraft Netlify function.
 * Returns a native SVG string — no rasterization, no VTracer.
 * This SVG (rawSvg) feeds directly into phase 5 (ESTRUCTURAR).
 */

import { GlobalConfig, VisualElement, Phase3Result, GenerationModel, getModelFamily } from "../types";
import { callRecraft } from "./aiClient";

/**
 * Normalize SVG dimensions so it scales to its container.
 * Recraft returns SVGs with explicit pixel width/height; we strip those
 * and ensure a viewBox is present so the SVG is resolution-independent.
 */
function normalizeSvgDimensions(svg: string): string {
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

const formatElements = (els: VisualElement[], depth = 0): string => {
    if (!Array.isArray(els)) return '';
    return els.map(el => {
        const indent = '  '.repeat(depth);
        const children = el.children?.length ? '\n' + formatElements(el.children, depth + 1) : '';
        return `${indent}- ${el.id}${children}`;
    }).join('\n');
};

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

    const lang = (row.NLU as any)?.lang || config.lang || 'es-419';
    const isEs = lang.startsWith('es');

    const nluContext = row.NLU && typeof row.NLU === 'object'
        ? `\n${isEs ? 'Contexto semántico' : 'Semantic context'}: ${row.NLU.visual_guidelines?.focus_actor || ''} — ${row.NLU.visual_guidelines?.action_core || ''} — ${row.NLU.visual_guidelines?.object_core || ''}`
        : '';

    const defaultStyle = isEs
        ? 'Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.'
        : 'Flat pictogram style, no text, simple vector design, white background.';
    const noTextLine = isEs
        ? 'Sin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.'
        : 'No text. No labels. No watermarks. White background. Flat design.';

    let fullPrompt = [
        isEs ? `Pictograma AAC: "${row.UTTERANCE}"` : `AAC Pictogram: "${row.UTTERANCE}"`,
        nluContext,
        '',
        isEs ? 'Elementos (jerarquía visual):' : 'Elements (visual hierarchy):',
        formatElements(elements),
        '',
        isEs ? 'Composición espacial:' : 'Spatial composition:',
        prompt,
        '',
        config.visualStylePrompt || defaultStyle,
        '',
        noTextLine,
    ].filter(s => s !== undefined).join('\n');

    if (fullPrompt.length > 2000) {
        const style = config.visualStylePrompt || defaultStyle;
        const suffix = `\n\n${style}\n${noTextLine}`;
        const header = isEs ? 'Pictograma AAC' : 'AAC Pictogram';
        const elemLabel = isEs ? 'Elementos' : 'Elements';
        const compLabel = isEs ? 'Composición espacial' : 'Spatial composition';
        const prefix = `${header}: "${row.UTTERANCE}"\n${nluContext}\n\n${elemLabel}:\n${formatElements(elements)}\n\n${compLabel}:\n${prompt}`;
        const maxPrefixLen = 1995 - suffix.length;
        fullPrompt = prefix.slice(0, maxPrefixLen) + suffix;
    }

    onLog?.('info', '[PRODUCIR] Enviando prompt a Recraft…');
    const colors = config.paletteColors?.filter(c => /^#[0-9a-fA-F]{6}$/.test(c));
    // onStatus: narra los reintentos del worker (429 del proveedor) en el log
    // de la UI, para que la espera larga no parezca un cuelgue silencioso.
    const response = await callRecraft({ prompt: fullPrompt, model, ...(colors?.length ? { colors } : {}) }, msg => onLog?.('info', msg));

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
