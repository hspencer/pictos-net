import fs from 'node:fs';
import { validateSVG } from '../index.js';
try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/validate-svg.js file.svg');
  const result = validateSVG(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify({ valid: result.valid, errors: result.errors }));
  process.exitCode = result.valid ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
