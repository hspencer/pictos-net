/**
 * svgMappingValidation — checks a provider's restructure_svg answer against
 * the frozen path inventory and composition tree before assembly
 * (svg-structuring.allium: MappingIsValidatedBeforeAssembly).
 *
 * Malformed shapes throw (no semantic repair). Recoverable problems become
 * issues: unknown path ids are dropped, a path claimed twice is kept only at
 * its first claim, and a group naming an unknown node is dropped so its paths
 * fall through to the unassigned fallback group. Mark numbers ("3", "mark 3")
 * resolve to the path at that mark, since the prompt labels paths by mark.
 *
 * Standalone module (type-only imports) so it runs under node --test.
 * Used in: svgStructureService.assembleFromMapping.
 */

import type { StructuringGroup, StructuringMapping } from '../types';

export interface MappingIssues {
    unknownPaths: string[];
    unknownNodes: string[];
    duplicatePaths: string[];
}

export function validateStructuringMapping(
    raw: unknown,
    orderedPathIds: string[],
    nodeIds: Set<string>,
): { mapping: StructuringMapping; issues: MappingIssues } {
    const m = raw as Partial<StructuringMapping> | null;
    if (!m || typeof m !== 'object' || !Array.isArray(m.groups) || m.groups.length === 0) throw new Error('Invalid mapping groups');

    const known = new Set(orderedPathIds);
    const issues: MappingIssues = { unknownPaths: [], unknownNodes: [], duplicatePaths: [] };
    const claimed = new Set<string>();

    const resolve = (ref: unknown): string | null => {
        if (typeof ref !== 'string') return null;
        const s = ref.trim();
        if (known.has(s)) return s;
        const mark = s.match(/^(?:mark\s*)?#?(\d+)$/i);
        if (mark && Number(mark[1]) < orderedPathIds.length) return orderedPathIds[Number(mark[1])];
        issues.unknownPaths.push(String(ref));
        return null;
    };
    // Resolve and claim; a path already claimed is reported and skipped.
    const claim = (refs: unknown): string[] => {
        const out: string[] = [];
        for (const ref of Array.isArray(refs) ? refs : []) {
            const id = resolve(ref);
            if (!id) continue;
            if (claimed.has(id)) { issues.duplicatePaths.push(id); continue; }
            claimed.add(id);
            out.push(id);
        }
        return out;
    };

    const seenNodes = new Set<string>();
    const groups: StructuringGroup[] = [];
    for (const g of m.groups) {
        if (!g || typeof g !== 'object' || typeof g.nodeId !== 'string' || !g.nodeId.trim() || seenNodes.has(g.nodeId)) throw new Error('Invalid mapping group ids');
        seenNodes.add(g.nodeId);
        if (!nodeIds.has(g.nodeId)) { issues.unknownNodes.push(g.nodeId); continue; }
        const sources = claim(g.merge?.sources);
        const keep = claim(g.keep);
        const merge = sources.length >= 2 ? { ...g.merge!, sources } : null;
        if (!merge) keep.push(...sources);
        groups.push({ ...g, keep, merge, parentId: g.parentId ?? null, selected: g.selected ?? true });
    }

    // A path both kept and discarded stays kept (preservation first).
    const discard = Array.from(new Set((Array.isArray(m.discard) ? m.discard : [])
        .map(ref => resolve(ref))
        .filter((id): id is string => !!id && !claimed.has(id))));

    return { mapping: { description: typeof m.description === 'string' ? m.description : '', groups, discard }, issues };
}
