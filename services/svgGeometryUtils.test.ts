/**
 * Unit tests for the micro-blob heuristic that stops assembleFromMapping()
 * from trusting a model's `discard` list for paths that are actually visible,
 * real content (e.g. the "Me duele la cabeza" pain-indicator bolt).
 * Run: node --test services/svgGeometryUtils.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBBoxFromPathD, bboxArea, isMicroBlob, DEFAULT_MICRO_BLOB_RATIO } from './svgGeometryUtils.ts';

const VIEWBOX_1024 = 1024 * 1024; // 1,048,576 sq px, the common pictogram canvas

test('parseBBoxFromPathD reads min/max from a simple rectangle path', () => {
    const box = parseBBoxFromPathD('M10,20 L110,20 L110,120 L10,120 Z');
    assert.deepEqual(box, { minX: 10, minY: 20, maxX: 110, maxY: 120 });
});

test('parseBBoxFromPathD handles negative coordinates', () => {
    const box = parseBBoxFromPathD('M-5,-5 L5,5');
    assert.deepEqual(box, { minX: -5, minY: -5, maxX: 5, maxY: 5 });
});

test('parseBBoxFromPathD returns null for a d-string with no numbers', () => {
    assert.equal(parseBBoxFromPathD('M L Z'), null);
});

test('parseBBoxFromPathD returns null for empty input', () => {
    assert.equal(parseBBoxFromPathD(''), null);
});

test('bboxArea computes width * height', () => {
    assert.equal(bboxArea({ minX: 0, minY: 0, maxX: 10, maxY: 5 }), 50);
});

test('bboxArea never goes negative for a degenerate (inverted) box', () => {
    assert.equal(bboxArea({ minX: 10, minY: 10, maxX: 0, maxY: 0 }), 0);
});

test('a few-pixel JPEG artifact on a 1024x1024 canvas is a micro-blob', () => {
    // ~5x5px fragment — the kind of trace noise the prompt means to allow.
    const d = 'M500,500 L505,500 L505,505 L500,505 Z';
    assert.equal(isMicroBlob(d, VIEWBOX_1024), true);
});

test('a small but real icon (pain-indicator bolt scale) is NOT a micro-blob', () => {
    // Reproduces the bug: a ~70x90px pain-bolt icon on a 1024x1024 canvas
    // must never be silently trusted as noise.
    const d = 'M500,300 L570,300 L570,390 L500,390 Z';
    assert.equal(isMicroBlob(d, VIEWBOX_1024), false);
});

test('a large shape (e.g. most of the figure) is never a micro-blob', () => {
    const d = 'M0,0 L1000,0 L1000,1000 L0,1000 Z';
    assert.equal(isMicroBlob(d, VIEWBOX_1024), false);
});

test('an unparsable path is distrusted (not treated as a micro-blob)', () => {
    assert.equal(isMicroBlob('', VIEWBOX_1024), false);
    assert.equal(isMicroBlob('M L Z', VIEWBOX_1024), false);
});

test('a zero or missing viewBox area is distrusted (not treated as a micro-blob)', () => {
    assert.equal(isMicroBlob('M0,0 L1,1', 0), false);
});

test('threshold boundary: just under the ratio is a micro-blob, just over is not', () => {
    const target = VIEWBOX_1024 * DEFAULT_MICRO_BLOB_RATIO;
    const side = Math.sqrt(target);
    const justUnder = `M0,0 L${side * 0.9},0 L${side * 0.9},${side * 0.9} L0,${side * 0.9} Z`;
    const justOver = `M0,0 L${side * 1.5},0 L${side * 1.5},${side * 1.5} L0,${side * 1.5} Z`;
    assert.equal(isMicroBlob(justUnder, VIEWBOX_1024), true);
    assert.equal(isMicroBlob(justOver, VIEWBOX_1024), false);
});
