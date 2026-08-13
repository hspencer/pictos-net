import type { Board, GlobalConfig, RowData, Sequence } from '../types';

export const GRAPH_DUMP_SCHEMA_VERSION = 3;

interface GraphDumpInput {
  appVersion: string;
  timestamp: string;
  config: GlobalConfig;
  rows: RowData[];
  svgs: unknown[];
  sequences: Sequence[];
  boards: Board[];
}

export function rekeyBoardsForLibrary(boards: Board[], libraryId: string): Board[] {
  return boards.map(board => ({ ...board, libraryId }));
}

export function createGraphDump({
  appVersion,
  timestamp,
  config,
  rows,
  svgs,
  sequences,
  boards,
}: GraphDumpInput) {
  const sanitizedRows = rows.map(row => {
    if (row.status !== 'processing') return row;

    const hasNLU = row.NLU && (typeof row.NLU === 'string'
      ? row.NLU.trim() !== ''
      : Object.keys(row.NLU).length > 0);
    const hasVisual = Boolean(
      (row.elements && row.elements.length > 0)
      || (row.prompt && row.prompt.trim() !== ''),
    );
    const hasBitmap = Boolean(row.bitmap && row.bitmap.trim() !== '');

    return {
      ...row,
      status: hasNLU || hasVisual || hasBitmap ? 'completed' as const : 'idle' as const,
    };
  });

  return {
    schemaVersion: GRAPH_DUMP_SCHEMA_VERSION,
    appVersion,
    type: 'pictonet_graph_dump' as const,
    timestamp,
    config,
    rows: sanitizedRows,
    svgs,
    sequences,
    boards,
  };
}
