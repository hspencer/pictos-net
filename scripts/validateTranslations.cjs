#!/usr/bin/env node

/**
 * Validates that all translation files have the same keys, and that every
 * literal t('...') key referenced in the source code exists in the catalogs
 * (a missing key renders as the raw key string in the UI).
 * Run with: node scripts/validateTranslations.cjs
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');
const enGB = JSON.parse(fs.readFileSync(path.join(localesDir, 'en-GB.json'), 'utf8'));
const es419 = JSON.parse(fs.readFileSync(path.join(localesDir, 'es-419.json'), 'utf8'));

/**
 * Recursively extracts all keys from a nested object
 * Returns array of dot-notation keys (e.g., ['header.title', 'header.subtitle'])
 */
function getKeys(obj, prefix = '') {
  return Object.keys(obj).flatMap(key => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])
      ? getKeys(obj[key], path)
      : [path];
  });
}

const enKeys = new Set(getKeys(enGB));
const esKeys = new Set(getKeys(es419));

// Find missing keys
const missingInEN = [...esKeys].filter(k => !enKeys.has(k));
const missingInES = [...enKeys].filter(k => !esKeys.has(k));

let hasErrors = false;

if (missingInEN.length > 0) {
  console.error('❌ Missing in en-GB.json:');
  missingInEN.forEach(key => console.error(`   - ${key}`));
  hasErrors = true;
}

if (missingInES.length > 0) {
  console.error('❌ Missing in es-419.json:');
  missingInES.forEach(key => console.error(`   - ${key}`));
  hasErrors = true;
}

// --- Cross-check: every literal t('...') key used in code must exist ---
// Scans .ts/.tsx sources (excluding vendored lib/, node_modules, dist).
// Only literal keys are checked; template-literal/dynamic keys are skipped.
const SRC_DIRS = ['components', 'hooks'];
const SRC_FILES = ['App.tsx'];

function collectSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) collectSourceFiles(p, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

const root = path.join(__dirname, '..');
const sources = SRC_FILES.map(f => path.join(root, f));
for (const d of SRC_DIRS) collectSourceFiles(path.join(root, d), sources);

const usedKeys = new Set();
for (const file of sources) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) usedKeys.add(m[1]);
}

const unknownKeys = [...usedKeys].filter(k => !esKeys.has(k)).sort();
if (unknownKeys.length > 0) {
  console.error('❌ Keys used in code but missing from catalogs (render as raw key):');
  unknownKeys.forEach(key => console.error(`   - ${key}`));
  hasErrors = true;
}

if (hasErrors) {
  console.error('\n❌ Translation validation failed!');
  process.exit(1);
}

console.log('✅ All translations validated successfully!');
console.log(`   Total keys: ${enKeys.size} | keys referenced in code: ${usedKeys.size}`);
