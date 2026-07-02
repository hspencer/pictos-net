/**
 * Pure boolean-operation adapter on SVG path d-strings.
 *
 * Pipeline:
 *   - paper-core parses the d-string and flattens curves to polylines.
 *   - martinez-polygon-clipping computes the boolean over polygon rings.
 *   - The result is reconstructed back to SVG path d-string.
 *
 * Why this split: paper.js's Vatti-based booleans return wrong results for
 * fully-contained operands (e.g. a small disc subtracted from a larger one
 * with no boundary intersections). Martinez (Martinez-Rueda-Feito sweep-line)
 * handles every topology case — disjoint, contained, overlapping — natively
 * and is the de facto algorithm in production GIS (Turf.js).
 *
 * Input fidelity: VTracer output is already polylines, so the flatten step
 * loses nothing. For paths with real Bezier curves the output collapses to
 * straight segments — apply applySimplify() afterwards to refit if needed.
 *
 * Spec: specs/svg-boolean-operations.allium
 */

import paper from 'paper/dist/paper-core.js';
import * as martinez from 'martinez-polygon-clipping';

export type BooleanOp = 'union' | 'subtract' | 'intersect';

const FLATTEN_TOLERANCE = 0.25;       // px, sub-pixel flattening for crisp results
const RECT_PIXEL_EPSILON = 0.05;      // px, snap-to-integer threshold on output

let scopeReady = false;

function ensureScope(): void {
    if (scopeReady) return;
    const scope = new paper.PaperScope();
    scope.setup(new paper.Size(1, 1));
    scope.activate();
    scopeReady = true;
}

/**
 * Parse a d-string with paper.js, flatten Bezier curves to straight segments,
 * and emit each closed sub-path as one martinez Ring (closed: first === last).
 * Open sub-paths are skipped (a boolean of an open path is undefined).
 */
function pathDToRings(d: string): martinez.Ring[] {
    if (!d || !d.trim()) return [];
    const compound = new paper.CompoundPath({ pathData: d, insert: false });
    const rings: martinez.Ring[] = [];
    try {
        for (const child of compound.children) {
            if (!(child instanceof paper.Path)) continue;
            const path = child as paper.Path;
            if (!path.closed) continue;
            const flat = path.clone({ insert: false }) as paper.Path;
            flat.flatten(FLATTEN_TOLERANCE);
            const ring: martinez.Position[] = flat.segments.map(s => [s.point.x, s.point.y]);
            if (ring.length < 3) { flat.remove(); continue; }
            // Martinez expects rings to be explicitly closed.
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                ring.push([first[0], first[1]]);
            }
            rings.push(ring);
            flat.remove();
        }
    } finally {
        compound.remove();
    }
    return rings;
}

/**
 * Wrap rings as a martinez MultiPolygon. Each ring becomes its own Polygon
 * (i.e. its own outer with no holes). Martinez treats nested rings of equal
 * orientation as overlapping fills and resolves them per the requested op,
 * so this works for inputs where one sub-path nests inside another.
 */
function ringsToMultiPolygon(rings: martinez.Ring[]): martinez.MultiPolygon {
    return rings.map(r => [r] as martinez.Polygon);
}

/**
 * Round coordinates that are within RECT_PIXEL_EPSILON of an integer to that
 * integer. Removes "37.0000001" noise from the sweep-line output so resulting
 * d-strings stay legible after many operations.
 */
function snap(v: number): number {
    const r = Math.round(v);
    return Math.abs(v - r) < RECT_PIXEL_EPSILON ? r : Math.round(v * 1000) / 1000;
}

/**
 * Convert martinez output (MultiPolygon | Polygon | null) to an SVG d-string.
 * Each ring becomes one M..L..Z subpath. Holes share the same compound path
 * and render correctly under fill-rule="evenodd".
 *
 * Disambiguating Polygon vs MultiPolygon: the leaf coordinate is `Position =
 * [number, number]`. A Polygon nests three levels deep (Polygon → Ring →
 * Position → number), a MultiPolygon four levels (MultiPolygon → Polygon →
 * Ring → Position → number). Test the leaf with `typeof === 'number'`.
 */
function geometryToPathD(geom: martinez.Geometry | null): string | null {
    if (!geom || geom.length === 0) return null;
    // Walk to a leaf and check its type to disambiguate the shape.
    const leaf = (geom as any)[0]?.[0]?.[0];
    const isPolygon = typeof leaf === 'number';
    const mp: martinez.MultiPolygon = isPolygon
        ? [geom as martinez.Polygon]
        : (geom as martinez.MultiPolygon);
    const subpaths: string[] = [];
    for (const polygon of mp) {
        for (const ring of polygon) {
            if (ring.length < 4) continue; // need at least a closed triangle
            const cmds: string[] = [`M${snap(ring[0][0])},${snap(ring[0][1])}`];
            // Skip the explicit closing point — Z handles closure.
            for (let i = 1; i < ring.length - 1; i++) {
                cmds.push(`L${snap(ring[i][0])},${snap(ring[i][1])}`);
            }
            cmds.push('Z');
            subpaths.push(cmds.join(' '));
        }
    }
    if (subpaths.length === 0) return null;
    return subpaths.join(' ');
}

/**
 * Apply a binary boolean operation to two SVG path d-strings.
 *
 * Returns the resulting path d, or null if the result is geometrically empty.
 */
export function applyBoolean(op: BooleanOp, baseD: string, otherD: string): string | null {
    if (!baseD || !otherD) return null;
    ensureScope();

    const baseRings = pathDToRings(baseD);
    const otherRings = pathDToRings(otherD);
    if (baseRings.length === 0 || otherRings.length === 0) return null;

    const baseMP = ringsToMultiPolygon(baseRings);
    const otherMP = ringsToMultiPolygon(otherRings);

    let result: martinez.Geometry | null = null;
    switch (op) {
        case 'union':
            result = martinez.union(baseMP, otherMP);
            break;
        case 'subtract':
            result = martinez.diff(baseMP, otherMP);
            break;
        case 'intersect':
            result = martinez.intersection(baseMP, otherMP);
            break;
    }
    return geometryToPathD(result);
}

/**
 * Apply union or intersect over N >= 2 operands by reducing pairwise.
 * Operands are processed left-to-right; if any intermediate result is empty
 * the whole operation returns null.
 *
 * Order is irrelevant for the geometric result of union and intersect, but
 * the first operand is conventionally the Base at the higher layer.
 */
export function applyBooleanN(op: 'union' | 'intersect', ds: string[]): string | null {
    if (ds.length < 2) return null;
    let acc: string | null = ds[0];
    for (let i = 1; i < ds.length && acc !== null; i++) {
        acc = applyBoolean(op, acc, ds[i]);
    }
    return acc;
}

/**
 * Refit a polyline-heavy path back to Bezier curves with paper.js's
 * Schneider-fitting simplifier. Useful after boolean operations (which
 * always emit polylines) and as a one-shot "smart paths" cleanup.
 *
 * tolerance: max allowed distance between the original curve and the
 * simplified one, in user units (≈ pixels). Calibration on a 200-segment
 * circle of radius 50 (typical VTracer output for a small disc):
 *   0.25 → 9 curves   (very accurate)
 *   0.50 → 8 curves   (default — good cleanup, no visible distortion)
 *   1.00 → 6 curves   (lightly distorted on small shapes)
 *   2.50 → 1 curve    (degenerate — circle collapses)
 * For very noisy paths (10k+ segments) push to 1.0–1.5.
 */
export function applySimplify(d: string, tolerance: number = 0.5): string | null {
    if (!d || !d.trim()) return null;
    ensureScope();
    const compound = new paper.CompoundPath({ pathData: d, insert: false });
    try {
        for (const child of compound.children) {
            if (child instanceof paper.Path && child.segments.length > 2) {
                child.simplify(tolerance);
            }
        }
        const out = compound.pathData;
        return out && out.trim() ? out : null;
    } finally {
        compound.remove();
    }
}
