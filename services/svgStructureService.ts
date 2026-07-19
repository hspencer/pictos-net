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
import { detectMergeCandidates } from './svgMergeCandidates';
import { shouldSimplify, roundPathD } from './svgPathPolish';

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
    /** Real bounding box in viewBox space [x, y, w, h] — only present when
     *  DOM measurement succeeded. Used by detectMergeCandidates. */
    bbox?: [number, number, number, number];
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

/**
 * LEGACY FALLBACK — estimates a path's centroid by averaging every number in
 * the `d` attribute as alternating x/y pairs. Wrong for relative commands
 * (l/c/q accumulate deltas, not positions) and arc flags/radii, so marks can
 * land far from the actual shape. Kept only as the fallback when DOM
 * measurement (measurePathAnchors) is unavailable or fails for a path.
 * Used in: buildPathInventory.
 */
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

/**
 * Measures the REAL anchor point of every `path[id]` by mounting the SVG in a
 * hidden DOM host: `getBBox()` gives the exact local bounding box (all
 * commands, relative or absolute, arcs included) and the CTM chain maps it to
 * viewBox space (handles translate/scale/matrix transforms, not just
 * translate). If the bbox centre falls outside the fill (C-shapes, rings),
 * a small grid is sampled with Path2D.isPointInPath and the inside point
 * closest to the centre wins — so the numbered mark sits ON the shape it
 * labels. Returns viewBox-space anchor AND bounding box per path id; paths
 * that fail to measure are simply absent (caller falls back to getCentroid,
 * without bbox). The bbox feeds detectMergeCandidates (double-contour pairs).
 * Used in: buildPathInventory.
 */
interface MeasuredPathGeometry {
    cx: number;
    cy: number;
    bbox: [number, number, number, number];
}

function measurePathAnchors(svgString: string): Map<string, MeasuredPathGeometry> {
    const anchors = new Map<string, MeasuredPathGeometry>();
    if (typeof document === 'undefined' || !document.body) return anchors;

    const host = document.createElement('div');
    // visibility:hidden (NOT display:none — getBBox needs a rendered layout)
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:512px;height:512px;overflow:hidden;visibility:hidden;pointer-events:none;';
    try {
        host.innerHTML = svgString;
        const svg = host.querySelector('svg') as SVGSVGElement | null;
        if (!svg) return anchors;
        svg.setAttribute('width', '512');
        svg.setAttribute('height', '512');
        document.body.appendChild(host);

        const rootCTM = svg.getScreenCTM();
        if (!rootCTM) return anchors;
        const rootInv = rootCTM.inverse();
        const ctx = document.createElement('canvas').getContext('2d');

        svg.querySelectorAll('path[id]').forEach(el => {
            const p = el as SVGPathElement;
            const id = p.getAttribute('id')!;
            try {
                const bbox = p.getBBox();
                if (bbox.width === 0 && bbox.height === 0) return;

                // Preferred anchor in LOCAL coords: bbox centre, nudged inside
                // the fill if the centre falls in a hole.
                let lx = bbox.x + bbox.width / 2;
                let ly = bbox.y + bbox.height / 2;
                if (ctx) {
                    const d = p.getAttribute('d') ?? '';
                    const fillRule = (p.getAttribute('fill-rule') as CanvasFillRule) || 'nonzero';
                    try {
                        const path2d = new Path2D(d);
                        if (!ctx.isPointInPath(path2d, lx, ly, fillRule)) {
                            // 7×7 grid over the bbox: nearest inside point to centre
                            let best: [number, number] | null = null;
                            let bestDist = Infinity;
                            for (let gy = 1; gy <= 7; gy++) {
                                for (let gx = 1; gx <= 7; gx++) {
                                    const sx = bbox.x + (bbox.width * gx) / 8;
                                    const sy = bbox.y + (bbox.height * gy) / 8;
                                    if (!ctx.isPointInPath(path2d, sx, sy, fillRule)) continue;
                                    const dist = (sx - lx) ** 2 + (sy - ly) ** 2;
                                    if (dist < bestDist) { bestDist = dist; best = [sx, sy]; }
                                }
                            }
                            if (best) { lx = best[0]; ly = best[1]; }
                        }
                    } catch { /* Path2D parse failed — keep bbox centre */ }
                }

                // LOCAL → viewBox space through the full CTM chain.
                const elCTM = p.getScreenCTM();
                if (!elCTM) return;
                const m = rootInv.multiply(elCTM);
                const tx = (x: number, y: number): [number, number] =>
                    [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
                // Bbox corners through the matrix (handles rotation/skew too)
                const corners = [
                    tx(bbox.x, bbox.y),
                    tx(bbox.x + bbox.width, bbox.y),
                    tx(bbox.x, bbox.y + bbox.height),
                    tx(bbox.x + bbox.width, bbox.y + bbox.height),
                ];
                const xs = corners.map(c => c[0]);
                const ys = corners.map(c => c[1]);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                const [acx, acy] = tx(lx, ly);
                anchors.set(id, {
                    cx: Math.round(acx),
                    cy: Math.round(acy),
                    bbox: [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)],
                });
            } catch { /* getBBox failed for this path — fallback covers it */ }
        });
    } finally {
        host.remove();
    }
    return anchors;
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
    // Effective fill: own attr/style, else nearest ancestor's (SVG paint is
    // inherited — re-parenting into semantic groups loses it unless baked in).
    // 'none' is preserved AS none: a stroke-only outline mapped to black
    // renders as a solid blob (this alone caused double-digit fidelity loss).
    let cur: Element | null = el;
    while (cur && cur.tagName.toLowerCase() !== 'svg') {
        const attr = cur.getAttribute('fill');
        if (attr) return attr.trim();
        const m = (cur.getAttribute('style') ?? '').match(/fill:\s*([^;]+)/);
        if (m) return m[1].trim();
        cur = cur.parentElement;
    }
    return '#000000';
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

    // Real anchors via DOM measurement (getBBox + CTM + inside-fill check);
    // getCentroid remains the per-path fallback when measurement fails.
    const measuredAnchors = measurePathAnchors(svg);

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
                const measured = measuredAnchors.get(pid);
                const [cx, cy] = measured ? [measured.cx, measured.cy] : getCentroid(d, tx, ty);
                const pCls = p.getAttribute('class')?.trim();
                if (pCls) pathClasses[pid] = pCls;
                paths.push({ id: pid, fill, fillRole: getFillRole(fill), cx, cy, bbox: measured?.bbox, vtracerGroup: id });
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
            const measured = measuredAnchors.get(pid);
            const [cx, cy] = measured ? [measured.cx, measured.cy] : getCentroid(d, tx, ty);
            const pCls = child.getAttribute('class')?.trim();
            if (pCls) pathClasses[pid] = pCls;
            paths.push({ id: pid, fill, fillRole: getFillRole(fill), cx, cy, bbox: measured?.bbox, vtracerGroup: null });
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

            const radius = 13;

            // ── Anti-colisión de marcas ──────────────────────────────────────
            // Paths concéntricos o adyacentes producen anclas casi idénticas y
            // las marcas se tapan entre sí (números ilegibles → asignaciones
            // erróneas). Relajación iterativa: pares más cercanos que 2r+2 se
            // separan a lo largo de su delta; las marcas desplazadas dibujan
            // una línea guía hasta su ancla original para no perder referencia.
            const anchors = inventory.paths.map(p => ({
                ax: Math.round(p.cx * scale),
                ay: Math.round(p.cy * scale),
            }));
            const marks = anchors.map(a => ({ x: a.ax, y: a.ay }));
            const minDist = radius * 2 + 2;
            for (let iter = 0; iter < 30; iter++) {
                let moved = false;
                for (let i = 0; i < marks.length; i++) {
                    for (let j = i + 1; j < marks.length; j++) {
                        let dx = marks[j].x - marks[i].x;
                        let dy = marks[j].y - marks[i].y;
                        let dist = Math.hypot(dx, dy);
                        if (dist >= minDist) continue;
                        if (dist < 0.001) { dx = 1; dy = 0; dist = 1; } // coincidentes: separar en x
                        const push = (minDist - dist) / 2 + 0.5;
                        const ux = dx / dist, uy = dy / dist;
                        marks[i].x -= ux * push; marks[i].y -= uy * push;
                        marks[j].x += ux * push; marks[j].y += uy * push;
                        moved = true;
                    }
                }
                // Mantener las marcas dentro del lienzo
                for (const m of marks) {
                    m.x = Math.min(w - radius, Math.max(radius, m.x));
                    m.y = Math.min(h - radius, Math.max(radius, m.y));
                }
                if (!moved) break;
            }

            // Líneas guía primero (debajo de los círculos)
            marks.forEach((m, i) => {
                const { ax, ay } = anchors[i];
                if (Math.hypot(m.x - ax, m.y - ay) <= radius * 0.75) return;
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                ctx.lineTo(ax, ay);
                ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
                ctx.lineWidth = 2;
                ctx.stroke();
                // Punto en el ancla real
                ctx.beginPath();
                ctx.arc(ax, ay, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(220, 38, 38, 0.9)';
                ctx.fill();
            });

            marks.forEach((m, index) => {
                const cx = Math.round(m.x);
                const cy = Math.round(m.y);
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

/**
 * LEGACY FALLBACK — guesses the semantic concept from the element id prefix.
 * Only used for rows composed before Phase 2 emitted `concept` explicitly
 * (see COMPOSE_TOOL_SCHEMA in claudeService). New rows carry the concept
 * derived from the NLU frame roles; this string heuristic is never preferred.
 * Used in: flattenElements, buildConceptMap.
 */
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
        // Prefer the concept composed from the NLU frame roles (Phase 2);
        // fall back to the legacy id-prefix guess for old rows.
        const concept = el.concept ?? guessConceptFromId(el.id);
        result.push({ id: el.id, label, concept, parentId });
        if (el.children) {
            result.push(...flattenElements(el.children, el.id));
        }
    }
    return result;
}

/**
 * Builds a nodeId → concept map from the VisualElement tree so that render
 * functions emit `data-concept` congruent with COMPRENDER/COMPONER instead of
 * re-guessing from the id string.
 * Used in: assembleFromMapping (renderGroup) and redrawSVG (renderRedrawGroup).
 */
function buildConceptMap(elements: VisualElement[]): Map<string, string> {
    return new Map(flattenElements(elements).map(n => [n.id, n.concept]));
}

// ─── CSS Palette extraction ──────────────────────────────────────────────────

function extractPaletteClasses(cssString: string): string {
    // Report each rule's CANONICAL (first) class. Matching the class glued to
    // '{' would report the LAST alias instead — ".main, .primary, .foreground"
    // was being advertised to the model as "foreground", a name the assembler's
    // colour check does not recognise.
    // @keyframes blocks are stripped first so their percentage steps are not
    // read as rules. The palette is capped at 30 rules and colour classes are
    // ordered first (see INITIAL_STYLES), so animations fall outside the cut —
    // intentional: structuring assigns semantics and colour, not motion.
    const withoutKeyframes = cssString.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
    const lines: string[] = [];
    const ruleRe = /([^{}]+)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(withoutKeyframes)) !== null) {
        const firstCls = m[1].match(/\.([a-zA-Z][\w-]*)/);
        if (!firstCls) continue;
        const cls = firstCls[1];
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
2. IMAGEN B — el trazado automático con un círculo numerado en rojo sobre cada path. Si dos paths estaban muy juntos, la marca se desplazó para ser legible y una línea roja fina la conecta con el punto exacto del path que etiqueta. Aporta las COORDENADAS, pero viene sucio: ruido, motas y contornos DOBLES (cada línea trazada como su borde interno + externo).
3. El código fuente SVG en bruto (paths con sus IDs)
4. El DOM semántico objetivo — nodos con id, concepto y etiqueta
5. La paleta CSS de la librería — clases disponibles para estilizar`
        : `1. Una imagen del SVG con un círculo numerado en rojo sobre cada path (si dos paths estaban muy juntos, la marca se desplazó y una línea roja fina la conecta con el punto exacto que etiqueta)
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
4. Las clases son de COLOR, no de semántica (la semántica va en data-concept, derivada del DOM). Elige según el fill-role que aparece en la lista de marcas: "k" = formas negras/oscuras, "f" = formas blancas (huecos, luces), "accent" = paths ya coloreados. Nunca recolorees: si el path es negro no le pongas "f" ni "accent"
5. parentId debe ser null para nodos de nivel superior, o un nodeId válido para nodos hijo`;
}

// ─── User Prompt ─────────────────────────────────────────────────────────────

function buildUserText(rawSvg: string, nodeList: NodeInfo[], cssStyles: string, inventory: PathInventory, hasCleanRef: boolean, mergeCandidates: string[][] = []): string {
    const domSection = nodeList
        .map(n => `- ${n.id} [${n.concept}] "${n.label}"${n.parentId ? ` (hijo de ${n.parentId})` : ''}`)
        .join('\n');

    const paletteSection = extractPaletteClasses(cssStyles);

    const marksSection = inventory.paths
        .map((p, i) => `  mark ${i}: id="${p.id}" fill-role="${p.fillRole}" centroide=(${p.cx},${p.cy})`)
        .join('\n');

    const mergeSection = mergeCandidates.length > 0
        ? `\nCandidatos de fusión detectados geométricamente (contornos casi concéntricos del mismo color — probables trazados dobles de la misma línea):\n${mergeCandidates.map(c => `  · [${c.join(' + ')}]`).join('\n')}\nVerifica cada candidato contra la imagen: si efectivamente son la misma forma visual, decláralos en merge.sources del grupo correspondiente; si son formas distintas (p. ej. anillo y su interior con significado propio), consérvalos por separado. También puedes proponer fusiones que no estén en esta lista.\n`
        : '';

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
${mergeSection}
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

    // Candidatos de fusión detectados localmente (contornos dobles) — el
    // modelo confirma contra la imagen en vez de tener que descubrirlos.
    const mergeCandidates = detectMergeCandidates(inventory.paths);
    if (mergeCandidates.length > 0 && onProgress) {
        onProgress(`[ESTRUCTURAR] candidatos de fusión detectados: ${mergeCandidates.map(c => `[${c.join('+')}]`).join(' ')}`);
    }

    const userText = buildUserText(rawSvg, nodeList, cssStyles, inventory, !!cleanRef, mergeCandidates);

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

// Presentation attributes that SVG inherits through <g> ancestors. Re-parenting
// a path into a semantic group severs that inheritance, so the effective value
// must be baked onto the path itself or strokes/opacity silently vanish.
const INHERITED_PRESENTATION_ATTRS = [
    'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-opacity', 'fill-rule', 'fill-opacity', 'opacity',
];

function extractOriginalPaths(rawSvg: string): Map<string, OriginalPathData> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const map = new Map<string, OriginalPathData>();
    doc.querySelectorAll('path').forEach(p => {
        const id = p.getAttribute('id');
        if (!id) return;
        const fill = extractFill(p);
        const d = p.getAttribute('d') ?? '';
        const className = p.getAttribute('class')?.trim() ?? '';

        // Bake the ancestor transform chain (outermost first — SVG composes
        // parent-to-child) so geometry survives re-parenting.
        const chain: string[] = [];
        let anc = p.parentElement;
        while (anc && anc.tagName.toLowerCase() !== 'svg') {
            const t = anc.getAttribute('transform');
            if (t) chain.unshift(t.trim());
            anc = anc.parentElement;
        }
        const ownT = p.getAttribute('transform')?.trim() ?? '';
        const transform = [...chain, ownT].filter(Boolean).join(' ');

        const skipAttrs = new Set(['id', 'd', 'transform', 'fill', 'style', 'class']);
        const otherParts: string[] = [];
        const present = new Set<string>();
        for (const attr of Array.from(p.attributes)) {
            if (skipAttrs.has(attr.name)) continue;
            present.add(attr.name);
            otherParts.push(`${attr.name}="${attr.value}"`);
        }
        // Inherit missing presentation attrs from the nearest ancestor.
        for (const name of INHERITED_PRESENTATION_ATTRS) {
            if (present.has(name)) continue;
            for (let a = p.parentElement; a && a.tagName.toLowerCase() !== 'svg'; a = a.parentElement) {
                const v = a.getAttribute(name);
                if (v) { otherParts.push(`${name}="${v}"`); break; }
            }
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
    conceptById: Map<string, string>,
    indent = '  ',
): string {
    const dominantRole = getDominantFillRole(group.keep, pathInfoMap);
    const colorCls = fillRoleToColorClass(dominantRole);
    const semanticCls = group.cssClass || 'f';
    // The class must agree with the ORIGINAL colour of the paths (fillRole,
    // measured locally). The model picks semantics among compatible classes
    // (k vs f for dark shapes) but never recolours — assigning 'accent' to an
    // originally-black arrow painted it red. Incompatible → derived from role.
    // k = black (CMYK key), f = white (#FFF) — both are COLOUR classes, so each
    // belongs to the fill-role group matching its own colour. Semantics are
    // carried by data-concept, not by the class.
    const ROLE_CLASSES: Record<string, string[]> = { dark: ['k', 'main'], light: ['f', 'w'], accent: ['accent'] };
    const knownColorClasses = ['k', 'f', 'w', 'main', 'accent'];
    let cls: string;
    if (!knownColorClasses.includes(semanticCls)) {
        cls = `${semanticCls} ${colorCls}`; // custom palette class + derived colour
    } else if (dominantRole === 'unknown' || ROLE_CLASSES[dominantRole]?.includes(semanticCls)) {
        cls = semanticCls;
    } else {
        console.warn(`[assemble] ${group.nodeId}: clase '${semanticCls}' incompatible con color original (${dominantRole}) — usando '${colorCls}'`);
        cls = colorCls;
    }
    const label = escapeXmlAttr(group.label || group.nodeId);
    // Concept comes from the composed VisualElement tree (NLU-derived);
    // only synthetic groups (e.g. the 'contexto' orphan bucket) fall back.
    const concept = escapeXmlAttr(conceptById.get(group.nodeId) ?? guessConceptFromId(group.nodeId));
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
        lines.push(renderGroup(child, grandChildren, originalPaths, pathInfoMap, conceptById, indent + '  '));
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
    pathInfoMap: Map<string, PathInfo>,
    onProgress?: (msg: string) => void,
): StructuringGroup[] {
    return groups.map(g => {
        const sources = g.merge?.sources ?? [];
        if (sources.length < 2) {
            if (g.merge) return { ...g, keep: [...(g.keep ?? []), ...sources], merge: null };
            return g;
        }

        // Gate: only union sources that the LOCAL double-contour detector
        // itself would pair (bbox IoU ≥ 0.7, similar area, same fill role —
        // detectMergeCandidates, tested). A model-proposed merge of
        // geometrically distinct shapes (an arm + the torso) deforms the
        // figure; keeping them as separate paths is always visually safe.
        const infos = sources
            .map(id => pathInfoMap.get(id))
            .filter((p): p is PathInfo => !!p);
        const clusters = detectMergeCandidates(infos);
        const compatible = infos.length === sources.length
            && clusters.length === 1
            && clusters[0].length === infos.length;
        if (!compatible) {
            onProgress?.(`[ESTRUCTURAR] merge ${g.nodeId}: fuentes no concéntricas [${sources.join(', ')}] — se conservan como paths separados`);
            return { ...g, keep: [...(g.keep ?? []), ...sources], merge: null };
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
        effectiveGroups = resolveMergeGeometry(effectiveGroups, originalPaths, pathInfoMap, input.onProgress);

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
        const conceptById = buildConceptMap(input.elements);
        const topLevel = childMap.get(null) ?? [];
        const body = topLevel
            .map(g => renderGroup(g, childMap.get(g.nodeId) ?? [], originalPaths, pathInfoMap, conceptById))
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
            svgContent = polishGeometry(svgContent, input.onProgress);
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

/**
 * Deterministic geometry polish (local, no API). Two passes over every
 * <path> of the assembled SVG:
 *   1. Curve refitting — ONLY for polyline-heavy paths (tracing noise made
 *      of dozens of tiny straight segments, see svgPathPolish.shouldSimplify).
 *      Smooth Bezier paths (Recraft native output) are never touched, so the
 *      polish cannot degrade clean geometry.
 *   2. Coordinate rounding to 1 decimal (sub-0.1px in a 1024 viewBox) —
 *      strips meaningless precision, shrinking the file.
 * Every rewritten d is validated; on any failure the original is kept.
 * Used in: assembleFromMapping and redrawSVG, after deriveChildIds.
 */
function polishGeometry(svgContent: string, onProgress?: (msg: string) => void): string {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        if (doc.querySelector('parsererror')) return svgContent;

        let simplifiedCount = 0;
        doc.querySelectorAll('path').forEach(p => {
            const d = p.getAttribute('d');
            if (!d) return;
            let next = d;
            if (shouldSimplify(d)) {
                try {
                    const refit = applySimplify(d, 0.5);
                    if (refit && validateMergedPath(refit)) {
                        next = refit;
                        simplifiedCount++;
                    }
                } catch { /* keep original */ }
            }
            const rounded = roundPathD(next, 1);
            if (validateMergedPath(rounded)) next = rounded;
            if (next !== d) p.setAttribute('d', next);
        });

        let out = new XMLSerializer().serializeToString(doc);
        out = out.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
        out = out.replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');

        const deltaKB = (svgContent.length - out.length) / 1024;
        onProgress?.(`[ESTRUCTURAR] pulido geométrico: ${simplifiedCount} path(s) refiteado(s) a curvas, ${deltaKB >= 0 ? '-' : '+'}${Math.abs(deltaKB).toFixed(1)} KB`);
        return out;
    } catch {
        return svgContent;
    }
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
        // Composed visual DOM (Phase 2) with NLU-derived concepts — the
        // structured SVG's <g> hierarchy should be congruent with this tree.
        visualDom: flattenElements(input.elements ?? []).map(n => ({ id: n.id, concept: n.concept, parentId: n.parentId })),
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
    conceptById: Map<string, string>,
    indent = '  ',
): string {
    const semanticCls = paletteClasses.includes(group.cssClass) ? group.cssClass : (paletteClasses[0] || 'main');
    const label = escapeXmlAttr(group.label || group.nodeId);
    const concept = escapeXmlAttr(conceptById.get(group.nodeId) ?? guessConceptFromId(group.nodeId));
    const lines: string[] = [];
    lines.push(`${indent}<g id="${group.nodeId}" role="group" tabindex="0" data-concept="${concept}" aria-label="${label}">`);
    for (const d of group.paths) {
        if (!validateMergedPath(d)) continue;
        lines.push(`${indent}  <path class="${semanticCls}" d="${escapeXmlAttr(d)}" />`);
    }
    for (const child of (childMap.get(group.nodeId) ?? [])) {
        lines.push(renderRedrawGroup(child, childMap, paletteClasses, conceptById, indent + '  '));
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
        const conceptById = buildConceptMap(input.elements);
        const body = `<desc>${escapeXmlAttr(description || input.utterance)}</desc>\n` +
            topLevel.map(g => renderRedrawGroup(g, childMap, paletteClasses, conceptById)).join('\n');

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
            svgContent = polishGeometry(svgContent, input.onProgress);
        }

        const pathCount = (svgContent.match(/<path /g) ?? []).length;
        const groupCount = (svgContent.match(/<g /g) ?? []).length;
        input.onProgress?.(`[ESTRUCTURAR] redibujo completado — ${(svgContent.length / 1024).toFixed(1)} KB, ${groupCount} grupos, ${pathCount} trazos limpios`);

        return { svg: svgContent, success: true };
    } catch (error) {
        return { svg: '', success: false, error: error instanceof Error ? error.message : 'Error desconocido en ESTRUCTURAR (redibujo)' };
    }
}

// ─── Fidelity verification (Phase5_FidelityCheck) ────────────────────────────

// Fraction of the RAW drawing's inked area that may change before the
// structured result is rejected. Relative to ink (not canvas) so small
// pictograms on a large viewBox are judged at the same sensitivity.
// ponytail: single global knob; per-element thresholds if ever needed.
const FIDELITY_DIFF_LIMIT = 0.05;
const FIDELITY_RASTER_SIZE = 256;

/** Rasterize an SVG to a binary ink mask (1 = clearly darker than paper).
 *  Colour-tolerant on purpose: palette mapping may shift hues, but the
 *  guarantee is that INK STAYS WHERE IT WAS — holes not filled, shapes not
 *  deformed, elements not dropped. */
async function rasterizeInkMask(svg: string, size: number): Promise<Uint8Array | null> {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img load failed')); img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const mask = new Uint8Array(size * size);
        for (let i = 0; i < mask.length; i++) {
            const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
            mask[i] = lum < 0.75 ? 1 : 0;
        }
        return mask;
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Compare raw vs structured ink coverage. All fractions are relative to the
 *  raw drawing's inked area. `added` = ink the structure invented (filled
 *  holes, solid blobs); `removed` = ink it lost (dropped shapes, background).
 *  Unmeasurable (canvas failure) → ok, don't flag. */
export async function verifyFidelity(rawSvg: string, structuredSvg: string): Promise<{ ok: boolean; diffFraction: number; added: number; removed: number }> {
    const [a, b] = await Promise.all([
        rasterizeInkMask(rawSvg, FIDELITY_RASTER_SIZE),
        rasterizeInkMask(structuredSvg, FIDELITY_RASTER_SIZE),
    ]);
    if (!a || !b) return { ok: true, diffFraction: 0, added: 0, removed: 0 };
    let ink = 0, added = 0, removed = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i]) ink++;
        if (!a[i] && b[i]) added++;
        else if (a[i] && !b[i]) removed++;
    }
    const denom = Math.max(ink, 1);
    const diffFraction = (added + removed) / denom;
    return { ok: diffFraction <= FIDELITY_DIFF_LIMIT, diffFraction, added: added / denom, removed: removed / denom };
}

/** Demote every proposed merge to plain keeps (union skipped, geometry
 *  untouched) — the fidelity-fail retry path. */
function stripMerges(mapping: StructuringMapping): StructuringMapping {
    return {
        ...mapping,
        groups: mapping.groups.map(g => g.merge?.sources?.length
            ? { ...g, keep: [...(g.keep ?? []), ...g.merge.sources], merge: null }
            : g),
    };
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

        // The pipeline only understands <path>; other primitives would be
        // silently dropped from the output. Surface it instead of hiding it.
        // ponytail: detection only — convert primitives to paths if this warning
        // ever fires on real rows.
        const nonPathCount = (input.rawSvg.match(/<(rect|circle|ellipse|polygon|polyline|line)\b/g) ?? []).length;
        if (nonPathCount > 0) {
            input.onProgress?.(`[ESTRUCTURAR] advertencia: ${nonPathCount} elemento(s) no-path (rect/circle/…) en el SVG crudo — no serán incluidos en la estructura`);
        }

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

        // Immediate assembly + fidelity measurement. NEVER blocks: a structured
        // result with issues beats no result (user decision 2026-07-18). When
        // the diff exceeds the threshold, the merge-free variant is also
        // assembled and whichever alters the drawing LESS is delivered; the
        // measurement is surfaced as a warning with an added/removed breakdown
        // so the source of the difference can be diagnosed from the log.
        let result = assembleFromMapping(mapping, input);
        if (!result.success) return result;

        let fidelity = await verifyFidelity(rawSvgWithIds, result.svg);
        if (!fidelity.ok) {
            const noMerge = assembleFromMapping(stripMerges(mapping), input);
            if (noMerge.success) {
                const nmFidelity = await verifyFidelity(rawSvgWithIds, noMerge.svg);
                if (nmFidelity.diffFraction < fidelity.diffFraction) {
                    input.onProgress?.(`[ESTRUCTURAR] variante sin fusiones es más fiel (${(nmFidelity.diffFraction * 100).toFixed(1)}% vs ${(fidelity.diffFraction * 100).toFixed(1)}%) — usando esa`);
                    result = noMerge;
                    fidelity = nmFidelity;
                }
            }
        }
        if (!fidelity.ok) {
            input.onProgress?.(`[ESTRUCTURAR] aviso de fidelidad: ${(fidelity.diffFraction * 100).toFixed(1)}% del área dibujada difiere (+${(fidelity.added * 100).toFixed(1)}% tinta añadida, -${(fidelity.removed * 100).toFixed(1)}% tinta perdida) — revisa el resultado`);
        } else {
            input.onProgress?.(`[ESTRUCTURAR] fidelidad: ${(fidelity.diffFraction * 100).toFixed(1)}% de diferencia — OK`);
        }
        return result;

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
