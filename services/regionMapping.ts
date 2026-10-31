/**
 * regionMapping — the region contract of the joint VECTORIZAR+ESTRUCTURAR
 * request (plan VE3, tool `restructure_regions`).
 *
 * Regions come from the VTracer 1.0 binding (vtracerWebService), one or more
 * paths each (`r<id>`, islands `r<id>_<n>`). The model assigns regions to
 * existing composition nodes and may also protect regions, propose discards,
 * ask for a split (one region holding several entities) or leave a region
 * unresolved. It never authors geometry. A distinct tool name versions the
 * contract: an answer is never read under the legacy `restructure_svg` rules.
 *
 * Conversion to the assembler's StructuringMapping keeps every doubt visible:
 * a split-requested region goes to the deepest common ancestor of its nodes
 * (or stays unassigned when they have none), unresolved regions are left out
 * of the groups (absorbUnassigned may then attach them to the region that
 * contains them), and protected regions are never discarded. Discard proposals still pass the assembler's local micro-blob
 * gate. Region refs are expanded to all their paths; validateStructuringMapping
 * then checks ids, nodes and double claims.
 *
 * Standalone module so it runs under node --test.
 * Used in: svgStructureService.vectorizeAndStructure.
 */

import type { StructuringMapping } from '../types';
import { validateStructuringMapping, type MappingIssues } from './svgMappingValidation.ts';

export const REGION_TOOL = 'restructure_regions';

export interface SplitRequest { region: string; entities: string[]; hint?: string }

export interface RegionAnswer {
    description?: string;
    groups?: Array<{ nodeId: string; label?: string; cssClass?: string; parentId?: string | null; regions?: string[] }>;
    protected?: string[];
    discardProposals?: Array<{ region: string; reason?: string }>;
    splitRequests?: SplitRequest[];
    unresolved?: string[];
}

export interface RegionDiagnostics extends MappingIssues {
    protectedRegions: string[];
    splitRequests: SplitRequest[];
    unresolved: string[];
}

export function buildRegionToolSchema(nodeIds: string[]) {
    const regionList = { type: 'array', items: { type: 'string' } };
    return {
        name: REGION_TOOL,
        description: 'Assign the numbered regions of a traced pictogram to its existing semantic nodes. Never author geometry.',
        input_schema: {
            type: 'object' as const,
            properties: {
                description: { type: 'string', description: 'Brief visual description of the pictogram (1-2 sentences).' },
                groups: {
                    type: 'array',
                    minItems: 1,
                    description: 'One entry per semantic node that is visible. Flat list; use parentId for hierarchy. A region belongs to at most one group.',
                    items: {
                        type: 'object',
                        properties: {
                            nodeId: { type: 'string', enum: nodeIds },
                            label: { type: 'string' },
                            cssClass: { type: 'string', description: 'Palette class matching the region colour.' },
                            parentId: { type: 'string', nullable: true, description: 'Parent nodeId, or null for top level.' },
                            regions: { ...regionList, description: 'Region ids (r<n>) or mark numbers whose visible area depicts this node.' },
                        },
                        required: ['nodeId', 'label', 'cssClass', 'regions'],
                    },
                },
                protected: { ...regionList, description: 'Regions that carry meaning and must never be removed, however small (eyes, fingers, arrows, pain marks).' },
                discardProposals: {
                    type: 'array',
                    description: 'Regions that look like tracing noise. A proposal only; the system decides locally.',
                    items: { type: 'object', properties: { region: { type: 'string' }, reason: { type: 'string' } }, required: ['region'] },
                },
                splitRequests: {
                    type: 'array',
                    description: 'A region that visibly contains several nodes (e.g. one black shape that is both a hand and a cup). Do not assign it to a group.',
                    items: {
                        type: 'object',
                        properties: {
                            region: { type: 'string' },
                            entities: { type: 'array', items: { type: 'string', enum: nodeIds }, minItems: 2 },
                            hint: { type: 'string', description: 'Where the boundary between them lies, in words.' },
                        },
                        required: ['region', 'entities'],
                    },
                },
                unresolved: { ...regionList, description: 'Regions whose node is unclear. Leave them here instead of guessing.' },
            },
            required: ['description', 'groups', 'protected', 'discardProposals', 'splitRequests', 'unresolved'],
        },
    };
}

/** Expand region refs (`r5` → `r5`, `r5_1`, `r5_a812`, …: everything after
 *  the first underscore is an island or an attached sliver of r5); other refs
 *  pass through for validateStructuringMapping to resolve or report. */
function expander(orderedPathIds: string[]) {
    const byRegion = new Map<string, string[]>();
    for (const id of orderedPathIds) {
        const region = id.replace(/_.*$/, '');
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region)!.push(id);
    }
    return (refs: unknown): string[] => (Array.isArray(refs) ? refs : [])
        .flatMap(ref => (typeof ref === 'string' && byRegion.has(ref.trim()) ? byRegion.get(ref.trim())! : [ref]));
}

export function regionAnswerToMapping(
    raw: unknown,
    orderedPathIds: string[],
    nodeIds: Set<string>,
    parentOf: Map<string, string | null> = new Map(),
): { mapping: StructuringMapping; diagnostics: RegionDiagnostics } {
    const a = (raw ?? {}) as RegionAnswer;
    const expand = expander(orderedPathIds);
    const splitRequests = Array.isArray(a.splitRequests) ? a.splitRequests.filter(s => s && typeof s.region === 'string') : [];
    const unresolved = Array.isArray(a.unresolved) ? a.unresolved.filter((r): r is string => typeof r === 'string') : [];
    const protectedRegions = Array.isArray(a.protected) ? a.protected.filter((r): r is string => typeof r === 'string') : [];

    // A region holding several nodes lies within their deepest common
    // ancestor (a node and its own descendants: that node; two siblings:
    // their parent), so it goes there. Only nodes with no common ancestor
    // (two top-level figures) leave it doubtful. The finer split stays
    // recorded as a diagnostic.
    const lineage = (id: string) => {
        const out = [id];
        for (let p = parentOf.get(id); p; p = parentOf.get(p)) out.push(p);
        return out;
    };
    const owners = new Map<string, string>();
    for (const sp of splitRequests) {
        const entities = (Array.isArray(sp.entities) ? sp.entities : []).filter(e => nodeIds.has(e));
        if (!entities.length) continue;
        const others = entities.slice(1).map(lineage);
        const owner = lineage(entities[0]).find(a => others.every(l => l.includes(a)));
        if (owner) owners.set(sp.region, owner);
    }

    // Doubtful regions stay unassigned: removed from every group.
    const doubtful = new Set(expand([...splitRequests.filter(sp => !owners.has(sp.region)).map(sp => sp.region), ...unresolved]));
    const keepOut = new Set([...doubtful, ...expand(protectedRegions)]);

    const groups = (Array.isArray(a.groups) ? a.groups : []).map(g => ({
        nodeId: g?.nodeId,
        label: g?.label ?? g?.nodeId,
        cssClass: g?.cssClass ?? '',
        parentId: g?.parentId ?? null,
        regions: [...(Array.isArray(g?.regions) ? g.regions : [])],
    }));
    for (const [region, owner] of owners) {
        let g = groups.find(x => x.nodeId === owner);
        if (!g) groups.push(g = { nodeId: owner, label: owner, cssClass: '', parentId: parentOf.get(owner) ?? null, regions: [] });
        g.regions.unshift(region); // first claim wins over a child group's
    }

    const draft = {
        description: a.description,
        groups: groups.map(({ regions, ...g }) => ({
            ...g,
            keep: expand(regions).filter(id => !doubtful.has(id as string)),
            selected: true,
            merge: null,
        })),
        discard: expand((Array.isArray(a.discardProposals) ? a.discardProposals : []).map(d => d?.region))
            .filter(id => !keepOut.has(id as string)),
    };
    const { mapping, issues } = validateStructuringMapping(draft, orderedPathIds, nodeIds);
    return { mapping, diagnostics: { ...issues, protectedRegions, splitRequests, unresolved } };
}

export interface RegionBox { regionId: number; bbox: [number, number, number, number] }

/**
 * In a mosaic partition nothing lies under a region: deleting one punches a
 * hole in the drawing. So no region is removed, and every path left outside
 * the groups (proposed as noise, unresolved, a split with no common
 * ancestor, or simply forgotten) is absorbed by the smallest assigned region
 * whose box contains its centre and is larger than its own (it follows that
 * group, like a sliver: an eye inside a head), or left unassigned when none
 * does.
 * ponytail: containment by bbox centre, not adjacency (same as slivers).
 */
export function absorbUnassigned(mapping: StructuringMapping, pathIds: string[], regionOf: (pathId: string) => RegionBox | undefined): { mapping: StructuringMapping; absorbed: number; unassigned: number } {
    const owners = mapping.groups.flatMap(g => g.keep.map(id => ({ group: g, box: regionOf(id) })))
        .filter((o): o is { group: StructuringMapping['groups'][number]; box: RegionBox } => !!o.box);
    const claimed = new Set(mapping.groups.flatMap(g => g.keep));
    let absorbed = 0, unassigned = 0;
    for (const id of pathIds) {
        if (claimed.has(id)) continue;
        const r = regionOf(id);
        let best: (typeof owners)[number] | null = null;
        if (r) {
            const cx = r.bbox[0] + r.bbox[2] / 2, cy = r.bbox[1] + r.bbox[3] / 2, own = r.bbox[2] * r.bbox[3];
            for (const o of owners) {
                const [x, y, w, h] = o.box.bbox;
                if (o.box.regionId === r.regionId || w * h <= own || cx < x || cx > x + w || cy < y || cy > y + h) continue;
                if (!best || w * h < best.box.bbox[2] * best.box.bbox[3]) best = o;
            }
        }
        if (best) { best.group.keep.push(id); absorbed++; } else unassigned++;
    }
    return { mapping: { ...mapping, discard: [] }, absorbed, unassigned };
}
