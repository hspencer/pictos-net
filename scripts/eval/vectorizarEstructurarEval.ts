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

// Wrong pixels at 256 (comparable with the first pilot run); local loss at
// both 256 and 512, since thin lines read as false losses at 256.
const SIZES = [256, 512];

interface Manifest {
    library: string;
    model: string;
    cases: Array<{ index: number; id: string; utterance: string; reason: string; bitmapSha256: string }>;
}

async function sha256(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pixels(src: string, size: number): Promise<Uint8ClampedArray> {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.drawImage(img, 0, 0, size, size);
    return g.getImageData(0, 0, size, size).data;
}

const svgUrl = (svg: string) => URL.createObjectURL(new Blob([svg.replace('</style>', 'svg path { stroke: none !important; }</style>')], { type: 'image/svg+xml' }));

/** Per size: wrong pixels (RGB distance > 90), worst per-cell ink loss
 *  (16×16 grid) and mean colour error over the bitmap's inked pixels. */
async function compareToBitmap(bitmapSrc: string, svg: string) {
    const out: Record<string, number> = {};
    const url = svgUrl(svg);
    const lum = (d: Uint8ClampedArray, k: number) => (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255;
    for (const size of SIZES) {
        const [ref, got] = await Promise.all([pixels(bitmapSrc, size), pixels(url, size)]);
        const cellSize = size / 16, minInk = 8 * (size / 256) ** 2;
        const ink = new Uint32Array(256), lost = new Uint32Array(256);
        let bad = 0, colourErr = 0, inked = 0;
        for (let i = 0; i < size * size; i++) {
            const k = i * 4;
            const d = Math.abs(ref[k] - got[k]) + Math.abs(ref[k + 1] - got[k + 1]) + Math.abs(ref[k + 2] - got[k + 2]);
            if (d > 90) bad++;
            const x = i % size, y = (i - x) / size, c = Math.floor(y / cellSize) * 16 + Math.floor(x / cellSize);
            if (lum(ref, k) < 0.75) { ink[c]++; inked++; colourErr += d; if (lum(got, k) >= 0.75) lost[c]++; }
        }
        let worst = 0;
        for (let c = 0; c < 256; c++) if (ink[c] >= minInk) worst = Math.max(worst, lost[c] / ink[c]);
        const suffix = size === 256 ? '' : String(size);
        out[`wrongPixelPct${suffix}`] = +(100 * bad / (size * size)).toFixed(2);
        out[`worstCellLossPct${suffix}`] = +(100 * worst).toFixed(1);
        out[`inkColourErr${suffix}`] = +(colourErr / Math.max(inked, 1)).toFixed(1);
    }
    return out;
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

export async function runEval(manifestUrl: string, onCase?: (msg: string) => void, variants: Array<'A' | 'D'> = ['A', 'D'], only?: number[]) {
    const manifest: Manifest = await (await fetch(manifestUrl)).json();
    const lib = await (await fetch(manifest.library)).json();
    const config = { ...lib.config, recording: { enabled: false } };
    const results = [];
    for (const c of manifest.cases.filter(x => !only || only.includes(x.index))) {
        const row = lib.rows[c.index];
        if (row.id !== c.id || await sha256(row.bitmap) !== c.bitmapSha256) throw new Error(`manifest mismatch for case ${c.index}`);
        const nodes = nodeIds(row.elements);
        const common = { nlu: row.NLU, elements: row.elements, utterance: row.UTTERANCE, prompt: row.prompt ?? '', config, phase5Model: manifest.model };
        const entry: Record<string, unknown> = { index: c.index, utterance: c.utterance };

        // A — legacy trace + ESTRUCTURAR
        if (variants.includes('A')) {
            const logs: string[] = [];
            const t0 = performance.now();
            const trace = await vectorizeBitmap(row.bitmap, PRESETS.pictogram ?? {});
            const rawSvg = typeof trace === 'string' ? trace : trace.svg;
            const t1 = performance.now();
            const r = await structureSVG({ ...common, rawSvg, referenceImage: row.bitmap, onProgress: m => logs.push(m) });
            const svg = r.svg || r.draftSvg || '';
            entry.A = { ok: !!svg, certified: !!r.svg, diagnostic: r.diagnostic?.key ?? null, traceMs: Math.round(t1 - t0), totalMs: Math.round(performance.now() - t0), ...tokens(logs),
                ...(svg ? { ...(await compareToBitmap(row.bitmap, svg)), ...structure(svg, nodes) } : { error: r.error }), traceVsBitmap: await compareToBitmap(row.bitmap, rawSvg) };
            entry.svgA = svg;
        }
        // D — joint
        if (variants.includes('D')) {
            const logs: string[] = [];
            const t0 = performance.now();
            const r = await vectorizeAndStructure({ ...common, bitmap: row.bitmap, onProgress: m => logs.push(m) });
            const svg = r.svg || r.draftSvg || '';
            const counts = logs.map(l => l.match(/(\d+) regiones marcadas, (\d+) astillas/)).find(Boolean);
            entry.D = { ok: !!svg, certified: !!r.svg, diagnostic: r.diagnostic?.key ?? null, totalMs: Math.round(performance.now() - t0), ...tokens(logs),
                markedRegions: counts ? Number(counts[1]) : null, slivers: counts ? Number(counts[2]) : null,
                splitRequests: r.regionDiagnostics?.splitRequests.map(s => `${s.region}:${s.entities.join('+')}`) ?? [], unresolved: r.regionDiagnostics?.unresolved.length ?? 0, protected: r.regionDiagnostics?.protectedRegions.length ?? 0,
                ...(svg ? { ...(await compareToBitmap(row.bitmap, svg)), ...structure(svg, nodes) } : { error: r.error }) };
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
