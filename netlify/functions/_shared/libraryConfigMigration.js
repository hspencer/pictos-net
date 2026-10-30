/**
 * Library configuration migration, shared by the app (applied on every library
 * load, template import and backup restore) and scripts/migrate-library-templates.mjs
 * (rewrites the shipped templates). One source, like nluMigration.js.
 *
 * Changes, each reported in `changes`:
 *   - legacy fields: imageModel (→ generationModel when none is set),
 *     aspectRatio and author (→ name) are removed;
 *   - renamed preview ids map to their stable id;
 *   - a model that cannot run its phase (retired or unknown) is removed, so the
 *     phase follows the current default (user decision 2026-10-30);
 *   - with `pins: 'drop'` (templates), every declared model is removed: a
 *     template follows the defaults of the version that imports it. Rows keep
 *     the model that actually produced them;
 *   - legacy `svgStyles` become `svgStyleDefs` when `baseStyleDefs` is given.
 *     Colours are kept BY ROLE: the darkest legacy class repaints `.k` and the
 *     lightest repaints `.f` (older libraries named them the other way round),
 *     any other class is added as its own definition.
 *
 * No other field is touched; the input is not mutated.
 */
import { modelSupportsPhase } from './modelCatalog.js';

const MODEL_FIELDS = { comprenderModel: [1], componerModel: [2], nluModel: [1, 2], generationModel: [3], phase5Model: [5] };
const RENAMED = { 'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image', 'gemini-3-pro-image-preview': 'gemini-3-pro-image' };

/** Same mapping the app has always applied to the pre-v2 imageModel field. */
function fromImageModel(imageModel) {
  if (imageModel === 'recraftv4_1_vector' || imageModel === 'recraftv4_1') return imageModel;
  if (imageModel.includes('pro')) return 'gemini-3-pro-image';
  return 'gemini-2.5-flash-image';
}

const CSS_PROPERTY = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin' };

function lightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

let ruleSeq = 0;
function rulesFrom(style) {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ({ id: `migrated-${++ruleSeq}`, property: CSS_PROPERTY[k] ?? k, value: String(v) }));
}

function convertStyles(svgStyles, baseStyleDefs) {
  const entries = Object.entries(svgStyles).filter(([, s]) => s && typeof s === 'object');
  const lit = entries.map(([cls, s]) => ({ cls, s, l: lightness(s.fill) })).filter(e => e.l !== null);
  const dark = lit.length ? lit.reduce((a, b) => (b.l < a.l ? b : a)) : null;
  const light = lit.length > 1 ? lit.reduce((a, b) => (b.l > a.l ? b : a)) : null;
  const defs = baseStyleDefs.map(d => ({ ...d, selectors: [...d.selectors], rules: d.rules.map(r => ({ ...r })) }));
  const repaint = (selector, style) => {
    const def = defs.find(d => d.selectors.includes(selector));
    if (def) def.rules = rulesFrom(style);
    else defs.push({ id: `migrated-${selector.slice(1)}`, selectors: [selector], rules: rulesFrom(style) });
  };
  if (dark) repaint('.k', dark.s);
  if (light && light !== dark) repaint('.f', light.s);
  for (const [cls, s] of entries) {
    if ((dark && cls === dark.cls) || (light && cls === light.cls)) continue;
    repaint(`.${cls}`, s);
  }
  return defs;
}

/**
 * @param {object} config  stored or template GlobalConfig
 * @param {{ pins?: 'keep' | 'drop', baseStyleDefs?: object[] }} [options]
 * @returns {{ config: object, changes: string[] }}
 */
export function migrateLibraryConfig(config, { pins = 'keep', baseStyleDefs } = {}) {
  const next = { ...(config ?? {}) };
  const changes = [];

  if (next.author !== undefined) {
    if (!next.name) next.name = next.author;
    delete next.author;
    changes.push('author → name');
  }
  if (next.imageModel !== undefined) {
    if (pins === 'keep' && !next.generationModel && typeof next.imageModel === 'string') {
      next.generationModel = fromImageModel(next.imageModel);
      changes.push(`imageModel ${next.imageModel} → generationModel ${next.generationModel}`);
    }
    delete next.imageModel;
    changes.push('imageModel removed');
  }
  if (next.aspectRatio !== undefined) {
    delete next.aspectRatio;
    changes.push('aspectRatio removed');
  }

  for (const [field, phases] of Object.entries(MODEL_FIELDS)) {
    const value = next[field];
    if (value === undefined) continue;
    if (pins === 'drop') {
      delete next[field];
      changes.push(`${field} ${value} removed (template follows defaults)`);
      continue;
    }
    if (RENAMED[value]) {
      next[field] = RENAMED[value];
      changes.push(`${field} ${value} → ${next[field]}`);
    }
    if (!phases.every(p => modelSupportsPhase(next[field], p))) {
      changes.push(`${field} ${next[field]} removed (retired or unknown; phase follows the default)`);
      delete next[field];
    }
  }

  if (next.svgStyles && typeof next.svgStyles === 'object' && baseStyleDefs) {
    if (!Array.isArray(next.svgStyleDefs) || next.svgStyleDefs.length === 0) {
      next.svgStyleDefs = convertStyles(next.svgStyles, baseStyleDefs);
      changes.push(`svgStyles (${Object.keys(next.svgStyles).join(', ')}) → svgStyleDefs`);
    }
    delete next.svgStyles;
  }

  return { config: next, changes };
}
