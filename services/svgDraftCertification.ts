/**
 * Certify an ESTRUCTURAR draft as it stands after manual editing, without a
 * model call and without touching geometry.
 *
 * A draft is assembled like an accepted revision (groups id = element id,
 * data-concept, role, aria-label) but carries a `pictonet-draft` metadata
 * block without bindings, because something did not bind. This module:
 *   - lists EVERY reason the draft does not certify yet (draftIssues), named
 *     by element, so the editor/tile can show a checklist;
 *   - adds an empty, correctly attributed group for each element without one
 *     (ensureDraftGroups), so shapes can be moved into it in the editor;
 *   - builds the canonical metadata from the groups as they are and runs the
 *     schema gate (certifyDraft). An Action with no drawing of its own may be
 *     declared implicit, performed by a drawn element (schema `implicit`).
 * The schema (`assertValidSVG`) stays the only authority; this never relaxes it.
 * Used in: App.tsx (certify, editor save of a draft), SVGGenerator (checklist).
 */
import { XMLSerializer } from '@xmldom/xmldom';
import type { RowData } from '../types';
import { assertSemanticInputs, assertValidSVG, createMetadata, parseSVG, parseMetadataJSON } from '../schemas/pictos-svg-schema/index.js';
import { canCertifySVG } from './svgCanonical.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GEOMETRY = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'use']);

export type DraftIssue =
    | { kind: 'inputs'; reasonKey: string; fields: string[] }    // row NLU/composition invalid: fix those fields in COMPRENDER/COMPONER
    | { kind: 'loose'; count: number; ids: string[]; parents: string[] } // shapes outside every element group, by id and current parent
    | { kind: 'empty'; elementId: string; concept: string; performers: string[] } // element without drawing
    | { kind: 'unknown'; groupId: string }                        // group of an element no longer in the composition
    | { kind: 'concepts'; elements: { elementId: string; suggested: string }[] } // legacy composition without `concept`: a person picks
    | { kind: 'invalid'; message: string };                       // final schema gate

/** elementId → performer elementId, for Actions declared implicit. */
export type ImplicitChoices = Record<string, string>;

interface Inspection {
    doc: Document;
    elements: Map<string, any>;
    groups: Map<string, Element>;
    drawn: Set<string>;
    issues: DraftIssue[];
}

const hasGeometry = (g: Element) => Array.from(g.getElementsByTagName('*')).some(n => GEOMETRY.has(n.localName));
const label = (id: string) => id.replace(/[_-]+/g, ' ');

export const CONCEPTS = ['Root', 'Agent', 'Action', 'Object', 'Context', 'Element'] as const;

/** Elements composed before `concept` existed, with the concept the draft already shows as the suggestion. */
function missingConcepts(row: Partial<RowData>, svg: string): { elementId: string; suggested: string }[] {
    const shown = new Map<string, string>();
    try {
        for (const g of Array.from((parseSVG(svg) as unknown as Document).getElementsByTagName('g')))
            if (g.getAttribute('id') && g.getAttribute('data-concept')) shown.set(g.getAttribute('id')!, g.getAttribute('data-concept')!);
    } catch { /* unreadable draft: no suggestions */ }
    const out: { elementId: string; suggested: string }[] = [];
    const visit = (nodes: any[], depth: number) => nodes.forEach(n => {
        if (!n.concept) out.push({ elementId: n.id, suggested: depth === 0 ? 'Root' : shown.get(n.id) ?? 'Element' });
        if (n.children) visit(n.children, depth + 1);
    });
    visit(row.elements ?? [], 0);
    return out;
}

/** Composition tree with the chosen concepts filled in (only where missing). */
export function applyConcepts(elements: any[], choices: Record<string, string>): any[] {
    return elements.map(n => ({ ...n, ...(!n.concept && choices[n.id] ? { concept: choices[n.id] } : {}),
        ...(n.children ? { children: applyConcepts(n.children, choices) } : {}) }));
}

function inspect(row: Partial<RowData>, svg: string, implicit: ImplicitChoices = {}): Inspection | { issues: DraftIssue[] } {
    const legacy = missingConcepts(row, svg);
    if (legacy.length) return { issues: [{ kind: 'concepts', elements: legacy }] };
    const eligibility = canCertifySVG(row);
    if (!eligibility.eligible) return { issues: [{ kind: 'inputs', reasonKey: eligibility.reasonKey!, fields: eligibility.fields ?? [] }] };
    const nlu = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
    const elements: Map<string, any> = assertSemanticInputs(nlu, { elements: row.elements, prompt: row.prompt }, row.UTTERANCE);
    const doc = parseSVG(svg) as unknown as Document;
    const groups = new Map<string, Element>();
    for (const g of Array.from(doc.getElementsByTagName('g'))) {
        const id = g.getAttribute('id');
        if (id && elements.has(id)) groups.set(id, g);
    }
    const issues: DraftIssue[] = [];
    for (const g of Array.from(doc.getElementsByTagName('g'))) {
        const id = g.getAttribute('id') ?? '';
        if (g.hasAttribute('data-concept') && !elements.has(id)) issues.push({ kind: 'unknown', groupId: id });
    }
    const drawn = new Set([...groups].filter(([, g]) => hasGeometry(g)).map(([id]) => id));
    const agents = [...elements.values()].filter(n => n.concept !== 'Root' && n.concept !== 'Action' && drawn.has(n.id)).map(n => n.id);
    for (const node of elements.values()) {
        if (node.concept === 'Root' || drawn.has(node.id)) continue;
        if (node.concept === 'Action' && implicit[node.id] && drawn.has(implicit[node.id])) continue;
        issues.push({ kind: 'empty', elementId: node.id, concept: node.concept, performers: node.concept === 'Action' ? agents : [] });
    }
    const bound = new Set([...groups.keys()].filter(id => elements.get(id)?.concept !== 'Root'));
    const looseIds: string[] = [], parents = new Set<string>();
    for (const n of Array.from(doc.getElementsByTagName('*'))) {
        if (!GEOMETRY.has(n.localName)) continue;
        let a = n.parentNode as Element | null;
        while (a && a !== doc.documentElement && a.localName !== 'defs' && !bound.has(a.getAttribute?.('id') ?? '')) a = a.parentNode as Element | null;
        if (!a || a === doc.documentElement) {
            looseIds.push(n.getAttribute('id') ?? n.localName);
            parents.add((n.parentNode as Element)?.getAttribute?.('id') ?? 'svg');
        }
    }
    if (looseIds.length) issues.push({ kind: 'loose', count: looseIds.length, ids: looseIds, parents: [...parents] });
    return { doc, elements, groups, drawn, issues };
}

/** Every reason this draft does not certify yet (empty = ready). */
export function draftIssues(row: Partial<RowData>, svg: string, implicit: ImplicitChoices = {}): DraftIssue[] {
    try {
        const result = inspect(row, svg, implicit);
        if (result.issues.length || !('doc' in result)) return result.issues;
        certifyDraft(row, svg, implicit);
        return [];
    } catch (error) {
        return [{ kind: 'invalid', message: error instanceof Error ? error.message : String(error) }];
    }
}

/** Add an empty group for each element without one, so shapes can be moved into it. */
export function ensureDraftGroups(row: Partial<RowData>, svg: string): string {
    try {
        const result = inspect(row, svg);
        if (!('doc' in result)) return svg;
        const { doc, groups } = result;
        let added = false;
        const visit = (nodes: any[], parent: Element) => {
            for (const node of nodes) {
                let g = groups.get(node.id);
                if (!g && node.concept !== 'Root') {
                    g = doc.createElementNS(SVG_NS, 'g');
                    for (const [k, v] of [['id', node.id], ['role', 'group'], ['tabindex', '0'], ['data-concept', node.concept], ['aria-label', label(node.id)]]) g.setAttribute(k, v);
                    parent.appendChild(g);
                    groups.set(node.id, g);
                    added = true;
                }
                if (node.children) visit(node.children, g ?? parent);
            }
        };
        visit(row.elements ?? [], doc.documentElement);
        return added ? new XMLSerializer().serializeToString(doc as any) : svg;
    } catch {
        return svg;
    }
}

/** Canonical SVG for this draft, or an Error carrying `issues`. */
export function certifyDraft(row: Partial<RowData>, svg: string, implicit: ImplicitChoices = {}, parentSha256?: string): string {
    const result = inspect(row, svg, implicit);
    if (result.issues.length || !('doc' in result)) throw Object.assign(new Error('Draft is not ready to certify'), { issues: result.issues });
    const { doc, elements, drawn } = result;
    const nlu = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
    const root = doc.documentElement;

    // The composition is the authority on concepts: group attributes follow it.
    for (const [id, node] of elements) {
        const g = Array.from(doc.getElementsByTagName('g')).find(x => x.getAttribute('id') === id);
        if (g && node.concept !== 'Root') g.setAttribute('data-concept', node.concept);
    }
    // Empty groups: implicit actions and the emptied unclassified bucket carry no drawing.
    for (const g of Array.from(doc.getElementsByTagName('g'))) if (!hasGeometry(g) && !g.getElementsByTagName('g').length) g.parentNode?.removeChild(g);

    const bindings = [...elements.values()].filter(n => n.concept !== 'Root').map(n =>
        drawn.has(n.id) ? { elementId: n.id, groupId: n.id } : { elementId: n.id, implicit: true, performedBy: implicit[n.id] });

    const metadataNode = Array.from(doc.getElementsByTagName('metadata'))[0];
    let provenance = {};
    try { provenance = parseMetadataJSON(metadataNode?.textContent ?? '{}').provenance ?? {}; } catch { /* draft without readable metadata */ }
    const desc = Array.from(doc.getElementsByTagName('desc'))[0];
    const title = Array.from(doc.getElementsByTagName('title'))[0];
    if (title) title.textContent = row.UTTERANCE ?? '';
    root.setAttribute('lang', nlu.lang);
    const metadata = createMetadata({ nlu, composition: { elements: row.elements, prompt: row.prompt }, bindings, provenance,
        description: desc?.textContent?.trim() || row.UTTERANCE, operation: 'manual_edit', parentSha256 });
    if (desc) desc.textContent = metadata.accessibility.description;
    const block = metadataNode ?? root.insertBefore(doc.createElementNS(SVG_NS, 'metadata'), root.firstChild);
    block.setAttribute('id', 'mf-accessibility');
    while (block.firstChild) block.removeChild(block.firstChild);
    block.appendChild(doc.createCDATASection(JSON.stringify(metadata, null, 2).replace(/\]\]>/g, ']]]]><![CDATA[>')));
    const out = new XMLSerializer().serializeToString(doc as any);
    assertValidSVG(out);
    return out;
}
