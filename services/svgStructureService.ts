/**
 * SVG Structure Service v4 — Single-Call Vision + Local Assembly
 *
 * Phase 5 (ESTRUCTURAR): Takes a raw SVG from Recraft and restructures it
 * into a clean, semantically grouped, CSS-styled SVG conforming to mf-svg-schema.
 *
 * Pipeline:
 *   rawSvg → ensurePathIds (local)
 *          → buildPathInventory (local)
 *          → rasterizeWithMarks (local, canvas → base64 JPEG)
 *          → callStructuringModel (single API call — Claude or Gemini)
 *              inputs: marked image + raw SVG source + VisualDOM + CSS palette
 *              tool: restructure_svg → StructuringMapping
 *          → if recording.enabled: return mapping for Phase5_Review
 *          → assembleFromMapping (local — geometry never leaves browser)
 *              → resolveMergeGeometry: model proposes merge.sources (path ids)
 *                only; the exact union is computed here via svgBooleanOps
 *                (Martinez sweep-line) + applySimplify, never model-authored.
 *                This is what actually removes VTracer's double-contour noise.
 *          → post-process: deriveChildIds, filterCSS, validateXML
 *
 * NLU context is NOT sent to the model — structuring is a purely visual task.
 *
 * @module services/svgStructureService
 */

import type { NLUData, VisualElement, GlobalConfig, StructuringMapping, StructuringGroup, MergedPath } from '../types';
import { SVG_STYLESHEET } from './svgStyles';
import { generateCssString } from '../lib/style-editor/lib/utils/cssGenerator';
import { callStructuringModel, extractToolUse } from './aiClient';
import type { ClaudeResponse } from './aiClient';
import { applyBooleanN, applySimplify } from './svgBooleanOps';
import { findUnreachableNodeIds } from './svgTreeUtils';
import { isMicroBlob } from './svgGeometryUtils';

const MARK_RENDER_SIZE = 800;

// ─── Public helpers ──────────────────────────────────────────────────────────

export const generateStylesheet = (config: GlobalConfig): string => {
    if (config.svgStyleDefs && config.svgStyleDefs.length > 0) {
        return generateCssString(config.svgStyleDefs, config.svgKeyframes ?? []);
    }
    return SVG_STYLESHEET;
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SVGStructureInput {
    rawSvg: string;
    nlu: NLUData;
    elements: VisualElement[];
    utterance: string;
    config: GlobalConfig;
    phase5Model?: string;
    /**
     * Source bitmap (data URL) used as the visual reference for the redraw path.
     * Preferred over a raster of the noisy trace. Optional — falls back to a
     * clean raster of rawSvg when absent.
     */
    referenceImage?: string;
    onProgress?: (msg: string) => void;
    onStatus?: (status: string) => void;
}

export interface SVGStructureResult {
    svg: string;
    success: boolean;
    error?: string;
    mapping?: StructuringMapping; // populated in recording mode (pending review)
    pendingReview?: boolean;
}

// ─── Path Inventory (local pre-processing) ───────────────────────────────────

interface PathInfo {
    id: string;
    fill: string;
    fillRole: 'dark' | 'light' | 'accent' | 'unknown';
    cx: number;
    cy: number;
    vtracerGroup: string | null;
}

interface PathInventory {
    paths: PathInfo[];
    vtracerGroups: Record<string, string[]>;
    groupClasses: Record<string, string>;
    pathClasses: Record<string, string>;
    standalonePathIds: string[];
    backgroundPathIds: string[];
    viewBox: string;
    rawStyleRules: string;
    cssFillMap: Record<string, string>;
}

function getFillRole(fill: string): 'dark' | 'light' | 'accent' | 'unknown' {
    if (!fill || fill === 'none') return 'unknown';
    const hex = fill.replace('#', '');
    if (hex.length !== 6 && hex.length !== 3) return 'unknown';
    let r: number, g: number, b: number;
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation > 0.4 && luminance > 0.1) return 'accent';
    if (luminance < 0.2) return 'dark';
    if (luminance > 0.8) return 'light';
    return 'unknown';
}

function fillRoleToColorClass(role: 'dark' | 'light' | 'accent' | 'unknown'): string {
    switch (role) {
        case 'dark': return 'main';
        case 'light': return 'w';
        case 'accent': return 'accent';
        default: return 'main';
    }
}

function getDominantFillRole(pathIds: string[], pathInfoMap: Map<string, PathInfo>): 'dark' | 'light' | 'accent' | 'unknown' {
    const counts: Record<string, number> = { dark: 0, light: 0, accent: 0, unknown: 0 };
    for (const id of pathIds) {
        const info = pathInfoMap.get(id);
        if (info) counts[info.fillRole]++;
    }
    if (counts.dark >= counts.light && counts.dark >= counts.accent && counts.dark > 0) return 'dark';
    if (counts.light >= counts.accent && counts.light > 0) return 'light';
    if (counts.accent > 0) return 'accent';
    return 'dark';
}

function getTranslateOffset(transform: string | null): [number, number] {
    if (!transform) return [0, 0];
    const m = transform.match(/translate\(\s*([^,\s]+)[\s,]+([^)\s]+)\s*\)/);
    return m ? [Math.round(parseFloat(m[1])), Math.round(parseFloat(m[2]))] : [0, 0];
}

function getCentroid(d: string, tx: number, ty: number): [number, number] {
    const nums = d.match(/-?[0-9]+\.?[0-9]*/g)?.map(Number) ?? [];
    if (nums.length < 2) return [tx, ty];
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    return [
        Math.round(xs.reduce((a, b) => a + b, 0) / xs.length + tx),
        Math.round(ys.reduce((a, b) => a + b, 0) / ys.length + ty),
    ];
}

function offsetPathD(d: string, tx: number, ty: number): string {
    const tokens = d.match(/[A-Za-z]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g);
    if (!tokens) return d;
    const result: string[] = [];
    let cmd = '';
    let argIndex = 0;
    for (const tok of tokens) {
        if (/^[A-Za-z]$/.test(tok)) { cmd = tok; argIndex = 0; result.push(tok); continue; }
        const val = parseFloat(tok);
        const isRelative = cmd === cmd.toLowerCase();
        if (isRelative) { result.push(tok); argIndex++; continue; }
        const upper = cmd.toUpperCase();
        let offsetVal = val;
        if (upper === 'H') { offsetVal = val + tx; }
        else if (upper === 'V') { offsetVal = val + ty; }
        else if (upper === 'A') { const ai = argIndex % 7; if (ai === 5) offsetVal = val + tx; else if (ai === 6) offsetVal = val + ty; }
        else { if (argIndex % 2 === 0) offsetVal = val + tx; else offsetVal = val + ty; }
        const str = Number.isInteger(offsetVal) ? String(offsetVal) : offsetVal.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
        result.push(str);
        argIndex++;
    }
    let out = '';
    for (let i = 0; i < result.length; i++) {
        const tok = result[i];
        out += (/^[A-Za-z]$/.test(tok) ? (i > 0 ? ' ' : '') : ' ') + tok;
    }
    return out.trim();
}

function extractFill(el: Element): string {
    const fillAttr = el.getAttribute('fill');
    if (fillAttr && fillAttr !== 'none') return fillAttr.trim();
    const style = el.getAttribute('style') ?? '';
    const m = style.match(/fill:\s*([^;]+)/);
    return m?.[1]?.trim() ?? '#000000';
}

function isBackgroundRect(d: string, tx: number, ty: number, viewBox: string): boolean {
    if (tx !== 0 || ty !== 0) return false;
    const vbParts = viewBox.split(/\s+/).map(Number);
    if (vbParts.length !== 4) return false;
    const [, , vbW, vbH] = vbParts;
    const nums = d.match(/-?[0-9]+\.?[0-9]*/g)?.map(Number) ?? [];
    if (nums.length < 4) return false;
    const hasWidth = nums.some(n => Math.abs(n - vbW) < 2);
    const hasHeight = nums.some(n => Math.abs(n - vbH) < 2);
    const startsAtOrigin = nums[0] === 0 && nums[1] === 0;
    return startsAtOrigin && hasWidth && hasHeight;
}

export function ensurePathIds(svg: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svg;
    const existingIds = new Set<string>();
    svgEl.querySelectorAll('[id]').forEach(el => existingIds.add(el.getAttribute('id')!));
    let counter = 0;
    svgEl.querySelectorAll('path').forEach(p => {
        if (!p.getAttribute('id')) {
            let newId: string;
            do { newId = `p${counter++}`; } while (existingIds.has(newId));
            p.setAttribute('id', newId);
            existingIds.add(newId);
        }
    });
    svgEl.querySelectorAll('g').forEach(g => {
        if (!g.getAttribute('id')) {
            let newId: string;
            do { newId = `g${counter++}`; } while (existingIds.has(newId));
            g.setAttribute('id', newId);
            existingIds.add(newId);
        }
    });
    return new XMLSerializer().serializeToString(svgEl);
}

export function buildPathInventory(svg: string): PathInventory {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    const viewBox = vbMatch?.[1] ?? '0 0 1024 1024';
    const paths: PathInfo[] = [];
    const backgroundPathIds: string[] = [];
    const vtracerGroups: Record<string, string[]> = {};
    const groupClasses: Record<string, string> = {};
    const pathClasses: Record<string, string> = {};
    const standalonePathIds: string[] = [];
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return { paths, vtracerGroups, groupClasses, pathClasses, standalonePathIds, backgroundPathIds: [], viewBox, rawStyleRules: '', cssFillMap: {} };

    let rawStyleRules = '';
    svgEl.querySelectorAll('style').forEach(styleEl => {
        const text = styleEl.textContent?.trim();
        if (text) rawStyleRules += (rawStyleRules ? '\n' : '') + text;
    });

    const cssFillMap: Record<string, string> = {};
    if (rawStyleRules) {
        const ruleRe = /([^{]+)\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = ruleRe.exec(rawStyleRules)) !== null) {
            const selector = m[1].trim();
            const decls = m[2];
            const fillMatch = decls.match(/fill\s*:\s*([^;}\s]+)/);
            if (!fillMatch) continue;
            const classMatches = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)];
            for (const cm of classMatches) { cssFillMap[cm[1]] = fillMatch[1].trim(); }
        }
    }

    function resolveFill(el: Element): string {
        const inline = extractFill(el);
        if (inline !== '#000000') return inline;
        const cls = el.getAttribute('class')?.trim();
        if (cls) { for (const c of cls.split(/\s+/)) { if (cssFillMap[c]) return cssFillMap[c]; } }
        return inline;
    }

    for (const child of Array.from(svgEl.children)) {
        const tag = child.tagName.toLowerCase();
        const id = child.getAttribute('id') ?? '';
        if (['defs', 'style', 'title', 'desc', 'metadata'].includes(tag)) continue;
        if (tag === 'g') {
            const groupPaths: string[] = [];
            const cls = child.getAttribute('class')?.trim();
            if (cls && id) groupClasses[id] = cls;
            for (const p of Array.from(child.querySelectorAll('path'))) {
                const pid = p.getAttribute('id') ?? '';
                if (!pid) continue;
                const fill = resolveFill(p);
                const d = p.getAttribute('d') ?? '';
                const transform = p.getAttribute('transform') ?? '';
                const [tx, ty] = getTranslateOffset(transform);
                const [cx, cy] = getCentroid(d, tx, ty);
                const pCls = p.getAttribute('class')?.trim();
                if (pCls) pathClasses[pid] = pCls;
                paths.push({ id: pid, fill, fillRole: getFillRole(fill), cx, cy, vtracerGroup: id });
                groupPaths.push(pid);
            }
            if (groupPaths.length > 0) vtracerGroups[id] = groupPaths;
        } else if (tag === 'path') {
            const pid = id;
            if (!pid) continue;
            const fill = resolveFill(child);
            const d = child.getAttribute('d') ?? '';
            const transform = child.getAttribute('transform') ?? '';
            const [tx, ty] = getTranslateOffset(transform);
            if (isBackgroundRect(d, tx, ty, viewBox)) { backgroundPathIds.push(pid); continue; }
            const [cx, cy] = getCentroid(d, tx, ty);
            const pCls = child.getAttribute('class')?.trim();
            if (pCls) pathClasses[pid] = pCls;
            paths.push({ id: pid, fill, fillRole: getFillRole(fill), cx, cy, vtracerGroup: null });
            standalonePathIds.push(pid);
        }
    }

    if (backgroundPathIds.length > 0) {
        console.info(`[inventory] Excluidos ${backgroundPathIds.length} path(s) de fondo: ${backgroundPathIds.join(', ')}`);
    }

    return { paths, vtracerGroups, groupClasses, pathClasses, standalonePathIds, backgroundPathIds, viewBox, rawStyleRules, cssFillMap };
}

// ─── Set-of-Marks Rasterization (browser canvas) ─────────────────────────────

async function rasterizeWithMarks(svgString: string, inventory: PathInventory): Promise<{ base64: string; widthPx: number; heightPx: number; sizeKB: number }> {
    return new Promise((resolve, reject) => {
        const parts = inventory.viewBox.split(/\s+/).map(Number);
        const vbW = parts[2] || 1024;
        const vbH = parts[3] || 1024;
        const scale = MARK_RENDER_SIZE / Math.max(vbW, vbH);
        const w = Math.round(vbW * scale);
        const h = Math.round(vbH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Could not get canvas context')); return; }

        const img = new Image();
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);

            inventory.paths.forEach((path, index) => {
                const cx = Math.round(path.cx * scale);
                const cy = Math.round(path.cy * scale);
                const radius = 13;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(220, 38, 38, 0.90)';
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = 'white';
                ctx.font = `bold ${radius}px Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(index), cx, cy);
            });

            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const base64 = dataUrl.split(',')[1];
            const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
            resolve({ base64, widthPx: w, heightPx: h, sizeKB });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to rasterize SVG for set-of-marks'));
        };
        img.src = url;
    });
}

// ─── Node list from VisualElement tree ──────────────────────────────────────

interface NodeInfo {
    id: string;
    label: string;
    concept: string;
    parentId: string | null;
}

function guessConceptFromId(id: string): string {
    const lower = id.toLowerCase();
    if (lower === 'pictograma' || lower === 'pictogram') return 'Root';
    if (lower.startsWith('actor') || lower.startsWith('persona') || lower.startsWith('sujeto') || lower.startsWith('agent')) return 'Agent';
    if (lower.startsWith('accion') || lower.startsWith('action') || lower.startsWith('verbo')) return 'Action';
    if (lower.startsWith('objeto') || lower.startsWith('object') || lower.startsWith('cosa')) return 'Object';
    if (lower.startsWith('contexto') || lower.startsWith('context') || lower.startsWith('escenario') || lower.startsWith('fondo')) return 'Context';
    return 'Element';
}

function flattenElements(elements: VisualElement[], parentId: string | null = null): NodeInfo[] {
    const result: NodeInfo[] = [];
    for (const el of elements) {
        const label = el.id.replace(/_/g, ' ');
        const concept = guessConceptFromId(el.id);
        result.push({ id: el.id, label, concept, parentId });
        if (el.children) {
            result.push(...flattenElements(el.children, el.id));
        }
    }
    return result;
}

// ─── CSS Palette extraction ──────────────────────────────────────────────────

function extractPaletteClasses(cssString: string): string {
    const lines: string[] = [];
    const ruleRe = /\.([a-zA-Z][\w-]*)\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(cssString)) !== null) {
        const cls = m[1];
        const decls = m[2].trim().replace(/\s+/g, ' ').slice(0, 120);
        lines.push(`.${cls} { ${decls} }`);
        if (lines.length >= 30) break;
    }
    return lines.length > 0
        ? lines.join('\n')
        : '(sin paleta definida — usa "k" para agentes/actores, "f" para objetos/acciones)';
}

// ─── Tool Schema ─────────────────────────────────────────────────────────────

function buildRestructureToolSchema(nodeList: NodeInfo[]) {
    const nodeIds = nodeList.map(n => n.id);
    return {
        name: 'restructure_svg',
        description: 'Restructure the SVG by assigning paths to semantic nodes, discarding tracing noise, and optionally proposing simple path merges.',
        input_schema: {
            type: 'object' as const,
            properties: {
                description: {
                    type: 'string',
                    description: 'Brief visual description of the pictogram (1–2 sentences).',
                },
                groups: {
                    type: 'array',
                    minItems: 1,
                    description: 'One entry per VisualDOM node. Flat list — use parentId for hierarchy. MUST NOT be empty — an empty array means every path was silently lost; if a node is unclear, assign it to the closest matching node instead of omitting it.',
                    items: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', enum: nodeIds, description: 'VisualDOM node id.' },
                            label: { type: 'string', description: 'Human-readable label for this node.' },
                            cssClass: { type: 'string', description: 'CSS class from the palette (e.g. "k", "f", "accent").' },
                            parentId: { type: 'string', description: 'Parent nodeId for nesting; omit or null for top-level.', nullable: true },
                            keep: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Path IDs (by mark number or id) to include verbatim from the SVG.',
                            },
                            merge: {
                                description: 'Optional: identify 2+ path ids that are duplicate/overlapping traces of the SAME visual line or shape (e.g. the inner and outer edge of a stroked line traced as two near-concentric closed contours). The system computes the exact geometric union locally — list only the source ids, never author path data yourself.',
                                oneOf: [
                                    { type: 'null' },
                                    {
                                        type: 'object',
                                        properties: {
                                            sources: { type: 'array', items: { type: 'string' }, minItems: 2, description: 'Path ids (2 or more) whose union forms one clean shape.' },
                                        },
                                        required: ['sources'],
                                    },
                                ],
                            },
                        },
                        required: ['nodeId', 'label', 'cssClass', 'keep'],
                    },
                },
                discard: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Path IDs to exclude. Only use for: (a) micro-blobs with no visible area, (b) geometrically identical duplicates, (c) background fill rects. When uncertain, assign to a group instead.',
                },
            },
            required: ['description', 'groups', 'discard'],
        },
    };
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(hasCleanRef: boolean): string {
    const imagesSection = hasCleanRef
        ? `1. IMAGEN A — el bitmap limpio original del pictograma. Es la VERDAD visual: muestra la figura como debe verse, sin ruido.
2. IMAGEN B — el trazado automático con un círculo numerado en rojo sobre el centroide de cada path. Aporta las COORDENADAS, pero viene sucio: ruido, motas y contornos DOBLES (cada línea trazada como su borde interno + externo).
3. El código fuente SVG en bruto (paths con sus IDs)
4. El DOM semántico objetivo — nodos con id, concepto y etiqueta
5. La paleta CSS de la librería — clases disponibles para estilizar`
        : `1. Una imagen del SVG con un círculo numerado en rojo sobre el centroide de cada path
2. El código fuente SVG en bruto (paths con sus IDs)
3. El DOM semántico objetivo — nodos con id, concepto y etiqueta
4. La paleta CSS de la librería — clases disponibles para estilizar`;

    const cleanupSection = hasCleanRef
        ? `Preservación primero (usa la IMAGEN A como referencia de qué es real):
- CONSERVA todo path que corresponda a una forma real del dibujo. La geometría del trazado suele estar limpia y a color — NO la reinventes ni la recortes de más; tu trabajo es agrupar y clasificar, no rediseñar.
- Contornos dobles: cuando dos o más paths casi concéntricos tracen la misma línea (borde interno + externo), NO elijas uno y descartes el otro — proponlos como merge con sources=[id1, id2, …]. El sistema calcula la unión geométrica exacta de forma local (nunca escribas tú el atributo d). La unión conserva todo el área cubierta por cualquiera de los contornos, así que es más segura que descartar uno a ciegas.
- DESCARTA solo lo que claramente NO existe en el bitmap: motas, fragmentos sueltos, bordes irregulares sin relación con ninguna forma real.
- Regla de oro: preservar la figura reconocible es la prioridad. Ante la duda, CONSERVA (o fusiona). Perder un elemento visible (una mano, el inodoro, el globo de habla) es un error grave; dejar una mota menor es tolerable.`
        : `Descarta SOLO estos casos:
  · Micro-blobs: paths con área visualmente insignificante (punto sin significado funcional)
  · Duplicados exactos: paths con geometría d= idéntica a otro path ya asignado
  · Fondos: rectángulos de relleno que cubren todo el viewBox (ya pre-excluidos en su mayoría)
- En caso de duda, CONSERVA el path. Eliminar un elemento visualmente presente es un error grave; incluir un artefacto menor es tolerable.`;

    return `Eres un agente de restructuración semántica de SVG para pictogramas AAC (Comunicación Aumentativa y Alternativa).

Recibes:
${imagesSection}

Tu tarea:
- Identifica qué paths numerados corresponden visualmente a cada nodo semántico
- ${cleanupSection}
- Asigna clases CSS de la paleta (nunca uses colores inline)
- Opcionalmente propón una fusión de paths: si múltiples paths claramente forman la misma región visual (p. ej. contorno doble), lista sus ids en merge.sources — el sistema calcula la geometría fusionada exacta, tú nunca escribes el atributo d.

Reglas:
1. Trabaja desde la evidencia visual de las imágenes — no asumas contenido semántico a partir de los nombres de nodos
2. Cada path que no sea fondo debe aparecer en exactamente un keep de grupo, o en discard
3. Usa solo los valores de cssClass listados en la paleta
4. "k" = agente/actor (personaje principal), "f" = objeto o acción, "accent" = acento de color
5. parentId debe ser null para nodos de nivel superior, o un nodeId válido para nodos hijo`;
}

// ─── User Prompt ─────────────────────────────────────────────────────────────

function buildUserText(rawSvg: string, nodeList: NodeInfo[], cssStyles: string, inventory: PathInventory, hasCleanRef: boolean): string {
    const domSection = nodeList
        .map(n => `- ${n.id} [${n.concept}] "${n.label}"${n.parentId ? ` (hijo de ${n.parentId})` : ''}`)
        .join('\n');

    const paletteSection = extractPaletteClasses(cssStyles);

    const marksSection = inventory.paths
        .map((p, i) => `  mark ${i}: id="${p.id}" fill-role="${p.fillRole}" centroide=(${p.cx},${p.cy})`)
        .join('\n');

    const svgSource = rawSvg.length > 10000
        ? rawSvg.slice(0, 10000) + '\n<!-- … SVG truncado —>'
        : rawSvg;

    const intro = hasCleanRef
        ? `Tienes dos imágenes: IMAGEN A (bitmap limpio original = verdad visual) e IMAGEN B (trazado numerado, con coordenadas pero sucio). Usa A para decidir qué es real y B para las coordenadas. Restructura semánticamente y descarta ruido y contornos duplicados.`
        : `Analiza esta imagen SVG numerada y restructúrala semánticamente.`;

    return `${intro}

DOM semántico objetivo:
${domSection}

Paleta CSS disponible:
${paletteSection}

Marcas en la imagen (mark# → path-id → fill-role → centroide):
${marksSection}

SVG fuente:
${svgSource}`;
}

// ─── Single Vision Call ───────────────────────────────────────────────────────

async function callVisionStructuring(
    image: { base64: string; widthPx: number; heightPx: number; sizeKB: number },
    referenceImage: string | undefined,
    rawSvg: string,
    elements: VisualElement[],
    cssStyles: string,
    inventory: PathInventory,
    model: string,
    onProgress?: (msg: string) => void,
): Promise<StructuringMapping> {
    const nodeList = flattenElements(elements);
    const tool = buildRestructureToolSchema(nodeList);
    const cleanRef = referenceImage ? parseDataUrl(referenceImage) : null;
    const systemPrompt = buildSystemPrompt(!!cleanRef);
    const userText = buildUserText(rawSvg, nodeList, cssStyles, inventory, !!cleanRef);

    // ── Console: Phase5_Console event 1 — full prompt
    if (onProgress) {
        onProgress(`[ESTRUCTURAR] Prompt del sistema:\n${systemPrompt}`);
        onProgress(`[ESTRUCTURAR] Prompt de usuario (${userText.length} chars):\n${userText.slice(0, 800)}${userText.length > 800 ? '…' : ''}`);
    }

    // ── Console: Phase5_Console event 2 — image(s) attached
    if (onProgress) {
        onProgress(`[ESTRUCTURAR] trazado numerado: ${image.widthPx}×${image.heightPx}px JPEG, ${image.sizeKB} KB`);
        if (cleanRef) onProgress(`[ESTRUCTURAR] + bitmap de referencia (${cleanRef.mediaType}) para limpieza`);
    }

    // ── Console: Phase5_Console event 3 — calling model
    if (onProgress) {
        onProgress(`[ESTRUCTURAR] llamando ${model}…`);
    }

    const startMs = Date.now();

    // Image order matches the prompt: [clean bitmap], numbered trace.
    const content: Array<Record<string, unknown>> = [];
    if (cleanRef) {
        content.push({ type: 'image', source: { type: 'base64', media_type: cleanRef.mediaType, data: cleanRef.base64 } });
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.base64 } });
    content.push({ type: 'text', text: userText });

    const response: ClaudeResponse = await callStructuringModel({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'restructure_svg' },
        messages: [{ role: 'user', content }],
    });

    const elapsedMs = Date.now() - startMs;

    // ── Console: Phase5_Console events 4 & 5 — timing + tokens
    if (onProgress) {
        onProgress(`[ESTRUCTURAR] respuesta recibida en ${(elapsedMs / 1000).toFixed(1)}s`);
        if (response.usage) {
            onProgress(`[ESTRUCTURAR] tokens: entrada=${response.usage.input_tokens}, salida=${response.usage.output_tokens}`);
        }
    }

    const mapping = extractToolUse(response, 'restructure_svg') as StructuringMapping;

    // ── Console: Phase5_Console event 6 — group assignments
    if (onProgress) {
        onProgress(`[ESTRUCTURAR] grupos: ${mapping.groups?.length ?? 0}, descartados: ${mapping.discard?.length ?? 0}`);
        for (const g of (mapping.groups ?? [])) {
            const mergeHint = g.merge ? ` [MERGE de ${g.merge.sources?.join(',')}]` : '';
            onProgress(`  ${g.nodeId} (${g.cssClass}): keep=[${g.keep?.join(', ')}]${mergeHint}`);
        }
    }

    // ── Console: Phase5_Console event 7 — discards
    if (onProgress && mapping.discard?.length > 0) {
        onProgress(`[ESTRUCTURAR] descartados: ${mapping.discard.join(', ')}`);
    }

    // Normalize: ensure required fields exist with defaults
    return {
        description: mapping.description ?? '',
        groups: (mapping.groups ?? []).map(g => ({
            ...g,
            keep: g.keep ?? [],
            selected: true,
            merge: g.merge ?? null,
            parentId: g.parentId ?? null,
        })),
        discard: mapping.discard ?? [],
    };
}

// ─── Geometry Validation (Phase5_GeometryValidation) ─────────────────────────

function validateMergedPath(d: string): boolean {
    try {
        const hasValidStart = /^\s*[MmZzLlHhVvCcSsQqTtAa]/.test(d);
        if (!hasValidStart) return false;
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d.replace(/"/g, '&quot;')}"/></svg>`, 'image/svg+xml');
        return !doc.querySelector('parsererror');
    } catch {
        return false;
    }
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

interface OriginalPathData {
    d: string;
    transform: string;
    fill: string;
    className: string;
    otherAttrs: string;
}

function extractOriginalPaths(rawSvg: string): Map<string, OriginalPathData> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const map = new Map<string, OriginalPathData>();
    doc.querySelectorAll('path').forEach(p => {
        const id = p.getAttribute('id');
        if (!id) return;
        const fill = extractFill(p);
        const d = p.getAttribute('d') ?? '';
        const transform = p.getAttribute('transform') ?? '';
        const className = p.getAttribute('class')?.trim() ?? '';
        const skipAttrs = new Set(['id', 'd', 'transform', 'fill', 'style', 'class']);
        const otherParts: string[] = [];
        for (const attr of Array.from(p.attributes)) {
            if (!skipAttrs.has(attr.name)) otherParts.push(`${attr.name}="${attr.value}"`);
        }
        map.set(id, { d, transform, fill, className, otherAttrs: otherParts.join(' ') });
    });
    return map;
}

function escapeXmlAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderGroup(
    group: StructuringGroup,
    childGroups: StructuringGroup[],
    originalPaths: Map<string, OriginalPathData>,
    pathInfoMap: Map<string, PathInfo>,
    indent = '  ',
): string {
    const dominantRole = getDominantFillRole(group.keep, pathInfoMap);
    const colorCls = fillRoleToColorClass(dominantRole);
    const semanticCls = group.cssClass || 'f';
    const userHasColorClass = ['k', 'f', 'w', 'main', 'accent'].includes(semanticCls);
    const clsParts = [semanticCls];
    if (!userHasColorClass) clsParts.push(colorCls);
    const cls = clsParts.join(' ');
    const label = escapeXmlAttr(group.label || group.nodeId);
    const concept = escapeXmlAttr(guessConceptFromId(group.nodeId));
    const lines: string[] = [];
    lines.push(`${indent}<g id="${group.nodeId}" role="group" tabindex="0" data-concept="${concept}" aria-label="${label}" class="${cls}">`);

    // Merged path — geometry resolved by resolveMergeGeometry() before render.
    if (group.merge?.d) {
        lines.push(`${indent}  <path d="${escapeXmlAttr(group.merge.d)}" />`);
    } else {
        for (const pathId of (group.keep ?? [])) {
            const p = originalPaths.get(pathId);
            if (!p) { console.warn(`[assemble] path no encontrado: ${pathId}`); continue; }
            const transformAttr = p.transform ? ` transform="${p.transform}"` : '';
            const classAttr = p.className ? ` class="${p.className}"` : '';
            const otherAttrs = p.otherAttrs ? ` ${p.otherAttrs}` : '';
            lines.push(`${indent}  <path id="${pathId}" d="${p.d}"${classAttr}${transformAttr}${otherAttrs}/>`);
        }
    }

    // Nested children
    for (const child of childGroups) {
        const grandChildren = [];
        lines.push(renderGroup(child, grandChildren, originalPaths, pathInfoMap, indent + '  '));
    }

    lines.push(`${indent}</g>`);
    return lines.join('\n');
}

/**
 * Compute the real geometric union for each group's proposed merge — this is
 * what actually eliminates VTracer's double-contour artifacts (an inner +
 * outer trace of the same stroked line). The model only lists source path
 * ids; coordinates are never model-authored.
 *
 * Steps per group: bake each source path's local d + transform into absolute
 * root-space coordinates (offsetPathD), union them pairwise (Martinez
 * sweep-line, exact — handles disjoint/contained/overlapping), then
 * applySimplify to refit the polyline union back to smooth Bezier curves
 * (VTracer output is already polyline-based, so nothing is lost).
 *
 * On any failure (missing path, degenerate union, invalid result) the group
 * falls back to keeping the sources as separate paths — never a broken merge.
 */
function resolveMergeGeometry(
    groups: StructuringGroup[],
    originalPaths: Map<string, OriginalPathData>,
    onProgress?: (msg: string) => void,
): StructuringGroup[] {
    return groups.map(g => {
        const sources = g.merge?.sources ?? [];
        if (sources.length < 2) {
            if (g.merge) return { ...g, keep: [...(g.keep ?? []), ...sources], merge: null };
            return g;
        }

        const absDs: string[] = [];
        for (const id of sources) {
            const p = originalPaths.get(id);
            if (!p) { console.warn(`[assemble] merge: path no encontrado: ${id}`); continue; }
            const [tx, ty] = getTranslateOffset(p.transform || null);
            absDs.push(tx || ty ? offsetPathD(p.d, tx, ty) : p.d);
        }

        const fallback = () => ({ ...g, keep: [...(g.keep ?? []), ...sources], merge: null });
        if (absDs.length < 2) return fallback();

        let unioned: string | null = null;
        try {
            unioned = applyBooleanN('union', absDs);
        } catch (err) {
            console.warn(`[assemble] merge ${g.nodeId}: unión falló`, err);
        }
        if (!unioned) {
            onProgress?.(`[ESTRUCTURAR] merge ${g.nodeId}: unión geométrica falló — usando paths originales (${sources.join(', ')})`);
            return fallback();
        }

        // Refit the polyline union to smooth curves — cleans jagged VTracer
        // micro-segments (the "cuadraditos" noise) at the geometry level.
        const smoothed = applySimplify(unioned, 0.5) ?? unioned;
        if (!validateMergedPath(smoothed)) {
            onProgress?.(`[ESTRUCTURAR] merge ${g.nodeId}: resultado inválido — usando paths originales (${sources.join(', ')})`);
            return fallback();
        }

        onProgress?.(`[ESTRUCTURAR] merge ${g.nodeId}: unión de [${sources.join(', ')}] calculada (${smoothed.length} chars)`);
        return { ...g, merge: { d: smoothed, sources } };
    });
}

export function assembleFromMapping(
    mapping: StructuringMapping,
    input: SVGStructureInput,
    selectionOverrides?: Map<string, boolean>,
    labelOverrides?: Map<string, string>,
): SVGStructureResult {
    try {
        const rawSvgWithIds = ensurePathIds(input.rawSvg);
        const inventory = buildPathInventory(rawSvgWithIds);
        const originalPaths = extractOriginalPaths(rawSvgWithIds);
        const pathInfoMap = new Map<string, PathInfo>(inventory.paths.map(p => [p.id, p]));

        // Apply selection and label overrides (from Phase5_Review)
        let effectiveGroups = mapping.groups.map(g => ({
            ...g,
            selected: selectionOverrides?.has(g.nodeId) ? selectionOverrides.get(g.nodeId)! : g.selected,
            label: labelOverrides?.get(g.nodeId) ?? g.label,
        })).filter(g => g.selected !== false);

        // Compute real geometric unions for proposed merges (double-contour
        // cleanup) — the model only proposed source ids, never path data.
        effectiveGroups = resolveMergeGeometry(effectiveGroups, originalPaths, input.onProgress);

        // Build parent → children map
        const childMap = new Map<string | null, StructuringGroup[]>();
        for (const g of effectiveGroups) {
            const parentId = g.parentId ?? null;
            if (!childMap.has(parentId)) childMap.set(parentId, []);
            childMap.get(parentId)!.push(g);
        }

        // Rescue orphaned subtrees: rendering only walks what's reachable from
        // top-level via childMap. A dangling parentId (pointing to a nodeId
        // the model never emitted, discarded, or that is itself unreachable)
        // would otherwise silently drop a WHOLE semantic element from the
        // output — visible content (e.g. "cabeza" + its child "dolor")
        // vanishing together with no error, even though their group entries
        // and paths are present. Reparent anything unreachable to top-level
        // so it always renders instead of disappearing.
        const unreachable = findUnreachableNodeIds(effectiveGroups.map(g => ({ nodeId: g.nodeId, parentId: g.parentId ?? null })));
        if (unreachable.size > 0) {
            const ids = Array.from(unreachable);
            console.warn(`[assemble] grupo(s) huérfano(s) reparentado(s) a top-level: ${ids.join(', ')}`);
            input.onProgress?.(`[ESTRUCTURAR] ${ids.length} grupo(s) huérfano(s) reparentado(s) a top-level (${ids.join(', ')})`);
            for (const g of effectiveGroups) {
                if (!unreachable.has(g.nodeId)) continue;
                const oldParent = g.parentId ?? null;
                const bucket = childMap.get(oldParent);
                if (bucket) {
                    const idx = bucket.indexOf(g);
                    if (idx !== -1) bucket.splice(idx, 1);
                }
                g.parentId = null;
                if (!childMap.has(null)) childMap.set(null, []);
                childMap.get(null)!.push(g);
            }
        }

        // Track all assigned path ids
        const assignedIds = new Set<string>();
        for (const g of effectiveGroups) {
            (g.keep ?? []).forEach(id => assignedIds.add(id));
            g.merge?.sources?.forEach(id => assignedIds.add(id));
        }

        // Discards are only trusted when the path is a genuine micro-blob —
        // the prompt's own rule ("área visualmente insignificante"). A
        // discarded path with a real, visible bounding box is distrusted
        // (see "Me duele la cabeza": the model discarded a clearly-visible
        // pain-indicator icon despite "preservar es la prioridad") and left
        // unassigned instead, so it flows through the orphan rescue below
        // and still renders, in an ungrouped 'contexto' bucket, rather than
        // silently vanishing.
        const [, , vbW, vbH] = inventory.viewBox.split(/\s+/).map(Number);
        const viewBoxArea = (vbW || 1024) * (vbH || 1024);
        let overriddenDiscards = 0;
        for (const id of (mapping.discard ?? [])) {
            const p = originalPaths.get(id);
            if (p && !isMicroBlob(p.d, viewBoxArea)) {
                overriddenDiscards++;
                continue; // left unassigned on purpose — rescued as an orphan below
            }
            assignedIds.add(id);
        }
        if (overriddenDiscards > 0) {
            console.warn(`[assemble] ${overriddenDiscards} descarte(s) del modelo revertido(s) por no ser micro-mancha(s)`);
            input.onProgress?.(`[ESTRUCTURAR] ${overriddenDiscards} descarte(s) del modelo revertido(s) — no eran micro-manchas, se preservan en 'contexto'`);
        }

        // Unaccounted paths → fallback contexto group
        const allOriginalIds = Array.from(originalPaths.keys()).filter(id => !inventory.backgroundPathIds.includes(id));
        const orphans = allOriginalIds.filter(id => !assignedIds.has(id));
        if (orphans.length > 0) {
            console.warn(`[assemble] paths sin asignar (→ contexto): ${orphans.join(', ')}`);
            const existing = effectiveGroups.find(g => g.nodeId === 'contexto');
            if (existing) {
                existing.keep = [...(existing.keep ?? []), ...orphans];
            } else {
                effectiveGroups.push({ nodeId: 'contexto', label: 'elementos de contexto', cssClass: 'f', parentId: null, keep: orphans, selected: true });
                if (!childMap.has(null)) childMap.set(null, []);
                childMap.get(null)!.push(effectiveGroups[effectiveGroups.length - 1]);
            }
        }

        // Hard safety net: if, after every rescue above, there is STILL
        // nothing renderable — the model returned zero groups, or its
        // `discard` list swallowed every real path (which also skips the
        // orphan rescue above, since discarded ids count as "accounted
        // for") — NEVER silently emit a blank pictogram. A wholesale-empty
        // response contradicts "preservar es la prioridad" outright, so it
        // is distrusted entirely: fall back to one flat group holding every
        // non-background path. Visible and unstructured beats invisible.
        if (effectiveGroups.length === 0 && allOriginalIds.length > 0) {
            console.warn(`[assemble] el modelo no devolvió ningún grupo renderizable (grupos vacíos o descarte total) — fallback a grupo plano con ${allOriginalIds.length} path(s)`);
            input.onProgress?.(`[ESTRUCTURAR] el modelo devolvió una estructura vacía — usando todos los trazos sin agrupar como respaldo (${allOriginalIds.length} paths)`);
            const fallbackGroup: StructuringGroup = { nodeId: 'contexto', label: 'elementos de contexto', cssClass: 'f', parentId: null, keep: allOriginalIds, selected: true };
            effectiveGroups = [fallbackGroup];
            childMap.clear();
            childMap.set(null, [fallbackGroup]);
        }

        // Render top-level groups (parentId = null)
        const topLevel = childMap.get(null) ?? [];
        const body = topLevel
            .map(g => renderGroup(g, childMap.get(g.nodeId) ?? [], originalPaths, pathInfoMap))
            .join('\n');

        // CSS
        const fullCSS = generateStylesheet(input.config);
        const usedClasses = new Set<string>();
        effectiveGroups.forEach(g => g.cssClass?.split(/\s+/).forEach(c => usedClasses.add(c)));
        for (const cls of Object.values(inventory.pathClasses)) cls.split(/\s+/).filter(Boolean).forEach(c => usedClasses.add(c));

        let filteredCSS = buildFilteredCSS(fullCSS, usedClasses);

        // Preserve original fill rules from raw SVG
        const pathFillRules = inventory.paths
            .filter(p => {
                const pCls = inventory.pathClasses[p.id];
                if (pCls && pCls.split(/\s+/).some(c => inventory.cssFillMap[c])) return false;
                return p.fill && p.fill !== '#000000';
            })
            .map(p => `#${p.id} { fill: ${p.fill}; }`)
            .join('\n');
        if (pathFillRules) {
            filteredCSS = filteredCSS ? `${filteredCSS}\n\n/* Original path fills */\n${pathFillRules}` : pathFillRules;
        }
        if (inventory.rawStyleRules) {
            filteredCSS = filteredCSS ? `${filteredCSS}\n\n/* User-defined styles */\n${inventory.rawStyleRules}` : inventory.rawStyleRules;
        }

        const metadata = buildMetadataJSON(input);
        let svgContent = assembleStructuredSVG(body, input, metadata, filteredCSS, inventory.viewBox);
        svgContent = removeEmptyGroupsFromFragment(svgContent);

        const validation = validateXML(svgContent);
        if (validation) {
            input.onProgress?.(`[ESTRUCTURAR] advertencia XML: ${validation.slice(0, 120)}`);
        } else {
            svgContent = deriveChildIds(svgContent);
        }

        const groupCount = (svgContent.match(/<g /g) ?? []).length;
        input.onProgress?.(`[ESTRUCTURAR] completado — ${(svgContent.length / 1024).toFixed(1)} KB, ${groupCount} grupos semánticos`);

        return { svg: svgContent, success: true };
    } catch (error) {
        return {
            svg: '',
            success: false,
            error: error instanceof Error ? error.message : 'Error desconocido en ensamblado',
        };
    }
}

// ─── Post-processing ─────────────────────────────────────────────────────────

function buildFilteredCSS(fullCSS: string, usedClasses: Set<string>): string {
    const keyframeRe = /@keyframes\s+([\w-]+)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    const keyframes = new Map<string, string>();
    let strippedCSS = fullCSS;
    let kfM: RegExpExecArray | null;
    while ((kfM = keyframeRe.exec(fullCSS)) !== null) { keyframes.set(kfM[1], kfM[0]); strippedCSS = strippedCSS.replace(kfM[0], ''); }
    const ruleRe = /([^{]+)\{([^}]+)\}/g;
    const keptRules: string[] = [];
    const usedAnimations = new Set<string>();
    let rM: RegExpExecArray | null;
    while ((rM = ruleRe.exec(strippedCSS)) !== null) {
        const selector = rM[1].trim();
        const declarations = rM[2].trim();
        if (!declarations) continue;
        if (selector.includes('[role="group"]')) { keptRules.push(`${selector} {\n  ${declarations}\n}`); continue; }
        const classesInSelector = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(c => c[1]);
        if (!classesInSelector.some(cls => usedClasses.has(cls))) continue;
        keptRules.push(`${selector} {\n  ${declarations}\n}`);
        const animMatch = declarations.match(/animation(?:-name)?\s*:\s*([\w-]+)/);
        if (animMatch) usedAnimations.add(animMatch[1]);
    }
    for (const [name, block] of keyframes) { if (usedAnimations.has(name)) keptRules.push(block); }
    return keptRules.join('\n\n');
}

function deriveChildIds(svgContent: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    if (doc.querySelector('parsererror')) { console.warn('[deriveChildIds] SVG parse failed'); return svgContent; }
    const renames = new Map<string, string>();
    const vtracerHashRe = /^el-[0-9a-z]+$/i;
    doc.querySelectorAll('g[id]').forEach(group => {
        const gId = group.getAttribute('id')!;
        if (vtracerHashRe.test(gId)) return;
        let counter = 1;
        group.childNodes.forEach(child => {
            if (!(child instanceof Element) || child.tagName === 'g') return;
            const oldId = child.getAttribute('id');
            if (!oldId) { child.setAttribute('id', `${gId}-${counter++}`); return; }
            if (vtracerHashRe.test(oldId) || /^(p|g|path|rect|circle)\d+$/.test(oldId)) {
                const newId = `${gId}-${counter++}`;
                child.setAttribute('id', newId);
                renames.set(oldId, newId);
            }
        });
    });
    let result = new XMLSerializer().serializeToString(doc);
    result = result.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    result = result.replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
    for (const [oldId, newId] of renames) {
        result = result.replace(new RegExp(`#${oldId}(?=[.\\s{,])`, 'g'), `#${newId}`);
    }
    return result;
}

function removeEmptyGroupsFromFragment(fragment: string): string {
    let prev = '';
    let current = fragment;
    while (prev !== current) { prev = current; current = current.replace(/<g(\s[^>]*)?\s*>\s*<\/g>/g, ''); }
    return current;
}

function validateXML(svg: string): string | null {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    return err ? err.textContent || 'XML parse error' : null;
}

// ─── Metadata ────────────────────────────────────────────────────────────────

function buildMetadataJSON(input: SVGStructureInput): object {
    const nlu = input.nlu;
    const vg = nlu.visual_guidelines;
    const config = input.config;
    const naturalDesc = [
        vg?.focus_actor,
        vg?.action_core && `realizando: ${vg.action_core}`,
        vg?.object_core && `con: ${vg.object_core}`,
        vg?.context && `contexto: ${vg.context}`,
    ].filter(Boolean).join(', ') || input.utterance;
    return {
        version: '1.0.0',
        schema: 'mediafranca/mf-svg-schema',
        pipeline: 'claude+recraft',
        utterance: input.utterance,
        lang: nlu.lang || config.lang || 'es-419',
        domain: nlu.domain ?? 'general',
        region: config.geoContext?.region ?? null,
        nsm: { explications: nlu.nsm_explications ?? {} },
        frames: (nlu.frames ?? []).map(f => ({
            frame: f.frame_name, label: f.frame_label ?? f.frame_name, lexicalUnit: f.lexical_unit,
            roles: Object.fromEntries(Object.entries(f.roles ?? {}).map(([role, data]) => [role, { type: data.type, surface: data.surface, ref: data.ref }])),
        })),
        pragmatics: {
            speechAct: nlu.metadata?.speech_act ?? 'assertive', intent: nlu.metadata?.intent ?? 'inform',
            politeness: nlu.pragmatics?.politeness ?? null, formality: nlu.pragmatics?.formality ?? null,
            expectedResponse: nlu.pragmatics?.expected_response ?? null,
        },
        visualGuidelines: { focusActor: vg?.focus_actor ?? null, actionCore: vg?.action_core ?? null, objectCore: vg?.object_core ?? null, context: vg?.context ?? null, temporal: vg?.temporal ?? null },
        accessibility: { cognitiveDescription: input.utterance, visualDescription: naturalDesc, lang: nlu.lang || config.lang || 'es-419' },
        provenance: { generator: 'PictoNet', generatedAt: new Date().toISOString(), sourceDataset: 'MediaFranca-PictoNet', licence: config.license || 'CC BY 4.0' },
    };
}

function assembleStructuredSVG(body: string, input: SVGStructureInput, metadata: object, filteredCSS: string, viewBox: string): string {
    const lang = input.nlu.lang || input.config.lang || 'es-419';
    const domain = input.nlu.domain ?? 'general';
    const utteranceEscaped = escapeXmlAttr(input.utterance);
    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const descContent = descMatch ? descMatch[1].trim() : input.utterance;
    const bodyWithoutDesc = body.replace(/<desc[^>]*>[\s\S]*?<\/desc>/i, '').trim();
    const descEscaped = descContent.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const metadataJSON = JSON.stringify(metadata, null, 2);
    return `<svg id="pictogram" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title desc" lang="${lang}" tabindex="0" focusable="true" data-domain="${domain}" data-utterance="${utteranceEscaped}">
  <title id="title">${utteranceEscaped}</title>
  <desc id="desc">${descEscaped}</desc>
  <metadata id="mf-data"><![CDATA[
${metadataJSON}
  ]]></metadata>
  <defs>
    <style>
${filteredCSS}
    </style>
  </defs>
  ${bodyWithoutDesc}
</svg>`;
}

// ─── ESTRUCTURAR (redraw): clean SVG authored from the reference image ────────
// Instead of relabeling noisy VTracer geometry, the vision model REDRAWS the
// pictogram as clean, single-stroke, semantically-grouped SVG. Trades faithful
// geometry for a clean icon — the "estructurar redibuja / limpieza" decision.

const REDRAW_VIEWBOX = '0 0 1024 1024';

interface RedrawGroup {
    nodeId: string;
    label: string;
    cssClass: string;
    parentId: string | null;
    paths: string[];
}

/** Class names available in the palette (for enum validation + fallback). */
function extractPaletteClassNames(cssString: string): string[] {
    const names: string[] = [];
    const ruleRe = /\.([a-zA-Z][\w-]*)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(cssString)) !== null) {
        if (!names.includes(m[1])) names.push(m[1]);
        if (names.length >= 40) break;
    }
    return names;
}

/** Parse a data URL (data:image/png;base64,…) → { base64, mediaType }. */
function parseDataUrl(dataUrl: string): { base64: string; mediaType: string } | null {
    const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!m) return null;
    return { mediaType: m[1], base64: m[2] };
}

/** Clean raster of the SVG (no set-of-marks) — visual-reference fallback. */
async function rasterizeClean(svgString: string, viewBox: string): Promise<{ base64: string; mediaType: string }> {
    const stubInventory = { viewBox, paths: [] } as unknown as PathInventory;
    const img = await rasterizeWithMarks(svgString, stubInventory);
    return { base64: img.base64, mediaType: 'image/jpeg' };
}

function buildRedrawToolSchema(nodeList: NodeInfo[], paletteClasses: string[]) {
    const nodeIds = nodeList.map(n => n.id);
    const cssClassSchema = paletteClasses.length
        ? { type: 'string', enum: paletteClasses, description: 'CSS class from the palette.' }
        : { type: 'string', description: 'CSS class (e.g. "k" agent, "f" object/action, "accent").' };
    return {
        name: 'redraw_svg',
        description: 'Redraw the pictogram as a clean SVG from the reference image: single-stroke paths, no double contours, no tracing noise, grouped by semantic node.',
        input_schema: {
            type: 'object' as const,
            properties: {
                description: { type: 'string', description: 'Brief visual description of the pictogram (1–2 sentences).' },
                groups: {
                    type: 'array',
                    description: 'One entry per visible semantic node. Flat list — use parentId for hierarchy.',
                    items: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', enum: nodeIds, description: 'VisualDOM node id this group represents.' },
                            label: { type: 'string', description: 'Human-readable label.' },
                            cssClass: cssClassSchema,
                            parentId: { type: 'string', description: 'Parent nodeId, or null for top-level.', nullable: true },
                            paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Clean SVG path "d" strings for this node. Single strokes — never trace both edges of a line.',
                            },
                        },
                        required: ['nodeId', 'label', 'cssClass', 'paths'],
                    },
                },
            },
            required: ['description', 'groups'],
        },
    };
}

function buildRedrawSystemPrompt(): string {
    return `Eres un ilustrador de pictogramas AAC (Comunicación Aumentativa y Alternativa). Tu trabajo es REDIBUJAR, no calcar.

Recibes:
1. Una imagen de referencia del pictograma. Puede venir de un trazado automático sucio: líneas dobles, contornos huecos y fragmentos de ruido.
2. El DOM semántico objetivo — nodos con id, concepto y etiqueta.
3. La paleta CSS de la librería.

Tu tarea: producir un SVG NUEVO y LIMPIO que represente el mismo pictograma.

Reglas de dibujo (críticas):
- Traza CADA forma con un único contorno. NUNCA dibujes el doble borde de una línea (interno + externo). Si en la referencia una línea se ve doble o hueca, dibújala como UN solo trazo.
- Elimina todo el ruido: fragmentos, motas, cuadraditos y bordes irregulares no existen en el dibujo limpio.
- Simplifica a la silueta esencial reconocible, con formas suaves y continuas (usa curvas C/Q cuando corresponda).
- Dibuja dentro del viewBox ${REDRAW_VIEWBOX}. Centra la figura y ocupa la mayor parte del lienzo.
- Agrupa los trazos por nodo semántico: cada parte visible (agente, acción, objeto, contexto) va en su nodo.
- Asigna a cada grupo una clase CSS de la paleta. Nunca uses colores inline ni atributos de estilo en los paths.
- Devuelve solo atributos "d" válidos (empiezan con M/m), con coordenadas dentro de 0–1024.`;
}

function buildRedrawUserText(nodeList: NodeInfo[], cssStyles: string, nlu: NLUData, utterance: string): string {
    const domSection = nodeList
        .map(n => `- ${n.id} [${n.concept}] "${n.label}"${n.parentId ? ` (hijo de ${n.parentId})` : ''}`)
        .join('\n');
    const paletteSection = extractPaletteClasses(cssStyles);
    const vg = nlu.visual_guidelines;
    const intent = [
        vg?.focus_actor && `actor: ${vg.focus_actor}`,
        vg?.action_core && `acción: ${vg.action_core}`,
        vg?.object_core && `objeto: ${vg.object_core}`,
        vg?.context && `contexto: ${vg.context}`,
    ].filter(Boolean).join('; ');

    return `Redibuja este pictograma en limpio.

Frase: "${utterance}"${intent ? `\nIntención visual: ${intent}` : ''}

DOM semántico objetivo (un grupo por nodo visible):
${domSection}

Paleta CSS disponible:
${paletteSection}

viewBox de salida: ${REDRAW_VIEWBOX}

Mira la imagen de referencia y dibuja los trazos limpios de cada nodo.`;
}

async function callRedrawModel(
    image: { base64: string; mediaType: string },
    elements: VisualElement[],
    cssStyles: string,
    nlu: NLUData,
    utterance: string,
    model: string,
    onProgress?: (msg: string) => void,
): Promise<{ description: string; groups: RedrawGroup[] }> {
    const nodeList = flattenElements(elements);
    const paletteClasses = extractPaletteClassNames(cssStyles);
    const tool = buildRedrawToolSchema(nodeList, paletteClasses);
    const systemPrompt = buildRedrawSystemPrompt();
    const userText = buildRedrawUserText(nodeList, cssStyles, nlu, utterance);

    if (onProgress) {
        onProgress(`[ESTRUCTURAR] Modo redibujo — el modelo genera SVG limpio desde la imagen`);
        onProgress(`[ESTRUCTURAR] imagen de referencia: ${image.mediaType}, ~${Math.round(image.base64.length * 3 / 4 / 1024)} KB`);
        onProgress(`[ESTRUCTURAR] llamando ${model}…`);
    }

    const startMs = Date.now();
    const response: ClaudeResponse = await callStructuringModel({
        // Redraw authors geometry → needs headroom so the tool call isn't cut
        // off mid-output (truncation surfaces as a 500 from the proxy).
        model,
        max_tokens: 32768,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'redraw_svg' },
        messages: [{
            role: 'user',
            content: [
                { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                { type: 'text', text: userText },
            ],
        }],
    });
    const elapsedMs = Date.now() - startMs;

    const result = extractToolUse(response, 'redraw_svg') as { description?: string; groups?: Array<Record<string, unknown>> };

    if (onProgress) {
        onProgress(`[ESTRUCTURAR] respuesta en ${(elapsedMs / 1000).toFixed(1)}s`);
        if (response.usage) onProgress(`[ESTRUCTURAR] tokens: entrada=${response.usage.input_tokens}, salida=${response.usage.output_tokens}`);
    }

    const groups: RedrawGroup[] = (result.groups ?? []).map(g => ({
        nodeId: String(g.nodeId ?? ''),
        label: String(g.label ?? g.nodeId ?? ''),
        cssClass: String(g.cssClass ?? 'main'),
        parentId: (g.parentId as string | null | undefined) ?? null,
        paths: Array.isArray(g.paths) ? (g.paths as unknown[]).filter((d): d is string => typeof d === 'string') : [],
    }));

    if (onProgress) {
        onProgress(`[ESTRUCTURAR] grupos redibujados: ${groups.length}`);
        for (const g of groups) onProgress(`  ${g.nodeId} (${g.cssClass}): ${g.paths.length} trazo(s)`);
    }

    return { description: result.description ?? '', groups };
}

function renderRedrawGroup(
    group: RedrawGroup,
    childMap: Map<string | null, RedrawGroup[]>,
    paletteClasses: string[],
    indent = '  ',
): string {
    const semanticCls = paletteClasses.includes(group.cssClass) ? group.cssClass : (paletteClasses[0] || 'main');
    const label = escapeXmlAttr(group.label || group.nodeId);
    const concept = escapeXmlAttr(guessConceptFromId(group.nodeId));
    const lines: string[] = [];
    lines.push(`${indent}<g id="${group.nodeId}" role="group" tabindex="0" data-concept="${concept}" aria-label="${label}">`);
    for (const d of group.paths) {
        if (!validateMergedPath(d)) continue;
        lines.push(`${indent}  <path class="${semanticCls}" d="${escapeXmlAttr(d)}" />`);
    }
    for (const child of (childMap.get(group.nodeId) ?? [])) {
        lines.push(renderRedrawGroup(child, childMap, paletteClasses, indent + '  '));
    }
    lines.push(`${indent}</g>`);
    return lines.join('\n');
}

/**
 * ESTRUCTURAR via redraw: the vision model authors a clean SVG from the
 * reference image (single strokes, no noise), which we assemble locally into
 * mf-svg-schema. Unlike assembleFromMapping, geometry here is model-authored.
 *
 * RETIRED as default — high variance: fine on trivial shapes, but it destroyed
 * clean multi-element pictograms (authoring geometry blind). The active path is
 * the two-image relabel, which preserves the traced geometry. Kept for
 * experimentation; runs via the background worker (no 90s timeout) when used.
 */
export async function redrawSVG(input: SVGStructureInput): Promise<SVGStructureResult> {
    try {
        const model = input.phase5Model ?? 'claude-sonnet-4-6';

        // Reference image: prefer the source bitmap (cleaner intent) over a
        // raster of the noisy trace.
        input.onProgress?.('[ESTRUCTURAR] Preparando imagen de referencia…');
        let image: { base64: string; mediaType: string } | null =
            input.referenceImage ? parseDataUrl(input.referenceImage) : null;
        if (!image) {
            if (!input.rawSvg) {
                return { svg: '', success: false, error: 'Se requiere una imagen de referencia o un SVG trazado' };
            }
            const rawSvgWithIds = ensurePathIds(input.rawSvg);
            const inventory = buildPathInventory(rawSvgWithIds);
            image = await rasterizeClean(rawSvgWithIds, inventory.viewBox || REDRAW_VIEWBOX);
        }

        const cssStyles = generateStylesheet(input.config);
        const paletteClasses = extractPaletteClassNames(cssStyles);

        const { description, groups } = await callRedrawModel(
            image, input.elements, cssStyles, input.nlu, input.utterance, model, input.onProgress,
        );

        const validGroups = groups.filter(g => g.paths.some(d => validateMergedPath(d)));
        if (validGroups.length === 0) {
            return { svg: '', success: false, error: 'El modelo no devolvió trazos válidos' };
        }

        // parent → children
        const childMap = new Map<string | null, RedrawGroup[]>();
        for (const g of validGroups) {
            const pid = g.parentId ?? null;
            if (!childMap.has(pid)) childMap.set(pid, []);
            childMap.get(pid)!.push(g);
        }
        const topLevel = childMap.get(null) ?? validGroups;
        const body = `<desc>${escapeXmlAttr(description || input.utterance)}</desc>\n` +
            topLevel.map(g => renderRedrawGroup(g, childMap, paletteClasses)).join('\n');

        const usedClasses = new Set<string>();
        validGroups.forEach(g => { if (paletteClasses.includes(g.cssClass)) usedClasses.add(g.cssClass); });
        const filteredCSS = buildFilteredCSS(cssStyles, usedClasses);

        const metadata = buildMetadataJSON(input);
        let svgContent = assembleStructuredSVG(body, input, metadata, filteredCSS, REDRAW_VIEWBOX);
        svgContent = removeEmptyGroupsFromFragment(svgContent);

        const validation = validateXML(svgContent);
        if (validation) {
            input.onProgress?.(`[ESTRUCTURAR] advertencia XML: ${validation.slice(0, 120)}`);
        } else {
            svgContent = deriveChildIds(svgContent);
        }

        const pathCount = (svgContent.match(/<path /g) ?? []).length;
        const groupCount = (svgContent.match(/<g /g) ?? []).length;
        input.onProgress?.(`[ESTRUCTURAR] redibujo completado — ${(svgContent.length / 1024).toFixed(1)} KB, ${groupCount} grupos, ${pathCount} trazos limpios`);

        return { svg: svgContent, success: true };
    } catch (error) {
        return { svg: '', success: false, error: error instanceof Error ? error.message : 'Error desconocido en ESTRUCTURAR (redibujo)' };
    }
}

// ─── Main structuring function ────────────────────────────────────────────────

export async function structureSVG(input: SVGStructureInput): Promise<SVGStructureResult> {
    try {
        if (!input.rawSvg || typeof input.rawSvg !== 'string') {
            return { svg: '', success: false, error: 'rawSvg no es un string válido' };
        }

        // Default = two-image relabel: PRESERVE the traced geometry (which is
        // often already clean and coloured) and only add semantic groups +
        // discard genuine noise, guided by the bitmap. Redraw-from-scratch is
        // retired as default — it destroyed clean pictograms (see redrawSVG).
        const model = input.phase5Model ?? 'claude-sonnet-4-6';

        input.onProgress?.('[ESTRUCTURAR] Pre-procesando SVG local…');
        const rawSvgWithIds = ensurePathIds(input.rawSvg);
        const inventory = buildPathInventory(rawSvgWithIds);

        if (inventory.paths.length === 0) {
            return { svg: '', success: false, error: 'No se encontraron paths en el SVG' };
        }

        input.onProgress?.(`[ESTRUCTURAR] Inventario: ${inventory.paths.length} paths, ${Object.keys(inventory.vtracerGroups).length} grupos, ${inventory.backgroundPathIds.length} fondo excluido`);

        input.onProgress?.('[ESTRUCTURAR] Renderizando marcas numeradas…');
        const image = await rasterizeWithMarks(rawSvgWithIds, inventory);

        const cssStyles = generateStylesheet(input.config);

        // Two-image relabel: the numbered trace supplies coordinates, and the
        // source bitmap (when present) shows the clean intent so the model can
        // confidently discard noise and redundant double-contours. Output stays
        // small (path ids) — fast and no output-token-cap 500s (unlike redraw).
        let mapping = await callVisionStructuring(
            image,
            input.referenceImage,
            rawSvgWithIds,
            input.elements,
            cssStyles,
            inventory,
            model,
            input.onProgress,
        );

        // Merge geometry (the real double-contour union) is resolved later,
        // in assembleFromMapping — the model has proposed only merge.sources
        // (path ids) at this point, no path data to validate yet.

        // Recording mode → return mapping for review timer
        if (input.config.recording?.enabled) {
            input.onProgress?.('[ESTRUCTURAR] Modo grabación activo — esperando revisión del usuario');
            return { svg: '', success: true, mapping, pendingReview: true };
        }

        // Immediate assembly
        return assembleFromMapping(mapping, input);

    } catch (error) {
        return {
            svg: '',
            success: false,
            error: error instanceof Error ? error.message : 'Error desconocido en ESTRUCTURAR',
        };
    }
}

// ─── Eligibility checks ──────────────────────────────────────────────────────

export function canVectorize(_row: object): { eligible: boolean; reason?: string } {
    return { eligible: false, reason: 'VTracer eliminado — Recraft entrega SVG nativo' };
}

export function canStructureSVG(row: {
    rawSvg?: string;
    bitmap?: string;
    NLU?: NLUData | string;
    elements?: VisualElement[];
}): { eligible: boolean; reason?: string } {
    // Relabel preserves and groups the traced geometry, so the trace is
    // required; the bitmap is an optional cleanup reference.
    if (!row.rawSvg) return { eligible: false, reason: 'Se requiere el trazado (ejecutar TRAZAR primero)' };
    if (!row.NLU || typeof row.NLU === 'string') return { eligible: false, reason: 'Se requiere análisis NLU' };
    if (!row.elements || row.elements.length === 0) return { eligible: false, reason: 'Se requieren elementos visuales' };
    return { eligible: true };
}

/** @deprecated Use canStructureSVG() instead */
export function canGenerateSVG(row: { rawSvg?: string; NLU?: NLUData | string; elements?: VisualElement[] }): { eligible: boolean; reason?: string } {
    return canStructureSVG(row);
}
