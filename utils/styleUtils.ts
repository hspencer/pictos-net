import type { StyleDefinition, CssRule } from '@style-editor/lib/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RULE_BLOCK_REGEX = /([^{}]+)\{([^}]*)\}/g;

// Matches override selectors of the form  #element-id.class-name
// (one ID selector + one class selector, no spaces, no combinators)
const OVERRIDE_SELECTOR_RE = /^#([\w-]+)\.([\w-]+)$/;

const generateId = () => Math.random().toString(36).slice(2, 9);

// ── Presentation attribute helpers ─────────────────────────────────────────

const PRESENTATION_ATTRS = ['fill', 'stroke', 'stroke-width', 'opacity', 'style'] as const;
type PresentationAttr = typeof PRESENTATION_ATTRS[number];

/**
 * Reads presentation attributes from an SVG element.
 * Used during pipeline cleanup to capture values before stripping.
 * @see CSS_STYLING_ARCHITECTURE.md — Pipeline Cleanup
 */
export function extractInlineStyleAttrs(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of PRESENTATION_ATTRS) {
    const val = element.getAttribute(attr);
    if (val !== null) result[attr] = val;
  }
  // Also parse style="" attribute into individual properties
  const styleAttr = element.getAttribute('style');
  if (styleAttr) {
    styleAttr.split(';').forEach(rule => {
      const idx = rule.indexOf(':');
      if (idx === -1) return;
      const prop = rule.slice(0, idx).trim();
      const val = rule.slice(idx + 1).trim();
      if (prop && val && !result[prop]) result[prop] = val;
    });
  }
  return result;
}

/**
 * Removes all presentation attributes from an SVG element in-place.
 * @see CSS_STYLING_ARCHITECTURE.md — Pipeline Cleanup
 */
export function stripInlineStyleAttrs(element: Element): void {
  for (const attr of PRESENTATION_ATTRS) {
    element.removeAttribute(attr);
  }
}

// ── Override rule parsing / serialization ──────────────────────────────────

/**
 * Map shape: elementId → className → { property: value }
 * @see CSS_STYLING_ARCHITECTURE.md — Two-Level Model
 */
export type OverrideMap = Map<string, Map<string, Record<string, string>>>;

/**
 * Parses #id.class { ... } override rules from a CSS text block.
 * Only rules whose selectors match exactly the override pattern are returned.
 * @see CSS_STYLING_ARCHITECTURE.md — Local Overrides
 */
export function parseOverrideRules(cssText: string): OverrideMap {
  const result: OverrideMap = new Map();
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const regex = new RegExp(RULE_BLOCK_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleaned)) !== null) {
    const selectorText = match[1].trim();
    const m = OVERRIDE_SELECTOR_RE.exec(selectorText);
    if (!m) continue;

    const [, elementId, className] = m;
    const declarations: Record<string, string> = {};

    match[2].trim().split(';').forEach(rule => {
      const idx = rule.indexOf(':');
      if (idx === -1) return;
      const property = rule.slice(0, idx).trim();
      const value = rule.slice(idx + 1).trim();
      if (property && value) declarations[property] = value;
    });

    if (Object.keys(declarations).length === 0) continue;

    if (!result.has(elementId)) result.set(elementId, new Map());
    result.get(elementId)!.set(className, declarations);
  }

  return result;
}

/**
 * Serializes an OverrideMap back to CSS text.
 * @see CSS_STYLING_ARCHITECTURE.md — Local Overrides
 */
export function serializeOverrideRules(overrides: OverrideMap): string {
  const rules: string[] = [];
  for (const [elementId, classMap] of overrides) {
    for (const [className, declarations] of classMap) {
      const props = Object.entries(declarations)
        .map(([p, v]) => `  ${p}: ${v};`)
        .join('\n');
      if (props) rules.push(`#${elementId}.${className} {\n${props}\n}`);
    }
  }
  return rules.join('\n\n');
}

/**
 * Extracts library-level rules (class rules, @keyframes) from CSS text,
 * discarding any #id.class override rules.
 * @see CSS_STYLING_ARCHITECTURE.md — Library Rules
 */
export function extractLibraryRules(cssText: string): string {
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: string[] = [];
  const regex = new RegExp(RULE_BLOCK_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleaned)) !== null) {
    const selectorText = match[1].trim();
    // Skip override selectors
    if (OVERRIDE_SELECTOR_RE.test(selectorText)) continue;
    // Skip empty blocks
    if (!match[2].trim()) continue;
    blocks.push(`${selectorText} {\n${match[2]}\n}`);
  }

  return blocks.join('\n\n');
}

// ── Override rule mutation ─────────────────────────────────────────────────

/**
 * Rebuilds the SVG <style> block keeping library rules intact and merging
 * the provided OverrideMap as the second section.
 * @see CSS_STYLING_ARCHITECTURE.md — Rebuild Cycle
 */
function rebuildStyleBlock(svgDocument: string, cssText: string, overrides: OverrideMap): string {
  const libSection = extractLibraryRules(cssText).trim();
  const overrideSection = serializeOverrideRules(overrides).trim();

  const parts: string[] = [];
  if (libSection) parts.push(libSection);
  if (overrideSection) parts.push(overrideSection);

  const combined = parts.join('\n\n/* --- local overrides --- */\n\n');
  return updateSvgStyleText(svgDocument, combined, combined.length === 0);
}

/**
 * Merges declarations into the override rule for (elementId, className).
 * Passing an empty string for a property removes it from the override.
 * Does NOT touch library rules or other elements' overrides.
 * @see CSS_STYLING_ARCHITECTURE.md — Level 2: Local Overrides
 */
export function setOverrideRule(
  svgDocument: string,
  elementId: string,
  className: string,
  declarations: Record<string, string>
): string {
  const cssText = getSvgStyleText(svgDocument);
  const overrides = parseOverrideRules(cssText);

  if (!overrides.has(elementId)) overrides.set(elementId, new Map());
  const classMap = overrides.get(elementId)!;

  const existing = classMap.get(className) ?? {};
  const merged: Record<string, string> = { ...existing };
  for (const [prop, val] of Object.entries(declarations)) {
    if (val === '') delete merged[prop];
    else merged[prop] = val;
  }

  if (Object.keys(merged).length === 0) {
    classMap.delete(className);
  } else {
    classMap.set(className, merged);
  }
  if (classMap.size === 0) overrides.delete(elementId);

  return rebuildStyleBlock(svgDocument, cssText, overrides);
}

/**
 * Removes the override rule for (elementId, className), if it exists.
 * Called during UNCITE and "Restore to library" actions.
 * @see CSS_STYLING_ARCHITECTURE.md — Garbage Collection
 */
export function removeOverrideRule(
  svgDocument: string,
  elementId: string,
  className: string
): string {
  const cssText = getSvgStyleText(svgDocument);
  const overrides = parseOverrideRules(cssText);
  overrides.get(elementId)?.delete(className);
  if (overrides.get(elementId)?.size === 0) overrides.delete(elementId);
  return rebuildStyleBlock(svgDocument, cssText, overrides);
}

// ── Pipeline cleanup ───────────────────────────────────────────────────────

/**
 * Converts all presentation attributes (fill, stroke, stroke-width, opacity,
 * style) on SVG elements into #id.from-inline { ... } rules in the <style>
 * block, then strips those attributes from the elements.
 *
 * This bridges SVGs produced by VTracer (which carry inline attrs) into the
 * two-level zero-inline model. Safe to call on already-clean SVGs (idempotent).
 * @see CSS_STYLING_ARCHITECTURE.md — Pipeline Cleanup
 */
export function convertInlineAttrsToCssRules(svgDocument: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgDocument;

  // Collect elements that have presentation attributes and an ID
  const candidates: Element[] = [];
  svgEl.querySelectorAll('[fill],[stroke],[stroke-width],[opacity],[style]').forEach(el => {
    if (el.getAttribute('id')) candidates.push(el);
  });

  if (candidates.length === 0) return svgDocument;

  // Build override rules, then strip inline attrs
  let current = svgDocument;
  candidates.forEach(el => {
    const id = el.getAttribute('id')!;
    const declarations = extractInlineStyleAttrs(el);
    if (Object.keys(declarations).length === 0) return;
    // Omit 'style' key itself (already expanded above) and replace with individual props
    const { style: _style, ...rest } = declarations;
    if (Object.keys(rest).length === 0) return;
    current = setOverrideRule(current, id, 'from-inline', rest);
  });

  // Strip inline attrs from all elements (re-parse the updated SVG)
  const doc2 = new DOMParser().parseFromString(current, 'image/svg+xml');
  doc2.querySelectorAll('[fill],[stroke],[stroke-width],[opacity],[style]').forEach(el => {
    stripInlineStyleAttrs(el);
  });

  return new XMLSerializer().serializeToString(doc2);
}

export const getSvgStyleText = (svgDocument: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
  const styleElement = doc.querySelector('style');
  return styleElement?.textContent?.trim() ?? '';
};

export const updateSvgStyleText = (
  svgDocument: string,
  cssText: string,
  removeIfEmpty: boolean = false
): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
  const svgElement = doc.querySelector('svg');
  if (!svgElement) return svgDocument;

  const trimmed = cssText.trim();
  let styleElement = svgElement.querySelector<SVGStyleElement>('style');
  if (!trimmed && removeIfEmpty) {
    if (styleElement) {
      styleElement.remove();
    }
    return new XMLSerializer().serializeToString(doc);
  }

  if (!styleElement) {
    styleElement = doc.createElementNS(SVG_NS, 'style');
    svgElement.insertBefore(styleElement, svgElement.firstChild);
  }

  styleElement.textContent = cssText;
  return new XMLSerializer().serializeToString(doc);
};

export const parseCssToStyleDefinitions = (cssText: string): StyleDefinition[] => {
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!cleaned.trim()) return [];

  const styles: StyleDefinition[] = [];
  let match: RegExpExecArray | null;

  while ((match = RULE_BLOCK_REGEX.exec(cleaned)) !== null) {
    const selectorText = match[1].trim();
    if (!selectorText || selectorText.startsWith('@')) continue;

    const selectors = selectorText
      .split(',')
      .map((sel) => sel.trim())
      .filter((sel) => sel.length > 0 && sel.startsWith('.'));

    if (selectors.length === 0) continue;

    const rulesText = match[2].trim();
    const rules: CssRule[] = [];

    rulesText.split(';').forEach((rule) => {
      const [property, value] = rule.split(':').map((part) => part.trim());
      if (!property || !value) return;
      rules.push({
        id: generateId(),
        property,
        value,
      });
    });

    styles.push({
      id: generateId(),
      selectors,
      rules,
    });
  }

  return styles;
};
