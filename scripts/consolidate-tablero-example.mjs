#!/usr/bin/env node

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const improvedPath = process.argv[2];
if (!improvedPath) {
  throw new Error('Usage: node scripts/consolidate-tablero-example.mjs <improved-library.json>');
}

const canonicalUrl = new URL('../public/libraries/tablero_graph_2026-08-13.json', import.meta.url);
const indexUrl = new URL('../public/libraries/index.json', import.meta.url);
const canonicalPath = fileURLToPath(canonicalUrl);

const improved = JSON.parse(readFileSync(improvedPath, 'utf8'));
const canonical = JSON.parse(readFileSync(canonicalUrl, 'utf8'));

if (!Array.isArray(improved.rows) || improved.rows.length !== 36) {
  throw new Error('The improved library must contain exactly 36 rows.');
}
if (!Array.isArray(improved.boards) || improved.boards.length !== 1) {
  throw new Error('The improved library must contain exactly one board.');
}

const canonicalRows = new Map(canonical.rows.map(row => [row.id, row]));
const improvedIds = new Set(improved.rows.map(row => row.id));
if (improvedIds.size !== improved.rows.length) {
  throw new Error('The improved library contains duplicate row ids.');
}

const mergedRows = improved.rows.map(row => {
  const previous = canonicalRows.get(row.id);
  if (!previous || previous.UTTERANCE !== row.UTTERANCE) {
    throw new Error(`Cannot safely match audio for row ${row.id} (${row.UTTERANCE}).`);
  }
  const audio = row.audio || previous.audio;
  if (!audio) throw new Error(`Missing audio for row ${row.id} (${row.UTTERANCE}).`);
  return { ...row, audio };
});

const mergedBoards = improved.boards.map(board => ({
  ...board,
  libraryId: 'template-tablero',
}));
const linkedRowIds = mergedBoards.flatMap(board => board.cells.map(cell => cell.rowId).filter(Boolean));
if (linkedRowIds.length !== 36 || linkedRowIds.some(rowId => !improvedIds.has(rowId))) {
  throw new Error('The board must link all 36 cells to rows in the improved library.');
}

const merged = {
  ...improved,
  schemaVersion: 3,
  boards: mergedBoards,
  rows: mergedRows,
};

writeFileSync(canonicalUrl, `${JSON.stringify(merged, null, 2)}\n`);

const index = JSON.parse(readFileSync(indexUrl, 'utf8'));
const entry = index.libraries.find(library => library.filename === 'tablero_graph_2026-08-13.json');
if (!entry) throw new Error('Tablero is missing from public/libraries/index.json.');
entry.filesize = statSync(canonicalPath).size;
writeFileSync(indexUrl, `${JSON.stringify(index, null, 2)}\n`);

console.log(JSON.stringify({
  rows: mergedRows.length,
  rowsWithAudio: mergedRows.filter(row => row.audio).length,
  boards: mergedBoards.length,
  linkedCells: linkedRowIds.length,
  filesize: entry.filesize,
}, null, 2));
