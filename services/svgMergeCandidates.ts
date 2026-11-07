/**
 * svgMergeCandidates — local, pre-model detection of double-contour merge
 * candidates for Phase 4 (ESTRUCTURAR).
 *
 * Detects sets of paths that are LIKELY duplicate traces of the same visual
 * shape (double contours: the inner + outer edge of a stroked line traced as
 * two near-concentric closed contours). Purely geometric — bbox IoU ≥ 0.7,
 * area ratio ≥ 0.4 and same fill role — so the vision model CONFIRMS
 * candidates against the image instead of having to discover them (much
 * higher merge recall). Pairs are clustered transitively (union-find) into
 * candidate sets of 2+.
 *
 * Standalone module (no imports) so it is directly testable with node --test,
 * same pattern as svgTreeUtils / svgGeometryUtils.
 * Used in: svgStructureService (callVisionStructuring → buildUserText).
 */

export interface MergeCandidatePath {
    id: string;
    fillRole: 'dark' | 'light' | 'accent' | 'unknown';
    /** Observed fill colour. Two accents of different colour are not one
     *  shape, so a known, differing fill rules the pair out. */
    fill?: string;
    /** Real bounding box in viewBox space [x, y, w, h] — paths without a
     *  measured bbox are skipped. */
    bbox?: [number, number, number, number];
}

const IOU_THRESHOLD = 0.7;
const AREA_RATIO_THRESHOLD = 0.4;

/**
 * Returns clusters (2+ path ids each) of probable double-contour duplicates.
 * Used in: svgStructureService.callVisionStructuring.
 */
export function detectMergeCandidates(paths: MergeCandidatePath[]): string[][] {
    const measurable = paths.filter(p => p.bbox && p.bbox[2] > 0 && p.bbox[3] > 0);

    const iou = (a: [number, number, number, number], b: [number, number, number, number]): number => {
        const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
        const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
        const inter = ix * iy;
        const union = a[2] * a[3] + b[2] * b[3] - inter;
        return union > 0 ? inter / union : 0;
    };

    // Union-find over indices of measurable
    const parent = measurable.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    for (let i = 0; i < measurable.length; i++) {
        for (let j = i + 1; j < measurable.length; j++) {
            const a = measurable[i], b = measurable[j];
            if (a.fillRole !== b.fillRole) continue;
            if (a.fill && b.fill && a.fill.toLowerCase() !== b.fill.toLowerCase()) continue;
            const bbA = a.bbox!, bbB = b.bbox!;
            const areaA = bbA[2] * bbA[3], areaB = bbB[2] * bbB[3];
            const areaRatio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
            if (areaRatio < AREA_RATIO_THRESHOLD) continue;
            if (iou(bbA, bbB) < IOU_THRESHOLD) continue;
            unite(i, j);
        }
    }

    const clusters = new Map<number, string[]>();
    measurable.forEach((p, i) => {
        const root = find(i);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root)!.push(p.id);
    });
    return Array.from(clusters.values()).filter(c => c.length >= 2);
}

/**
 * Fusion clusters for the post-assembly union (svgStructureService
 * fuseSameFill), within ONE semantic group:
 *   - shapes with the same paint whose boxes touch (within `margin`) cluster
 *     transitively;
 *   - a minor shape (box area < `minorArea`: anti-aliasing slivers, specks)
 *     that touches a major one of similar colour (RGB distance ≤ `maxColourDist`)
 *     joins the nearest-coloured such major and takes its paint.
 * Each cluster of 2+ becomes one boolean union whose first id is its largest
 * shape. Clearly different colours are never fused; unmeasured shapes are skipped.
 */
export interface FusionPath { id: string; fill: string; rgb?: [number, number, number]; bbox?: [number, number, number, number] }
export function fusionClusters(paths: FusionPath[], { margin = 1.5, minorArea = 0, maxColourDist = 0 } = {}): string[][] {
    const usable = paths.filter(p => p.bbox && p.fill && !p.fill.startsWith('none'));
    const parent = usable.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const area = (p: FusionPath) => p.bbox![2] * p.bbox![3];
    const touch = (a: FusionPath, b: FusionPath) => {
        const [ax, ay, aw, ah] = a.bbox!, [bx, by, bw, bh] = b.bbox!;
        return ax <= bx + bw + margin && bx <= ax + aw + margin && ay <= by + bh + margin && by <= ay + ah + margin;
    };
    const dist = (a: FusionPath, b: FusionPath) => a.rgb && b.rgb ? Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]) : Infinity;
    for (let i = 0; i < usable.length; i++)
        for (let j = i + 1; j < usable.length; j++)
            if (usable[i].fill === usable[j].fill && touch(usable[i], usable[j])) parent[find(i)] = find(j);
    usable.forEach((p, i) => {
        if (area(p) >= minorArea) return;
        let best = -1, bestDist = Infinity;
        usable.forEach((q, j) => {
            if (j === i || area(q) < minorArea || q.fill === p.fill || !touch(p, q)) return;
            const d = dist(p, q);
            if (d <= maxColourDist && d < bestDist) { bestDist = d; best = j; }
        });
        if (best >= 0) parent[find(i)] = find(best);
    });
    const clusters = new Map<number, FusionPath[]>();
    usable.forEach((p, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), p]); });
    return [...clusters.values()].filter(c => c.length > 1).map(c => [...c].sort((a, b) => area(b) - area(a)).map(p => p.id));
}
