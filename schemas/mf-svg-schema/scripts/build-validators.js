import addFormats from 'ajv-formats';
import metadata from '../metadata-2.0.0-draft.1.schema.json' with { type: 'json' };
import { buildValidators } from './standalone-code.js';
buildValidators(new URL('../', import.meta.url), [metadata], {
  validateMetadataShape: metadata.$id,
  validateNlu: metadata.$defs.NLU.$id,
  validateComposition: metadata.$defs.Composition.$id,
}, addFormats);
