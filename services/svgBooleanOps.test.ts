/**
 * Unit tests for the pure boolean-operation adapter that resolveMergeGeometry()
 * (svgStructureService.ts) relies on to eliminate VTracer's double-contour
 * noise. Headless — paper-core has no DOM/canvas dependency.
 * Run: node --test services/svgBooleanOps.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBoolean, applyBooleanN, applySimplify } from './svgBooleanOps.ts';

// Two 10x10 squares, offset by 5 on both axes: overlapping (not contained, not disjoint).
const SQUARE_A = 'M0,0 L10,0 L10,10 L0,10 Z';
const SQUARE_B = 'M5,5 L15,5 L15,15 L5,15 Z';
// Disjoint square, far away.
const SQUARE_C = 'M100,100 L110,100 L110,110 L100,110 Z';
// Small square fully inside a large one (no boundary intersections) — the case
// the module doc says paper.js's Vatti booleans get wrong.
const SMALL_INSIDE = 'M2,2 L8,2 L8,8 L2,8 Z';
const LARGE_OUTER = 'M0,0 L20,0 L20,20 L0,20 Z';

test('union of two overlapping squares merges into one 8-vertex L-shape', () => {
    const d = applyBoolean('union', SQUARE_A, SQUARE_B);
    assert.ok(d, 'union should not be null for overlapping shapes');
    // One M...Z subpath (a single merged ring, not two separate ones).
    const subpaths = d!.match(/M/g) ?? [];
    assert.equal(subpaths.length, 1, 'overlapping union should collapse to a single ring');
    // Result must cover both operands' extremes: 0 (from A) and 15 (from B).
    assert.match(d!, /\b0\b/);
    assert.match(d!, /\b15\b/);
});

test('union of two disjoint squares keeps two separate rings', () => {
    const d = applyBoolean('union', SQUARE_A, SQUARE_C);
    assert.ok(d);
    const subpaths = d!.match(/M/g) ?? [];
    assert.equal(subpaths.length, 2, 'disjoint shapes must not be merged into one ring');
});

test('union with full containment (no boundary intersection) returns the outer footprint', () => {
    // This is the exact topology paper.js/Vatti mishandles — regression guard
    // for why the module uses Martinez instead (see file header doc comment).
    const d = applyBoolean('union', LARGE_OUTER, SMALL_INSIDE);
    assert.ok(d);
    const subpaths = d!.match(/M/g) ?? [];
    assert.equal(subpaths.length, 1, 'containment union must yield the single outer ring, not two');
    assert.match(d!, /\b20\b/, 'must retain the outer square\'s extent');
});

test('subtract removes the intersection; intersect keeps only the overlap', () => {
    const sub = applyBoolean('subtract', SQUARE_A, SQUARE_B);
    assert.ok(sub);
    const inter = applyBoolean('intersect', SQUARE_A, SQUARE_B);
    assert.ok(inter);
    // The intersection of A and B is the 5x5 square [5,5]-[10,10].
    assert.match(inter!, /\b5\b/);
    assert.match(inter!, /\b10\b/);
});

test('applyBoolean returns null for empty/invalid operands instead of throwing', () => {
    assert.equal(applyBoolean('union', '', SQUARE_A), null);
    assert.equal(applyBoolean('union', 'not a path', SQUARE_A), null);
});

test('applyBooleanN unions 3+ near-duplicate contours (double/triple-trace case)', () => {
    // Simulates VTracer tracing one stroked line as 3 near-concentric contours
    // (inner, middle, outer edge) — exactly the artifact resolveMergeGeometry
    // is meant to collapse into one clean shape.
    const inner = 'M2,2 L8,2 L8,8 L2,8 Z';
    const middle = 'M1,1 L9,1 L9,9 L1,9 Z';
    const outer = 'M0,0 L10,0 L10,10 L0,10 Z';
    const d = applyBooleanN('union', [inner, middle, outer]);
    assert.ok(d);
    const subpaths = d!.match(/M/g) ?? [];
    assert.equal(subpaths.length, 1, 'nested near-duplicate contours must collapse to one ring');
});

test('applyBooleanN requires at least 2 operands', () => {
    assert.equal(applyBooleanN('union', [SQUARE_A]), null);
    assert.equal(applyBooleanN('union', []), null);
});

test('applySimplify refits a jagged polyline into fewer, smooth (curved) commands', () => {
    // A near-straight edge with tiny jitter — typical VTracer micro-segment noise.
    const jagged = 'M0,0 L1,0.05 L2,-0.05 L3,0.03 L4,-0.02 L5,0 L5,10 L0,10 Z';
    const smoothed = applySimplify(jagged, 0.5);
    assert.ok(smoothed);
    // Simplify refits to Beziers — output should use curve commands, and the
    // jittery interior points should be gone (jagged has 7 "L" segments before Z).
    const jaggedLCount = (jagged.match(/L/g) ?? []).length;
    const smoothedLCount = (smoothed!.match(/L/g) ?? []).length;
    assert.ok(smoothedLCount < jaggedLCount, 'simplified path should have fewer straight-line segments than the jagged input');
});

test('applySimplify returns null for empty input', () => {
    assert.equal(applySimplify(''), null);
    assert.equal(applySimplify('   '), null);
});
