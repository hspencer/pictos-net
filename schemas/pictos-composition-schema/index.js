import { validateDocumentShape, validateProviderShape, validateElementShape } from './validators.js';
import providerSchema from './pictogram-composition-provider-0.1.0.schema.json' with { type: 'json' };
import documentSchema from './pictogram-composition-0.1.0.schema.json' with { type: 'json' };

export { providerSchema, documentSchema };
export const VERSION = '0.1.0';
const providerValidator = validateProviderShape;
const documentValidator = validateDocumentShape;
const elementValidator = validateElementShape;

function relationErrors(elements, hasRoot, prompt) {
  const errors = [];
  const ids = new Set();
  function visit(elements, path, root = false) {
    for (const [i, element] of elements.entries()) {
      const p = `${path}/${i}`;
      if (ids.has(element.id)) errors.push({ instancePath: `${p}/id`, message: 'must be unique across the whole tree' });
      ids.add(element.id);
      if (!root && ['pictograma', 'pictogram'].includes(element.id)) errors.push({ instancePath: `${p}/id`, message: 'is reserved for the deterministic root' });
      if (!root && prompt !== undefined && !prompt.includes(`'${element.id}'`)) errors.push({ instancePath: '/prompt', message: `must reference element ${element.id} in single quotes` });
      if (element.children) visit(element.children, `${p}/children`);
    }
  }
  visit(elements, '/elements', hasRoot);
  // Apostrophes inside natural words (person's, don't) are not delimiters.
  for (const match of prompt?.matchAll(/(?<![\p{L}\p{N}_])'([^']+)'(?![\p{L}\p{N}_])/gu) ?? []) {
    if (!ids.has(match[1])) errors.push({ instancePath: '/prompt', message: `references unknown element ${match[1]}` });
  }
  return errors;
}

function validateTree(data, validator, hasRoot) {
  if (!validator(data)) return [...validator.errors];
  return relationErrors(data.elements, hasRoot, data.prompt);
}

/** Precondition for editing only a prompt: validate the existing rooted tree
 * without requiring or inventing a spatial prompt that is about to be replaced. */
export function validateElementTree(elements) {
  const errors = elementValidator(elements)
    ? relationErrors(elements, true)
    : [...elementValidator.errors];
  validateElementTree.errors = errors.length ? errors : null;
  return errors.length === 0;
}
validateElementTree.errors = null;

export function validateProvider(data) {
  const errors = validateTree(data, providerValidator, false);
  validateProvider.errors = errors.length ? errors : null;
  return errors.length === 0;
}
validateProvider.errors = null;

export function validateDocument(data) {
  const errors = validateTree(data, documentValidator, true);
  validateDocument.errors = errors.length ? errors : null;
  return errors.length === 0;
}
validateDocument.errors = null;
