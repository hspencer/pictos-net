import { validateDocumentShape, validateGenerationShape } from './validators.js';
import documentSchema from './pictonet-nlu-1.1.0.schema.json' with { type: 'json' };
import generationSchema from './pictonet-nlu-generation-1.1.0.schema.json' with { type: 'json' };

export { documentSchema, generationSchema };
export const VERSION = '1.1.0';
export const validateDocument = validateDocumentShape;
const validateProfile = validateGenerationShape;

/** Structural validation does not establish semantic correctness or training rights. */
export function validateGeneration(data) {
  const valid = validateProfile(data);
  const errors = [...(validateProfile.errors ?? [])];
  if (valid) {
    const ids = new Set();
    for (const [i, frame] of data.frames.entries()) {
      if (frame.id && ids.has(frame.id)) errors.push({ instancePath: `/frames/${i}/id`, message: 'must be unique' });
      if (frame.id) ids.add(frame.id);
    }
    for (const [i, frame] of data.frames.entries()) {
      for (const [role, filler] of Object.entries(frame.roles)) {
        if (filler.ref_frame && !ids.has(filler.ref_frame)) {
          errors.push({ instancePath: `/frames/${i}/roles/${role}/ref_frame`, message: 'must reference an existing frame id, not a frame name' });
        }
      }
    }
  }
  validateGeneration.errors = errors.length ? errors : null;
  return errors.length === 0;
}
validateGeneration.errors = null;
