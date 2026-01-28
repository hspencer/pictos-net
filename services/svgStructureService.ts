/**
 * SVG Structure Service - Gemini-powered SVG Restructuring
 *
 * Takes a raw SVG from vtracer and structures it according to
 * the mf-svg-schema specification, adding semantic roles,
 * accessibility metadata, and ICAP validation data.
 *
 * @module services/svgStructureService
 */

import { GoogleGenAI } from "@google/genai";
import type { NLUData, VisualElement, EvaluationMetrics, GlobalConfig } from "../types";

// Reuse the AI client pattern from geminiService
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Embedded CSS stylesheet following mf-svg-schema specification
 * This is inserted into the <defs> section of structured SVGs
 */
/**
 * Generate CSS stylesheet dynamically based on GlobalConfig
 * Following mf-svg-schema specification with user-defined overrides
 */
export const generateStylesheet = (config: GlobalConfig): string => {
    const styles = config.svgStyles || {
        f: { fill: '#000', stroke: 'none', strokeWidth: 0 },
        k: { fill: '#fff', stroke: 'none', strokeWidth: 0 }
    };

    // Generate CSS for each defined class
    const classStyles = Object.entries(styles).map(([className, style]) => `
.${className} {
  fill: ${style.fill};
  fill-opacity: ${style.opacity ?? 1};
  stroke: ${style.stroke};
  stroke-width: ${style.strokeWidth};
  stroke-opacity: ${style.opacity ?? 1};
  stroke-linecap: ${style.strokeLinecap || 'round'};
  stroke-linejoin: ${style.strokeLinejoin || 'round'};
}`).join('\n');

    return `
/* MediaFranca SVG Schema - Dynamic Class Styling System */
${classStyles}

/* --- Mini Utility Classes (Tailwind-like) --- */
/* Colors */
.fill-none { fill: none; }
.stroke-none { stroke: none; }
.fill-red { fill: #ef4444; }
.fill-blue { fill: #3b82f6; }
.fill-green { fill: #22c55e; }
.fill-yellow { fill: #eab308; }

/* Strokes */
.stroke-sm { stroke-width: 1px; }
.stroke-md { stroke-width: 2px; }
.stroke-lg { stroke-width: 4px; }

/* Animations */
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.animate-spin { animation: spin 1s linear infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Focus states for keyboard navigation */
g[role="group"]:focus {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
}
`;
};

/**
 * Remove inline presentation attributes to enforce CSS classes
 */
function sanitizeSVG(svgContent: string): string {
    if (!svgContent) return '';

    // Regex to strip fill, stroke, stroke-width, style from shape elements
    // We run it twice to catch multiple attributes
    let clean = svgContent;
    const regex = /(<(?:path|rect|circle|ellipse|line|polyline|polygon|g)[^>]*?)\s+(?:fill|stroke|stroke-width|style|opacity)=["'][^"']*["']/gi;

    clean = clean.replace(regex, '$1');
    clean = clean.replace(regex, '$1'); // Second pass for remaining attributes
    clean = clean.replace(regex, '$1'); // Third pass to be sure

    return clean;
}

/**
 * Input data for SVG structuring
 */
export interface SVGStructureInput {
    /** Raw SVG string from vtracer */
    rawSvg: string;
    /** Original bitmap (Base64 PNG) for visual reference */
    bitmap: string;
    /** NLU semantic analysis */
    nlu: NLUData;
    /** Hierarchical visual elements */
    elements: VisualElement[];
    /** ICAP evaluation metrics */
    evaluation: EvaluationMetrics;
    /** Original utterance */
    utterance: string;
    /** Global configuration */
    config: GlobalConfig;
    /** Callback for progress logs (string messages) */
    onProgress?: (msg: string) => void;
    /** Callback for structural status updates (short codes/messages) */
    onStatus?: (status: string) => void;
}

/**
 * Result of SVG structuring
 */
export interface SVGStructureResult {
    /** Fully structured SVG string (mf-svg-schema compliant) */
    svg: string;
    /** Whether the structuring was successful */
    success: boolean;
    /** Error message if failed */
    error?: string;
}

// Internal interface for typed concept building
interface ConceptMetadata {
    id?: string;
    role: string;
    label: string;
    nsmPrime?: string;
    implicit?: boolean;
    performedBy?: string;
    note?: string;
}

/**
 * Extract NSM primes from NLU data
 */
function extractNSMPrimes(nlu: NLUData): string[] {
    const primes = new Set<string>();

    // Extract from nsm_explications keys and values
    if (nlu.nsm_explications) {
        for (const [key, value] of Object.entries(nlu.nsm_explications)) {
            // Keys are often NSM primes in caps
            if (key === key.toUpperCase()) {
                primes.add(key);
            }
            // Extract caps words from values
            const capsWords = value.match(/\b[A-Z]+\b/g);
            if (capsWords) {
                capsWords.forEach(w => primes.add(w));
            }
        }
    }

    // Fallback primes based on roles
    if (primes.size === 0) {
        if (nlu.visual_guidelines?.focus_actor) primes.add('SOMEONE');
        if (nlu.visual_guidelines?.action_core) primes.add('DO');
        if (nlu.visual_guidelines?.object_core) primes.add('SOMETHING');
    }

    return Array.from(primes).slice(0, 5); // Limit to 5 primes
}

/**
 * Build semantic concepts array for metadata
 */
function buildConceptsArray(elements: VisualElement[], nlu: NLUData): ConceptMetadata[] {
    const concepts: ConceptMetadata[] = [];
    const roles = nlu.visual_guidelines;

    // Map elements to semantic roles
    const flatElements = flattenElements(elements);

    for (const el of flatElements) {
        const id = `g-${el.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        // Determine role based on NLU visual_guidelines
        let role = 'Theme';
        let nsmPrime = 'SOMETHING';

        if (roles?.focus_actor && el.id.toLowerCase().includes(roles.focus_actor.toLowerCase())) {
            role = 'Agent';
            nsmPrime = 'SOMEONE';
        } else if (roles?.object_core && el.id.toLowerCase().includes(roles.object_core.toLowerCase())) {
            role = 'Patient';
            nsmPrime = 'SOMETHING';
        }

        concepts.push({
            id,
            role,
            label: el.id.replace(/_/g, ' '),
            nsmPrime
        });
    }

    // Add implicit Action if action_core exists
    if (roles?.action_core) {
        const agent = concepts.find(c => c.role === 'Agent');

        concepts.push({
            role: 'Action',
            label: `${roles.action_core} (implicit action)`,
            nsmPrime: 'DO',
            implicit: true,
            performedBy: agent?.id,
            note: 'Action is implicit, performed by the Agent through posture or gesture'
        });
    }

    return concepts;
}

/**
 * Flatten nested visual elements
 */
function flattenElements(elements: VisualElement[]): VisualElement[] {
    const flat: VisualElement[] = [];

    for (const el of elements) {
        // Skip the root 'pictograma' element
        if (el.id !== 'pictograma') {
            flat.push(el);
        }
        if (el.children) {
            flat.push(...flattenElements(el.children));
        }
    }

    return flat;
}

/**
 * Calculate ICAP average score
 */
function calculateICAPAverage(eval_: EvaluationMetrics): number {
    const { clarity, recognizability, semantic_transparency, pragmatic_fit, cultural_adequacy, cognitive_accessibility } = eval_;
    return (clarity + recognizability + semantic_transparency + pragmatic_fit + cultural_adequacy + cognitive_accessibility) / 6;
}

/**
 * Build the metadata JSON block
 */
function buildMetadataJSON(input: SVGStructureInput): object {
    const primes = extractNSMPrimes(input.nlu);
    const concepts = buildConceptsArray(input.elements, input.nlu);
    const icapAvg = calculateICAPAverage(input.evaluation);

    return {
        version: "1.0.0",
        utterance: input.utterance,
        nsm: {
            primes,
            gloss: primes.join(' ') + ' (derived from NLU analysis)'
        },
        concepts,
        accessibility: {
            cognitiveDescription: input.utterance,
            visualDescription: input.nlu.visual_guidelines
                ? `${input.nlu.visual_guidelines.focus_actor || 'Element'} ${input.nlu.visual_guidelines.action_core || 'interacts with'} ${input.nlu.visual_guidelines.object_core || 'object'}`
                : input.utterance
        },
        provenance: {
            generator: "PictoNet v2.7",
            generatedAt: new Date().toISOString(),
            sourceDataset: "MediaFranca-PictoNet",
            licence: input.config.license || "CC BY 4.0"
        },
        icap: {
            validated: true,
            validatedAt: new Date().toISOString(),
            validator: input.config.author || "PictoNet",
            clarityScore: Math.round(input.evaluation.clarity),
            comments: input.evaluation.reasoning || `ICAP average: ${icapAvg.toFixed(2)}`
        }
    };
}

/**
 * Build the system instruction for Gemini
 */
function buildSystemInstruction(metadata: object, elements: VisualElement[], config: GlobalConfig, lang: string = 'en'): string {
    const css = generateStylesheet(config);
    return `You are an SVG restructuring agent following the MediaFranca SVG Schema specification.

**YOUR TASK:**
Convert a raw vectorized SVG into a semantically structured SVG following the mf-svg-schema standard.

**INPUT YOU RECEIVE:**
1. **Visual Reference (IMAGE)**: The original bitmap pictogram - USE THIS to understand what each part represents
2. **Geometric Base (TEXT)**: Raw SVG with unstructured <path> elements from vtracer vectorization
3. **Semantic Context (TEXT)**: Hierarchical visual elements that MUST correspond to visual parts in the image
4. **Metadata (TEXT)**: NLU analysis, concepts, ICAP scores

**CRITICAL VISUAL CORRELATION:**
Look at the IMAGE and the HIERARCHICAL ELEMENTS together:
- Each element in the hierarchy (e.g., "persona", "vaso_agua") represents a VISIBLE part in the image
- Your job is to GROUP the SVG paths that correspond to each element
- Use the IMAGE as the PRIMARY reference to understand what represents what

**OUTPUT REQUIREMENTS:**
You must output a COMPLETE, VALID SVG file with these exact parts in order:

1. **<svg> root** with attributes:
   - id="pictogram"
   - xmlns="http://www.w3.org/2000/svg"
   - viewBox="0 0 100 100" (adjust based on input)
   - role="img"
   - aria-labelledby="title desc"
   - lang="${lang}"
   - tabindex="0"
   - focusable="true"

2. **<title id="title">** - The utterance

3. **<desc id="desc">** - Visual description from accessibility.visualDescription

4. **<metadata id="mf-accessibility">** - The complete JSON metadata block (provided below)

5. **<defs><style>** - The embedded CSS stylesheet (provided below)

6. **Semantic <g> groups** - Group the paths according to concepts:
   - Each concept with an 'id' needs a corresponding <g> element
   - Attributes: id, role="group", tabindex="0", data-concept="Role", aria-label
   - Assign class="f" (foreground/secondary) or class="k" (key/primary - for Agents)
   - Preserve the original path geometry, just reorganize into groups

**SEMANTIC METADATA TO EMBED:**
\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`

**CSS STYLESHEET TO EMBED:**
\`\`\`css
${css}
\`\`\`

**VISUAL ELEMENT HIERARCHY:**
\`\`\`json
${JSON.stringify(elements, null, 2)}
\`\`\`

**GROUPING STRATEGY (USE THE IMAGE!):**
1. Look at the PROVIDED IMAGE to see what the pictogram shows
2. Look at the HIERARCHICAL ELEMENTS to know what elements should exist (e.g., "persona", "vaso")
3. For each element in the hierarchy:
   - Identify which part of the IMAGE it represents
   - Find the SVG paths that draw that same part
   - Group those paths together in a <g> element with the correct concept ID
4. Visual cues in the IMAGE:
   - Agents (usually "persona", "niño", etc.) = human/animal figures
   - Patients/Objects (usually nouns) = things being acted upon
   - Context elements = background or secondary objects
5. If an element is in the hierarchy but not clearly visible, mark it as implicit

**CRITICAL RULES:**
1. Output ONLY the complete SVG, no explanation
2. Preserve ALL original path data - do not simplify or modify paths
3. Every path must be inside a semantic <g> group
4. The metadata JSON must be exactly as provided (inside <metadata> tags)
5. Remove any path fill/stroke attributes and rely on CSS classes
6. Maintain proper SVG structure and valid XML`;
}

/**
 * Clean SVG response from Gemini
 */
function cleanSVGResponse(text: string): string {
    if (!text) return '';

    let cleaned = text.trim();

    // Remove markdown code blocks
    cleaned = cleaned.replace(/^```(?:svg|xml|html)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
    cleaned = cleaned.trim();

    // Find the SVG content
    const svgStart = cleaned.indexOf('<svg');
    const svgEnd = cleaned.lastIndexOf('</svg>');

    if (svgStart !== -1 && svgEnd !== -1) {
        return cleaned.substring(svgStart, svgEnd + 6);
    }

    return cleaned;
}

/**
 * Structure a raw SVG according to mf-svg-schema
 * 
 * This function takes a raw SVG (from vtracer) and transforms it into
 * a semantically rich, accessible SVG following the MediaFranca specification.
 * 
 * @param input - The structuring input containing raw SVG, NLU, elements, etc.
 * @returns Promise resolving to structured SVG result
 * 
 * @example
 * ```typescript
 * const result = await structureSVG({
 *   rawSvg: svgFromVtracer,
 *   nlu: row.NLU,
 *   elements: row.elements,
 *   evaluation: row.evaluation,
 *   utterance: row.UTTERANCE,
 *   config: globalConfig
 * });
 * 
 * if (result.success) {
 *   console.log(result.svg);
 * }
 * ```
 */
export async function structureSVG(input: SVGStructureInput): Promise<SVGStructureResult> {
    try {
        const ai = getAI();

        // Build the metadata JSON
        const metadata = buildMetadataJSON(input);

        // Build the system instruction
        const lang = input.nlu.lang || input.config.lang || 'en';
        const systemInstruction = buildSystemInstruction(metadata, input.elements, input.config, lang);

        if (input.onProgress) input.onProgress('[SVG FORMAT] Preparando solicitud multimodal...');
        if (input.onStatus) input.onStatus('sending');

        // Extract base64 data from bitmap (remove data URL prefix if present)
        const base64Data = input.bitmap.replace(/^data:image\/\w+;base64,/, '');

        // Format hierarchical elements as readable text
        const formatElements = (els: VisualElement[], depth = 0): string => {
            return els.map(el => {
                const indent = '  '.repeat(depth);
                const children = el.children ? '\n' + formatElements(el.children, depth + 1) : '';
                return `${indent}- ${el.id}${children}`;
            }).join('\n');
        };

        if (input.onProgress) input.onProgress('[SVG FORMAT] Enviando imagen + SVG + elementos a Gemini 3 Pro...');

        // Call Gemini with MULTIMODAL input (image + text)
        const result = await ai.models.generateContentStream({
            model: "gemini-3-pro-preview",
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: "image/png",
                            data: base64Data
                        }
                    },
                    {
                        text: `**ORIGINAL PICTOGRAM IMAGE ABOVE** - This is your PRIMARY visual reference.

**HIERARCHICAL ELEMENTS YOU MUST FIND IN THE IMAGE:**
${formatElements(input.elements)}

**RAW SVG GEOMETRY (paths you need to group):**
${input.rawSvg}

**INSTRUCTIONS:**
Look at the IMAGE carefully and identify where each element appears visually.
Then, group the corresponding SVG paths into semantic <g> groups according to the mf-svg-schema specification.
Output ONLY the complete, restructured SVG file - no explanation.`
                    }
                ]
            },
            config: {
                systemInstruction,
            }
        });

        let text = '';
        let lastReportSize = 0;

        if (input.onStatus) input.onStatus('receiving');
        if (input.onProgress) input.onProgress('[SVG FORMAT] Gemini está analizando la imagen y estructurando el SVG...');

        for await (const chunk of result) {
            const chunkText = chunk.text;
            text += chunkText;

            // Report progress every ~1KB or so
            if (input.onProgress && (text.length - lastReportSize > 500)) {
                input.onProgress(`[SVG FORMAT] Recibiendo SVG estructurado... (${(text.length / 1024).toFixed(1)} KB)`);
                lastReportSize = text.length;
            }
        }

        // Parse the response
        if (input.onProgress) input.onProgress('[SVG FORMAT] Respuesta completa recibida, procesando...');

        // Sanitize to remove inline styles and force CSS usage
        if (input.onStatus) input.onStatus('sanitizing');
        if (input.onProgress) input.onProgress('[SVG FORMAT] Limpiando respuesta y extrayendo SVG...');
        let svgContent = cleanSVGResponse(text);

        if (input.onProgress) input.onProgress('[SVG FORMAT] Sanitizando estilos inline y aplicando clases CSS...');
        // Sanitize to remove inline styles and force CSS usage
        svgContent = sanitizeSVG(svgContent);

        if (!svgContent || !svgContent.includes('<svg')) {
            if (input.onProgress) input.onProgress('[SVG FORMAT] ❌ Error: respuesta no contiene SVG válido');
            return {
                svg: '',
                success: false,
                error: 'Gemini did not return valid SVG'
            };
        }

        if (input.onProgress) input.onProgress(`[SVG FORMAT] ✓ SVG estructurado completado (${(svgContent.length / 1024).toFixed(1)} KB)`);

        return {
            svg: svgContent,
            success: true
        };

    } catch (error) {
        return {
            svg: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during SVG structuring'
        };
    }
}

/**
 * Check if a row has sufficient data for SVG generation
 * Requires: bitmap (for vectorization), NLU, elements, evaluation with ICAP >= 4.0
 */
export function canGenerateSVG(row: {
    bitmap?: string;
    NLU?: NLUData | string;
    elements?: VisualElement[];
    evaluation?: EvaluationMetrics;
}): { eligible: boolean; reason?: string } {

    if (!row.bitmap) {
        return { eligible: false, reason: 'No bitmap available' };
    }

    if (!row.NLU || typeof row.NLU === 'string') {
        return { eligible: false, reason: 'NLU analysis required' };
    }

    if (!row.elements || row.elements.length === 0) {
        return { eligible: false, reason: 'Visual elements required' };
    }

    if (!row.evaluation) {
        return { eligible: false, reason: 'ICAP evaluation required' };
    }

    const { clarity, recognizability, semantic_transparency, pragmatic_fit, cultural_adequacy, cognitive_accessibility } = row.evaluation;
    const average = (clarity + recognizability + semantic_transparency + pragmatic_fit + cultural_adequacy + cognitive_accessibility) / 6;

    if (average < 4.0) {
        return {
            eligible: false,
            reason: `ICAP average (${average.toFixed(2)}) must be >= 4.0`
        };
    }

    return { eligible: true };
}
