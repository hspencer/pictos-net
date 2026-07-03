/**
 * Batch Service — bulk Phase 3 (PRODUCIR) via the Vertex Batch API.
 *
 * Spec: specs/batch-generation.allium. Design: docs/BATCH_GENERATION_DESIGN.md.
 * Orchestrates the client side of batch generation; used by App.tsx
 * (startLibraryBatch handler, the 60s status poll and the drain effect).
 *
 * 50% of online cost, no rate limits, minutes-to-hours turnaround — a
 * "generate the library overnight" mode, not a live one.
 */

import type { RowData, GlobalConfig, VisualElement } from '../types';
import { composeGeminiPrompt } from './geminiService';
import { callBatchCreate, callBatchStatus, callBatchRowResult, type BatchJobView } from './aiClient';

/** Defensive elements accessor (same contract as App.tsx's local helper). */
function elementsOf(row: RowData): VisualElement[] {
    return Array.isArray(row.elements) ? row.elements : [];
}

export type { BatchJobView };

/** Batch supports Gemini image models only (Recraft has no batch API). */
export const BATCH_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];

/** True while the job still needs polling or draining. */
export function isActiveBatch(job: BatchJobView | null): boolean {
    return !!job && ['submitted', 'queued', 'running', 'collecting'].includes(job.state);
}

/**
 * Rows eligible for batching: Phase 2 completed (prompt present) and not
 * currently mid-generation. Used to enable the button and build the payload.
 */
export function batchableRows(rows: RowData[]): RowData[] {
    return rows.filter(r => !!r.prompt && r.bitmapStatus !== 'processing');
}

/**
 * Submit a library batch. Composes each row's FULL Phase 3 prompt with the
 * same composition as online generation (composeGeminiPrompt), so batch and
 * online pictograms are stylistically identical. Returns the created job id.
 * Throws QuotaExceededError (429) or Error (including the 409 "already
 * active" case) — the caller handles UI feedback.
 */
export async function submitLibraryBatch(
    libraryId: string,
    rows: RowData[],
    config: GlobalConfig,
): Promise<{ jobId: string; rowCount: number }> {
    const model = BATCH_MODELS.includes(config.generationModel)
        ? config.generationModel
        : BATCH_MODELS[0];

    const payload = batchableRows(rows).map(row => ({
        rowId: row.id,
        prompt: composeGeminiPrompt(elementsOf(row), row.prompt || '', row, config),
    }));
    if (payload.length === 0) throw new Error('No hay pictogramas con Fase 2 completa para enviar al lote');

    const res = await callBatchCreate({ libraryId, model, rows: payload });
    return { jobId: res.jobId, rowCount: res.rowCount };
}

/** Current batch job of a library, or null. */
export async function fetchBatchJob(libraryId: string): Promise<BatchJobView | null> {
    return callBatchStatus(libraryId);
}

export interface DrainedRow {
    rowId: string;
    bitmap?: string;
    error?: string;
}

/**
 * Drain collected results for the given rows. Fetches each per-row blob
 * once (deleted server-side on read) and reports outcomes via onRow so the
 * caller updates state incrementally.
 *
 * strict = true (final drain, job terminal): a missing blob ({pending}) is
 * an error — the collector guarantees explicit outcomes at the end.
 * strict = false (partial drain, job still running): pending rows are
 * silently skipped; they simply have not finished yet. This is what makes
 * pictograms appear one by one while the batch runs.
 */
export async function drainBatchResults(
    job: BatchJobView,
    rowIds: string[],
    onRow: (r: DrainedRow) => void,
    { strict = true }: { strict?: boolean } = {},
): Promise<void> {
    for (const rowId of rowIds) {
        try {
            const data = await callBatchRowResult(job.id, rowId);
            if (data.bitmap) onRow({ rowId, bitmap: data.bitmap });
            else if (data.error) onRow({ rowId, error: data.error });
            else if (strict) onRow({ rowId, error: 'Resultado del lote no disponible' });
            // !strict && pending → still generating; skip silently.
        } catch (err: any) {
            if (strict) onRow({ rowId, error: err.message || 'Error al recuperar resultado del lote' });
        }
    }
}
