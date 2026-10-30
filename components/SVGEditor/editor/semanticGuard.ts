/**
 * Semantic guard for structured SVGs (pictos-svg-schema).
 *
 * A structured SVG carries, in metadata#mf-accessibility, the bindings between
 * composition elements and <g> groups. The editor changes the drawing, not that
 * structure (specs/vector-editor.allium: SemanticStructureIsGuarded). Every
 * commit is compared with the document before it: an edit that introduces a
 * new violation is refused, so deleting a group's last geometry, booleans
 * across groups, moving geometry out of its group, ungrouping or renaming a
 * bound group never reach the document. Edits that remove violations (moving
 * unclassified geometry into a bound group) are allowed, so drafts can be
 * repaired. Documents without bindings (raw traces) are not guarded.
 *
 * Mirrors the binding checks of validateSVG in schemas/pictos-svg-schema.
 * Used in: svgEditorStore.commitSvg; SVGEditorModal shows the refusal.
 */

const GEOMETRY = 'path, rect, circle, ellipse, line, polygon, polyline, use';

export type ViolationKind = 'missing' | 'empty' | 'attrs' | 'unbound';
export interface SemanticRefusal { kind: ViolationKind; target: string; count: number }

const byId = (doc: Document, id: string) => doc.querySelector(`[id="${CSS.escape(id)}"]`);

/** Violation keys (`kind:target`) of a structured SVG, or null when it has no bindings. */
export function semanticViolations(svg: string): Set<string> | null {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    let bindings: Array<{ groupId?: string; implicit?: boolean }>;
    try {
        bindings = JSON.parse(byId(doc, 'mf-accessibility')?.textContent ?? '').bindings ?? [];
    } catch {
        return null;
    }
    const bound = bindings.filter(b => !b.implicit && b.groupId).map(b => b.groupId!);
    if (!bound.length) return null;

    const violations = new Set<string>();
    for (const id of bound) {
        const g = byId(doc, id);
        if (!g || g.localName !== 'g') { violations.add(`missing:${id}`); continue; }
        if (!g.querySelector(GEOMETRY)) violations.add(`empty:${id}`);
        if (!g.getAttribute('data-concept') || g.getAttribute('role') !== 'group' || g.getAttribute('tabindex') !== '0' || !g.getAttribute('aria-label')?.trim()) violations.add(`attrs:${id}`);
    }
    const boundSet = new Set(bound);
    const root = doc.documentElement;
    doc.querySelectorAll(GEOMETRY).forEach((el, i) => {
        let a = el.parentElement;
        while (a && a !== root && a.localName !== 'defs' && !boundSet.has(a.id)) a = a.parentElement;
        if (!a || a === root) violations.add(`unbound:${el.id || `#${i}`}`);
    });
    return violations;
}

/** The first violation `after` adds to `before`, or null when the edit keeps the structure. */
export function refuseIfBreaking(before: string, after: string): SemanticRefusal | null {
    const was = semanticViolations(before);
    if (!was) return null;
    const now = semanticViolations(after) ?? new Set(['missing:mf-accessibility']);
    const added = [...now].filter(v => !was.has(v));
    if (!added.length) return null;
    // Report the most specific kind first: a vanished group explains its
    // unbound geometry.
    const order: ViolationKind[] = ['missing', 'empty', 'attrs', 'unbound'];
    added.sort((x, y) => order.indexOf(x.split(':')[0] as ViolationKind) - order.indexOf(y.split(':')[0] as ViolationKind));
    const [kind, ...rest] = added[0].split(':');
    return { kind: kind as ViolationKind, target: rest.join(':'), count: added.length };
}
