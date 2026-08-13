import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGraphDump, GRAPH_DUMP_SCHEMA_VERSION, rekeyBoardsForLibrary } from './libraryTransferService.ts';
import type { Board, GlobalConfig, RowData } from '../types.ts';

const board: Board = {
  id: 'board-core',
  libraryId: 'source-library',
  name: 'Core board',
  grid: { rows: 1, cols: 1 },
  cells: [{ id: 'cell-0-0', position: { rowIndex: 0, colIndex: 0 }, color: 'amarillo', rowId: 'row-yo' }],
  showLabels: true,
  createdAt: '2026-08-13T00:00:00.000Z',
  modifiedAt: '2026-08-13T00:00:00.000Z',
};

test('graph dump keeps boards and per-row audio together', () => {
  const row = {
    id: 'row-yo',
    UTTERANCE: 'Yo',
    audio: 'data:audio/webm;base64,AAAA',
    status: 'completed',
    nluStatus: 'completed',
    visualStatus: 'completed',
    bitmapStatus: 'completed',
  } as RowData;

  const dump = createGraphDump({
    appVersion: '2.4.1',
    timestamp: '2026-08-13T00:00:00.000Z',
    config: { name: 'Tablero' } as GlobalConfig,
    rows: [row],
    svgs: [],
    sequences: [],
    boards: [board],
  });

  assert.equal(dump.schemaVersion, GRAPH_DUMP_SCHEMA_VERSION);
  assert.equal(dump.rows[0].audio, row.audio);
  assert.deepEqual(dump.boards, [board]);
  assert.equal(dump.boards[0].cells[0].rowId, dump.rows[0].id);
});

test('template/import re-keying preserves board identity, layout, colours and row links', () => {
  const [rekeyed] = rekeyBoardsForLibrary([board], 'destination-library');

  assert.equal(rekeyed.libraryId, 'destination-library');
  assert.equal(rekeyed.id, board.id);
  assert.deepEqual(rekeyed.grid, board.grid);
  assert.deepEqual(rekeyed.cells, board.cells);
  assert.notEqual(rekeyed, board);
});

test('the deployable Tablero example contains its complete 6x6 board and audio rows', () => {
  const templateUrl = new URL('../public/libraries/tablero_graph_2026-08-13.json', import.meta.url);
  const template = JSON.parse(readFileSync(templateUrl, 'utf8'));
  const expectedLabels = [
    'Yo', 'Tú', 'Qué', 'Dónde', 'Sí', 'No',
    'Querer', 'Ir', 'Ver', 'Hacer', 'Más', 'Terminado',
    'Comer', 'Tomar', 'Jugar', 'Ayuda', 'Diferente', 'Igual',
    'Parar', 'Poner', 'Tener', 'Gustar', 'Bueno', 'Malo',
    'Arriba', 'Abajo', 'Dentro', 'Fuera', 'Grande', 'Pequeño',
    'Esto', 'Eso', 'Cosa', 'Persona', 'Hola', 'Adiós',
  ];
  const expectedColours = [
    'amarillo', 'amarillo', 'rosa', 'rosa', 'morado', 'morado',
    'verde', 'verde', 'verde', 'verde', 'azul', 'azul',
    'verde', 'verde', 'verde', 'verde', 'azul', 'azul',
    'verde', 'verde', 'verde', 'verde', 'azul', 'azul',
    'rosa', 'rosa', 'rosa', 'rosa', 'azul', 'azul',
    'amarillo', 'amarillo', 'naranja', 'naranja', 'morado', 'morado',
  ];

  assert.equal(template.schemaVersion, GRAPH_DUMP_SCHEMA_VERSION);
  assert.equal(template.rows.length, 36);
  assert.ok(template.rows.every((row: RowData) => row.audio));
  assert.equal(template.boards.length, 1);

  const [templateBoard] = template.boards as Board[];
  assert.deepEqual(templateBoard.grid, { rows: 6, cols: 6 });
  assert.equal(templateBoard.cells.length, 36);

  const rowsById = new Map<string, RowData>(template.rows.map((row: RowData) => [row.id, row]));
  const orderedCells = [...templateBoard.cells].sort((a, b) =>
    a.position.rowIndex - b.position.rowIndex || a.position.colIndex - b.position.colIndex
  );

  assert.deepEqual(orderedCells.map(cell => rowsById.get(cell.rowId!)?.UTTERANCE), expectedLabels);
  assert.deepEqual(orderedCells.map(cell => cell.color), expectedColours);
  assert.ok(orderedCells.every(cell => rowsById.get(cell.rowId!)?.audio));
});
