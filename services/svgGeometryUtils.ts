/**
 * Pure geometry heuristics used to decide whether a path the model proposed
 * to discard is actually safe to drop.
 *
 * Why this exists: `mapping.discard` lets the model silently remove paths,
 * and the prompt restricts that to genuine micro-blobs ("área visualmente
 * insignificante"). But prompt compliance isn't guaranteed — a model can
 * still discard a real, visible element (e.g. a pain-indicator icon) while
 * believing it's noise. Rather than trust that judgment blindly,
 * assembleFromMapping cross-checks every discarded path's on-canvas size
 * against the viewBox and overrides the discard for anything that isn't
 * actually tiny — see resolveMergeGeometry / the "no vanishing elements"
 * fixes in this same module for the same philosophy applied elsewhere.
 */

export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Extract a rough bounding box from an SVG path's `d` attribute by reading
 * every numeric token as an (x, y) pair, in the SAME way getCentroid() in
 * svgStructureService.ts does for mark placement. Not exact for curves (a
 * Bezier control point can lie outside the rendered curve), but reliable
 * enough to separate a several-pixel JPEG/trace artifact from an actual
 * drawn shape, which is all this needs to do.
 */
export function parseBBoxFromPathD(d: string): BBox | null {
    const nums = d.match(/-?[0-9]+\.?[0-9]*/g)?.map(Number) ?? [];
    if (nums.length < 2) return null;
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

export function bboxArea(box: BBox): number {
    return Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
}

/**
 * Default micro-blob threshold: a path whose bounding-box area is under this
 * fraction of the total viewBox area is treated as genuine noise (a few
 * pixels across on a ~1024x1024 canvas). Calibration: a true JPEG/trace
 * artifact is typically under 0.01% of the canvas; a small but real icon
 * (e.g. a pain-indicator bolt, a button, a facial feature) is comfortably
 * above 0.1%. 0.15% sits between the two with margin on both sides.
 */
export const DEFAULT_MICRO_BLOB_RATIO = 0.0015;

/**
 * Decide whether a discarded path is small enough to trust as noise. Returns
 * true (safe to discard) only when its bounding-box area is under the
 * threshold ratio of the total viewBox area. Anything that fails to parse a
 * bounding box, or has zero viewBox area, is NOT trusted (errs toward
 * preserving content, per "preservar es la prioridad").
 */
export function isMicroBlob(
    pathD: string,
    viewBoxArea: number,
    thresholdRatio: number = DEFAULT_MICRO_BLOB_RATIO,
): boolean {
    if (!viewBoxArea || viewBoxArea <= 0) return false;
    const box = parseBBoxFromPathD(pathD);
    if (!box) return false;
    return bboxArea(box) / viewBoxArea < thresholdRatio;
}
