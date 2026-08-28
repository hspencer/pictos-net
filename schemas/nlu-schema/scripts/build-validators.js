import addFormats from 'ajv-formats';
import document from '../pictonet-nlu-1.1.0.schema.json' with { type: 'json' };
import generation from '../pictonet-nlu-generation-1.1.0.schema.json' with { type: 'json' };
import { buildValidators } from './standalone-code.js';
buildValidators(new URL('../', import.meta.url), [document, generation], {
  validateDocumentShape: document.$id,
  validateGenerationShape: generation.$id,
}, addFormats);
