import type { RowData } from '../types';

/** A failed Phase 3 may resume only from a coherent completed Phase 2 snapshot. */
/** Cause of the last failure of a phase, shown only while that phase is in error. */
export function failureFor(row: RowData, phase: 1 | 2 | 3 | 5): string | undefined {
  const status = { 1: row.nluStatus, 2: row.visualStatus, 3: row.bitmapStatus, 5: row.structuredSvgStatus }[phase];
  return status === 'error' && row.lastFailure?.phase === phase ? row.lastFailure.message : undefined;
}

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
