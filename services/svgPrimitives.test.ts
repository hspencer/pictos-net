import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
Object.assign(globalThis, { DOMParser, XMLSerializer });
const { primitivesToPaths } = await import('./svgCanonical.ts');

test('primitives become paths with their paint and transform; defs and lines stay', () => {
  const out = primitivesToPaths('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><circle id="c" r="1"/></defs>'
    + '<circle cx="5" cy="5" r="2" fill="#000" transform="rotate(10)"/><rect x="1" y="1" width="3" height="2" class="s"/>'
    + '<polygon points="0,0 2,0 1,2"/><line x1="0" y1="0" x2="1" y2="1"/></svg>');
  assert.equal((out.match(/<path\b/g) ?? []).length, 3);
  assert.match(out, /<path fill="#000" transform="rotate\(10\)" d="M7,5 A2,2/);
  assert.match(out, /<path class="s" d="M1,1 L4,1/);
  assert.match(out, /<defs><circle id="c"/);
  assert.match(out, /<line /);
  assert.doesNotMatch(out, / cx=| width="3"/);
});
