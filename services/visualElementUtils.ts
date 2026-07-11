/**
 * Pure utilities for the Phase 2 (COMPONER) element tree.
 *
 * Extracted from claudeService.ts so they can be tested in Node without
 * pulling in aiClient → AuthGate → browser APIs.
 *
 * Spec: visual-reasoning.allium
 *   @invariant "single-root element tree" — VisualDOM always has exactly one
 *     top-level node ('pictograma' / 'pictogram'), injected deterministically
 *     post-parse, never delegated to the model.
 *   @invariant "single response delivers both artifacts" — consumers may
 *     verify that elements + prompt are always produced together.
 */

import type { VisualElement, VisualConcept } from '../types.ts';
import { VISUAL_CONCEPTS } from '../types.ts';

/** Concepts the model is allowed to assign. Root is excluded — it is injected
 *  locally and must never appear in the model's response. */
export const CHILD_CONCEPTS: VisualConcept[] = VISUAL_CONCEPTS.filter(c => c !== 'Root');

/**
 * Normalize child elements from the compose_pictogram tool response.
 *
 * - If the model mistakenly wrapped everything under a pictograma/pictogram
 *   root (old behaviour or cache miss), unwrap it transparently.
 * - Strip any 'Root' concept that leaks through (model non-compliance).
 * - Recurse into children.
 */
export function normalizeElements(raw: any[]): VisualElement[] {
    if (!Array.isArray(raw)) return [];
    // Defensive unwrap: model returned a single pictograma/pictogram root
    if (raw.length === 1 && (raw[0].id === 'pictograma' || raw[0].id === 'pictogram')) {
        const kids = raw[0].children || raw[0].elements;
        raw = Array.isArray(kids) ? kids : [];
    }
    return raw.map(el => {
        const node: VisualElement = { id: el.id || 'unknown' };
        if ((CHILD_CONCEPTS as string[]).includes(el.concept)) {
            node.concept = el.concept as VisualConcept;
        }
        const kids = el.children || el.elements;
        if (Array.isArray(kids) && kids.length > 0) {
            node.children = normalizeElements(kids);
        }
        return node;
    });
}

/**
 * Wrap normalized child elements under a deterministic pictogram root.
 *
 * Root id is language-dependent:
 *   - Spanish (lang starts with 'es') → 'pictograma'
 *   - All other languages              → 'pictogram'
 */
export function injectRoot(children: VisualElement[], lang: string): VisualElement[] {
    const rootId = lang.startsWith('es') ? 'pictograma' : 'pictogram';
    const root: VisualElement = {
        id: rootId,
        concept: 'Root',
        ...(children.length > 0 ? { children } : {}),
    };
    return [root];
}
