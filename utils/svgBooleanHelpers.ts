/**
 * DOM-side helpers for SVG boolean operations.
 *
 * Extracts each operand's geometry as an absolute path d-string, baked into
 * the SVG root coordinate space. The pure clipping happens in
 * services/svgBooleanOps.ts.
 *
 * V1 scope: <path>, <rect>, <circle>, <ellipse>, <polygon>, <polyline>.
 * Group operands and cross-branch DCA placement are deferred.
 */

import { bakeMatrixIntoPathD, parseTransformToMatrix } from './svgNormalizer';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type EligibilityResult =
    | { ok: true }
    | { ok: false; reason: string };

/** Tags this V1 supports as boolean operands. */
const SUPPORTED_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline']);

export { primitiveToPathD } from './svgPrimitives';
import { primitiveToPathD } from './svgPrimitives';

/**
 * Compose the matrix that takes coordinates from `el`'s local space to the
 * coordinate space of `stopAt` (typically the <svg> root). Each ancestor's
 * `transform` attribute is multiplied in, outermost first.
 */
export function getCumulativeMatrix(el: Element, stopAt: Element | null): DOMMatrix {
    const chain: Element[] = [];
    let cur: Element | null = el;
    while (cur && cur !== stopAt) {
        chain.push(cur);
        cur = cur.parentElement;
    }
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) {
        const t = chain[i].getAttribute('transform');
        if (t) m = m.multiply(parseTransformToMatrix(t));
    }
    return m;
}

/**
 * Read an element's geometry as a path d-string in the coordinate space of
 * the SVG root. Returns null for unsupported tags or degenerate geometry.
 */
export function getAbsolutePathData(el: Element, svgRoot: Element): string | null {
    const local = primitiveToPathD(el);
    if (!local) return null;
    const m = getCumulativeMatrix(el, svgRoot);
    if (m.isIdentity) return local;
    return bakeMatrixIntoPathD(local, m);
}

/**
 * Validate that a set of selected element ids can take part in a boolean
 * operation. Returns ok or a reason string suitable for a tooltip.
 */
export function checkBooleanEligibility(
    op: 'union' | 'subtract' | 'intersect',
    ids: string[],
    svgDocument: string
): EligibilityResult {
    if (op === 'subtract') {
        if (ids.length !== 2) return { ok: false, reason: 'Subtract requires exactly 2 shapes' };
    } else {
        if (ids.length < 2) return { ok: false, reason: 'Select at least 2 shapes' };
    }
    if (!svgDocument) return { ok: false, reason: 'No SVG loaded' };

    const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
    for (const id of ids) {
        const el = doc.querySelector(`#${CSS.escape(id)}`);
        if (!el) return { ok: false, reason: `Element ${id} not found` };
        const tag = el.tagName.toLowerCase();
        if (!SUPPORTED_TAGS.has(tag)) {
            return { ok: false, reason: `Unsupported element type: <${tag}>` };
        }
    }
    return { ok: true };
}

/**
 * Sort element ids by document order (top-of-Z last). Used by subtract to
 * pick the bottom shape (Base) and the top shape (biter).
 */
export function sortByDocumentOrder(ids: string[], svgDocument: string): string[] {
    const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
    const elements = ids
        .map(id => ({ id, el: doc.querySelector(`#${CSS.escape(id)}`) }))
        .filter((x): x is { id: string; el: Element } => x.el !== null);
    elements.sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    });
    return elements.map(x => x.id);
}
