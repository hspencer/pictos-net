/**
 * svgPathPolish — pure d-string helpers for the deterministic geometry
 * polish step of Phase 4 (ESTRUCTURAR).
 *
 * Two responsibilities:
 *   1. Decide WHICH paths deserve curve refitting (shouldSimplify): only
 *      polyline-heavy paths — tracing noise made of hundreds of tiny L
 *      segments. Paths already authored as smooth Bezier curves (Recraft
 *      native output) are left untouched, so polishing can never degrade
 *      clean geometry.
 *   2. Round coordinates (roundPathD) to strip meaningless precision
 *      (sub-0.1px in a 1024 viewBox) — smaller files, cleaner diffs.
 *
 * Standalone module (no imports) so it is directly testable with node --test,
 * same pattern as svgTreeUtils / svgMergeCandidates. The actual curve
 * refitting (paper.js) lives in svgBooleanOps.applySimplify; composition
 * happens in svgStructureService.polishGeometry.
 */

export interface PathCommandStats {
    /** Total command letters in the d attribute. */
    total: number;
    /** Straight-segment commands: L l H h V v. */
    lineCmds: number;
    /** Curve commands: C c S s Q q T t A a. */
    curveCmds: number;
}

/**
 * Counts command letters in a d attribute by kind.
 * Used in: shouldSimplify, and diagnostics.
 */
export function analyzePathD(d: string): PathCommandStats {
    const cmds = d.match(/[A-Za-z]/g) ?? [];
    let lineCmds = 0;
    let curveCmds = 0;
    for (const c of cmds) {
        if ('LlHhVv'.includes(c)) lineCmds++;
        else if ('CcSsQqTtAa'.includes(c)) curveCmds++;
    }
    return { total: cmds.length, lineCmds, curveCmds };
}

/**
 * True when a path is "polyline-heavy": at least `minSegments` drawing
 * segments AND `lineRatio` (or more) of them are straight lines. That is the
 * signature of tracing noise (VTracer-style micro-segments), the only case
 * where curve refitting is a win. Smooth Bezier paths return false and are
 * preserved verbatim.
 * Used in: svgStructureService.polishGeometry.
 */
export function shouldSimplify(d: string, minSegments = 24, lineRatio = 0.6): boolean {
    const { lineCmds, curveCmds } = analyzePathD(d);
    const segments = lineCmds + curveCmds;
    if (segments < minSegments) return false;
    return lineCmds / segments >= lineRatio;
}

/**
 * Rounds every numeric token of a d attribute to `decimals` places. Command
 * letters and arc flags survive intact (flags are integers, rounding is a
 * no-op on them). Output re-joins numbers with single spaces — valid SVG and
 * typically much shorter than the input's excess precision.
 * Used in: svgStructureService.polishGeometry.
 */
export function roundPathD(d: string, decimals = 1): string {
    const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
    if (!tokens) return d;
    const factor = 10 ** decimals;
    let out = '';
    let prevWasNum = false;
    for (const tok of tokens) {
        if (/^[A-Za-z]$/.test(tok)) {
            out += tok;
            prevWasNum = false;
            continue;
        }
        const n = Math.round(parseFloat(tok) * factor) / factor;
        out += (prevWasNum ? ' ' : '') + String(n);
        prevWasNum = true;
    }
    return out;
}
