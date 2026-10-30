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
 * split-requested and unresolved regions are left unassigned (their geometry
 * survives in the unclassified draft group), and protected regions are never
 * discarded. Discard proposals still pass the assembler's local micro-blob
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
): { mapping: StructuringMapping; diagnostics: RegionDiagnostics } {
    const a = (raw ?? {}) as RegionAnswer;
    const expand = expander(orderedPathIds);
    const splitRequests = Array.isArray(a.splitRequests) ? a.splitRequests.filter(s => s && typeof s.region === 'string') : [];
    const unresolved = Array.isArray(a.unresolved) ? a.unresolved.filter((r): r is string => typeof r === 'string') : [];
    const protectedRegions = Array.isArray(a.protected) ? a.protected.filter((r): r is string => typeof r === 'string') : [];

    // Doubtful regions stay unassigned: removed from every group.
    const doubtful = new Set(expand([...splitRequests.map(s => s.region), ...unresolved]));
    const keepOut = new Set([...doubtful, ...expand(protectedRegions)]);

    const draft = {
        description: a.description,
        groups: (Array.isArray(a.groups) ? a.groups : []).map(g => ({
            nodeId: g?.nodeId,
            label: g?.label ?? g?.nodeId,
            cssClass: g?.cssClass ?? '',
            parentId: g?.parentId ?? null,
            keep: expand(g?.regions).filter(id => !doubtful.has(id as string)),
            selected: true,
            merge: null,
        })),
        discard: expand((Array.isArray(a.discardProposals) ? a.discardProposals : []).map(d => d?.region))
            .filter(id => !keepOut.has(id as string)),
    };
    const { mapping, issues } = validateStructuringMapping(draft, orderedPathIds, nodeIds);
    return { mapping, diagnostics: { ...issues, protectedRegions, splitRequests, unresolved } };
}
