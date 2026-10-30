/**
 * Tests for the region contract (regionMapping).
 * Run with: npm test (node --test with type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absorbDiscards, buildRegionToolSchema, regionAnswerToMapping } from './regionMapping.ts';

const PATHS = ['r1', 'r2', 'r2_1', 'r2_a7', 'r3', 'r4'];
const NODES = new Set(['persona', 'mano', 'vaso']);
const answer = (extra: Record<string, unknown> = {}) => ({
    description: 'd',
    groups: [{ nodeId: 'persona', label: 'p', cssClass: 'k', regions: ['r1', 'r2'] }],
    protected: [], discardProposals: [], splitRequests: [], unresolved: [],
    ...extra,
});

test('a region ref expands to its islands and attached slivers', () => {
    const { mapping } = regionAnswerToMapping(answer(), PATHS, NODES);
    assert.deepEqual(mapping.groups[0].keep, ['r1', 'r2', 'r2_1', 'r2_a7']);
});

test('split-requested and unresolved regions are left unassigned', () => {
    const { mapping, diagnostics } = regionAnswerToMapping(answer({
        groups: [{ nodeId: 'mano', label: 'm', cssClass: 'k', regions: ['r1', 'r2', 'r3'] }],
        splitRequests: [{ region: 'r2', entities: ['mano', 'vaso'], hint: 'el vaso está en la mano' }],
        unresolved: ['r3'],
    }), PATHS, NODES);
    assert.deepEqual(mapping.groups[0].keep, ['r1']);
    assert.equal(diagnostics.splitRequests.length, 1);
    assert.deepEqual(diagnostics.unresolved, ['r3']);
});

test('a protected region is never discarded', () => {
    const { mapping } = regionAnswerToMapping(answer({
        protected: ['r4'],
        discardProposals: [{ region: 'r4', reason: 'tiny' }, { region: 'r3', reason: 'speck' }],
    }), PATHS, NODES);
    assert.deepEqual(mapping.discard, ['r3']);
});

test('ids, nodes and double claims go through the shared validation', () => {
    const { mapping, diagnostics } = regionAnswerToMapping(answer({
        groups: [
            { nodeId: 'persona', label: 'p', cssClass: 'k', regions: ['r1', 'r9'] },
            { nodeId: 'vaso', label: 'v', cssClass: 'k', regions: ['r1', '4'] },
            { nodeId: 'gato', label: 'g', cssClass: 'k', regions: ['r4'] },
        ],
    }), PATHS, NODES);
    assert.deepEqual(mapping.groups.map(g => [g.nodeId, g.keep]), [['persona', ['r1']], ['vaso', ['r3']]]);
    assert.deepEqual(diagnostics.unknownPaths, ['r9']);
    assert.deepEqual(diagnostics.duplicatePaths, ['r1']);
    assert.deepEqual(diagnostics.unknownNodes, ['gato']);
});

test('the schema only offers existing nodes', () => {
    const schema = buildRegionToolSchema(['persona', 'vaso']);
    assert.equal(schema.name, 'restructure_regions');
    assert.deepEqual(schema.input_schema.properties.groups.items.properties.nodeId.enum, ['persona', 'vaso']);
});

test('a split between a node and its descendant goes to the ancestor', () => {
    const parents = new Map<string, string | null>([['persona', null], ['mano', 'persona'], ['vaso', null]]);
    const { mapping, diagnostics } = regionAnswerToMapping(answer({
        groups: [{ nodeId: 'mano', label: 'm', cssClass: 'k', regions: ['r3'] }],
        splitRequests: [{ region: 'r2', entities: ['mano', 'persona'] }, { region: 'r4', entities: ['mano', 'vaso'] }],
    }), PATHS, NODES, parents);
    assert.deepEqual(mapping.groups.find(g => g.nodeId === 'persona')?.keep, ['r2', 'r2_1', 'r2_a7']);
    assert.ok(!mapping.groups.some(g => g.keep.includes('r4')), 'siblings stay unresolved');
    assert.equal(diagnostics.splitRequests.length, 2, 'both splits stay recorded');
});

test('a proposed discard is absorbed by the region containing it, never removed', () => {
    const boxes: Record<string, [number, number, number, number]> = { r1: [0, 0, 100, 100], r2: [10, 10, 20, 20], r3: [40, 40, 5, 5], r4: [500, 500, 5, 5] };
    const regionOf = (id: string) => boxes[id.replace(/_.*$/, '')] && { regionId: Number(id.replace(/_.*$/, '').slice(1)), bbox: boxes[id.replace(/_.*$/, '')] };
    const mapping = { description: '', discard: ['r3', 'r4'], groups: [
        { nodeId: 'persona', label: 'p', cssClass: 'k', keep: ['r1'], selected: true, merge: null, parentId: null },
        { nodeId: 'mano', label: 'm', cssClass: 'k', keep: ['r2'], selected: true, merge: null, parentId: 'persona' },
    ] };
    const { mapping: out, absorbed } = absorbDiscards(mapping, regionOf);
    assert.deepEqual(out.discard, []);
    assert.deepEqual(out.groups[0].keep, ['r1', 'r3'], 'r3 lies inside r1 only');
    assert.equal(absorbed, 1, 'r4 is contained by no assigned region: left unassigned');
});
