import document from '../pictogram-composition-0.1.0.schema.json' with { type: 'json' };
import provider from '../pictogram-composition-provider-0.1.0.schema.json' with { type: 'json' };
import { buildValidators } from './standalone-code.js';
buildValidators(new URL('../', import.meta.url), [document, provider], {
  validateDocumentShape: document.$id,
  validateProviderShape: provider.$id,
  validateElementShape: `${document.$id}#/properties/elements`,
});
