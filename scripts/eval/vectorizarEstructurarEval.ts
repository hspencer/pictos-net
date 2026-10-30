/**
 * Browser harness for the VECTORIZAR+ESTRUCTURAR evaluation (plan §12).
 * Runs inside the dev app (it needs DOM, canvas, the WASM tracers and the
 * Netlify function proxy):
 *
 *   const E = await import('/scripts/eval/vectorizarEstructurarEval.ts');
 *   const results = await E.runEval('/docs/eval/icap-pilot-10.json');
 *
 * Variants, same model and config:
 *   A — legacy VTracer 0.6 trace (pictogram preset) + ESTRUCTURAR (current code)
 *   D — joint vectorizeAndStructure (VTracer 1.0 regions + restructure_regions)
 *
 * Every metric is measured against the SOURCE BITMAP, with style strokes
 * neutralised (a library outline is a style, not geometry). Human time is
 * not measured here: it needs the protocol in plan §12.2.
 */

import { vectorizeBitmap, PRESETS } from '../../services/vtracerService';
import { structureSVG, vectorizeAndStructure } from '../../services/svgStructureService';
import type { VisualElement } from '../../types';

const SIZE = 256;
const CELL = 16;

interface Manifest {
    library: string;
    model: string;
    cases: Array<{ index: number; id: string; utterance: string; reason: string; bitmapSha256: string }>;
}

async function sha256(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pixels(src: string): Promise<Uint8ClampedArray> {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, SIZE, SIZE);
    g.drawImage(img, 0, 0, SIZE, SIZE);
    return g.getImageData(0, 0, SIZE, SIZE).data;
}

const svgUrl = (svg: string) => URL.createObjectURL(new Blob([svg.replace('</style>', 'svg path { stroke: none !important; }</style>')], { type: 'image/svg+xml' }));

/** Wrong pixels (RGB distance > 90) and worst per-cell ink loss vs the bitmap. */
async function compareToBitmap(bitmap: Uint8ClampedArray, svg: string) {
    const out = await pixels(svgUrl(svg));
    const cells = SIZE / CELL;
    const ink = new Uint32Array(cells * cells), lost = new Uint32Array(cells * cells);
    let bad = 0;
    const lum = (d: Uint8ClampedArray, k: number) => (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255;
    for (let i = 0; i < SIZE * SIZE; i++) {
        const k = i * 4;
        if (Math.abs(bitmap[k] - out[k]) + Math.abs(bitmap[k + 1] - out[k + 1]) + Math.abs(bitmap[k + 2] - out[k + 2]) > 90) bad++;
        const x = i % SIZE, y = (i - x) / SIZE, c = Math.floor(y / CELL) * cells + Math.floor(x / CELL);
        if (lum(bitmap, k) < 0.75) { ink[c]++; if (lum(out, k) >= 0.75) lost[c]++; }
    }
    let worst = 0;
    for (let c = 0; c < ink.length; c++) if (ink[c] >= 8) worst = Math.max(worst, lost[c] / ink[c]);
    return { wrongPixelPct: +(100 * bad / (SIZE * SIZE)).toFixed(2), worstCellLossPct: +(100 * worst).toFixed(1) };
}

function nodeIds(els: VisualElement[]): string[] {
    return els.flatMap(e => [e.id, ...nodeIds(e.children ?? [])]);
}

/** Structural reading of a structured SVG: node coverage and unassigned share. */
function structure(svg: string, nodes: string[]) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const total = doc.querySelectorAll('path').length;
    const covered = nodes.filter(id => doc.getElementById(id)?.querySelector('path'));
    const unassigned = [...doc.querySelectorAll('g')].filter(g => /^_*unclassified$/.test(g.id)).reduce((n, g) => n + g.querySelectorAll('path').length, 0);
    return { paths: total, kb: +(svg.length / 1024).toFixed(1), nodesCovered: `${covered.length}/${nodes.length}`, missingNodes: nodes.filter(id => !covered.includes(id)), unassignedPathPct: +(100 * unassigned / Math.max(total, 1)).toFixed(1) };
}

function tokens(logs: string[]) {
    const m = logs.map(l => l.match(/tokens: entrada=(\d+), salida=(\d+)/)).find(Boolean);
    return m ? { tokensIn: Number(m[1]), tokensOut: Number(m[2]) } : { tokensIn: null, tokensOut: null };
}

export async function runEval(manifestUrl: string, onCase?: (msg: string) => void) {
    const manifest: Manifest = await (await fetch(manifestUrl)).json();
    const lib = await (await fetch(manifest.library)).json();
    const config = { ...lib.config, recording: { enabled: false } };
    const results = [];
    for (const c of manifest.cases) {
        const row = lib.rows[c.index];
        if (row.id !== c.id || await sha256(row.bitmap) !== c.bitmapSha256) throw new Error(`manifest mismatch for case ${c.index}`);
        const nodes = nodeIds(row.elements);
        const bitmap = await pixels(row.bitmap);
        const common = { nlu: row.NLU, elements: row.elements, utterance: row.UTTERANCE, prompt: row.prompt ?? '', config, phase5Model: manifest.model };
        const entry: Record<string, unknown> = { index: c.index, utterance: c.utterance };

        // A — legacy trace + ESTRUCTURAR
        {
            const logs: string[] = [];
            const t0 = performance.now();
            const trace = await vectorizeBitmap(row.bitmap, PRESETS.pictogram ?? {});
            const rawSvg = typeof trace === 'string' ? trace : trace.svg;
            const t1 = performance.now();
            const r = await structureSVG({ ...common, rawSvg, referenceImage: row.bitmap, onProgress: m => logs.push(m) });
            const svg = r.svg || r.draftSvg || '';
            entry.A = { ok: !!svg, certified: !!r.svg, diagnostic: r.diagnostic?.key ?? null, traceMs: Math.round(t1 - t0), totalMs: Math.round(performance.now() - t0), ...tokens(logs),
                ...(svg ? { ...(await compareToBitmap(bitmap, svg)), ...structure(svg, nodes) } : { error: r.error }), traceVsBitmap: await compareToBitmap(bitmap, rawSvg) };
            entry.svgA = svg;
        }
        // D — joint
        {
            const logs: string[] = [];
            const t0 = performance.now();
            const r = await vectorizeAndStructure({ ...common, bitmap: row.bitmap, onProgress: m => logs.push(m) });
            const svg = r.svg || r.draftSvg || '';
            const counts = logs.map(l => l.match(/(\d+) regiones marcadas, (\d+) astillas/)).find(Boolean);
            entry.D = { ok: !!svg, certified: !!r.svg, diagnostic: r.diagnostic?.key ?? null, totalMs: Math.round(performance.now() - t0), ...tokens(logs),
                markedRegions: counts ? Number(counts[1]) : null, slivers: counts ? Number(counts[2]) : null,
                splitRequests: r.regionDiagnostics?.splitRequests.map(s => `${s.region}:${s.entities.join('+')}`) ?? [], unresolved: r.regionDiagnostics?.unresolved.length ?? 0, protected: r.regionDiagnostics?.protectedRegions.length ?? 0,
                ...(svg ? { ...(await compareToBitmap(bitmap, svg)), ...structure(svg, nodes) } : { error: r.error }) };
            entry.svgD = svg;
        }
        results.push(entry);
        onCase?.(`${c.index} ${c.utterance}: A ${JSON.stringify(entry.A)} | D ${JSON.stringify(entry.D)}`);
    }
    return results;
}

/** Manifest entries for chosen rows (hashes computed from the library). */
export async function buildManifest(library: string, picks: Array<{ index: number; reason: string }>, model: string): Promise<Manifest> {
    const lib = await (await fetch(library)).json();
    const cases = [];
    for (const p of picks) {
        const row = lib.rows[p.index];
        cases.push({ index: p.index, id: row.id, utterance: row.UTTERANCE, reason: p.reason, bitmapSha256: await sha256(row.bitmap) });
    }
    return { library, model, cases };
}
