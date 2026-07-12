/**
 * AI Client — always-proxy abstraction.
 *
 * All AI calls go through Netlify Functions (both in dev with `netlify dev`
 * and in production). No API key ever reaches the browser.
 *
 * Provides:
 *   callClaude(params)   → api-claude function (phases 1, 2, 5)
 *   callRecraft(params)  → api-recraft function (phase 3)
 */

import { getCurrentUser, requestLogin } from "../components/AuthGate";

/**
 * Thrown by callProxy when the server returns HTTP 429 (quota exhausted).
 * Carries the user's current daily usage so the UI can display it.
 */
export class QuotaExceededError extends Error {
  constructor(public readonly units_used: number, public readonly limit: number) {
    super('Daily quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

export async function getAuthToken(): Promise<string> {
    let user = getCurrentUser();
    if (!user) {
        user = await requestLogin();
    }
    // Proactively refresh when the token expires within 2 minutes.
    // Background functions call GoTrue to verify the JWT after a small delay
    // (cold start + setup), so tokens right at the expiry boundary get rejected
    // even though they looked valid client-side when the request was sent.
    const expiresAt: number | undefined = (user as any).token?.expires_at;
    const nearExpiry = expiresAt !== undefined && (expiresAt - Date.now()) < 120_000;
    try {
        // Pass true to force-refresh when close to expiry; undefined = normal.
        const token = await (user as any).jwt(nearExpiry ? true : undefined);
        if (!token || typeof token !== 'string') throw new Error('jwt() devolvió un token vacío');
        return token;
    } catch {
        // GoTrue token-refresh failure (e.g. "401 status code (no body)" from an
        // expired session, or a suspended Google OAuth project). Prompt re-login.
        user = await requestLogin();
        const token = await user.jwt();
        if (!token || typeof token !== 'string') throw new Error('Sesión expirada — por favor inicia sesión de nuevo');
        return token;
    }
}

async function callProxy(endpoint: string, params: object): Promise<any> {
    const MAX_RETRIES = 2;

    // In Vite dev mode (`netlify dev`), skip auth — the function has a NETLIFY_DEV bypass.
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLocalDev) {
        const token = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(`/.netlify/functions/${endpoint}`, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(params),
        });

        if (res.ok) return res.json();

        if (res.status === 429) {
            const body = await res.json().catch(() => ({}));
            throw new QuotaExceededError(body.units_used ?? 0, body.limit ?? 100);
        }

        if ([502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
            const delay = (attempt + 1) * 3000;
            console.warn(`[aiClient] ${res.status} on attempt ${attempt + 1}, retrying in ${delay}ms…`);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Proxy error ${res.status}`);
    }

    throw new Error('Max retries exceeded');
}

export interface CacheControl {
    type: 'ephemeral';
}

export interface ClaudeTextBlock {
    type: 'text';
    text: string;
    cache_control?: CacheControl;
}

export interface ClaudeParams {
    model: string;
    max_tokens?: number;
    /** Accepts a plain string or a content-block array (required for cache_control). */
    system?: string | ClaudeTextBlock[];
    tools?: object[];
    tool_choice?: object;
    messages: object[];
}

export interface ClaudeResponse {
    content: Array<{ type: string; name?: string; input?: any; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
}

/**
 * Call Claude via the api-claude Netlify function.
 * Returns the raw Anthropic messages response.
 */
export async function callClaude(params: ClaudeParams): Promise<ClaudeResponse> {
    return callProxy('api-claude', params);
}

/**
 * Call a Gemini text model via the api-gemini-nlu Netlify function.
 * Used for Phase 1 (COMPRENDER) and Phase 2 (COMPONER) when a gemini-* model is selected.
 * Returns a ClaudeResponse-compatible shape (translated by geminiResponseToClaude server-side).
 */
export async function callGeminiNlu(params: ClaudeParams): Promise<ClaudeResponse> {
    return callProxy('api-gemini-nlu', params);
}

/**
 * Call the Phase 5 structuring model (vision + tool use).
 * claude-* → api-claude (synchronous). gemini-* → background job + poll, so
 * slow geometry-authoring (redraw) is not bound by the 90s function timeout.
 * Both return a ClaudeResponse-compatible shape.
 */
export async function callStructuringModel(params: ClaudeParams): Promise<ClaudeResponse> {
    if (params.model.startsWith('gemini-')) {
        return callStructuringBackground(params);
    }
    return callProxy('api-claude', params);
}

/**
 * Start a Gemini structuring background job and poll for the result.
 * Long-poll (up to ~6 min) because authoring geometry can take minutes.
 */
/**
 * Authorize a background job. Background functions can't verify the Identity
 * JWT (their Authorization header is stripped and a loopback fetch to GoTrue
 * returns a Netlify edge 404), so this synchronous endpoint verifies the user
 * via clientContext and deposits a single-use grant keyed by jobId that the
 * worker consumes. Must be called before invoking any background worker.
 */
async function authorizeJob(jobId: string, reqHeaders: Record<string, string>): Promise<void> {
    const res = await fetch('/.netlify/functions/api-authorize', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
        throw new Error('No autorizado — por favor inicia sesión de nuevo');
    }
}

async function callStructuringBackground(params: ClaudeParams): Promise<ClaudeResponse> {
    const jobId = 'struct-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let authToken: string | null = null;
    if (!isLocalDev) {
        authToken = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
        await authorizeJob(jobId, reqHeaders);
    }

    const startRes = await fetch('/.netlify/functions/api-gemini-structure-background', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ ...params, jobId, ...(authToken ? { _authToken: authToken } : {}) }),
    });
    if (!startRes.ok && startRes.status !== 202) {
        throw new Error(`Fallo al iniciar el trabajo de estructurado: ${startRes.statusText}`);
    }

    // Poll up to ~6 min (180 × 2s). Redraw of complex pictograms can take minutes.
    for (let i = 0; i < 180; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`/.netlify/functions/api-gemini-structure-poll?jobId=${jobId}`, {
            headers: reqHeaders,
        });
        if (!pollRes.ok) {
            if ([502, 503, 504].includes(pollRes.status)) continue;
            const err = await pollRes.json().catch(() => ({}));
            throw new Error(err.error || `Proxy error ${pollRes.status}`);
        }

        const data = await pollRes.json();
        if (data.response) return data.response as ClaudeResponse;
        if (data.quotaExceeded) throw new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
        if (data.error) throw new Error(data.error);
        if (data.pending) continue;
    }

    throw new Error('Tiempo de espera agotado (6 min) estructurando el pictograma');
}

/**
 * Extract the tool_use block from a Claude response.
 * Throws if the model did not invoke the tool (hard failure per spec).
 */
export function extractToolUse(response: ClaudeResponse, toolName: string): any {
    const block = response.content?.find(b => b.type === 'tool_use' && b.name === toolName);
    if (!block) {
        throw new Error(`Claude did not invoke tool '${toolName}' (stop_reason: ${response.stop_reason})`);
    }
    return block.input;
}

export interface RecraftParams {
    prompt: string;
    /** Preferred colors in hex format (max 10). Sent as controls.colors to Recraft. */
    colors?: string[];
    /** Recraft model to use. Defaults to recraftv4_1_vector. */
    model?: 'recraftv4_1' | 'recraftv4_1_vector';
}

export interface RecraftResponse {
    svg?: string;    // present for recraftv4_1_vector
    bitmap?: string; // present for recraftv4_1 (base64 PNG data URL)
}

/**
 * Retry progress payload forwarded by the poll functions while the background
 * worker is backing off on provider 429/5xx. Used to narrate the wait in the
 * UI log instead of leaving a mute spinner.
 */
interface RetryingInfo {
    attempt: number;
    of: number;
    waitMs: number;
    status: number;
}

/**
 * Build the user-facing log line for a worker retry. Used by callRecraft and
 * callGemini below whenever the poll response carries `retrying`.
 */
function retryStatusMessage(r: RetryingInfo): string {
    const cause = r.status === 429 ? 'proveedor saturado (429)' : `error ${r.status} del proveedor`;
    return `[PRODUCIR] ${cause} — reintento ${r.attempt}/${r.of}, esperando ${Math.round(r.waitMs / 1000)}s…`;
}

/**
 * Call Recraft via the Background Worker and polling.
 * Returns { svg } for vector model or { bitmap } for raster model.
 * `onStatus` receives human-readable retry progress for the UI log.
 */
export async function callRecraft(params: RecraftParams, onStatus?: (msg: string) => void): Promise<RecraftResponse> {
    const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let authToken: string | null = null;
    if (!isLocalDev) {
        authToken = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
        await authorizeJob(jobId, reqHeaders);
    }

    // 1. Iniciar el worker en segundo plano.
    // _authToken is included in the body as a fallback in case the Netlify
    // routing layer strips the Authorization header for background functions.
    const startRes = await fetch('/.netlify/functions/api-recraft-worker-background', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ ...params, jobId, ...(authToken ? { _authToken: authToken } : {}) }),
    });

    // Netlify Background Functions devuelven 202 Accepted.
    if (!startRes.ok && startRes.status !== 202) {
        throw new Error(`Fallo al iniciar el trabajo de Recraft: ${startRes.statusText}`);
    }

    // 2. Hacer polling hasta por 120 segundos — el worker reintenta 429 del
    //    proveedor con backoff exponencial (presupuesto interno de 90s), así
    //    que la ventana debe superar generación + reintentos.
    let lastRetryAttempt = 0;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`/.netlify/functions/api-recraft-poll?jobId=${jobId}`, {
            headers: reqHeaders
        });

        if (!pollRes.ok) {
            // Ignorar errores temporales 5xx de red y seguir intentando
            if ([502, 503, 504].includes(pollRes.status)) continue;
            const err = await pollRes.json().catch(() => ({}));
            throw new Error(err.error || `Proxy error ${pollRes.status}`);
        }

        const data = await pollRes.json();

        if (data.svg) return { svg: data.svg };
        if (data.bitmap) return { bitmap: data.bitmap };
        if (data.quotaExceeded) {
            throw new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
        }
        if (data.error) throw new Error(data.error);
        if (data.pending) {
            if (data.retrying && data.retrying.attempt !== lastRetryAttempt) {
                lastRetryAttempt = data.retrying.attempt;
                onStatus?.(retryStatusMessage(data.retrying));
            }
            continue;
        }
    }

    throw new Error('Tiempo de espera agotado tras 120s generando el pictograma');
}

export interface GeminiParams {
    prompt: string;
    model: string;
}

export interface GeminiResponse {
    bitmap: string; // base64 PNG data URL
}

/**
 * Call Gemini image generation via Background Worker and polling.
 * Returns { bitmap } — a base64 PNG data URL.
 * `onStatus` receives human-readable retry progress for the UI log.
 */
export async function callGemini(params: GeminiParams, onStatus?: (msg: string) => void): Promise<GeminiResponse> {
    const jobId = 'gemini-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let authToken: string | null = null;
    if (!isLocalDev) {
        authToken = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
        await authorizeJob(jobId, reqHeaders);
    }

    const startRes = await fetch('/.netlify/functions/api-gemini-worker-background', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ ...params, jobId, ...(authToken ? { _authToken: authToken } : {}) }),
    });

    if (!startRes.ok && startRes.status !== 202) {
        throw new Error(`Fallo al iniciar el trabajo de Gemini: ${startRes.statusText}`);
    }

    // Polling hasta 120s: el worker reintenta 429 (cuota compartida de Vertex)
    // con backoff exponencial (presupuesto interno de 90s), así que la espera
    // puede superar los 60s.
    let lastRetryAttempt = 0;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`/.netlify/functions/api-gemini-poll?jobId=${jobId}`, {
            headers: reqHeaders,
        });

        if (!pollRes.ok) {
            if ([502, 503, 504].includes(pollRes.status)) continue;
            const err = await pollRes.json().catch(() => ({}));
            throw new Error(err.error || `Proxy error ${pollRes.status}`);
        }

        const data = await pollRes.json();

        if (data.bitmap) return { bitmap: data.bitmap };
        if (data.quotaExceeded) {
            throw new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
        }
        if (data.error) throw new Error(data.error);
        if (data.pending) {
            if (data.retrying && data.retrying.attempt !== lastRetryAttempt) {
                lastRetryAttempt = data.retrying.attempt;
                onStatus?.(retryStatusMessage(data.retrying));
            }
            continue;
        }
    }

    throw new Error('Tiempo de espera agotado tras 120s generando imagen con Gemini');
}

// ── Batch generation (specs/batch-generation.allium) ───────────────────────

export interface BatchJobView {
    id: string;
    libraryId: string;
    model: string;
    state: 'submitted' | 'queued' | 'running' | 'collecting' | 'completed' | 'failed' | 'expired';
    rowIds: string[];
    rowCount: number;
    succeededCount: number;
    failedCount: number;
    createdAt: string;
    collectedAt?: string;
    none?: boolean;
}

/** Shared auth headers builder for the batch endpoints. */
async function batchHeaders(): Promise<Record<string, string>> {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!import.meta.env.DEV) {
        const token = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    return reqHeaders;
}

/**
 * Create a batch job (api-batch-create). Used by batchService.
 * Throws QuotaExceededError on 429 and Error with the server message otherwise.
 */
export async function callBatchCreate(body: {
    libraryId: string;
    model: string;
    rows: { rowId: string; prompt: string }[];
}): Promise<{ jobId: string; state: string; rowCount: number }> {
    const res = await fetch('/.netlify/functions/api-batch-create', {
        method: 'POST',
        headers: await batchHeaders(),
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 && data.quotaExceeded) {
        throw new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
    }
    if (!res.ok) throw new Error(data.error || `Batch create failed (${res.status})`);
    return data;
}

/**
 * Read the library's batch job (api-batch-status). Returns null when none.
 * Polled by App.tsx every 60s while a job is active. Used by batchService.
 */
export async function callBatchStatus(libraryId: string): Promise<BatchJobView | null> {
    const res = await fetch(`/.netlify/functions/api-batch-status?libraryId=${encodeURIComponent(libraryId)}`, {
        headers: await batchHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Batch status failed (${res.status})`);
    return data.none ? null : (data as BatchJobView);
}

/**
 * Fetch one collected batch row result through the existing gemini poll
 * endpoint (the collector wrote one blob per row). Single GET, no loop:
 * the blob either exists (bitmap or error; deleted on read) or the job is
 * still collecting ({pending}). Used by batchService.drainBatchRow.
 */
export async function callBatchRowResult(jobId: string, rowId: string): Promise<{ bitmap?: string; error?: string; pending?: boolean }> {
    const key = `batchrow-${jobId}-${rowId}`;
    const res = await fetch(`/.netlify/functions/api-gemini-poll?jobId=${encodeURIComponent(key)}`, {
        headers: await batchHeaders(),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Batch row fetch failed (${res.status})`);
    }
    return res.json();
}

// ── Pipeline batch (full Phase 1→2→3 per row) ─────────────────────────────

export interface PipelineBatchRow {
    rowId: string;
    utterance: string;
}

export interface PipelineBatchJob {
    id: string;
    libraryId: string;
    state: 'running' | 'completed' | 'failed';
    model: string;
    rowCount: number;
    rowIds: string[];
    succeededCount: number;
    failedCount: number;
    startedAt?: string;
    completedAt?: string;
    none?: boolean;
}

export interface PipelineRowResult {
    nluData?: any;
    elements?: any[];
    prompt?: string;
    svg?: string;
    bitmap?: string;
    error?: string;
    pending?: boolean;
}

/**
 * Create a full-pipeline batch job (api-pipeline-batch-create).
 * Accepts raw utterances; server runs Phase 1→2→3 for each row.
 * Works with any provider config (Claude/Gemini NLU, Recraft/Gemini image).
 * Max 25 rows.
 */
export async function callPipelineBatchCreate(body: {
    libraryId: string;
    rows: PipelineBatchRow[];
    config: object;
}): Promise<{ jobId: string; rowCount: number }> {
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLocalDev) {
        const token = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/.netlify/functions/api-pipeline-batch-create', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 && data.quotaExceeded) throw new QuotaExceededError(data.units_used ?? 0, data.limit ?? 100);
    if (!res.ok) throw new Error(data.error || `Pipeline batch create failed (${res.status})`);
    return data;
}

/** Poll the pipeline batch job state for a library. */
export async function callPipelineBatchPoll(libraryId: string): Promise<PipelineBatchJob | null> {
    const res = await fetch(
        `/.netlify/functions/api-pipeline-batch-poll?libraryId=${encodeURIComponent(libraryId)}`,
        { headers: await batchHeaders() },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Pipeline batch poll failed (${res.status})`);
    return data.none ? null : (data as PipelineBatchJob);
}

/**
 * Fetch a single row's result from the pipeline batch (consumed on read).
 * Returns { pending: true } when the row has not completed yet.
 */
export async function callPipelineRowResult(
    libraryId: string,
    jobId: string,
    rowId: string,
): Promise<PipelineRowResult> {
    const params = new URLSearchParams({ libraryId, jobId, rowId });
    const res = await fetch(
        `/.netlify/functions/api-pipeline-batch-poll?${params}`,
        { headers: await batchHeaders() },
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Pipeline row fetch failed (${res.status})`);
    }
    return res.json();
}

export interface CheckResult {
    ok: boolean;
    latency: number;
    error?: string;
}

/**
 * Ping an AI provider via api-check to verify connectivity and credentials.
 * Does NOT consume quota units.
 * service: 'claude' | 'gemini' | 'recraft'
 * model: required for 'claude'; unused for 'gemini'/'recraft'
 */
export async function callCheck(service: string, model?: string): Promise<CheckResult> {
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLocalDev) {
        try {
            const token = await getAuthToken();
            reqHeaders['Authorization'] = `Bearer ${token}`;
        } catch (e) {
            return { ok: false, latency: 0, error: 'No autenticado' };
        }
    }
    const t0 = Date.now();
    try {
        const res = await fetch('/.netlify/functions/api-check', {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({ service, model }),
        });
        const data = await res.json();
        return { ok: data.ok ?? false, latency: data.latency ?? (Date.now() - t0), error: data.error };
    } catch (e) {
        return { ok: false, latency: Date.now() - t0, error: (e as Error).message };
    }
}
