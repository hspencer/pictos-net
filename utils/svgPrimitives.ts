/** Geometric SVG primitives as path data; pure, no DOM globals or stores. */

/**
 * Convert a geometric SVG primitive to a path d-string in its own local
 * coordinate space (transform NOT yet applied). Returns null if the element
 * is not a supported geometric primitive.
 */
export function primitiveToPathD(el: Element): string | null {
    const tag = el.tagName.toLowerCase();
    const num = (name: string, fallback = 0): number => {
        const v = el.getAttribute(name);
        return v == null ? fallback : parseFloat(v);
    };
    switch (tag) {
        case 'path':
            return el.getAttribute('d');
        case 'rect': {
            const x = num('x'), y = num('y'), w = num('width'), h = num('height');
            if (w <= 0 || h <= 0) return null;
            return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
        }
        case 'circle': {
            const cx = num('cx'), cy = num('cy'), r = num('r');
            if (r <= 0) return null;
            return `M${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} Z`;
        }
        case 'ellipse': {
            const cx = num('cx'), cy = num('cy'), rx = num('rx'), ry = num('ry');
            if (rx <= 0 || ry <= 0) return null;
            return `M${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} Z`;
        }
        case 'polygon':
        case 'polyline': {
            const points = (el.getAttribute('points') || '').trim();
            if (!points) return null;
            const pairs = points.split(/[\s,]+/).map(parseFloat);
            if (pairs.length < 4 || pairs.length % 2 !== 0) return null;
            const cmds: string[] = [`M${pairs[0]},${pairs[1]}`];
            for (let i = 2; i < pairs.length; i += 2) {
                cmds.push(`L${pairs[i]},${pairs[i + 1]}`);
            }
            if (tag === 'polygon') cmds.push('Z');
            return cmds.join(' ');
        }
        default:
            return null;
    }
}
