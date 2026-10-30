/**
 * Geometry kernel — the single authority for SVG coordinate math in the editor.
 *
 * Everything that parses a path, builds or applies a matrix, or bakes a
 * transform into geometry goes through here. There is exactly one path-bake
 * (`bakeMatrixIntoPathD`), one transform parser (`parseTransformToMatrix`) and
 * one primitive→path conversion (`primitiveToPathD`); this module re-exports
 * the canonical implementations (which already live in utils/) so callers have
 * a single import surface, and adds the pieces the non-destructive editor needs:
 *
 *   - gesture matrix builders (translate / scale / rotate) in document space,
 *   - parent-space conversion so a document-space gesture can be written as an
 *     element `transform` attribute (live, non-destructive — no geometry touched),
 *   - `bakeElementTransform`: bake one element's `transform` into its geometry,
 *     keeping a primitive a primitive when the matrix allows and promoting to
 *     `<path>` only when it cannot (rotation/skew on rect/circle/ellipse),
 *   - `bakeDocumentTransforms`: the save-time bake of every transform in the doc.
 *
 * The node-level path AST (editable anchors/handles) stays in utils/pathParser —
 * that is the node tool's concern, a different representation from matrix baking.
 */

import {
    parseTransformToMatrix,
    matrixToTransform,
    bakeMatrixIntoPathD,
    normalizeSVGTransforms,
    flattenGroupTransforms,
} from '../../../utils/svgNormalizer';
import {
    primitiveToPathD,
    getCumulativeMatrix,
    getAbsolutePathData,
} from '../../../utils/svgBooleanHelpers';

// Re-export the canonical kernel surface so the editor imports geometry from here.
export {
    parseTransformToMatrix,
    matrixToTransform,
    bakeMatrixIntoPathD,
    flattenGroupTransforms,
    primitiveToPathD,
    getCumulativeMatrix,
    getAbsolutePathData,
};

export interface BBox { x: number; y: number; width: number; height: number; }
export interface Pt { x: number; y: number; }

const EPS = 1e-6;

// ── Matrix classification ────────────────────────────────────────────────────

/** No rotation and no skew: the matrix is pure translate + axis scale. */
function isAxisAligned(m: DOMMatrix): boolean {
    return Math.abs(m.b) < EPS && Math.abs(m.c) < EPS;
}

/** Axis-aligned and the two scale factors are equal (a true circle stays a circle). */
function isUniform(m: DOMMatrix): boolean {
    return isAxisAligned(m) && Math.abs(Math.abs(m.a) - Math.abs(m.d)) < EPS;
}

// ── Gesture matrix builders (document / root space) ───────────────────────────

export function translateMatrix(dx: number, dy: number): DOMMatrix {
    return new DOMMatrix([1, 0, 0, 1, dx, dy]);
}

/** Scale by (sx, sy) about the fixed point (ox, oy). */
export function scaleMatrix(sx: number, sy: number, ox: number, oy: number): DOMMatrix {
    // translate(o) · scale(s) · translate(-o)
    return new DOMMatrix([sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy)]);
}

/** Rotate by `deg` degrees about the fixed point (cx, cy). */
export function rotateMatrix(deg: number, cx: number, cy: number): DOMMatrix {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return new DOMMatrix([
        cos, sin, -sin, cos,
        cx * (1 - cos) + cy * sin,
        cy * (1 - cos) - cx * sin,
    ]);
}

// ── Reading / writing an element's live transform ─────────────────────────────

/** The element's current `transform` as a matrix (identity if none). */
export function getElementTransformMatrix(el: Element): DOMMatrix {
    return parseTransformToMatrix(el.getAttribute('transform'));
}

/** Write a matrix as the element's `transform`, or remove it when identity. */
export function setElementTransformMatrix(el: Element, m: DOMMatrix): void {
    const t = matrixToTransform(m);
    if (t) el.setAttribute('transform', t);
    else el.removeAttribute('transform');
}

/**
 * Convert a gesture expressed in document/root space into the element's own
 * parent space, so it can be composed with the element's existing transform.
 * For a direct child of the root this is a no-op; inside transformed groups it
 * rebases the gesture through the parent's cumulative matrix.
 */
export function gestureToParentSpace(el: Element, gestureRoot: DOMMatrix, svgRoot: Element): DOMMatrix {
    const parent = el.parentElement;
    if (!parent || parent === svgRoot) return gestureRoot;
    const mParent = getCumulativeMatrix(parent, svgRoot); // parent-local → root
    return mParent.inverse().multiply(gestureRoot).multiply(mParent);
}

/**
 * Apply a document-space gesture on top of a base transform, writing the result
 * as the element's `transform`. `base` is the element's transform captured when
 * the gesture began (so repeated previews don't accumulate). Non-destructive:
 * only the `transform` attribute changes; geometry is untouched until save.
 */
export function previewGesture(el: Element, gestureRoot: DOMMatrix, base: DOMMatrix, svgRoot: Element): void {
    const g = gestureToParentSpace(el, gestureRoot, svgRoot);
    setElementTransformMatrix(el, g.multiply(base));
}

// ── Baking one element's transform into its geometry ──────────────────────────

const PATH_PROMOTE_TAGS = new Set(['rect', 'circle', 'ellipse']);

function transformPoint(m: DOMMatrix, x: number, y: number): Pt {
    const p = new DOMPoint(x, y).matrixTransform(m);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return { x: r(p.x), y: r(p.y) };
}

function num(el: Element, name: string, fallback = 0): number {
    const v = el.getAttribute(name);
    return v == null ? fallback : parseFloat(v);
}

/** Replace a primitive element with a `<path>` carrying its id/class and baked `d`. */
function promoteToPath(el: Element, d: string): void {
    const path = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const attr of Array.from(el.attributes)) {
        if (['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
             'x1', 'y1', 'x2', 'y2', 'points', 'd', 'transform'].includes(attr.name)) continue;
        path.setAttribute(attr.name, attr.value);
    }
    path.setAttribute('d', d);
    el.replaceWith(path);
}

/**
 * Bake the element's `transform` into its geometry and remove the attribute.
 * A primitive stays a primitive when the matrix is axis-aligned; it is promoted
 * to `<path>` only when rotation/skew make that impossible. Groups are left for
 * `bakeDocumentTransforms` to flatten; text/image/use keep their transform
 * (their geometry cannot be baked). No-op when there is no transform.
 */
export function bakeElementTransform(el: Element): void {
    const t = el.getAttribute('transform');
    if (!t || t === 'none') return;
    const m = parseTransformToMatrix(t);
    if (m.isIdentity) { el.removeAttribute('transform'); return; }

    const tag = el.tagName.toLowerCase();
    const sx = Math.hypot(m.a, m.b);
    const sy = Math.hypot(m.c, m.d);

    switch (tag) {
        case 'path': {
            const d = el.getAttribute('d');
            if (d) el.setAttribute('d', bakeMatrixIntoPathD(d, m));
            el.removeAttribute('transform');
            return;
        }
        case 'line': {
            const a = transformPoint(m, num(el, 'x1'), num(el, 'y1'));
            const b = transformPoint(m, num(el, 'x2'), num(el, 'y2'));
            el.setAttribute('x1', String(a.x)); el.setAttribute('y1', String(a.y));
            el.setAttribute('x2', String(b.x)); el.setAttribute('y2', String(b.y));
            el.removeAttribute('transform');
            return;
        }
        case 'polygon':
        case 'polyline': {
            const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
            const out: string[] = [];
            for (let i = 0; i + 1 < pts.length; i += 2) {
                const p = transformPoint(m, pts[i], pts[i + 1]);
                out.push(`${p.x},${p.y}`);
            }
            el.setAttribute('points', out.join(' '));
            el.removeAttribute('transform');
            return;
        }
        case 'rect': {
            if (isAxisAligned(m) && m.a > 0 && m.d > 0) {
                const p = transformPoint(m, num(el, 'x'), num(el, 'y'));
                el.setAttribute('x', String(p.x));
                el.setAttribute('y', String(p.y));
                el.setAttribute('width', String(Math.round(num(el, 'width') * m.a * 1000) / 1000));
                el.setAttribute('height', String(Math.round(num(el, 'height') * m.d * 1000) / 1000));
                el.removeAttribute('transform');
                return;
            }
            break; // rotated/skewed → promote
        }
        case 'circle': {
            if (isUniform(m)) {
                const p = transformPoint(m, num(el, 'cx'), num(el, 'cy'));
                el.setAttribute('cx', String(p.x));
                el.setAttribute('cy', String(p.y));
                el.setAttribute('r', String(Math.round(num(el, 'r') * sx * 1000) / 1000));
                el.removeAttribute('transform');
                return;
            }
            break;
        }
        case 'ellipse': {
            if (isAxisAligned(m)) {
                const p = transformPoint(m, num(el, 'cx'), num(el, 'cy'));
                el.setAttribute('cx', String(p.x));
                el.setAttribute('cy', String(p.y));
                el.setAttribute('rx', String(Math.round(num(el, 'rx') * sx * 1000) / 1000));
                el.setAttribute('ry', String(Math.round(num(el, 'ry') * sy * 1000) / 1000));
                el.removeAttribute('transform');
                return;
            }
            break;
        }
        case 'g':
        case 'text':
        case 'image':
        case 'use':
        case 'tspan':
            // Groups are flattened by bakeDocumentTransforms; the rest cannot be
            // baked into geometry — their transform stays.
            return;
    }

    // Fall-through: a primitive under rotation/skew. Promote to a baked <path>.
    if (PATH_PROMOTE_TAGS.has(tag)) {
        const local = primitiveToPathD(el);
        if (local) { promoteToPath(el, bakeMatrixIntoPathD(local, m)); return; }
    }
    // Unknown shape: leave the transform rather than lose geometry.
}

/**
 * Save-time bake of every transform in the document. First flattens group
 * transforms into their children (reusing the proven group flattener), then
 * bakes any remaining element transform into its geometry. The result renders
 * identically with no transform attributes on bakeable elements.
 */
export function bakeDocumentTransforms(svgString: string): string {
    const flattened = normalizeSVGTransforms(svgString); // groups → children
    const doc = new DOMParser().parseFromString(flattened, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return flattened;
    // Snapshot the list first: promoteToPath mutates the tree.
    for (const el of Array.from(doc.querySelectorAll('[transform]'))) {
        if (el.tagName.toLowerCase() === 'g') continue; // already flattened
        bakeElementTransform(el);
    }
    return new XMLSerializer()
        .serializeToString(doc)
        .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
        .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
}

// ── Geometry hit-testing (visible art, not boxes) ─────────────────────────────

export interface ScreenRect { left: number; top: number; right: number; bottom: number; }

/**
 * Does the element's visible geometry touch a screen-space rectangle? Mirrors
 * VectorCraft's marquee (`intersects_rect`): an element counts when its outline
 * (widened by half its stroke) crosses or lies inside the rectangle, or when the
 * rectangle lies inside its painted fill. Its bounding box alone never counts, so
 * a concave shape is not touched through its empty regions.
 */
export function geometryTouchesRect(el: SVGGeometryElement, r: ScreenRect): boolean {
    const ctm = el.getScreenCTM();
    if (!ctm) return false;
    const br = el.getBoundingClientRect();
    if (br.width === 0 && br.height === 0) return false;
    if (br.right < r.left || br.left > r.right || br.bottom < r.top || br.top > r.bottom) return false;

    const style = getComputedStyle(el);
    const scale = Math.hypot(ctm.a, ctm.b) || 1;
    const halfStroke = style.stroke && style.stroke !== 'none'
        ? ((parseFloat(style.strokeWidth) || 0) * scale) / 2
        : 0;
    const inside = (x: number, y: number) =>
        x >= r.left - halfStroke && x <= r.right + halfStroke &&
        y >= r.top - halfStroke && y <= r.bottom + halfStroke;

    // 1. The outline crosses the rectangle or lies inside it.
    let len = 0;
    try { len = el.getTotalLength(); } catch { /* not measurable */ }
    if (len > 0) {
        // ponytail: sampling every ~2 screen px, capped; an exact segment/rect
        // intersection would replace this if long paths ever make marquee slow.
        const n = Math.min(2000, Math.max(16, Math.ceil((len * scale) / 2)));
        for (let i = 0; i <= n; i++) {
            const p = el.getPointAtLength((len * i) / n).matrixTransform(ctm);
            if (inside(p.x, p.y)) return true;
        }
    }

    // 2. No outline inside it: the rectangle is either wholly inside the fill or
    //    wholly outside it, so its centre decides.
    if (style.fill && style.fill !== 'none') {
        const c = new DOMPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2).matrixTransform(ctm.inverse());
        try { if (el.isPointInFill(c)) return true; } catch { /* unsupported */ }
    }
    return false;
}

// ── BBox + handles (for the selection overlay) ────────────────────────────────

/** Axis-aligned bbox of an element in root coordinates (needs a rendered element). */
export function getRootBBox(el: SVGGraphicsElement, svgRoot: SVGSVGElement): BBox | null {
    try {
        const b = el.getBBox();
        const ctm = el.getCTM();
        if (!ctm) return { x: b.x, y: b.y, width: b.width, height: b.height };
        const corners = [
            new DOMPoint(b.x, b.y), new DOMPoint(b.x + b.width, b.y),
            new DOMPoint(b.x + b.width, b.y + b.height), new DOMPoint(b.x, b.y + b.height),
        ].map(p => p.matrixTransform(ctm));
        const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    } catch {
        return null;
    }
}

/** Union of several bboxes (for a multi-selection marquee frame). */
export function unionBBox(boxes: BBox[]): BBox | null {
    if (boxes.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The eight resize handles of a bbox, in root coordinates. */
export function bboxHandles(b: BBox): Record<HandleId, Pt> {
    const { x, y, width: w, height: h } = b;
    return {
        nw: { x, y }, n: { x: x + w / 2, y }, ne: { x: x + w, y },
        e: { x: x + w, y: y + h / 2 }, se: { x: x + w, y: y + h },
        s: { x: x + w / 2, y: y + h }, sw: { x, y: y + h }, w: { x, y: y + h / 2 },
    };
}

/** The fixed (opposite) corner for a given resize handle — the scale origin. */
export function handleAnchor(b: BBox, h: HandleId): Pt {
    const hs = bboxHandles(b);
    const opposite: Record<HandleId, HandleId> = {
        nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e',
    };
    return hs[opposite[h]];
}
