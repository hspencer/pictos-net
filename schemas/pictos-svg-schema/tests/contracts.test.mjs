import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateSVG, inspectPassiveSVG, parseMetadataJSON, assertValidSVG, createSvgReference, verifySvgReference, reviseSVG } from '../index.js';
const svg = fs.readFileSync(new URL('../examples/v2example.svg', import.meta.url), 'utf8');
const replaceMetadata = (edit) => svg.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, (_, text) => `<![CDATA[${JSON.stringify(edit(JSON.parse(text)))}]]>`);

test('frozen historical schema, example and license retain original bytes', () => {
  const frozen = JSON.parse(fs.readFileSync(new URL('../FROZEN_RELEASES.json', import.meta.url)));
  for (const [name, hash] of Object.entries(frozen)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../' + name, import.meta.url))).digest('hex'), hash);
});
test('complete v2 is independently valid; exact UTF8 references detect edits and revisions', async () => {
  assert.equal(validateSVG(svg).valid, true);
  const reference = await createSvgReference(svg);
  assert.equal(await verifySvgReference(svg, reference), true);
  assert.equal(await verifySvgReference(svg + '\n', reference), false);
  const revised = reviseSVG(svg, reference.sha256);
  const next = await createSvgReference(revised);
  assert.notEqual(reference.revisionId, next.revisionId);
  assert.equal(assertValidSVG(revised).revision.parentSha256, reference.sha256);
  assert.deepEqual(assertValidSVG(revised).nlu, assertValidSVG(svg).nlu);
  assert.deepEqual(assertValidSVG(revised).composition, assertValidSVG(svg).composition);
});
test('duplicate JSON keys including escaped names are never silently accepted', () => {
  assert.throws(() => parseMetadataJSON('{"a":1,"\\u0061":2}'), /Duplicate/);
  assert.throws(() => parseMetadataJSON('{"nested":{"x":1,"x":2}}'), /Duplicate/);
  assert.deepEqual(parseMetadataJSON('{"a":[{"b":"value"},{"b":"other"}]}'), { a: [{ b: 'value' }, { b: 'other' }] });
});
test('XML, DTDs, nested processing instructions, scripts and event handlers fail closed', () => {
  for (const bad of [svg.replace('</svg>', ''), '<!DOCTYPE svg>' + svg, svg.replace('<g ', '<?xml-stylesheet href="https://example.invalid/a"?><g '), svg.replace('</svg>', '<script>alert(1)</script></svg>'), svg.replace('<circle ', '<circle onload="alert(1)" ')]) assert.equal(validateSVG(bad).valid, false);
});
test('external resources, unresolved href and CSS references are rejected', () => {
  for (const bad of [svg.replace('<circle ', '<use href="https://example.invalid/a"/><circle '), svg.replace('<circle ', '<use href="#missing"/><circle '), svg.replace('<circle ', '<circle fill="url(#missing)" '), svg.replace('</svg>', '<defs><style>@import "https://example.invalid/a";</style></defs></svg>')]) assert.equal(validateSVG(bad).valid, false);
});
test('escaped CSS resources and unexpected provenance payloads fail closed', () => {
  const escaped = svg.replace('<circle ', String.raw`<circle style="filter:u\72l(https://example.invalid/a.svg#x)" `);
  assert.equal(validateSVG(escaped).valid, false);
  assert.equal(validateSVG(replaceMetadata(m => ({ ...m, provenance: { phaseExecutions: [{ inputSnapshot: { prompt: 'private' } }] } }))).valid, false);
});
test('duplicate IDs, ARIA, viewBox, language and accessible text are checked', () => {
  for (const bad of [svg.replace('id="vaso"', 'id="persona"'), svg.replace('title desc', 'title missing'), svg.replace('0 0 100 100', '0 0 -1 100'), svg.replace('lang="es-419"', 'lang="en"'), svg.replace('<title id="title">Beber agua', '<title id="title">Different')]) assert.equal(validateSVG(bad).valid, false);
});
test('bindings cannot invent concepts, omit elements, or change semantic role', () => {
  for (const change of [m => ({ ...m, bindings: [] }), m => ({ ...m, bindings: m.bindings.slice(1) }), m => ({ ...m, bindings: [{ elementId: 'unknown', groupId: 'persona' }, ...m.bindings.slice(1)] })]) assert.equal(validateSVG(replaceMetadata(change)).valid, false);
  assert.equal(validateSVG(svg.replace('data-concept="Agent"', 'data-concept="Context"')).valid, false);
  assert.equal(validateSVG(replaceMetadata(m => { m.composition.elements[0].children[0].id = 'pictogram'; return m; })).valid, false);
});
test('implicit actions are accepted only as supplied bindings to a real performer', () => {
  const implicit = replaceMetadata(m => {
    m.composition.elements[0].children.push({ id: 'beber', concept: 'Action' });
    m.composition.prompt += " 'beber' ocurre.";
    m.bindings.push({ elementId: 'beber', implicit: true, performedBy: 'persona' });
    return m;
  });
  assert.equal(validateSVG(implicit).valid, true);
  assert.equal(validateSVG(implicit.replace('"performedBy":"persona"', '"performedBy":"unknown"')).valid, false);
});


test('passive draft inspection does not certify meaning and retains every safety check', () => {
  const draft = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1L2 2"/></svg>';
  assert.ok(inspectPassiveSVG(draft));
  assert.equal(validateSVG(draft).valid, false);
  for (const bad of [
    draft.replace('<path', '<path onload="alert(1)"'),
    draft.replace('</svg>', '<script>alert(1)</script></svg>'),
    draft.replace('</svg>', '<use href="https://example.invalid/svg"/></svg>'),
    draft.replace('</svg>', '<use href="#missing"/></svg>'),
    draft.replace('<path', '<path fill="url(https://example.invalid/paint)"'),
    '<!DOCTYPE svg>' + draft,
  ]) assert.throws(() => inspectPassiveSVG(bad));
});
