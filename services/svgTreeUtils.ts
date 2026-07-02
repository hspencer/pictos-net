/**
 * Pure parent/child reachability helper for the ESTRUCTURAR assembly tree.
 *
 * assembleFromMapping() renders only what's reachable from top-level
 * (parentId === null) by walking parent→child edges. If the model proposes a
 * group whose parentId points to a nodeId it never emitted (or that was
 * discarded/deselected), that whole subtree is silently unreachable — visible
 * elements vanish from the output with no error, even though their own group
 * entries and paths are present. This is the fix for that class of bug.
 */

export interface TreeNode {
    nodeId: string;
    parentId?: string | null;
}

/**
 * Given a flat list of {nodeId, parentId} nodes, return the set of nodeIds
 * NOT reachable from any top-level node (parentId == null) by following
 * parent→child edges. A node is unreachable if its parentId points to a
 * nodeId absent from the list, or to a node that is itself unreachable
 * (broken chain at any depth) — including cycles, which never reach a
 * top-level root.
 */
export function findUnreachableNodeIds(nodes: TreeNode[]): Set<string> {
    const byParent = new Map<string | null, string[]>();
    for (const n of nodes) {
        const p = n.parentId ?? null;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p)!.push(n.nodeId);
    }

    const reachable = new Set<string>();
    const queue = [...(byParent.get(null) ?? [])];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (reachable.has(id)) continue; // guard against cycles
        reachable.add(id);
        queue.push(...(byParent.get(id) ?? []));
    }

    const all = new Set(nodes.map(n => n.nodeId));
    const unreachable = new Set<string>();
    for (const id of all) {
        if (!reachable.has(id)) unreachable.add(id);
    }
    return unreachable;
}
