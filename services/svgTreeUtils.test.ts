/**
 * Unit tests for the orphaned-subtree detector used by assembleFromMapping()
 * to stop whole semantic elements (e.g. "cabeza" + its child "dolor") from
 * silently vanishing when a group's parentId is dangling.
 * Run: node --test services/svgTreeUtils.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnreachableNodeIds } from './svgTreeUtils.ts';

test('a healthy tree has no unreachable nodes', () => {
    const nodes = [
        { nodeId: 'actor', parentId: null },
        { nodeId: 'cabeza', parentId: 'actor' },
        { nodeId: 'dolor', parentId: 'cabeza' },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set());
});

test('a child whose parentId is missing entirely is unreachable', () => {
    // Reproduces the bug: "dolor" (pain bolt) has parentId "cabeza", but the
    // model never emitted a "cabeza" group — dolor would silently vanish.
    const nodes = [
        { nodeId: 'actor', parentId: null },
        { nodeId: 'dolor', parentId: 'cabeza' }, // "cabeza" does not exist
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set(['dolor']));
});

test('a multi-level broken chain marks every descendant unreachable', () => {
    const nodes = [
        { nodeId: 'actor', parentId: null },
        { nodeId: 'cabeza', parentId: 'missing' },
        { nodeId: 'dolor', parentId: 'cabeza' },
        { nodeId: 'rayo', parentId: 'dolor' },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set(['cabeza', 'dolor', 'rayo']));
});

test('parentId undefined and null both mean top-level', () => {
    const nodes = [
        { nodeId: 'a', parentId: undefined },
        { nodeId: 'b', parentId: null },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set());
});

test('a self-referencing cycle never reaches top-level and is unreachable', () => {
    const nodes = [
        { nodeId: 'a', parentId: 'a' },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set(['a']));
});

test('a mutual two-node cycle with no top-level root is fully unreachable', () => {
    const nodes = [
        { nodeId: 'a', parentId: 'b' },
        { nodeId: 'b', parentId: 'a' },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set(['a', 'b']));
});

test('siblings under the same valid parent are all reachable', () => {
    const nodes = [
        { nodeId: 'root', parentId: null },
        { nodeId: 'left', parentId: 'root' },
        { nodeId: 'right', parentId: 'root' },
    ];
    assert.deepEqual(findUnreachableNodeIds(nodes), new Set());
});

test('empty input returns an empty set', () => {
    assert.deepEqual(findUnreachableNodeIds([]), new Set());
});
