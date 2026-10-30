#!/usr/bin/env node
/**
 * Rewrite the shipped library templates (public/libraries/*.json) through the
 * shared configuration migration: legacy fields removed and every declared
 * model dropped, so a template follows the defaults of the version that
 * imports it. Rows, media and sequences are untouched. Legacy svgStyles stay
 * in the file: the app converts them on import (the base palette is TS-only).
 *
 *   node scripts/migrate-library-templates.mjs          # report only
 *   node scripts/migrate-library-templates.mjs --write  # rewrite in place
 *
 * Node 18 compatible (no import.meta.dirname).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLibraryConfig } from '../netlify/functions/_shared/libraryConfigMigration.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/libraries');
const write = process.argv.includes('--write');

let touched = 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').sort()) {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, 'utf8');
  const data = JSON.parse(text);
  if (!data.config) continue;
  const { config, changes } = migrateLibraryConfig(data.config, { pins: 'drop' });
  if (!changes.length) continue;
  touched++;
  console.log(`${file}\n  ${changes.join('\n  ')}`);
  if (!write) continue;
  // Keep each file's own layout: pretty (2 spaces) or minified, same trailing newline.
  const pretty = text.startsWith('{\n');
  const out = JSON.stringify({ ...data, config }, null, pretty ? 2 : undefined) + (text.endsWith('\n') ? '\n' : '');
  fs.writeFileSync(full, out);
}
console.log(`${touched} template(s) ${write ? 'rewritten' : 'would change (dry run; pass --write)'}`);
