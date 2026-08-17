#!/usr/bin/env node

/**
 * Validates that all translation files have the same keys, and that every
 * literal t('...') key referenced in the source code exists in the catalogs
 * (a missing key renders as the raw key string in the UI).
 * Run with: node scripts/validateTranslations.cjs
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const localesDir = path.join(__dirname, '..', 'locales');
const enPath = path.join(localesDir, 'en-GB.json');
const esPath = path.join(localesDir, 'es-419.json');
const enSource = fs.readFileSync(enPath, 'utf8');
const esSource = fs.readFileSync(esPath, 'utf8');
const enGB = JSON.parse(enSource);
const es419 = JSON.parse(esSource);

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

// JSON.parse silently keeps the last occurrence of a duplicate object key.
// That can erase a whole translation namespace, so reject duplicates first.
function findDuplicateJsonKeys(filename, source) {
  const sourceFile = ts.parseJsonText(filename, source);
  const duplicates = [];

  function visit(node, objectPath = '') {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.text;
        const keyPath = objectPath ? `${objectPath}.${key}` : key;
        if (seen.has(key)) duplicates.push(keyPath);
        seen.add(key);
        visit(property.initializer, keyPath);
      }
      return;
    }
    ts.forEachChild(node, child => visit(child, objectPath));
  }

  visit(sourceFile);
  return duplicates;
}

for (const [filename, source] of [[enPath, enSource], [esPath, esSource]]) {
  const duplicates = findDuplicateJsonKeys(filename, source);
  if (duplicates.length > 0) {
    console.error(`❌ Duplicate translation keys in ${path.basename(filename)}:`);
    duplicates.forEach(key => console.error(`   - ${key}`));
    hasErrors = true;
  }
}

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
const hardcodedUi = [];
const hardcodedMessages = [];
// Proper names, technical identifiers and native language names do not need
// translation. Everything else visible in JSX or accessibility attributes does.
const UI_LITERAL_ALLOWLIST = new Set([
  'PICTOS.net',
  'PICTOS.net v',
  'PICTOS v',
  'hspencer@ead.cl',
  'Español',
  'English',
  'FrameNet:',
  'SVG',
]);
const UI_ATTRIBUTES = new Set(['aria-label', 'alt', 'placeholder', 'title']);

for (const file of sources) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) usedKeys.add(m[1]);

  const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visitUi(node) {
    let literal = null;
    let kind = null;
    if (ts.isJsxText(node)) {
      literal = node.text.trim().replace(/\s+/g, ' ');
      kind = 'text';
    } else if (
      ts.isJsxAttribute(node)
      && UI_ATTRIBUTES.has(node.name.text)
      && node.initializer
      && ts.isStringLiteral(node.initializer)
    ) {
      literal = node.initializer.text.trim();
      kind = node.name.text;
    }

    if (literal && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(literal) && !UI_LITERAL_ALLOWLIST.has(literal)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      hardcodedUi.push(`${path.relative(root, file)}:${line} (${kind}) ${JSON.stringify(literal)}`);
    }

    // Console entries, transient status and browser dialogs are UI too, even
    // though they are not JSX. Reject direct prose passed to these sinks.
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const callName = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? `${expression.expression.getText(sourceFile)}.${expression.name.text}`
          : '';
      const messageArgIndex = callName === 'addLog' || callName === 'onLog' ? 1 : 0;
      const checkedCalls = new Set([
        'addLog', 'onLog', 'setSubStatus', 'setError',
        'window.prompt', 'window.confirm', 'window.alert',
      ]);
      const arg = checkedCalls.has(callName) ? node.arguments[messageArgIndex] : undefined;
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg))) {
        const value = arg.getText(sourceFile);
        if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(value)) {
          const line = sourceFile.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
          hardcodedMessages.push(`${path.relative(root, file)}:${line} (${callName}) ${value}`);
        }
      }
    }
    ts.forEachChild(node, visitUi);
  }
  visitUi(sourceFile);
}

const unknownKeys = [...usedKeys].filter(k => !esKeys.has(k)).sort();
if (unknownKeys.length > 0) {
  console.error('❌ Keys used in code but missing from catalogs (render as raw key):');
  unknownKeys.forEach(key => console.error(`   - ${key}`));
  hasErrors = true;
}

if (hardcodedUi.length > 0) {
  console.error('❌ User-visible JSX text or accessibility attributes must use t():');
  hardcodedUi.forEach(item => console.error(`   - ${item}`));
  hasErrors = true;
}

if (hardcodedMessages.length > 0) {
  console.error('❌ User-visible logs, status messages and dialogs must use t():');
  hardcodedMessages.forEach(item => console.error(`   - ${item}`));
  hasErrors = true;
}

if (hasErrors) {
  console.error('\n❌ Translation validation failed!');
  process.exit(1);
}

console.log('✅ All translations validated successfully!');
console.log(`   Total keys: ${enKeys.size} | keys referenced in code: ${usedKeys.size}`);
