/**
 * Tests for svgPathPolish — polyline-heavy detection and coordinate rounding
 * used by the deterministic geometry polish of Phase 4 ESTRUCTURAR.
 * Run with: npm test (node --test with type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePathD, shouldSimplify, roundPathD } from './svgPathPolish.ts';

test('analyzePathD counts line and curve commands', () => {
    const stats = analyzePathD('M0 0L1 1L2 2C3 3 4 4 5 5A1 1 0 0 1 6 6Z');
    assert.equal(stats.lineCmds, 2);
    assert.equal(stats.curveCmds, 2);
    assert.equal(stats.total, 6); // M, 2×L, C, A, Z
});

test('a smooth Bezier path is NOT flagged for simplification', () => {
    const d = 'M0 0' + 'C1 1 2 2 3 3'.repeat(40) + 'Z';
    assert.equal(shouldSimplify(d), false);
});

test('a polyline-heavy path IS flagged for simplification', () => {
    const d = 'M0 0' + Array.from({ length: 40 }, (_, i) => `L${i} ${i}`).join('') + 'Z';
    assert.equal(shouldSimplify(d), true);
});

test('short paths are never flagged, even if all lines', () => {
    assert.equal(shouldSimplify('M0 0L1 1L2 2L3 3Z'), false);
});

test('mixed path below the line ratio is preserved', () => {
    // 12 lines / 20 curves → ratio 0.375 < 0.6
    const d = 'M0 0' + 'L1 1'.repeat(12) + 'C1 1 2 2 3 3'.repeat(20) + 'Z';
    assert.equal(shouldSimplify(d), false);
});

test('roundPathD rounds to the requested precision', () => {
    assert.equal(roundPathD('M10.6789 20.1234L30.5555 40.4444', 1), 'M10.7 20.1L30.6 40.4');
    assert.equal(roundPathD('M10.6789 20.1234', 2), 'M10.68 20.12');
});

test('roundPathD preserves arc flags and negative numbers', () => {
    const d = 'M0 0A10.123 10.987 0 0 1 -20.456 30.789Z';
    assert.equal(roundPathD(d, 1), 'M0 0A10.1 11 0 0 1 -20.5 30.8Z');
});

test('roundPathD handles exponent notation and relative commands', () => {
    assert.equal(roundPathD('m1.05e1 2.04999l-1.44 2.06', 1), 'm10.5 2l-1.4 2.1');
});

test('roundPathD is idempotent', () => {
    const once = roundPathD('M10.6789 20.1234C1.111 2.222 3.333 4.444 5.555 6.666', 1);
    assert.equal(roundPathD(once, 1), once);
});
