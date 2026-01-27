#!/usr/bin/env node

/**
 * Validates that all translation files have the same keys
 * Run with: node scripts/validateTranslations.js
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

if (hasErrors) {
  console.error('\n❌ Translation validation failed!');
  process.exit(1);
}

console.log('✅ All translations validated successfully!');
console.log(`   Total keys: ${enKeys.size}`);
