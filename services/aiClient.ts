import { getModelProvider } from '../netlify/functions/_shared/modelCatalog.js';
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

import type { OpenAIImageQuality, PhaseExecution, GenerationModel } from "../types";
import { getCurrentUser, requestLogin } from "../components/AuthGate";

import { QuotaExceededError, ExternalProviderQuotaError, ProviderRequestError, providerErrorFromPayload, isUnmanagedGatewayFailure } from './providerErrors';
export { QuotaExceededError, ExternalProviderQuotaError, ProviderRequestError } from './providerErrors';

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
    const requestId = globalThis.crypto?.randomUUID?.()
        ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // In Vite dev mode (`netlify dev`), skip auth — the function has a NETLIFY_DEV bypass.
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLocalDev) {
        const token = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res: Response;
        try {
            res = await fetch(`/.netlify/functions/${endpoint}`, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify({ ...params, _requestId: requestId, _attempt: attempt + 1 }),
            });
        } catch (error) {
            // A failed POST transport can follow a successful provider call; do not replay.
            const message = error instanceof Error ? error.message : 'Network request failed';
            throw new ProviderRequestError(message, 'network', null, requestId, true);
        }

        if (res.ok) return res.json();

        const err = await res.json().catch(() => ({ error: res.statusText }));
        if (isUnmanagedGatewayFailure(res.status, err) && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
            continue;
        }
        throw providerErrorFromPayload(err, {
            provider: endpoint, model: (params as any).model, status: res.status,
            requestId, attempts: attempt + 1,
        });
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
    model?: string;
    meta?: { provider: string; requestId: string; attempts: number; actualModel?: string; requestedModel?: string; reasoningEffort?: string; durationMs?: number };
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

/** OpenAI text/vision returns the same forced-tool envelope; canonical validation remains local. */
export async function callOpenAIText(params: ClaudeParams): Promise<ClaudeResponse> {
    return callProxy('api-openai-text', params);
}

/**
 * Call the Phase 5 structuring model (vision + tool use).
 * Claude uses its synchronous proxy. Gemini/OpenAI use background jobs and
 * polling beyond Netlify's 60s synchronous limit. Both stage image inputs
 * through a synchronous gate to respect the 256 KB background payload limit.
 */
export async function callStructuringModel(params: ClaudeParams): Promise<ClaudeResponse> {
    const provider = getModelProvider(params.model);
    if (provider === 'gemini' || provider === 'openai') return callStructuringBackground(params, provider);
    if (provider === 'claude') return callProxy('api-claude', params);
    throw new Error('Unsupported structuring model');
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

async function callStructuringBackground(params: ClaudeParams, provider: 'gemini' | 'openai'): Promise<ClaudeResponse> {
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let authToken: string | null = null;
    if (!isLocalDev) {
        authToken = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const staged = await fetch('/.netlify/functions/api-structure-stage', {
        method: 'POST', headers: reqHeaders, body: JSON.stringify(params),
    });
    const data = await staged.json().catch(() => ({}));
    if (!staged.ok) throw providerErrorFromPayload(data, { provider, model: params.model, status: staged.status });
    const jobId = data.jobId;
    if (typeof jobId !== 'string' || !/^(?:openai-)?struct-[a-zA-Z0-9-]{1,100}$/.test(jobId)) throw new Error('Invalid structuring job ID');

    const startRes = await fetch(`/.netlify/functions/api-${provider === 'openai' ? 'openai-text' : 'gemini-structure'}-background`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ jobId }),
    });
    if (!startRes.ok && startRes.status !== 202) {
        throw new Error(`Fallo al iniciar el trabajo de estructurado: ${startRes.statusText}`);
    }

    // Poll up to ~6 min (180 × 2s). Redraw of complex pictograms can take minutes.
    for (let i = 0; i < 180; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`/.netlify/functions/api-${provider === 'openai' ? 'openai-text' : 'gemini-structure'}-poll?jobId=${jobId}`, {
            headers: reqHeaders,
        });
        if (!pollRes.ok) {
            if ([502, 503, 504].includes(pollRes.status)) continue;
            const err = await pollRes.json().catch(() => ({}));
            throw providerErrorFromPayload(err, { provider, model: params.model, status: pollRes.status, requestId: jobId });
        }

        const data = await pollRes.json();
        if (data.response) return data.response as ClaudeResponse;
        if (data.error || data.quotaExceeded || data.failureSource) throw providerErrorFromPayload(data,{ provider, model: params.model, requestId: jobId });
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
    model?: Extract<GenerationModel, `recraft${string}`>;
    style_id?: string;
}

export interface RecraftResponse {
    svg?: string;    // present for *_vector models
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
            throw providerErrorFromPayload(err, { provider: 'recraft', model: params.model, status: pollRes.status, requestId: jobId });
        }

        const data = await pollRes.json();

        if (data.svg) return { svg: data.svg };
        if (data.bitmap) return { bitmap: data.bitmap };
        if (data.error || data.quotaExceeded || data.failureSource) throw providerErrorFromPayload(data,{ provider: 'recraft', model: params.model, requestId: jobId });
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
    return callImageBackground('gemini', params, onStatus);
}

export async function callOpenAI(
    params: GeminiParams & { quality: OpenAIImageQuality }, onStatus?: (msg: string) => void,
): Promise<GeminiResponse & { generationQuality?: OpenAIImageQuality }> {
    return callImageBackground('openai', params, onStatus);
}

async function callImageBackground(
    provider: 'gemini' | 'openai', params: GeminiParams & { quality?: OpenAIImageQuality },
    onStatus?: (msg: string) => void,
): Promise<GeminiResponse & { generationQuality?: OpenAIImageQuality }> {
    const jobId = provider + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    const isLocalDev = import.meta.env.DEV;
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let authToken: string | null = null;
    if (!isLocalDev) {
        authToken = await getAuthToken();
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
        await authorizeJob(jobId, reqHeaders);
    }

    const startRes = await fetch(`/.netlify/functions/api-${provider}-worker-background`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ ...params, jobId, ...(authToken ? { _authToken: authToken } : {}) }),
    });

    if (!startRes.ok && startRes.status !== 202) {
        throw new Error(`Fallo al iniciar el trabajo de ${provider}: ${startRes.statusText}`);
    }

    // Gemini keeps its 120s window. OpenAI allows 220s to cover its bounded
    // 180s request plus worker startup/storage; it never auto-replays generation.
    let lastRetryAttempt = 0;
    for (let i = 0; i < (provider === 'openai' ? 110 : 60); i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`/.netlify/functions/api-${provider}-poll?jobId=${jobId}`, {
            headers: reqHeaders,
        });

        if (!pollRes.ok) {
            if ([502, 503, 504].includes(pollRes.status)) continue;
            const err = await pollRes.json().catch(() => ({}));
            throw providerErrorFromPayload(err, { provider: provider, model: params.model, status: pollRes.status, requestId: jobId });
        }

        const data = await pollRes.json();

        if (data.bitmap) return { bitmap: data.bitmap, ...(provider === 'openai' ? { generationQuality: data.generationQuality } : {}) };
        if (data.error || data.quotaExceeded || data.failureSource) throw providerErrorFromPayload(data, { provider: provider, model: params.model, requestId: jobId });
        if (data.pending) {
            if (data.retrying && data.retrying.attempt !== lastRetryAttempt) {
                lastRetryAttempt = data.retrying.attempt;
                onStatus?.(retryStatusMessage(data.retrying));
            }
            continue;
        }
    }

    throw new Error(`Tiempo de espera agotado generando imagen con ${provider}`);
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
 * Passive variant of getAuthToken: returns the JWT when a session already
 * exists, null otherwise. NEVER opens the login modal.
 *
 * For status/poll reads that fire automatically on library open (batch
 * resumption): an anonymous visitor must be able to browse libraries without
 * being asked to log in — and cannot own an active batch anyway.
 */
async function getAuthTokenPassive(): Promise<string | null> {
    const user = getCurrentUser();
    if (!user) return null;
    try {
        const token = await (user as any).jwt();
        return typeof token === 'string' && token ? token : null;
    } catch {
        return null;
    }
}

/**
 * Headers for passive status reads. Returns null when there is no session —
 * the caller should short-circuit to its "no job" result without a request.
 */
async function passiveBatchHeaders(): Promise<Record<string, string> | null> {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (import.meta.env.DEV) return reqHeaders;
    const token = await getAuthTokenPassive();
    if (!token) return null;
    reqHeaders['Authorization'] = `Bearer ${token}`;
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
    const headers = await passiveBatchHeaders();
    if (!headers) return null; // anonymous: no session, no batch — never prompt login
    const res = await fetch(`/.netlify/functions/api-batch-status?libraryId=${encodeURIComponent(libraryId)}`, {
        headers,
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
    const headers = await passiveBatchHeaders();
    if (!headers) throw new Error('Sesión requerida'); // unreachable without a job; never prompt
    const key = `batchrow-${jobId}-${rowId}`;
    const res = await fetch(`/.netlify/functions/api-gemini-poll?jobId=${encodeURIComponent(key)}`, {
        headers,
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
    state: 'running' | 'completed' | 'failed' | 'provider_quota_blocked';
    model: string;
    rowCount: number;
    rowIds: string[];
    succeededCount: number;
    failedCount: number;
    startedAt?: string;
    completedAt?: string;
    providerQuotaBlockedAtRowId?: string;
    refundedGenerationUnits?: number;
    none?: boolean;
}

export interface PipelineRowResult {
    phaseExecutions?: PhaseExecution[];
    generationQuality?: OpenAIImageQuality;
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
    provider?: string;
    providerStatus?: number;
    requestId?: string;
    retryable?: boolean;
    retryAfterMs?: number | null;
    attempts?: number;
    recoverable?: boolean;
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
    const headers = await passiveBatchHeaders();
    if (!headers) return null; // anonymous: no session, no batch — never prompt login
    const res = await fetch(
        `/.netlify/functions/api-pipeline-batch-poll?libraryId=${encodeURIComponent(libraryId)}`,
        { headers },
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
    const headers = await passiveBatchHeaders();
    if (!headers) throw new Error('Sesión requerida'); // unreachable without a job; never prompt
    const params = new URLSearchParams({ libraryId, jobId, rowId });
    const res = await fetch(
        `/.netlify/functions/api-pipeline-batch-poll?${params}`,
        { headers },
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
    checkScope?: string;
    checkedModel?: string;
    credits?: number | null;
    generationVerified?: false;
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
        // Passive: a diagnostic ping must not open the login modal.
        const token = await getAuthTokenPassive();
        if (!token) return { ok: false, latency: 0, error: 'No autenticado' };
        reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    const t0 = Date.now();
    try {
        const res = await fetch('/.netlify/functions/api-check', {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({ service, model }),
        });
        const data = await res.json();
        return { ok: data.ok ?? false, latency: data.latency ?? (Date.now() - t0), error: data.error,
            checkScope: data.checkScope, checkedModel: data.checkedModel, credits: data.credits, generationVerified: false };
    } catch (e) {
        return { ok: false, latency: Date.now() - t0, error: (e as Error).message };
    }
}
