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

import type { RowData, GlobalConfig, VisualElement, OpenAIImageQuality, PhaseExecution } from '../types';
import { composeGeminiPrompt } from './geminiService';
import {
    callBatchCreate, callBatchStatus, callBatchRowResult, type BatchJobView,
    callPipelineBatchCreate, callPipelineBatchPoll, callPipelineRowResult,
    type PipelineBatchJob, type PipelineRowResult,
} from './aiClient';

/** Defensive elements accessor (same contract as App.tsx's local helper). */
function elementsOf(row: RowData): VisualElement[] {
    return Array.isArray(row.elements) ? row.elements : [];
}

export type { BatchJobView };

/** Vertex batch supports Gemini image models only (Recraft has no Vertex batch API). */
export const BATCH_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];

/** Pipeline batch works with any provider config. Max 25 rows (15-min budget). */
export const PIPELINE_BATCH_MAX_ROWS = 25;

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
    if (!BATCH_MODELS.includes(config.generationModel)) {
        throw new Error('Vertex batch only supports Gemini image models');
    }
    const model = config.generationModel;

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

// ── Pipeline batch — full Phase 1→2→3 per row ────────────────────────────────

export type { PipelineBatchJob, PipelineRowResult };

/** True while the pipeline batch is still running. */
export function isActivePipelineBatch(job: PipelineBatchJob | null): boolean {
    return !!job && job.state === 'running';
}

/**
 * Rows eligible for pipeline batch: any row with an utterance that is not
 * currently mid-generation. Unlike the Vertex batch, Phase 2 is NOT required.
 */
export function pipelineBatchableRows(rows: RowData[]): RowData[] {
    return rows.filter(r => !!r.UTTERANCE?.trim() && r.bitmapStatus !== 'processing');
}

/**
 * Submit a pipeline batch job. Sends raw utterances; the server runs the full
 * Phase 1→2→3 pipeline for each row. Returns { jobId, rowCount }.
 * Throws QuotaExceededError on 429, Error otherwise.
 */
export async function submitPipelineBatch(
    libraryId: string,
    rows: RowData[],
    config: GlobalConfig,
): Promise<{ jobId: string; rowCount: number }> {
    const eligible = pipelineBatchableRows(rows).slice(0, PIPELINE_BATCH_MAX_ROWS);
    if (eligible.length === 0) throw new Error('No hay pictogramas con enunciados para enviar al lote');

    return callPipelineBatchCreate({
        libraryId,
        rows: eligible.map(r => ({ rowId: r.id, utterance: r.UTTERANCE })),
        config: {
            lang: config.lang,
            geoContext: config.geoContext,

            comprenderModel: config.comprenderModel,
            componerModel: config.componerModel,
            generationModel: config.generationModel,
            openaiImageQuality: config.openaiImageQuality ?? 'low',
            visualStylePrompt: config.visualStylePrompt,
            domainContext: config.domainContext,
            svgStyleDefs: config.svgStyleDefs,
            paletteColors: (config as any).paletteColors,
        },
    });
}

/** Current pipeline batch job of a library, or null. */
export async function fetchPipelineBatchJob(libraryId: string): Promise<PipelineBatchJob | null> {
    return callPipelineBatchPoll(libraryId);
}

export interface PipelineDrainedRow {
    phaseExecutions?: PhaseExecution[];
    generationQuality?: OpenAIImageQuality;
    rowId: string;
    nluData?: any;
    elements?: any[];
    prompt?: string;
    svg?: string;
    bitmap?: string;
    error?: string;
    pending?: boolean;
    deferred?: boolean;
    rowState?: 'completed' | 'error' | 'phase3_error' | 'deferred';
    failureSource?: string;
    recoverable?: boolean;
}

/**
 * Drain one pipeline batch row result. Returns { pending: true } when the row
 * has not completed yet. Callers should skip pending rows and retry next poll.
 */
export async function drainPipelineRow(
    libraryId: string,
    jobId: string,
    rowId: string,
): Promise<PipelineDrainedRow> {
    try {
        const result = await callPipelineRowResult(libraryId, jobId, rowId);
        return { rowId, ...result };
    } catch (err: any) {
        return { rowId, error: err.message || 'Error al recuperar resultado' };
    }
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
