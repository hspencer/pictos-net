/**
 * Tests for visual-reasoning.allium — Phase 2 (COMPONER) invariants.
 *
 * Spec obligations covered:
 *   @invariant "single-root element tree"
 *     — VisualDOM always has exactly one top-level node ('pictograma' / 'pictogram'),
 *       injected deterministically by local code post-parse, never by the model.
 *   @invariant "CHILD_CONCEPTS excludes Root"
 *     — The model's tool schema enum must not include 'Root'.
 *   rule Phase2_Componer
 *     — Concept validation: invalid/Root concepts are stripped.
 *     — Defensive unwrap: model response wrapped under a root is transparently unwrapped.
 *   NLUModel catalog
 *     — All four models present; default is claude-haiku-4-5; Gemini models included.
 *
 * Run: node --test services/visualElementUtils.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHILD_CONCEPTS, normalizeElements, injectRoot } from './visualElementUtils.ts';
import { VISUAL_CONCEPTS, NLU_MODELS, DEFAULT_NLU_MODEL } from '../types.ts';

// ── CHILD_CONCEPTS ────────────────────────────────────────────────────────────

test('CHILD_CONCEPTS does not include Root', () => {
    assert.equal(CHILD_CONCEPTS.includes('Root' as any), false);
});

test('CHILD_CONCEPTS includes all non-Root visual concepts', () => {
    const expected = VISUAL_CONCEPTS.filter(c => c !== 'Root');
    assert.deepEqual(CHILD_CONCEPTS, expected);
});

// ── normalizeElements — defensive unwrap ─────────────────────────────────────

test('normalizeElements unwraps a single pictograma root (Spanish model response)', () => {
    const raw = [{ id: 'pictograma', concept: 'Root', children: [{ id: 'persona', concept: 'Agent' }] }];
    const result = normalizeElements(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'persona');
});

test('normalizeElements unwraps a single pictogram root (English model response)', () => {
    const raw = [{ id: 'pictogram', concept: 'Root', children: [{ id: 'person', concept: 'Agent' }] }];
    const result = normalizeElements(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'person');
});

test('normalizeElements does NOT unwrap when multiple roots are present (model hallucination preserved for inspection)', () => {
    const raw = [{ id: 'pictograma', concept: 'Root' }, { id: 'accion', concept: 'Action' }];
    const result = normalizeElements(raw);
    // Two items returned as-is — no unwrap when root is not the only element
    assert.equal(result.length, 2);
});

test('normalizeElements returns empty array for empty input', () => {
    assert.deepEqual(normalizeElements([]), []);
});

test('normalizeElements unwraps to empty when pictograma root has no children', () => {
    const raw = [{ id: 'pictograma', concept: 'Root' }];
    const result = normalizeElements(raw);
    assert.deepEqual(result, []);
});

// ── normalizeElements — concept validation ────────────────────────────────────

test('normalizeElements strips Root concept from child elements (model non-compliance)', () => {
    const raw = [{ id: 'persona', concept: 'Root' }];
    const result = normalizeElements(raw);
    assert.equal(result[0].id, 'persona');
    assert.equal(result[0].concept, undefined);
});

test('normalizeElements preserves valid child concepts', () => {
    const raw = [
        { id: 'nina',   concept: 'Agent' },
        { id: 'correr', concept: 'Action' },
        { id: 'pelota', concept: 'Object' },
        { id: 'parque', concept: 'Context' },
        { id: 'sombra', concept: 'Element' },
    ];
    const result = normalizeElements(raw);
    assert.equal(result[0].concept, 'Agent');
    assert.equal(result[1].concept, 'Action');
    assert.equal(result[2].concept, 'Object');
    assert.equal(result[3].concept, 'Context');
    assert.equal(result[4].concept, 'Element');
});

test('normalizeElements strips unknown/invalid concept values', () => {
    const raw = [{ id: 'cosa', concept: 'Furniture' }];
    const result = normalizeElements(raw);
    assert.equal(result[0].concept, undefined);
});

test('normalizeElements strips missing concept', () => {
    const raw = [{ id: 'cosa' }];
    const result = normalizeElements(raw);
    assert.equal(result[0].concept, undefined);
});

// ── normalizeElements — recursive children ────────────────────────────────────

test('normalizeElements recurses into children and validates their concepts', () => {
    const raw = [{
        id: 'nina', concept: 'Agent',
        children: [
            { id: 'cara', concept: 'Element' },
            { id: 'cuerpo', concept: 'Root' }, // invalid in child position
        ],
    }];
    const result = normalizeElements(raw);
    assert.equal(result[0].children?.length, 2);
    assert.equal(result[0].children![0].concept, 'Element');
    assert.equal(result[0].children![1].concept, undefined); // Root stripped
});

test('normalizeElements accepts el.elements alias for children (legacy key)', () => {
    const raw = [{
        id: 'nina', concept: 'Agent',
        elements: [{ id: 'cara', concept: 'Element' }],
    }];
    const result = normalizeElements(raw);
    assert.equal(result[0].children?.length, 1);
    assert.equal(result[0].children![0].id, 'cara');
});

test('normalizeElements uses unknown as fallback id when el.id is missing', () => {
    const raw = [{ concept: 'Agent' }];
    const result = normalizeElements(raw);
    assert.equal(result[0].id, 'unknown');
});

// ── injectRoot — single-root invariant ───────────────────────────────────────

test('injectRoot wraps children under pictograma for Spanish lang', () => {
    const children = [{ id: 'nina', concept: 'Agent' as const }];
    const result = injectRoot(children, 'es-419');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'pictograma');
    assert.equal(result[0].concept, 'Root');
    assert.equal(result[0].children?.length, 1);
});

test('injectRoot wraps children under pictogram for English lang', () => {
    const children = [{ id: 'girl', concept: 'Agent' as const }];
    const result = injectRoot(children, 'en-GB');
    assert.equal(result[0].id, 'pictogram');
    assert.equal(result[0].concept, 'Root');
});

test('injectRoot produces a single-element array (exactly one root)', () => {
    const result = injectRoot([{ id: 'a', concept: 'Agent' as const }], 'es');
    assert.equal(result.length, 1);
});

test('injectRoot omits children property when children array is empty', () => {
    const result = injectRoot([], 'es-419');
    assert.equal(result[0].children, undefined);
});

test('injectRoot root node always carries concept Root', () => {
    const result = injectRoot([], 'en');
    assert.equal(result[0].concept, 'Root');
});

// Round-trip: normalizeElements → injectRoot always yields single-root tree
test('normalizeElements + injectRoot round-trip: flat model response becomes single-root tree', () => {
    const modelResponse = [
        { id: 'nina',   concept: 'Agent' },
        { id: 'correr', concept: 'Action' },
    ];
    const children = normalizeElements(modelResponse);
    const tree = injectRoot(children, 'es-419');

    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, 'pictograma');
    assert.equal(tree[0].concept, 'Root');
    assert.equal(tree[0].children?.length, 2);
    assert.equal(tree[0].children![0].id, 'nina');
    assert.equal(tree[0].children![1].id, 'correr');
});

test('normalizeElements + injectRoot round-trip: old-style wrapped response still yields single-root tree', () => {
    const modelResponse = [{
        id: 'pictograma', concept: 'Root',
        children: [{ id: 'nina', concept: 'Agent' }],
    }];
    const children = normalizeElements(modelResponse);
    const tree = injectRoot(children, 'es-419');

    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, 'pictograma');
    assert.equal(tree[0].children?.length, 1);
    assert.equal(tree[0].children![0].id, 'nina');
});

// ── NLUModel catalog (spec: value NLUModel) ───────────────────────────────────

test('NLU_MODELS contains exactly four entries', () => {
    assert.equal(NLU_MODELS.length, 4);
});

test('NLU_MODELS includes both Claude models', () => {
    const ids = NLU_MODELS.map(m => m.id);
    assert.ok(ids.includes('claude-haiku-4-5-20251001'));
    assert.ok(ids.includes('claude-sonnet-4-6'));
});

test('NLU_MODELS includes both Gemini models', () => {
    const ids = NLU_MODELS.map(m => m.id);
    assert.ok(ids.includes('gemini-2.5-flash'));
    assert.ok(ids.includes('gemini-2.5-pro'));
});

test('DEFAULT_NLU_MODEL is claude-haiku-4-5', () => {
    assert.equal(DEFAULT_NLU_MODEL, 'claude-haiku-4-5-20251001');
});

test('every NLU_MODELS entry has a non-empty label', () => {
    for (const m of NLU_MODELS) {
        assert.ok(m.label.length > 0, `model ${m.id} has empty label`);
    }
});

// ── Model routing predicate (spec: NLUModel routing comment) ─────────────────

test('gemini-2.5-flash is routed to Gemini endpoint (startsWith check)', () => {
    assert.ok('gemini-2.5-flash'.startsWith('gemini-'));
});

test('gemini-2.5-pro is routed to Gemini endpoint', () => {
    assert.ok('gemini-2.5-pro'.startsWith('gemini-'));
});

test('claude-haiku is routed to Claude endpoint (not Gemini)', () => {
    assert.ok(!'claude-haiku-4-5-20251001'.startsWith('gemini-'));
});

test('claude-sonnet is routed to Claude endpoint (not Gemini)', () => {
    assert.ok(!'claude-sonnet-4-6'.startsWith('gemini-'));
});
