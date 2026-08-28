import type { RowData } from '../types';

/** A failed Phase 3 may resume only from a coherent completed Phase 2 snapshot. */
export function canRetryPhase3Only(row: RowData): boolean {
  return row.bitmapStatus === 'error'
    && row.nluStatus === 'completed'
    && row.visualStatus === 'completed'
    && typeof row.NLU === 'object'
    && row.NLU !== null
    && !Array.isArray(row.NLU)
    && Array.isArray(row.elements)
    && row.elements.length > 0
    && !!row.prompt?.trim();
}
