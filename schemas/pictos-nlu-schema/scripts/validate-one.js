#!/usr/bin/env node
import fs from 'node:fs';
import { validateDocument, validateGeneration } from '../index.js';
const generation = process.argv.includes('--generation');
const file = process.argv.slice(2).find(arg => arg !== '--generation');
if (!file) {
  console.error('Usage: node scripts/validate-one.js <json-file> [--generation]');
  process.exit(1);
}
try {
  const validate = generation ? validateGeneration : validateDocument;
  if (!validate(JSON.parse(fs.readFileSync(file, 'utf8')))) {
    console.error(validate.errors);
    process.exitCode = 1;
  } else console.log(`Valid ${generation ? 'generation profile' : 'document'} 1.1.0: ${file}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
