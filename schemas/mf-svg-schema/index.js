import { validateMetadataShape, validateNlu, validateComposition } from './validators.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import metadataSchema from './metadata-2.0.0-draft.1.schema.json' with { type: 'json' };

export const VERSION = '2.0.0-draft.1';
export { metadataSchema };
const SVG_NS = 'http://www.w3.org/2000/svg';
const geometries = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'use']);
const allowedElements = new Set(['svg', 'g', 'defs', 'style', 'title', 'desc', 'metadata', ...geometries, 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern']);

/** JSON.parse establishes syntax; a token walk rejects duplicate (also escaped) keys. */
export function parseMetadataJSON(text) {
  const data = JSON.parse(text);
  const stack = [];
  for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? []) {
    const current = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push({ key: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':' && current) current.key = false;
    else if (token === ',' && current?.keys) current.key = true;
    else if (token.startsWith('"') && current?.keys && current.key) {
      const key = JSON.parse(token);
      if (current.keys.has(key)) throw new Error('Duplicate JSON metadata key');
      current.keys.add(key);
    }
  }
  return data;
}

export function parseSVG(svg) {
  if (typeof svg !== 'string' || !svg.trim()) throw new Error('SVG must be nonempty XML');
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new Error('DTD/entities are forbidden');
  const errors = [];
  const document = new DOMParser({ onError: (level, message) => { errors.push(`${level}: ${message}`); } }).parseFromString(svg, 'image/svg+xml');
  if (errors.length || !document?.documentElement) throw new Error('Malformed SVG XML');
  function inspect(node) {
    if (node.nodeType === 7 || node.nodeType === 10) throw new Error('XML processing instructions are forbidden');
    for (let child = node.firstChild; child; child = child.nextSibling) inspect(child);
  }
  inspect(document);
  if (document.documentElement.localName !== 'svg' || document.documentElement.namespaceURI !== SVG_NS) throw new Error('Expected namespaced SVG root');
  return document;
}

function semanticElements(composition) {
  const result = new Map();
  function visit(nodes) {
    for (const node of nodes) {
      if (result.has(node.id)) throw new Error('Duplicate composition element id');
      result.set(node.id, node);
      if (node.children) visit(node.children);
    }
  }
  visit(composition.elements);
  return result;
}

export function assertSemanticInputs(nlu, composition, utterance = nlu?.utterance) {
  if (!validateNlu(nlu)) throw new Error('NLU does not satisfy the complete canonical generation profile');
  if (!validateComposition(composition)) throw new Error('Composition does not satisfy the canonical artifact contract');
  if (utterance !== nlu.utterance) throw new Error('Utterance differs from the embedded NLU');
  const frames = new Set();
  for (const frame of nlu.frames) {
    if (frame.id && frames.has(frame.id)) throw new Error('Duplicate NLU frame id');
    if (frame.id) frames.add(frame.id);
  }
  for (const frame of nlu.frames) for (const role of Object.values(frame.roles)) {
    if (role.ref_frame && !frames.has(role.ref_frame)) throw new Error('Unknown NLU frame reference');
  }
  const elements = semanticElements(composition);
  for (const node of elements.values()) if (node.concept !== 'Root' && ['pictograma', 'pictogram'].includes(node.id)) throw new Error('Composition child uses a reserved root id');
  for (const node of elements.values()) if (node.concept !== 'Root' && !composition.prompt.includes(`'${node.id}'`)) throw new Error('Composition prompt omits an element');
  for (const match of composition.prompt.matchAll(/(?<![\p{L}\p{N}_])'([^']+)'(?![\p{L}\p{N}_])/gu)) if (!elements.has(match[1])) throw new Error('Composition prompt references an unknown element');
  return elements;
}

export function createMetadata({ nlu, composition, bindings, provenance = {}, operation = 'assembly', parentSha256 = undefined, description = nlu?.utterance }) {
  assertSemanticInputs(nlu, composition);
  return structuredClone({ schemaVersion: VERSION,
    revision: { id: crypto.randomUUID(), createdAt: new Date().toISOString(), operation, ...(parentSha256 ? { parentSha256 } : {}) },
    contracts: { nlu: '1.1.0', composition: '0.1.0' }, nlu, composition, bindings, provenance, review: { status: 'unreviewed' }, accessibility: { title: nlu.utterance, description, lang: nlu.lang } });
}

export function validateSVG(svg) {
  const errors = [];
  let metadata;
  try {
    const document = parseSVG(svg);
    const root = document.documentElement;
    const nodes = Array.from(document.getElementsByTagName('*'));
    const ids = new Map();
    const references = [];
    for (const node of nodes) {
      if (node.namespaceURI !== SVG_NS || !allowedElements.has(node.localName)) throw new Error('Unsupported or active SVG element');
      const id = node.getAttribute('id');
      if (id) {
        if (ids.has(id) || /[\s"'<>#]/.test(id)) throw new Error('Duplicate or unsafe SVG id');
        ids.set(id, node);
      }
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.localName) || attr.localName === 'base') throw new Error('Event handlers and xml:base are forbidden');
        if (attr.localName === 'href') {
          if (!attr.value.startsWith('#') || attr.value.length < 2) throw new Error('External SVG resource is forbidden');
          references.push(attr.value.slice(1));
        }
        if (['aria-labelledby', 'aria-describedby'].includes(attr.localName)) references.push(...attr.value.trim().split(/\s+/));
        if (/url\s*\(/i.test(attr.value) || /^(style|fill|stroke|filter|clip-path|mask|cursor|marker(?:-.*)?)$/.test(attr.localName)) checkCss(attr.value, references);
      }
      if (node.localName === 'style') checkCss(node.textContent, references);
    }
    for (const ref of references) if (!ids.has(ref)) throw new Error('Unresolved SVG/ARIA reference');
    if (root.getAttribute('role') !== 'img') throw new Error('Root role must be img');
    const labels = (root.getAttribute('aria-labelledby') || '').trim().split(/\s+/).map(id => ids.get(id));
    for (const name of ['title', 'desc']) if (!labels.some(node => node?.localName === name && node.textContent.trim())) throw new Error('Root ARIA must reference nonempty title and desc');
    const metadataNodes = nodes.filter(node => node.localName === 'metadata');
    if (metadataNodes.length !== 1 || metadataNodes[0].parentNode !== root || metadataNodes[0].getAttribute('id') !== 'mf-accessibility') throw new Error('Exactly one root canonical metadata block is required');
    metadata = parseMetadataJSON(metadataNodes[0].textContent);
    if (!validateMetadataShape(metadata)) throw new Error(`Metadata schema violation: ${validateMetadataShape.errors.map(e => `${e.instancePath} ${e.keyword}`).join('; ')}`);
    const elements = assertSemanticInputs(metadata.nlu, metadata.composition);
    const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('SVG viewBox must have finite positive dimensions');
    if (root.getAttribute('lang') !== metadata.nlu.lang || metadata.accessibility.lang !== metadata.nlu.lang) throw new Error('SVG language differs from NLU');
    const title = labels.find(node => node?.localName === 'title');
    const desc = labels.find(node => node?.localName === 'desc');
    if (title.textContent !== metadata.nlu.utterance || title.textContent !== metadata.accessibility.title || desc.textContent !== metadata.accessibility.description) throw new Error('SVG accessible text differs from embedded evidence');
    const bound = new Map();
    const groupIds = new Set();
    for (const binding of metadata.bindings) {
      const semantic = elements.get(binding.elementId);
      if (!semantic || semantic.concept === 'Root' || bound.has(binding.elementId)) throw new Error('Invalid or duplicate semantic binding');
      bound.set(binding.elementId, binding);
      if (binding.implicit) {
        if (semantic.concept !== 'Action' || binding.performedBy === binding.elementId) throw new Error('Only supplied implicit actions may refer to a performer');
        continue;
      }
      const group = ids.get(binding.groupId);
      if (!group || group.localName !== 'g' || groupIds.has(binding.groupId)) throw new Error('Binding must reference a unique real SVG group');
      groupIds.add(binding.groupId);
      if (group.getAttribute('data-concept') !== semantic.concept || group.getAttribute('role') !== 'group' || group.getAttribute('tabindex') !== '0' || !group.getAttribute('aria-label')?.trim()) throw new Error('Semantic group attributes differ from composition');
      if (!Array.from(group.getElementsByTagName('*')).some(node => geometries.has(node.localName))) throw new Error('Semantic group has no geometry');
    }
    for (const node of elements.values()) if (node.concept !== 'Root' && !bound.has(node.id)) throw new Error('Composition element lacks an explicit or supplied implicit binding');
    for (const binding of bound.values()) if (binding.implicit && !bound.get(binding.performedBy)?.groupId) throw new Error('Implicit action performer has no real group binding');
    for (const node of nodes) {
      if (node.localName === 'g' && node.hasAttribute('data-concept') && !groupIds.has(node.getAttribute('id')) && !(node.getAttribute('data-concept') === 'Root' && elements.get(node.getAttribute('id'))?.concept === 'Root')) throw new Error('Unknown semantic group cannot be promoted');
      if (geometries.has(node.localName)) {
        let ancestor = node.parentNode;
        while (ancestor && ancestor !== root && ancestor.localName !== 'defs' && !groupIds.has(ancestor.getAttribute?.('id'))) ancestor = ancestor.parentNode;
        if (!ancestor || ancestor === root) throw new Error('Visible geometry has no semantic binding');
      }
    }
  } catch (error) { errors.push(error.message); }
  return { valid: !errors.length, errors, metadata };
}

function checkCss(css, references) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\\|@import|(?:https?|data|javascript):|image-set\s*\(/i.test(plain)) throw new Error('External or escaped CSS resources are forbidden');
  for (const match of plain.matchAll(/url\s*\(\s*(["']?)([^)]*?)\1\s*\)/gi)) {
    const value = match[2].trim();
    if (!/^#[^\s"'()]+$/.test(value)) throw new Error('Only local CSS resource references are allowed');
    references.push(value.slice(1));
  }
}

export function assertValidSVG(svg) {
  const result = validateSVG(svg);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return result.metadata;
}

export async function createSvgReference(svg) {
  const metadata = assertValidSVG(svg);
  const bytes = new TextEncoder().encode(svg);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { schemaVersion: VERSION, revisionId: metadata.revision.id, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), byteLength: bytes.length };
}

export async function verifySvgReference(svg, reference) {
  try {
    const actual = await createSvgReference(svg);
    return Object.keys(actual).every(key => actual[key] === reference?.[key]);
  } catch { return false; }
}

export function reviseSVG(svg, parentSha256) {
  const metadata = assertValidSVG(svg);
  const document = parseSVG(svg);
  metadata.revision = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), operation: 'manual_edit', ...(parentSha256 ? { parentSha256 } : {}) };
  metadata.review = { status: 'unreviewed' };
  const block = Array.from(document.getElementsByTagNameNS(SVG_NS, 'metadata'))[0];
  block.textContent = JSON.stringify(metadata);
  const revised = new XMLSerializer().serializeToString(document);
  assertValidSVG(revised);
  return revised;
}
