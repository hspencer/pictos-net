/**
 * Tests for validateStructuringMapping (svgMappingValidation).
 * Run with: npm test (node --test with type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStructuringMapping } from './svgMappingValidation.ts';

const PATHS = ['p0', 'p1', 'p2', 'p3'];
const NODES = new Set(['persona', 'vaso']);
const group = (nodeId: string, keep: string[], extra: Record<string, unknown> = {}) => ({ nodeId, label: nodeId, cssClass: 'k', keep, ...extra });

test('unknown path ids are reported and dropped', () => {
    const { mapping, issues } = validateStructuringMapping({ groups: [group('persona', ['p0', 'zz'])], discard: [] }, PATHS, NODES);
    assert.deepEqual(mapping.groups[0].keep, ['p0']);
    assert.deepEqual(issues.unknownPaths, ['zz']);
});

test('a path claimed twice is kept once, at its first claim', () => {
    const { mapping, issues } = validateStructuringMapping({ groups: [group('persona', ['p0', 'p1']), group('vaso', ['p1', 'p2'])], discard: [] }, PATHS, NODES);
    assert.deepEqual(mapping.groups[0].keep, ['p0', 'p1']);
    assert.deepEqual(mapping.groups[1].keep, ['p2']);
    assert.deepEqual(issues.duplicatePaths, ['p1']);
});

test('a group naming an unknown node is dropped so its paths stay unassigned', () => {
    const { mapping, issues } = validateStructuringMapping({ groups: [group('persona', ['p0']), group('inventado', ['p1'])], discard: [] }, PATHS, NODES);
    assert.deepEqual(mapping.groups.map(g => g.nodeId), ['persona']);
    assert.deepEqual(issues.unknownNodes, ['inventado']);
});

test('mark numbers resolve to the path at that mark', () => {
    const { mapping } = validateStructuringMapping({ groups: [group('persona', ['2', 'mark 3'])], discard: ['#1'] }, PATHS, NODES);
    assert.deepEqual(mapping.groups[0].keep, ['p2', 'p3']);
    assert.deepEqual(mapping.discard, ['p1']);
});

test('a kept path is never also discarded', () => {
    const { mapping } = validateStructuringMapping({ groups: [group('persona', ['p0'])], discard: ['p0', 'p1', 'p1'] }, PATHS, NODES);
    assert.deepEqual(mapping.discard, ['p1']);
});

test('a merge left with fewer than two valid sources becomes plain keeps', () => {
    const { mapping } = validateStructuringMapping({ groups: [group('persona', ['p0'], { merge: { sources: ['p1', 'ghost'] } })], discard: [] }, PATHS, NODES);
    assert.equal(mapping.groups[0].merge, null);
    assert.deepEqual(mapping.groups[0].keep, ['p0', 'p1']);
});

test('malformed responses throw instead of being repaired', () => {
    assert.throws(() => validateStructuringMapping({ groups: [] }, PATHS, NODES));
    assert.throws(() => validateStructuringMapping(null, PATHS, NODES));
    assert.throws(() => validateStructuringMapping({ groups: [group('persona', []), group('persona', [])] }, PATHS, NODES));
});
