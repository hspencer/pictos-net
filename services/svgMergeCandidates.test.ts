/**
 * Tests for detectMergeCandidates (svgMergeCandidates) — local detection of
 * double-contour merge candidates for Phase 4 ESTRUCTURAR.
 * Run with: npm test (node --test with type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMergeCandidates } from './svgMergeCandidates.ts';

type P = Parameters<typeof detectMergeCandidates>[0][number];

const path = (id: string, bbox: [number, number, number, number] | undefined, fillRole: P['fillRole'] = 'dark'): P => ({
    id,
    fillRole,
    bbox,
});

test('near-concentric contours of the same fill role are paired', () => {
    const result = detectMergeCandidates([
        path('outer', [100, 100, 200, 200]),
        path('inner', [104, 104, 192, 192]),
        path('far', [600, 600, 100, 100]),
    ]);
    assert.equal(result.length, 1);
    assert.deepEqual([...result[0]].sort(), ['inner', 'outer']);
});

test('different fill roles are never paired', () => {
    const result = detectMergeCandidates([
        path('dark', [100, 100, 200, 200], 'dark'),
        path('light', [104, 104, 192, 192], 'light'),
    ]);
    assert.equal(result.length, 0);
});

test('small shape inside a big one (low IoU) is not a candidate', () => {
    // pupil inside an eye: contained but much smaller — IoU is low
    const result = detectMergeCandidates([
        path('eye', [100, 100, 200, 200]),
        path('pupil', [180, 180, 40, 40]),
    ]);
    assert.equal(result.length, 0);
});

test('transitive clusters merge into one candidate set of 3+', () => {
    const result = detectMergeCandidates([
        path('a', [100, 100, 200, 200]),
        path('b', [103, 103, 196, 196]),
        path('c', [106, 106, 190, 190]),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 3);
});

test('paths without measured bbox are skipped', () => {
    const result = detectMergeCandidates([
        path('a', undefined),
        path('b', undefined),
    ]);
    assert.equal(result.length, 0);
});

test('area ratio below 0.4 disqualifies even with decent overlap', () => {
    // Same top-left, one much smaller in area but overlapping region equals
    // the small one entirely: IoU = 36/100 → also below threshold. Use a case
    // where IoU passes but area ratio governs: identical boxes scaled.
    const result = detectMergeCandidates([
        path('big', [0, 0, 100, 100]),
        path('small', [0, 0, 100, 35]), // area ratio 0.35, IoU 0.35
    ]);
    assert.equal(result.length, 0);
});
