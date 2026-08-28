// Development-only sync proof; standalone npm test never reads outside this product.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const profileURL = new URL('../metadata-2.0.0-draft.1.schema.json', import.meta.url);
const profile = JSON.parse(fs.readFileSync(profileURL));
const expected = {
  NLU: JSON.parse(fs.readFileSync(new URL('../../nlu-schema/pictonet-nlu-generation-1.1.0.schema.json', import.meta.url))),
  Composition: JSON.parse(fs.readFileSync(new URL('../../pictogram-composition-schema/pictogram-composition-0.1.0.schema.json', import.meta.url))),
};
if (process.argv.includes('--check')) { assert.deepEqual(profile.$defs, expected); console.log('Embedded canonical contracts match'); }
else { profile.$defs = expected; fs.writeFileSync(profileURL, JSON.stringify(profile, null, 2) + '\n'); }
