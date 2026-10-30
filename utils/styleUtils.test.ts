/**
 * Tests for the style-block rules the editor must keep (styleUtils).
 * Run with: npm test (node --test with type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPreservedRules, parseOverrideRules } from './styleUtils.ts';

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
