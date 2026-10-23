#!/usr/bin/env node
/**
 * NLU corpus rescue (plan F5). Brings stored NLU back to the current document
 * contract so COMPONER accepts it, without regenerating anything and without
 * losing what was there.
 *
 *   node scripts/migrate-nlu.mjs propose <library.json | directory> [out.json]
 *     Inventory of contract failures per path: each distinct short value with
 *     its count and a suggested target, all pending approval. Free text (long
 *     or multi-word values, e.g. intent sentences) is counted, never printed.
 *
 *   node scripts/migrate-nlu.mjs apply <library.json> <out.json> [approved.json]
 *     Writes a migrated COPY; never touches the input. Applies:
 *       1. case: the value equals an allowed value ignoring case (always)
 *       2. approved: an entry of the approved table (path + from -> to)
 *     Every change is recorded on its row in nluMigration with the original
 *     value. Row ids, utterances, media and everything else are untouched.
 *     Prints a report: rows valid before/after and what still fails, by path.
 *
 * Approved table: { "approved": [{ "path": "/visual_guidelines/temporal",
 *   "from": "ahora", "to": "immediate" }] }  (from matches ignoring case;
 *   path uses * for array indices, as the propose report prints it).
 * Node 18 compatible. Reads and writes local files only; no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateDocument, VERSION as NLU_VERSION } from '../schemas/pictos-nlu-schema/index.js';

/** Suggestions only: they are applied after a person approves them. */
const SUGGESTIONS = {
  '/visual_guidelines/temporal': { ahora: 'immediate', now: 'immediate', 'futuro cercano': 'near_future' },
  '/pragmatics/expected_response': { acknowledgement: 'acknowledgment' },
  '/metadata/speech_act': { assertion: 'assertive', solicitud: 'directive', request: 'directive', pregunta: 'interrogative', question: 'interrogative' },
  '/pragmatics/politeness': { neutro: 'neutral', neutra: 'neutral', 'cortés': 'polite', cortes: 'polite' },
  '/pragmatics/formality': { neutro: 'neutral', neutra: 'neutral', alta: 'formal', baja: 'informal' },
};

const isFreeText = value => typeof value !== 'string' || value.length > 32 || /\s\S+\s/.test(value);
const pattern = instancePath => instancePath.replace(/\/\d+(?=\/|$)/g, '/*');
const fold = value => String(value).trim().toLocaleLowerCase('es');
const getAt = (doc, instancePath) => instancePath.split('/').slice(1).reduce((node, key) => node?.[key], doc);
const setAt = (doc, instancePath, value) => {
  const keys = instancePath.split('/').slice(1);
  const parent = keys.slice(0, -1).reduce((node, key) => node[key], doc);
  parent[keys.at(-1)] = value;
};

function rowsOf(library) {
  const rows = Array.isArray(library) ? library : library?.rows;
  if (!Array.isArray(rows)) throw new Error('Library must be an array of rows or have a rows array');
  return rows;
}

function nluOf(row) {
  if (row?.NLU && typeof row.NLU === 'object') return { nlu: row.NLU, encoded: false };
  if (typeof row?.NLU === 'string') {
    try { return { nlu: JSON.parse(row.NLU), encoded: true }; } catch { return null; }
  }
  return null;
}

function enumErrors(nlu) {
  if (validateDocument(nlu)) return [];
  return validateDocument.errors.filter(e => e.keyword === 'enum');
}

/** Decide one enum failure: [target, rule] or null when a person must decide. */
export function resolveValue(instancePath, value, allowed, approved = []) {
  if (typeof value !== 'string') return null;
  const exact = allowed.find(option => fold(option) === fold(value));
  if (exact) return [exact, 'case'];
  const where = pattern(instancePath);
  const entry = approved.find(a => a.path === where && fold(a.from) === fold(value) && allowed.includes(a.to));
  return entry ? [entry.to, 'approved'] : null;
}

export function migrateLibrary(library, approved = [], now = new Date().toISOString()) {
  const out = structuredClone(library);
  const report = { contract: NLU_VERSION, rows: 0, withNlu: 0, validBefore: 0, validAfter: 0, changes: { case: 0, approved: 0 }, remaining: {} };
  for (const row of rowsOf(out)) {
    report.rows++;
    const parsed = nluOf(row);
    if (!parsed) continue;
    report.withNlu++;
    const { nlu, encoded } = parsed;
    if (validateDocument(nlu)) { report.validBefore++; report.validAfter++; continue; }
    const changes = [];
    for (const error of enumErrors(nlu)) {
      const value = getAt(nlu, error.instancePath);
      const resolved = resolveValue(error.instancePath, value, error.params.allowedValues, approved);
      if (!resolved) continue;
      setAt(nlu, error.instancePath, resolved[0]);
      changes.push({ path: error.instancePath, from: value, to: resolved[0], rule: resolved[1] });
      report.changes[resolved[1]]++;
    }
    if (changes.length) {
      row.NLU = encoded ? JSON.stringify(nlu) : nlu;
      const previous = Array.isArray(row.nluMigration?.changes) ? row.nluMigration.changes : [];
      row.nluMigration = { tool: 'migrate-nlu', contract: NLU_VERSION, at: now, changes: [...previous, ...changes] };
    }
    if (validateDocument(nlu)) { report.validAfter++; continue; }
    for (const error of validateDocument.errors) {
      const key = `${pattern(error.instancePath)} ${error.keyword}`;
      report.remaining[key] = (report.remaining[key] ?? 0) + 1;
    }
  }
  report.remaining = Object.fromEntries(Object.entries(report.remaining).sort((a, b) => b[1] - a[1]));
  return { library: out, report };
}

export function proposeTable(libraries) {
  const byPath = {};
  for (const library of libraries) {
    for (const row of rowsOf(library)) {
      const parsed = nluOf(row);
      if (!parsed) continue;
      for (const error of enumErrors(parsed.nlu)) {
        const where = pattern(error.instancePath);
        const slot = byPath[where] ??= { allowed: error.params.allowedValues, freeText: 0, values: {} };
        const value = getAt(parsed.nlu, error.instancePath);
        if (isFreeText(value)) { slot.freeText++; continue; }
        const resolved = resolveValue(error.instancePath, value, slot.allowed);
        const suggestion = SUGGESTIONS[where]?.[fold(value)];
        const item = slot.values[value] ??= {
          count: 0,
          ...(resolved ? { to: resolved[0], rule: 'case (automatic)' }
            : suggestion ? { to: suggestion, rule: 'suggested', status: 'pending' }
            : { to: null, rule: 'needs a decision', status: 'pending' }),
        };
        item.count++;
      }
    }
  }
  return { contract: NLU_VERSION, note: 'Free text is counted, never printed. Approve by copying entries to approved.json.', paths: byPath };
}

function readLibraries(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [JSON.parse(fs.readFileSync(target, 'utf8'))];
  return fs.readdirSync(target).filter(f => f.endsWith('.json') && f !== 'index.json')
    .map(f => JSON.parse(fs.readFileSync(path.join(target, f), 'utf8')));
}

function main([mode, input, output, table]) {
  if (mode === 'propose' && input) {
    const json = JSON.stringify(proposeTable(readLibraries(input)), null, 2);
    if (output) fs.writeFileSync(output, json + '\n'); else process.stdout.write(json + '\n');
    return;
  }
  if (mode === 'apply' && input && output) {
    if (path.resolve(input) === path.resolve(output)) throw new Error('Refusing to overwrite the input; write a copy');
    const approved = table ? JSON.parse(fs.readFileSync(table, 'utf8')).approved ?? [] : [];
    const { library, report } = migrateLibrary(JSON.parse(fs.readFileSync(input, 'utf8')), approved);
    fs.writeFileSync(output, JSON.stringify(library, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stderr.write('usage: migrate-nlu.mjs propose <library|dir> [out] | apply <in> <out> [approved.json]\n');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main(process.argv.slice(2));
