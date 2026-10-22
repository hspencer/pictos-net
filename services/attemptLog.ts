/**
 * Facilitator diagnostics (plan F2, task 3): one entry per phase attempt,
 * success or failure, so a workshop can tell a local rejection from a contract
 * failure, an unavailable model or a provider error, with a reference to quote.
 *
 * No communicative content is ever recorded: no utterance, NLU, prompt, image
 * or SVG, and no provider message. Entries stay in this browser (a capped
 * localStorage ring) and leave it only through an explicit export.
 */
import { QuotaExceededError, ExternalProviderQuotaError, ProviderRequestError } from './providerErrors.ts';
import { ModelUnavailableError } from '../netlify/functions/_shared/modelCatalog.js';

export type AttemptOutcome =
  | 'ok' | 'draft' | 'model_unavailable' | 'pictos_quota' | 'provider_quota' | 'no_image'
  | 'provider_error' | 'contract_invalid' | 'structure_rejected' | 'local_error';

export interface AttemptEntry {
  ts: string;
  runId?: string;
  rowId: string;
  phase: 1 | 2 | 3 | 5;
  /** Unambiguous name: ESTRUCTURAR is internal phase 5 but shown as phase 4. */
  phaseName: string;
  model: string;
  outcome: AttemptOutcome;
  durationMs: number | null;
  failureSource?: string;
  providerStatus?: number | null;
  requestId?: string | null;
  retryable?: boolean;
  attempts?: number;
  contractIssues?: string[];
  diagnostic?: string;
  errorName?: string;
}

const KEY = 'pictos_attempt_log';
const PHASE_NAMES = { 1: 'COMPRENDER', 2: 'COMPONER', 3: 'PRODUCIR', 5: 'ESTRUCTURAR' } as const;
const MAX_ENTRIES = 500;

/** Failure fields of an error, by type; never its message, which may carry content. */
export function classifyAttempt(err: unknown): Pick<AttemptEntry,
  'outcome' | 'failureSource' | 'providerStatus' | 'requestId' | 'retryable' | 'attempts' | 'contractIssues' | 'diagnostic' | 'errorName'> {
  const e = err as any;
  if (err instanceof ModelUnavailableError) return { outcome: 'model_unavailable' };
  if (err instanceof QuotaExceededError) return { outcome: 'pictos_quota' };
  if (err instanceof ExternalProviderQuotaError) {
    return { outcome: 'provider_quota', requestId: e.requestId ?? null, attempts: e.attempts };
  }
  if (err instanceof ProviderRequestError) {
    return {
      outcome: e.failureSource === 'no_image' ? 'no_image' : 'provider_error',
      failureSource: e.failureSource, providerStatus: e.providerStatus, requestId: e.requestId,
      retryable: e.retryable, attempts: e.attempts,
    };
  }
  if (e?.code === 'pipeline_contract_invalid') {
    return {
      outcome: 'contract_invalid',
      contractIssues: (e.issues ?? []).slice(0, 10).map((i: any) => `${i.instancePath || '/'} ${i.keyword ?? 'invalid'}`),
    };
  }
  if (e?.diagnostic?.key) return { outcome: 'structure_rejected', diagnostic: e.diagnostic.key };
  return { outcome: 'local_error', errorName: e?.name ?? typeof err };
}

export function getAttempts(): AttemptEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordAttempt(entry: Omit<AttemptEntry, 'ts' | 'phaseName'>): void {
  try {
    const entries = [...getAttempts(), { ts: new Date().toISOString(), phaseName: PHASE_NAMES[entry.phase], ...entry }];
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Diagnostics must never break generation (storage full or blocked).
  }
}

export function clearAttempts(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

export function exportAttempts(appVersion: string): string {
  return JSON.stringify({
    type: 'pictos_attempt_log', appVersion, exportedAt: new Date().toISOString(),
    phaseNumbering: 'Internal phase numbers. 5 = ESTRUCTURAR, shown as phase 4 in settings (4 was the retired VTracer step).',
    entries: getAttempts(),
  }, null, 2);
}
