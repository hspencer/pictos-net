import fs from 'node:fs';
import documentSchema from '../pictonet-nlu-1.1.0.schema.json' with { type: 'json' };
import { generationProfile } from './generation-profile.js';
fs.writeFileSync(new URL('../pictonet-nlu-generation-1.1.0.schema.json', import.meta.url), JSON.stringify(generationProfile(documentSchema), null, 2) + '\n');
