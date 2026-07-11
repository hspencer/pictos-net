/**
 * Integration tests: Phase 1 (COMPRENDER) + Phase 2 (COMPONER) pipeline.
 *
 * Calls the local Netlify dev server via HTTP, bypassing the browser auth layer
 * (NETLIFY_DEV=true in dev mode skips JWT validation inside the functions).
 *
 * Requires:  npm run dev  →  http://localhost:9001
 * Run:       node --experimental-strip-types --test services/pipeline.integration.test.ts
 *
 * What is validated:
 *   Phase 1 — NLUData shape: required fields, frame structure, visual_guidelines
 *   Phase 2 — @invariant "single-root element tree": exactly one root node
 *   Phase 2 — every element (incl. nested) carries a valid CHILD_CONCEPT
 *   Phase 2 — spatial prompt is a non-empty string
 *   Round-trip — Phase 1 → Phase 2 chain for Spanish + English utterances
 *   api-gemini-nlu — conditional: skipped when Vertex credentials are absent
 *
 * Phase 3 (PRODUCIR) is excluded to avoid consuming Recraft/Gemini image credits.
 * Run it manually via the app UI after verifying Phases 1–2 pass here.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import type { NLUData, VisualElement, VisualConcept } from '../types.ts';
import { VOCAB_NSM, VOCAB, DEFAULT_NLU_MODEL } from '../types.ts';
import { CHILD_CONCEPTS, normalizeElements, injectRoot } from './visualElementUtils.ts';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:9001';
const CALL_TIMEOUT_MS = 45_000;

// ── Infrastructure ────────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
    try {
        await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(3000) });
        return true;
    } catch {
        return false;
    }
}

async function callFunction(fn: string, body: object): Promise<any> {
    const res = await fetch(`${BASE_URL}/.netlify/functions/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`[${fn}] HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

function extractToolUse(response: any, toolName: string): any {
    const block = response.content?.find((b: any) => b.type === 'tool_use' && b.name === toolName);
    if (!block) {
        throw new Error(
            `Model did not invoke '${toolName}' (stop_reason: ${response.stop_reason}). ` +
            `Content: ${JSON.stringify(response.content?.slice(0, 2))}`
        );
    }
    return block.input;
}

// ── Prompt builders (replicate claudeService.ts without browser deps) ─────────

function buildNSMBlock(lang: string): string {
    const isEs = lang.startsWith('es');
    const key = isEs ? 'es' : 'en';
    const entries = Object.entries(VOCAB_NSM) as [string, { en: string[]; es: string[] }][];
    return entries.map(([cat, primes]) => {
        const label = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `*   **${label}:** ${primes[key].join(', ')}`;
    }).join('\n');
}

function buildNluSystem(lang: string): string {
    const isEs = lang.startsWith('es');
    const explicLang = isEs
        ? 'Las explicaciones NSM (nsm_explications) deben estar escritas usando los primos en ESPAÑOL.'
        : 'The NSM explications (nsm_explications) must be written using the primes in ENGLISH.';
    const frameLabelLang = isEs
        ? 'Genera frame_label como traducción al español del frame_name.'
        : 'Generate frame_label as the English label for the frame_name.';

    return `Operas como el nodo "NLU Schema Engine" en la arquitectura PictoNet.
Tu tarea es analizar la intención comunicativa y devolver el resultado JSON vía la herramienta disponible.

Contexto de uso:
- Región geográfica: Latinoamérica
- Idioma del vocabulario: ${lang}

Ontología NSM (Goddard & Wierzbicka v19, 2017):
${buildNSMBlock(lang)}

${explicLang}
${frameLabelLang}

Dominio — infiere uno de: ${VOCAB.domain.join(', ')}

Reglas:
1. Invoca SIEMPRE la herramienta analyze_utterance con el JSON completo.
2. Analiza semántica y pragmática profunda, no solo la superficie.
3. Todos los campos requeridos deben estar presentes.`;
}

function buildVisualSystem(lang: string): string {
    const availableClasses = '.main, .secondary, .tertiary, .accent, .red, .green, .dashed, .glow, .anim-blink, .anim-beat, .anim-swing';
    return `You are the "Visual Topology Node" in the PictoNet graph.
Translate the semantic NLU graph into a list of visual child elements and a spatial prompt.

Language context: **${lang}**
— Element IDs and the prompt must be in **${lang}**.
— IDs: simple nouns in ${lang}, snake_case for compounds.
— Do NOT include a root pictograma/pictogram element — return only the semantic children.

Concept mapping (REQUIRED on every element, including nested children):
— Derive each element's \`concept\` from the NLU frame roles, never from the ID text:
  · Agent — fillers of Agent, Experiencer, Speaker or Addressee roles (the protagonist).
  · Action — the visual depiction of the lexical_unit / event itself (gesture, motion lines, arrows).
  · Object — fillers of Patient, Theme, Object, Instrument or Beneficiary roles.
  · Context — Location, Time, scenario or background elements.
  · Element — anything that does not map to a frame role.

Available CSS classes (optional suggestedClass hint only): ${availableClasses}

Prompt rules:
— Wrap every element ID in single quotes: 'persona', 'casa'.
— Describe only TOPOLOGY (relative position, size, connections). No style.
— 3–6 sentences maximum.

You MUST invoke the compose_pictogram tool with both \`elements\` and \`prompt\`.`;
}

// ── Schema definitions (mirrors claudeService.ts) ─────────────────────────────

const NLU_TOOL_SCHEMA = {
    type: 'object',
    properties: {
        utterance: { type: 'string' },
        lang: { type: 'string' },
        domain: { type: 'string' },
        metadata: {
            type: 'object',
            properties: { speech_act: { type: 'string' }, intent: { type: 'string' } },
            required: ['speech_act', 'intent'],
        },
        frames: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    frame_name: { type: 'string' },
                    frame_label: { type: 'string' },
                    lexical_unit: { type: 'string' },
                    roles: {
                        type: 'object',
                        minProperties: 1,
                        additionalProperties: {
                            type: 'object',
                            required: ['type'],
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['Agent', 'Addressee', 'Speaker', 'Experiencer', 'Patient',
                                        'Theme', 'Beneficiary', 'Instrument', 'Object',
                                        'Event', 'Location', 'Time', 'Other'],
                                },
                                surface: { type: 'string' },
                                lemma: { type: 'string' },
                            },
                        },
                    },
                },
                required: ['frame_name', 'lexical_unit', 'roles'],
            },
        },
        nsm_explications: { type: 'object', additionalProperties: { type: 'string' } },
        logical_form: {
            type: 'object',
            properties: { event: { type: 'string' }, modality: { type: 'string' } },
            required: ['event', 'modality'],
        },
        pragmatics: {
            type: 'object',
            properties: {
                politeness: { type: 'string' },
                formality: { type: 'string' },
                expected_response: { type: 'string' },
            },
            required: ['politeness', 'formality', 'expected_response'],
        },
        visual_guidelines: {
            type: 'object',
            properties: {
                focus_actor: { type: 'string' },
                action_core: { type: 'string' },
                object_core: { type: 'string' },
                context: { type: 'string' },
                temporal: { type: 'string' },
            },
            required: ['focus_actor', 'action_core', 'object_core', 'context', 'temporal'],
        },
    },
    required: ['utterance', 'lang', 'metadata', 'frames', 'nsm_explications', 'logical_form', 'pragmatics', 'visual_guidelines'],
};

const COMPOSE_TOOL_SCHEMA = {
    type: 'object',
    properties: {
        elements: {
            type: 'array',
            description: 'Semantic child elements. Do NOT include a root pictograma/pictogram node.',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    concept: { type: 'string', enum: CHILD_CONCEPTS },
                    children: { type: 'array', items: { type: 'object' } },
                },
                required: ['id', 'concept'],
            },
        },
        prompt: { type: 'string' },
    },
    required: ['elements', 'prompt'],
};

// ── Pipeline helpers ──────────────────────────────────────────────────────────

async function runPhase1(utterance: string, lang = 'es-419', model = DEFAULT_NLU_MODEL): Promise<NLUData> {
    const response = await callFunction('api-claude', {
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: buildNluSystem(lang), cache_control: { type: 'ephemeral' } }],
        tools: [{
            name: 'analyze_utterance',
            description: 'Return the NLU semantic analysis of the communicative intention.',
            input_schema: NLU_TOOL_SCHEMA,
            cache_control: { type: 'ephemeral' },
        }],
        tool_choice: { type: 'tool', name: 'analyze_utterance' },
        messages: [{ role: 'user', content: `UTTERANCE: "${utterance}"` }],
    });
    return extractToolUse(response, 'analyze_utterance') as NLUData;
}

async function runPhase2(nlu: NLUData, lang: string, model = DEFAULT_NLU_MODEL): Promise<{ elements: VisualElement[]; prompt: string }> {
    const response = await callFunction('api-claude', {
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: buildVisualSystem(lang), cache_control: { type: 'ephemeral' } }],
        tools: [{
            name: 'compose_pictogram',
            description: 'Return the visual DOM (elements hierarchy) and the spatial prompt.',
            input_schema: COMPOSE_TOOL_SCHEMA,
            cache_control: { type: 'ephemeral' },
        }],
        tool_choice: { type: 'tool', name: 'compose_pictogram' },
        messages: [{ role: 'user', content: `NLU Semantics: ${JSON.stringify(nlu)}` }],
    });
    const raw = extractToolUse(response, 'compose_pictogram');
    const children = normalizeElements(raw.elements ?? []);
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
    const elements = injectRoot(children, lang);
    return { elements, prompt };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

function assertNluShape(nlu: NLUData, label: string) {
    assert.ok(typeof nlu.utterance === 'string' && nlu.utterance.length > 0, `${label}: utterance missing`);
    assert.ok(typeof nlu.lang === 'string' && nlu.lang.length > 0, `${label}: lang missing`);
    assert.ok(nlu.metadata?.speech_act, `${label}: metadata.speech_act missing`);
    assert.ok(nlu.metadata?.intent, `${label}: metadata.intent missing`);
    assert.ok(Array.isArray(nlu.frames) && nlu.frames.length > 0, `${label}: frames empty`);
    for (const frame of nlu.frames) {
        assert.ok(frame.frame_name, `${label}: frame_name missing`);
        assert.ok(frame.lexical_unit, `${label}: lexical_unit missing`);
        assert.ok(frame.roles && Object.keys(frame.roles).length > 0, `${label}: frame has no roles`);
    }
    assert.ok(nlu.visual_guidelines?.focus_actor !== undefined, `${label}: visual_guidelines.focus_actor missing`);
    assert.ok(nlu.visual_guidelines?.action_core !== undefined, `${label}: visual_guidelines.action_core missing`);
    assert.ok(nlu.logical_form?.event, `${label}: logical_form.event missing`);
    assert.ok(nlu.pragmatics?.politeness, `${label}: pragmatics.politeness missing`);
}

function assertElementsRecursive(els: VisualElement[], allowRoot: boolean, path: string) {
    for (const el of els) {
        const here = `${path}/${el.id}`;
        assert.ok(typeof el.id === 'string' && el.id.length > 0, `${here}: id must be a non-empty string`);
        if (allowRoot && el.concept === 'Root') {
            // root node — concept validated by injectRoot, children validated below
        } else {
            assert.ok(
                el.concept !== undefined && (CHILD_CONCEPTS as string[]).includes(el.concept as string),
                `${here}: concept '${el.concept}' is not a valid CHILD_CONCEPT`
            );
        }
        if (el.children?.length) {
            assertElementsRecursive(el.children, false, here);
        }
    }
}

function assertSingleRootTree(elements: VisualElement[], lang: string, label: string) {
    // @invariant "single-root element tree"
    assert.equal(elements.length, 1, `${label}: tree must have exactly one root, got ${elements.length}`);
    const root = elements[0];
    const expectedRootId = lang.startsWith('es') ? 'pictograma' : 'pictogram';
    assert.equal(root.id, expectedRootId, `${label}: root id must be '${expectedRootId}', got '${root.id}'`);
    assert.equal(root.concept, 'Root', `${label}: root concept must be 'Root', got '${root.concept}'`);
    if (root.children) {
        assertElementsRecursive(root.children, false, `${label}/${root.id}`);
    }
}

// ── Test cases ────────────────────────────────────────────────────────────────

const UTTERANCES: Array<{ text: string; lang: string; description: string }> = [
    { text: 'la niña come una manzana',  lang: 'es-419', description: 'SVO simple en español' },
    { text: 'quiero ir al baño',          lang: 'es-419', description: 'deseo + movimiento' },
    { text: 'the boy kicks the ball',     lang: 'en-GB',  description: 'SVO simple in English' },
];

let serverAvailable = false;

before(async () => {
    serverAvailable = await isServerUp();
    if (!serverAvailable) {
        console.warn('\n⚠  netlify dev not running on port 9001 — all integration tests will be skipped.\n   Run: npm run dev\n');
    }
});

// ── Phase 1 + Phase 2 round-trip ─────────────────────────────────────────────

for (const { text, lang, description } of UTTERANCES) {
    test(`[pipeline] ${description} — Phase 1 → Phase 2`, { timeout: CALL_TIMEOUT_MS * 2 }, async (t) => {
        if (!serverAvailable) {
            t.skip('netlify dev not running');
            return;
        }

        // ── Phase 1: COMPRENDER ──
        const nlu = await runPhase1(text, lang);
        assertNluShape(nlu, `Phase1(${text})`);
        assert.equal(
            nlu.utterance.toLowerCase().includes(text.toLowerCase().split(' ')[0]),
            true,
            `Phase1: utterance field should reflect the input`
        );

        // ── Phase 2: COMPONER ──
        const { elements, prompt } = await runPhase2(nlu, lang);

        // @invariant "single-root element tree"
        assertSingleRootTree(elements, lang, `Phase2(${text})`);

        // Prompt must be a non-empty string
        assert.ok(typeof prompt === 'string' && prompt.trim().length > 0,
            `Phase2(${text}): prompt must be a non-empty string, got: ${JSON.stringify(prompt)}`);

        // At least one child element
        const root = elements[0];
        assert.ok(
            root.children && root.children.length > 0,
            `Phase2(${text}): root should have at least one child element`
        );

        console.log(`  ✓ ${text}`);
        console.log(`    intent: ${nlu.metadata?.intent}`);
        console.log(`    focus_actor: ${nlu.visual_guidelines?.focus_actor}`);
        console.log(`    elements: ${root.children?.map(c => `${c.id}[${c.concept}]`).join(', ')}`);
        console.log(`    prompt: ${prompt.substring(0, 100)}…`);
    });
}

// ── Model does NOT include root in its response ───────────────────────────────

test('[pipeline] Phase 2: model response never leaks a root element (defensive unwrap)', { timeout: CALL_TIMEOUT_MS * 2 }, async (t) => {
    if (!serverAvailable) {
        t.skip('netlify dev not running');
        return;
    }
    // Use a well-known utterance and check that normalizeElements handled any
    // model-wrapped root correctly — the final tree must still have exactly one root.
    const nlu = await runPhase1('el niño lee un libro', 'es-419');
    const { elements } = await runPhase2(nlu, 'es-419');

    assertSingleRootTree(elements, 'es-419', 'defensive-unwrap test');

    // The root itself must never appear in the children list
    const allIds = (function collectIds(els: VisualElement[]): string[] {
        return els.flatMap(e => [e.id, ...(e.children ? collectIds(e.children) : [])]);
    })(elements[0].children ?? []);

    assert.ok(!allIds.includes('pictograma'), 'children must not contain a pictograma node');
    assert.ok(!allIds.includes('pictogram'), 'children must not contain a pictogram node');
});

// ── api-gemini-nlu (conditional) ──────────────────────────────────────────────

test('[pipeline] api-gemini-nlu: Phase 1 via Gemini 2.5 Flash', { timeout: CALL_TIMEOUT_MS }, async (t) => {
    if (!serverAvailable) {
        t.skip('netlify dev not running');
        return;
    }
    const utterance = 'la niña come una manzana';
    const lang = 'es-419';
    const model = 'gemini-2.5-flash';

    let response: any;
    try {
        response = await callFunction('api-gemini-nlu', {
            model,
            max_tokens: 4096,
            system: [{ type: 'text', text: buildNluSystem(lang), cache_control: { type: 'ephemeral' } }],
            tools: [{
                name: 'analyze_utterance',
                description: 'Return the NLU semantic analysis of the communicative intention.',
                input_schema: NLU_TOOL_SCHEMA,
                cache_control: { type: 'ephemeral' },
            }],
            tool_choice: { type: 'tool', name: 'analyze_utterance' },
            messages: [{ role: 'user', content: `UTTERANCE: "${utterance}"` }],
        });
    } catch (err: any) {
        if (err.message?.includes('credentials') || err.message?.includes('401') || err.message?.includes('403')) {
            t.skip('Vertex AI credentials not available in dev environment');
            return;
        }
        throw err;
    }

    const nlu = extractToolUse(response, 'analyze_utterance') as NLUData;

    // Gemini NLU shape: same required fields as Claude, but frame.roles may be
    // sparse — Gemini serialises additionalProperties maps differently, so we
    // only assert the frame array exists and has the structural wrapper.
    assert.ok(typeof nlu.utterance === 'string', 'GeminiNlu: utterance missing');
    assert.ok(Array.isArray(nlu.frames) && nlu.frames.length > 0, 'GeminiNlu: frames empty');
    for (const frame of nlu.frames) {
      assert.ok(frame.frame_name, 'GeminiNlu: frame_name missing');
      assert.ok(frame.lexical_unit, 'GeminiNlu: lexical_unit missing');
      assert.ok(frame.roles !== null && typeof frame.roles === 'object', 'GeminiNlu: roles must be an object (may be empty)');
    }
    assert.ok(nlu.visual_guidelines?.focus_actor !== undefined, 'GeminiNlu: visual_guidelines missing');
    assert.ok(nlu.metadata?.intent, 'GeminiNlu: metadata.intent missing');

    console.log(`  ✓ Gemini NLU intent: ${nlu.metadata?.intent}`);
});
