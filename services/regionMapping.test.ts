/**
 * Tests for the region contract (regionMapping).
 * Run with: npm test (node --test with type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionToolSchema, regionAnswerToMapping } from './regionMapping.ts';

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
