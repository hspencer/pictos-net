/**
 * Tests for the style-block rules the editor must keep (styleUtils).
 * Run with: npm test (node --test with type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPreservedRules, parseOverrideRules, citedClassNames, styleIsCited, parseCssToStyleDefinitions, getShapeRule } from './styleUtils.ts';

const CSS = `
svg .main, svg .primary { fill: #1a1a1a; stroke: #fff; }
.w, .white { fill: #ffffff; }
@keyframes pulse { 0% { opacity: 1; } 100% { opacity: 0.5; } }
g[role="group"]:focus { outline: 2px solid #0066cc; }
/* Original path fills */
#mamá-1 { fill: #505052; }
#lugar-forma { fill: #93AA95; }
#mamá-2.main { fill: #ff0000; }
`;

test('per-shape colours and the focus style are preserved; library rules and overrides are not', () => {
    const kept = extractPreservedRules(CSS);
    assert.match(kept, /#mamá-1 \{\s*fill: #505052;/);
    assert.match(kept, /#lugar-forma \{\s*fill: #93AA95;/);
    assert.match(kept, /g\[role="group"\]:focus/);
    assert.doesNotMatch(kept, /\.main|\.white|@keyframes|opacity/);
    assert.doesNotMatch(kept, /#mamá-2\.main/, 'overrides are rebuilt separately');
});

test('overrides on ids with accents are recognised', () => {
    const overrides = parseOverrideRules(CSS);
    assert.deepEqual(overrides.get('mamá-2')?.get('main'), { fill: '#ff0000' });
});

test('citedClassNames reads class attributes, not style rules; styleIsCited matches any class selector', () => {
    const svg = `<svg><style>.k{fill:#000}.unused{fill:red}</style><g class="k main"><path class='f'/></g></svg>`;
    const cited = citedClassNames(svg);
    assert.deepEqual([...cited].sort(), ['f', 'k', 'main']);
    assert.equal(styleIsCited({ id: '1', selectors: ['.k', '.x'], rules: [] }, cited), true);
    assert.equal(styleIsCited({ id: '2', selectors: ['.unused'], rules: [] }, cited), false);
});

test('classes written as `svg .name` read back (generateCssString round trip)', () => {
    const defs = parseCssToStyleDefinitions(CSS);
    assert.deepEqual(defs.map(d => d.selectors), [['.main', '.primary'], ['.w', '.white']]);
    assert.deepEqual(defs[0].rules.map(r => r.property), ['fill', 'stroke']);
});

test('a per-shape colour rule is matched by its exact id', () => {
    assert.deepEqual(getShapeRule(CSS, 'mamá-1'), { fill: '#505052' });
    assert.equal(getShapeRule(CSS, 'mamá'), null);
    assert.equal(getShapeRule(CSS, 'mamá-2'), null, '#mamá-2.main is an override, not a shape colour');
});
