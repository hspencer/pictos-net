import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertValidSVG } from '../schemas/pictos-svg-schema/index.js';
import { certifyDraft, draftIssues, ensureDraftGroups } from './svgDraftCertification.ts';
import { prepareSvgPromotion } from './svgCanonical.ts';
import type { RowData } from '../types';

const certified = fs.readFileSync(new URL('../schemas/pictos-svg-schema/examples/v2example.svg', import.meta.url), 'utf8');
const metadata = assertValidSVG(certified);
const row = (): RowData => ({ id: 'r', UTTERANCE: metadata.nlu.utterance, NLU: structuredClone(metadata.nlu), ...structuredClone(metadata.composition),
    rawSvg: '<svg/>', status: 'idle', nluStatus: 'completed', visualStatus: 'completed', bitmapStatus: 'completed' });
// A draft as ESTRUCTURAR saves it: same groups, non-canonical metadata block without bindings.
const asDraft = (svg: string) => svg.replace(/<metadata id="mf-accessibility">[\s\S]*?<\/metadata>/,
    `<metadata id="pictonet-draft"><![CDATA[${JSON.stringify({ status: 'draft', provenance: { structuringModel: 'claude-sonnet-4-6' } })}]]></metadata>`);

test('an edited draft whose groups are complete certifies without restructuring, keeping its geometry', async () => {
    const draft = asDraft(certified);
    assert.deepEqual(draftIssues(row(), draft), []);
    const out = certifyDraft(row(), draft);
    const meta = assertValidSVG(out);
    assert.deepEqual(meta.bindings, metadata.bindings);
    assert.equal(meta.revision.operation, 'manual_edit');
    assert.deepEqual(meta.provenance, { structuringModel: 'claude-sonnet-4-6' });
    const paths = (s: string) => s.match(/<path\b[^>]*>/g);
    assert.deepEqual(paths(out), paths(draft));
    const promoted = await prepareSvgPromotion(row(), out);
    assert.equal(promoted.structuredSvgStatus, 'completed');
});

test('every blocking reason is listed at once and named by element', () => {
    // vaso emptied, its shape left outside every group, plus a stale group.
    const vaso = certified.match(/<g id="vaso"[^>]*>([\s\S]*?)<\/g>/)!;
    const broken = asDraft(certified.replace(vaso[0], `<g id="vaso" role="group" tabindex="0" aria-label="Vaso" data-concept="Object"></g>${vaso[1]}<g id="mesa" data-concept="Object"><path d="M0 0h1v1z"/></g>`));
    const issues = draftIssues(row(), broken);
    assert.deepEqual(issues.map(i => i.kind).sort(), ['empty', 'loose', 'unknown']);
    assert.ok(issues.some(i => i.kind === 'empty' && i.elementId === 'vaso'));
    assert.throws(() => certifyDraft(row(), broken), (e: any) => e.issues.length === 3);
});

test('a missing group is added for the editor, and an Action without drawing can be declared implicit', () => {
    const withAction = row();
    (withAction.elements![0] as any).children.push({ id: 'beber', concept: 'Action' });
    withAction.prompt += " 'beber'";
    const draft = asDraft(certified);
    const [issue] = draftIssues(withAction, draft);
    assert.deepEqual(issue, { kind: 'empty', elementId: 'beber', concept: 'Action', performers: ['persona', 'vaso'] });
    assert.match(ensureDraftGroups(withAction, draft), /<g id="beber" role="group" tabindex="0" data-concept="Action" aria-label="beber"\/?>/);
    const out = certifyDraft(withAction, ensureDraftGroups(withAction, draft), { beber: 'persona' });
    const meta = assertValidSVG(out);
    assert.deepEqual(meta.bindings.find((b: any) => b.elementId === 'beber'), { elementId: 'beber', implicit: true, performedBy: 'persona' });
    assert.doesNotMatch(out, /id="beber"/);
});

test('a composition without concepts asks for them, suggested from the draft, then certifies', async () => {
    const { applyConcepts } = await import('./svgDraftCertification.ts');
    const legacy = row();
    const strip = (els: any[]): any[] => els.map(({ concept, children, ...rest }) => ({ ...rest, ...(children ? { children: strip(children) } : {}) }));
    legacy.elements = strip(legacy.elements as any);
    const draft = asDraft(certified);
    const [issue] = draftIssues(legacy, draft) as any[];
    assert.deepEqual(issue, { kind: 'concepts', elements: [
        { elementId: 'pictograma', suggested: 'Root' }, { elementId: 'persona', suggested: 'Agent' }, { elementId: 'vaso', suggested: 'Object' }] });
    legacy.elements = applyConcepts(legacy.elements as any, Object.fromEntries(issue.elements.map((e: any) => [e.elementId, e.suggested])));
    assert.deepEqual(draftIssues(legacy, draft), []);
    assert.ok(assertValidSVG(certifyDraft(legacy, draft)));
});

test('an element that is not drawn can be removed from the composition, keeping the sentence readable', async () => {
    const { removeElement } = await import('./svgDraftCertification.ts');
    const withContext = row();
    (withContext.elements![0] as any).children.push({ id: 'cocina_casa', concept: 'Context', children: [{ id: 'mesa', concept: 'Object' }] });
    withContext.prompt += " Todo ocurre en la 'cocina_casa', con la 'mesa' al fondo.";
    const { elements, prompt } = removeElement(withContext.elements as any, withContext.prompt!, 'cocina_casa');
    assert.ok(JSON.stringify(elements).includes('"mesa"'));
    assert.ok(!JSON.stringify(elements).includes('cocina_casa'));
    assert.match(prompt, /en la cocina casa, con la 'mesa'/);
});
