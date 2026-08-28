import type { PhaseExecution, RowData } from '../types';

const stepStatuses = ['idle', 'processing', 'completed', 'error', 'outdated', 'review'];
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Hydrate an editable row without discarding research evidence. Values needing
 * UI defaults remain inspectable in importOriginalValues; this is not validation
 * or a migration to a newer semantic contract. The source is never mutated. */
export function sanitizeRow(input: unknown): RowData {
  const row: Record<string, any> = isObject(input) ? { ...input } : {};
  const original: Record<string, unknown> = isObject(row.importOriginalValues) ? { ...row.importOriginalValues } : {};
  if (row.importOriginalValues !== undefined && !isObject(row.importOriginalValues)) original.importOriginalValues = row.importOriginalValues;
  if (!isObject(input)) original.row = structuredClone(input);
  const fallback = (key: string, valid: boolean, value: unknown) => {
    if (valid) return;
    if (Object.hasOwn(row, key) && !Object.hasOwn(original, key)) original[key] = row[key];
    row[key] = value;
  };
  fallback('id', typeof row.id === 'string' && !!row.id, `R_${crypto.randomUUID()}`);
  fallback('UTTERANCE', typeof row.UTTERANCE === 'string', '');
  fallback('elements', row.elements === undefined || Array.isArray(row.elements), undefined);
  for (const key of ['prompt', 'bitmap', 'rawSvg', 'structuredSvg']) {
    fallback(key, row[key] === undefined || typeof row[key] === 'string', undefined);
  }
  fallback('status', ['idle', 'processing', 'completed', 'error'].includes(row.status), 'idle');
  for (const key of ['nluStatus', 'visualStatus', 'bitmapStatus']) fallback(key, stepStatuses.includes(row[key]), 'idle');
  if (row.structuredSvgStatus !== undefined) fallback('structuredSvgStatus', stepStatuses.includes(row.structuredSvgStatus), 'idle');
  for (const key of ['nluDuration', 'visualDuration', 'bitmapDuration']) {
    fallback(key, row[key] === undefined || (typeof row[key] === 'number' && Number.isFinite(row[key])), undefined);
  }
  fallback('phaseExecutions', row.phaseExecutions === undefined || Array.isArray(row.phaseExecutions), undefined);
  if (row.interventionLog !== undefined) {
    const log = row.interventionLog;
    if (!isObject(log) || !Array.isArray(log.sessions)) {
      fallback('interventionLog', false, undefined);
    } else {
      const hydrated = { ...log, sessions: log.sessions.filter((session: any) =>
        isObject(session) && typeof session.startedAt === 'string' && Array.isArray(session.events)
      ).map((session: any) => ({
        ...session,
        // This is an operational orphan-session closure, not a historic event.
        endedAt: typeof session.endedAt === 'string' ? session.endedAt : new Date().toISOString(),
        events: session.events.map((event: any) => isObject(event) ? {
          ...event,
          ...(event.context?.modelId && !event.modelId ? { modelId: event.context.modelId } : {}),
          id: event.id || crypto.randomUUID(),
        } : event),
      })) };
      if (JSON.stringify(log) !== JSON.stringify(hydrated)) {
        if (!Object.hasOwn(original, 'interventionLog')) original.interventionLog = log;
        row.interventionLog = hydrated;
      }
    }
  }
  if (Object.keys(original).length) row.importOriginalValues = original;
  return row as RowData;
}

/** Poll retries may deliver an accepted execution again; append by its actual
 * execution id, never by output similarity or a reconstructed historical id. */
export function appendPhaseExecutions(previous: PhaseExecution[] | undefined, accepted: PhaseExecution[]): PhaseExecution[] {
  const result = Array.isArray(previous) ? [...previous] : [];
  for (const execution of accepted) {
    if (!result.some(existing => existing?.id === execution.id)) result.push(execution);
  }
  return result;
}

/** Upgrade the library container, not its semantic contracts. Row hydration is
 * shared with ordinary imports so legacy event context and exact originals are
 * preserved before the UI reads them. Never mutate the parsed source document. */
export function migrateLibraryJson(raw: any, currentVersion: number): any {
  if (!isObject(raw) || (raw.schemaVersion ?? 1) >= currentVersion) return raw;
  const migrated = structuredClone(raw);
  if (typeof migrated.svgs === 'string') {
    try {
      const parsed = JSON.parse(migrated.svgs);
      if (Array.isArray(parsed)) migrated.svgs = parsed;
    } catch { /* Keep an unreadable original rather than substituting an empty asset collection. */ }
  }
  if (!Array.isArray(migrated.boards)) migrated.boards = [];
  if (Array.isArray(migrated.rows)) migrated.rows = migrated.rows.map(sanitizeRow);
  migrated.schemaVersion = currentVersion;
  return migrated;
}
