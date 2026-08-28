import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

// Render the actual component with its production eligibility checks and i18n.
const root = path.resolve(import.meta.dirname, '..');
const compiled = buildSync({
  stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { SVGGenerator } from './components/SVGGenerator'; export const render = props => renderToStaticMarkup(React.createElement(SVGGenerator, props));`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['paper', 'netlify-identity-widget'],
  define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent',
}).outputFiles[0].text;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), module, module.exports);
const render = module.exports.render;
const library = JSON.parse(fs.readFileSync(path.join(root, 'public/libraries/escena_descriptiva_graph_2026-08-26.json'), 'utf8'));
const historical = library.rows.find(row => row.UTTERANCE === 'Abro la app de delivery en mi teléfono');

test('invalid or missing NLU leaves trace controls rendered in both layouts and locales', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const locale of ['es-419', 'en-GB']) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => locale } });
      for (const layout of ['stacked', 'columns']) {
        for (const semantic of [historical.NLU, undefined]) {
          const html = render({ row: { ...historical, NLU: semantic, rawSvg: '<svg viewBox="0 0 10 10"><path id="retained-trace" d="M0 0L10 10"/></svg>' }, config: library.config, layout, onLog() {}, onUpdate() {}, onOpenEditor() {}, onOpenVectorizer() {} });
          assert.match(html, /retained-trace/);
          assert.match(html, locale === 'es-419' ? /Re-trazar/ : /Re-trace/);
          assert.match(html, locale === 'es-419' ? /Descargar/ : /Download/);
          assert.match(html, /[Ee]dit/);
          assert.match(html, locale === 'es-419' ? /Certificación semántica pendiente/ : /Semantic certification pending/);
          if (semantic) assert.match(html, /\/pragmatics\/formality/);
          assert.doesNotMatch(html, /disabled=""[^>]*aria-label="(Estructurar|Structure)/);
          assert.doesNotMatch(html, /NLU does not satisfy|Requirements not met/);
        }
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('uncertified drafts expose their own editor and never show the trace-ready or generic-failure message', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const locale of ['es-419', 'en-GB']) {
      const messages = JSON.parse(fs.readFileSync(path.join(root, `locales/${locale}.json`), 'utf8'));
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => locale } });
      for (const layout of ['stacked', 'columns']) {
        for (const diagnostic of [{ key: 'structureFailed' }, { key: 'metadataNeedsReview', fields: ['/bindings/0'] }]) {
          const html = render({ row: { ...historical, rawSvg: '<svg viewBox="0 0 10 10"><path id="retained-trace" d="M0 0L10 10"/></svg>', structuredSvgDraft: '<svg xmlns="http://www.w3.org/2000/svg"><g id="draft-only"/></svg>', structuredSvgDraftDiagnostic: diagnostic }, config: library.config, layout, onLog() {}, onUpdate() {}, onOpenEditor() {}, onOpenVectorizer() {} });
          assert.ok(html.includes(messages.svgGenerator.editDraft));
          assert.ok(html.includes(messages.svgGenerator.downloadDraft));
          assert.ok(html.includes(messages.svgGenerator[diagnostic.key === 'structureFailed' ? 'draftReasonUnavailable' : diagnostic.key]));
          assert.ok(!html.includes(messages.svgGenerator.structureFailed));
          assert.ok(!html.includes(messages.svg.traceDone));
          if (diagnostic.fields) assert.match(html, /\/bindings\/0/);
        }
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
