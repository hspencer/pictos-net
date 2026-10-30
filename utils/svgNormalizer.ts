/**
 * SVG Normalizer
 * Strips all inline style attributes and converts them to CSS classes.
 * Also provides flattenGroupTransforms() to bake group-level matrix/translate
 * transforms destructively into child path coordinates.
 */

export interface NormalizeResult {
    svg: string;
    cssRules: string;
}

function generateId(): string {
    return 'el-' + Math.random().toString(36).substr(2, 9);
}

export function normalizeSVG(svgString: string): NormalizeResult {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.querySelector('svg');

    if (!svgElement) {
        // Return original if invalid, to avoid crash
        console.error('Invalid SVG document');
        return { svg: svgString, cssRules: '' };
    }

    // Auto-generate IDs for elements without them
    const allElements = svgElement.querySelectorAll('*');
    allElements.forEach((element) => {
        if (!element.id) {
            element.id = generateId();
        }
    });

    const cssRules: Map<string, string> = new Map();
    let classCounter = 0;

    // Recursive function to process elements
    function processElement(element: Element) {
        const styleAttr = element.getAttribute('style');

        if (styleAttr) {
            // Check if it already has a class from style extraction
            // For simplicity, we just extract everything
            const className = `mf-style-${classCounter++}`;

            cssRules.set(className, styleAttr);

            element.removeAttribute('style');
            const existingClass = element.getAttribute('class');
            element.setAttribute('class', existingClass ? `${existingClass} ${className}` : className);
        }

        Array.from(element.children).forEach(processElement);
    }

    processElement(svgElement);

    let cssBlock = '';
    if (cssRules.size > 0) {
        cssBlock = Array.from(cssRules.entries())
            .map(([className, styles]) => `.${className} { ${styles} }`)
            .join('\n');
    }

    // Inject extraction style block logic if needed, but here we just return the cleaned SVG string
    // and the CSS rules separately, or inject them.
    // The store handles styles separately usually via extracting extracting extracting into styleExtraction logic.
    // The original extraction logic put it into <style> tag.

    // Let's keep extraction minimal.
    const serializer = new XMLSerializer();
    return {
        svg: serializer.serializeToString(doc),
        cssRules: cssBlock,
    };
}

/**
 * Parse SVG string into a structured DOM tree compatible with our store
 */
import { SVGElement } from '../stores/svgEditorStore';

export function parseSVGToDOM(svgString: string): SVGElement | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.querySelector('svg');

    if (!svgElement) {
        return null;
    }

    function elementToNode(element: Element): SVGElement {
        const attributes: Record<string, string> = {};
        Array.from(element.attributes).forEach((attr) => {
            attributes[attr.name] = attr.value;
        });

        const id = element.getAttribute('id') || generateId();
        if (!element.id) element.id = id;

        const children = Array.from(element.children).map((child) => elementToNode(child));

        return {
            id,
            tagName: element.tagName,
            attributes,
            children,
            // innerText omitted as SVG usually doesn't use it for structure except <text>
        };
    }

    return elementToNode(svgElement);
}

// ── Transform Flattening ──────────────────────────────────────────────────────

/**
 * Parse an SVG transform string into a DOMMatrix.
 * Handles: matrix(a,b,c,d,e,f), translate(x,y), scale(x,y), rotate(deg,cx,cy),
 *          skewX(deg), skewY(deg), and chains of multiple transforms.
 *
 * NOTE: DOMMatrix constructor expects CSS syntax (translate needs px units),
 * but SVG transforms are unitless. We parse manually to avoid silent failures.
 */
export function parseTransformToMatrix(transform: string | null): DOMMatrix {
    if (!transform || transform === 'none') return new DOMMatrix();

    // Match each SVG transform function: name(args)
    const fnRegex = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
    let result = new DOMMatrix(); // identity
    let match: RegExpExecArray | null;

    while ((match = fnRegex.exec(transform)) !== null) {
        const fn = match[1].toLowerCase();
        const args = match[2].split(/[\s,]+/).map(Number);
        let m = new DOMMatrix(); // identity for this function

        switch (fn) {
            case 'matrix':
                if (args.length >= 6) {
                    m = new DOMMatrix([args[0], args[1], args[2], args[3], args[4], args[5]]);
                }
                break;
            case 'translate':
                m.e = args[0] ?? 0;
                m.f = args[1] ?? 0;
                break;
            case 'scale': {
                const sx = args[0] ?? 1;
                const sy = args[1] ?? sx;
                m.a = sx;
                m.d = sy;
                break;
            }
            case 'rotate': {
                const deg = args[0] ?? 0;
                const cx = args[1] ?? 0;
                const cy = args[2] ?? 0;
                const rad = (deg * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                // rotate(deg, cx, cy) = translate(cx,cy) · rotate(deg) · translate(-cx,-cy)
                m = new DOMMatrix([cos, sin, -sin, cos,
                    cx * (1 - cos) + cy * sin,
                    cy * (1 - cos) - cx * sin]);
                break;
            }
            case 'skewx': {
                const rad = ((args[0] ?? 0) * Math.PI) / 180;
                m.c = Math.tan(rad);
                break;
            }
            case 'skewy': {
                const rad = ((args[0] ?? 0) * Math.PI) / 180;
                m.b = Math.tan(rad);
                break;
            }
        }
        // Chain: result = result × m
        result = result.multiply(m);
    }

    return result;
}

/**
 * Serialize a DOMMatrix back to a compact SVG transform string.
 * - Pure translate (a=1,b=0,c=0,d=1): → "translate(e, f)"
 * - Pure identity: → "" (no transform needed)
 * - Everything else: → "matrix(a,b,c,d,e,f)"
 */
export function matrixToTransform(m: DOMMatrix): string {
    const r = (n: number) => Math.round(n * 10000) / 10000; // 4 decimal places

    const isIdentity =
        m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
    if (isIdentity) return '';

    const isPureTranslate = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
    if (isPureTranslate) return `translate(${r(m.e)},${r(m.f)})`;

    return `matrix(${r(m.a)},${r(m.b)},${r(m.c)},${r(m.d)},${r(m.e)},${r(m.f)})`;
}

/**
 * Apply a DOMMatrix to all coordinate numbers inside an SVG path `d` attribute.
 *
 * This is the truly destructive bake: every absolute coordinate pair in the
 * path data is transformed by the matrix, so the path renders identically but
 * needs no external transform attribute to do so.
 *
 * Strategy: normalize path to absolute commands, transform each coordinate pair.
 * Handles M, L, C, Q, A, Z. Relative commands are first converted to absolute.
 */
export function bakeMatrixIntoPathD(d: string, m: DOMMatrix): string {
    if (!d) return d;

    // Tokenize: split into command + args chunks
    const tokens = d.match(/([MLHVCSQTAZmlhvcsqtaz])[^MLHVCSQTAZmlhvcsqtaz]*/g) ?? [];
    if (tokens.length === 0) return d;

    let cx = 0; // current x
    let cy = 0; // current y
    let sx = 0; // subpath start x (for Z)
    let sy = 0; // subpath start y
    let isFirstCommand = true; // tracks whether we've seen any M/m yet

    const result: string[] = [];

    /** Transform a single point through the matrix */
    const tx = (x: number, y: number): [number, number] => {
        const pt = new DOMPoint(x, y).matrixTransform(m);
        const r = (n: number) => Math.round(n * 100) / 100;
        return [r(pt.x), r(pt.y)];
    };

    /** Parse space/comma-separated numbers from a token's arguments */
    const nums = (token: string): number[] =>
        (token.slice(1).match(/-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g) ?? []).map(Number);

    /** Scale factor for arc radii (approximate, works for uniform scale) */
    const scaleX = Math.sqrt(m.a * m.a + m.b * m.b);
    const scaleY = Math.sqrt(m.c * m.c + m.d * m.d);

    for (const token of tokens) {
        const cmd = token[0];
        const args = nums(token);

        switch (cmd) {
            case 'M': case 'm': {
                for (let i = 0; i + 1 < args.length; i += 2) {
                    // Bug A fix: first 'm' in the entire path behaves as absolute 'M' per SVG spec
                    if (cmd === 'm' && isFirstCommand) {
                        cx = args[i]; cy = args[i + 1];
                    } else if (cmd === 'm') {
                        cx += args[i]; cy += args[i + 1];
                    } else {
                        cx = args[i]; cy = args[i + 1];
                    }
                    const [nx, ny] = tx(cx, cy);
                    if (i === 0) { sx = cx; sy = cy; result.push(`M${nx},${ny}`); }
                    else result.push(`L${nx},${ny}`);
                }
                isFirstCommand = false;
                break;
            }
            case 'L': case 'l': {
                for (let i = 0; i + 1 < args.length; i += 2) {
                    if (cmd === 'l') { cx += args[i]; cy += args[i + 1]; }
                    else { cx = args[i]; cy = args[i + 1]; }
                    const [nx, ny] = tx(cx, cy);
                    result.push(`L${nx},${ny}`);
                }
                break;
            }
            case 'H': case 'h': {
                for (const ax of args) {
                    cx = cmd === 'h' ? cx + ax : ax;
                    const [nx, ny] = tx(cx, cy);
                    result.push(`L${nx},${ny}`); // H becomes L after matrix
                }
                break;
            }
            case 'V': case 'v': {
                for (const ay of args) {
                    cy = cmd === 'v' ? cy + ay : ay;
                    const [nx, ny] = tx(cx, cy);
                    result.push(`L${nx},${ny}`); // V becomes L after matrix
                }
                break;
            }
            case 'C': case 'c': {
                // Bug D fix: i + 6 <= args.length ensures we don't skip the last curve
                for (let i = 0; i + 6 <= args.length; i += 6) {
                    const [c1x, c1y] = cmd === 'c'
                        ? [cx + args[i], cy + args[i + 1]]
                        : [args[i], args[i + 1]];
                    const [c2x, c2y] = cmd === 'c'
                        ? [cx + args[i + 2], cy + args[i + 3]]
                        : [args[i + 2], args[i + 3]];
                    const [ex, ey] = cmd === 'c'
                        ? [cx + args[i + 4], cy + args[i + 5]]
                        : [args[i + 4], args[i + 5]];
                    // Bug B fix: cx,cy updated AFTER computing control points (already correct
                    // for relative since offsets are from the pre-update cx,cy)
                    cx = ex; cy = ey;
                    const [nc1x, nc1y] = tx(c1x, c1y);
                    const [nc2x, nc2y] = tx(c2x, c2y);
                    const [nex, ney] = tx(ex, ey);
                    result.push(`C${nc1x},${nc1y},${nc2x},${nc2y},${nex},${ney}`);
                }
                break;
            }
            case 'Q': case 'q': {
                for (let i = 0; i + 4 <= args.length; i += 4) {
                    const [c1x, c1y] = cmd === 'q'
                        ? [cx + args[i], cy + args[i + 1]]
                        : [args[i], args[i + 1]];
                    const [ex, ey] = cmd === 'q'
                        ? [cx + args[i + 2], cy + args[i + 3]]
                        : [args[i + 2], args[i + 3]];
                    cx = ex; cy = ey;
                    const [nc1x, nc1y] = tx(c1x, c1y);
                    const [nex, ney] = tx(ex, ey);
                    result.push(`Q${nc1x},${nc1y},${nex},${ney}`);
                }
                break;
            }
            case 'S': case 's': {
                for (let i = 0; i + 4 <= args.length; i += 4) {
                    const [c2x, c2y] = cmd === 's'
                        ? [cx + args[i], cy + args[i + 1]]
                        : [args[i], args[i + 1]];
                    const [ex, ey] = cmd === 's'
                        ? [cx + args[i + 2], cy + args[i + 3]]
                        : [args[i + 2], args[i + 3]];
                    cx = ex; cy = ey;
                    const [nc2x, nc2y] = tx(c2x, c2y);
                    const [nex, ney] = tx(ex, ey);
                    result.push(`S${nc2x},${nc2y},${nex},${ney}`);
                }
                break;
            }
            case 'T': case 't': {
                for (let i = 0; i + 2 <= args.length; i += 2) {
                    if (cmd === 't') { cx += args[i]; cy += args[i + 1]; }
                    else { cx = args[i]; cy = args[i + 1]; }
                    const [nx, ny] = tx(cx, cy);
                    result.push(`T${nx},${ny}`);
                }
                break;
            }
            case 'A': case 'a': {
                // Bug C fix: transform arc endpoint and scale radii
                // Arc args: rx ry x-rotation large-arc-flag sweep-flag x y
                for (let i = 0; i + 7 <= args.length; i += 7) {
                    const rx = args[i] * scaleX;
                    const ry = args[i + 1] * scaleY;
                    const xRot = args[i + 2];
                    const largeArc = args[i + 3];
                    const sweep = args[i + 4];
                    let ex: number, ey: number;
                    if (cmd === 'a') {
                        ex = cx + args[i + 5]; ey = cy + args[i + 6];
                    } else {
                        ex = args[i + 5]; ey = args[i + 6];
                    }
                    cx = ex; cy = ey;
                    const r = (n: number) => Math.round(n * 100) / 100;
                    const [nex, ney] = tx(ex, ey);
                    result.push(`A${r(rx)},${r(ry)},${xRot},${largeArc},${sweep},${nex},${ney}`);
                }
                break;
            }
            case 'Z': case 'z': {
                cx = sx; cy = sy;
                result.push('Z');
                break;
            }
            default:
                result.push(token);
        }
    }

    return result.join(' ');
}

/**
 * Flatten all group-level transforms destructively into child coordinates.
 *
 * The problem: when the SVG editor scales/moves a group, the transform is stored
 * on the <g> element. If the group is later removed or the paths processed
 * individually (e.g., by ESTRUCTURAR), the group transform is lost and shapes
 * jump back to their original positions.
 *
 * The fix: for every <g> with a transform, multiply that matrix into each child's
 * own transform (composing them), then bake the resulting matrix into the child's
 * path `d` coordinates. After this, neither the group nor the child needs a
 * transform attribute — the coordinates in `d` are already in final screen space.
 *
 * This is safe because:
 * - vtracer paths use translate(tx, ty) on each <path> and all d coords start at 0,0
 * - The group matrix was applied visually on top of those translates
 * - After baking, d contains absolute screen coordinates, transform="" can be removed
 *
 * @param svgString  The raw SVG XML string
 * @param groupIds   Optional list of group IDs to flatten. If omitted, ALL groups
 *                   with a non-identity transform are processed.
 */
export function flattenGroupTransforms(
    svgString: string,
    groupIds?: string[]
): string {
    let current = svgString;
    // Multi-pass: handle arbitrarily nested <g transform> elements.
    // Each pass flattens one level; repeat until no transforms remain (max 5 passes).
    for (let pass = 0; pass < 5; pass++) {
        const next = flattenOnePass(current, groupIds);
        if (next === current) break; // no more transforms to flatten
        current = next;
    }
    return current;
}

/** Single pass: flatten direct-child transforms of each <g transform>. */
function flattenOnePass(
    svgString: string,
    groupIds?: string[]
): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');

    if (doc.querySelector('parsererror')) {
        console.warn('[flattenGroupTransforms] SVG parse error, returning original');
        return svgString;
    }

    // Collect target groups
    const allGroups = Array.from(doc.querySelectorAll('g[transform]'));
    const targetGroups = groupIds
        ? allGroups.filter(g => groupIds.includes(g.getAttribute('id') ?? ''))
        : allGroups;

    if (targetGroups.length === 0) return svgString; // nothing to do

    for (const group of targetGroups) {
        const groupTransformStr = group.getAttribute('transform');
        if (!groupTransformStr || groupTransformStr === 'none') continue;

        const groupMatrix = parseTransformToMatrix(groupTransformStr);

        // Check if it's actually the identity (no-op transform)
        const isIdentity =
            groupMatrix.a === 1 && groupMatrix.b === 0 &&
            groupMatrix.c === 0 && groupMatrix.d === 1 &&
            groupMatrix.e === 0 && groupMatrix.f === 0;
        if (isIdentity) { group.removeAttribute('transform'); continue; }

        // Process each direct child
        Array.from(group.children).forEach(child => {
            const childTransformStr = child.getAttribute('transform') ?? '';
            const childMatrix = parseTransformToMatrix(childTransformStr || null);

            // Compose: final = groupMatrix × childMatrix
            const composedMatrix = groupMatrix.multiply(childMatrix);

            // For <path> elements: bake the full composed matrix into `d` coords
            if (child.tagName === 'path') {
                const d = child.getAttribute('d') ?? '';
                if (d) {
                    child.setAttribute('d', bakeMatrixIntoPathD(d, composedMatrix));
                    child.removeAttribute('transform');
                }
            }
            // For <rect>, <circle>, <ellipse>: bake via transform attribute (simpler)
            // These are rare in vtracer output; use composed matrix as transform
            else if (['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(child.tagName)) {
                const t = matrixToTransform(composedMatrix);
                if (t) child.setAttribute('transform', t);
                else child.removeAttribute('transform');
            }
            // For nested <g>: compose the transforms (will be flattened on next pass)
            else if (child.tagName === 'g') {
                const t = matrixToTransform(composedMatrix);
                if (t) child.setAttribute('transform', t);
                else child.removeAttribute('transform');
            }
        });

        // Remove the group's own transform — it's been baked into children
        group.removeAttribute('transform');
    }

    return new XMLSerializer().serializeToString(doc);
}

/**
 * Convenience: flatten ALL group transforms in the SVG, then also fix the
 * redundant xmlns attributes that XMLSerializer adds to child elements.
 */
export function normalizeSVGTransforms(svgString: string): string {
    const flattened = flattenGroupTransforms(svgString);
    // XMLSerializer sprinkles xmlns on children — clean up
    return flattened
        .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
        .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
}
