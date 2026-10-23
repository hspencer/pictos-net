/**
 * Safe NLU repair, shared by the app (applied silently on every load through
 * sanitizeRow) and scripts/migrate-nlu.mjs (corpus reports and copies).
 *
 * Only two kinds of change, both meaning-preserving:
 *   case      the value equals an allowed value ignoring case
 *   approved  an equivalence a person approved (APPROVED_EQUIVALENCES)
 * Free text is never classified here. Each change keeps its original value,
 * so the repair is traceable and reversible. Only the NLU is touched.
 */
import { validateDocument, VERSION as NLU_VERSION } from '../../../schemas/pictos-nlu-schema/index.js';

/** Approved 2026-10-22 by the project lead (plan F5). Paths use * for array indices. */
export const APPROVED_EQUIVALENCES = [
  { path: "/metadata/speech_act", from: "Assertion", to: "assertive" },
  { path: "/metadata/speech_act", from: "Pregunta", to: "interrogative" },
  { path: "/metadata/speech_act", from: "Question", to: "interrogative" },
  { path: "/metadata/speech_act", from: "Request", to: "directive" },
  { path: "/metadata/speech_act", from: "Solicitud", to: "directive" },
  { path: "/metadata/speech_act", from: "assertion", to: "assertive" },
  { path: "/metadata/speech_act", from: "pregunta", to: "interrogative" },
  { path: "/metadata/speech_act", from: "question", to: "interrogative" },
  { path: "/metadata/speech_act", from: "request", to: "directive" },
  { path: "/metadata/speech_act", from: "solicitud", to: "directive" },
  { path: "/pragmatics/expected_response", from: "Acknowledgement", to: "acknowledgment" },
  { path: "/pragmatics/expected_response", from: "acknowledgement", to: "acknowledgment" },
  { path: "/pragmatics/formality", from: "Neutra", to: "neutral" },
  { path: "/pragmatics/formality", from: "Neutro", to: "neutral" },
  { path: "/pragmatics/formality", from: "alta", to: "formal" },
  { path: "/pragmatics/formality", from: "baja", to: "informal" },
  { path: "/pragmatics/formality", from: "neutra", to: "neutral" },
  { path: "/pragmatics/formality", from: "neutro", to: "neutral" },
  { path: "/pragmatics/politeness", from: "Cortes", to: "polite" },
  { path: "/pragmatics/politeness", from: "Cortés", to: "polite" },
  { path: "/pragmatics/politeness", from: "Neutro", to: "neutral" },
  { path: "/pragmatics/politeness", from: "cortés", to: "polite" },
  { path: "/pragmatics/politeness", from: "neutra", to: "neutral" },
  { path: "/pragmatics/politeness", from: "neutro", to: "neutral" },
  { path: "/visual_guidelines/temporal", from: "AHORA", to: "immediate" },
  { path: "/visual_guidelines/temporal", from: "Ahora", to: "immediate" },
  { path: "/visual_guidelines/temporal", from: "Futuro cercano", to: "near_future" },
  { path: "/visual_guidelines/temporal", from: "NOW", to: "immediate" },
  { path: "/visual_guidelines/temporal", from: "Now", to: "immediate" },
  { path: "/visual_guidelines/temporal", from: "ahora", to: "immediate" },
  { path: "/visual_guidelines/temporal", from: "futuro cercano", to: "near_future" },
  { path: "/visual_guidelines/temporal", from: "now", to: "immediate" },
];

const fold = value => String(value).trim().toLocaleLowerCase('es');
export const pathPattern = instancePath => instancePath.replace(/\/\d+(?=\/|$)/g, '/*');
export const valueAt = (doc, instancePath) => instancePath.split('/').slice(1).reduce((node, key) => node?.[key], doc);

/** Decide one enum failure: [target, rule] or null when a person must decide. */
export function resolveValue(instancePath, value, allowed, approved = APPROVED_EQUIVALENCES) {
  if (typeof value !== 'string') return null;
  const exact = allowed.find(option => fold(option) === fold(value));
  if (exact) return [exact, 'case'];
  const where = pathPattern(instancePath);
  const entry = approved.find(a => a.path === where && fold(a.from) === fold(value) && allowed.includes(a.to));
  return entry ? [entry.to, 'approved'] : null;
}

/**
 * Repair a parsed NLU document in place. Returns the changes made, each with
 * its original value; an empty list when it was valid or nothing was safe.
 */
export function repairNlu(nlu, approved = APPROVED_EQUIVALENCES) {
  if (!nlu || typeof nlu !== 'object' || validateDocument(nlu)) return [];
  const changes = [];
  for (const error of validateDocument.errors.filter(e => e.keyword === 'enum')) {
    const value = valueAt(nlu, error.instancePath);
    const resolved = resolveValue(error.instancePath, value, error.params.allowedValues, approved);
    if (!resolved) continue;
    const keys = error.instancePath.split('/').slice(1);
    keys.slice(0, -1).reduce((node, key) => node[key], nlu)[keys.at(-1)] = resolved[0];
    changes.push({ path: error.instancePath, from: value, to: resolved[0], rule: resolved[1] });
  }
  return changes;
}

/**
 * Row-level repair: parses a string NLU, keeps its encoding, records the
 * changes in nluMigration. Returns the same row object when nothing changed.
 */
export function repairRowNlu(row, approved = APPROVED_EQUIVALENCES, now = new Date().toISOString()) {
  const encoded = typeof row?.NLU === 'string';
  let nlu;
  try { nlu = encoded ? JSON.parse(row.NLU) : structuredClone(row?.NLU); } catch { return row; }
  const changes = repairNlu(nlu, approved);
  if (!changes.length) return row;
  const previous = Array.isArray(row.nluMigration?.changes) ? row.nluMigration.changes : [];
  return {
    ...row,
    NLU: encoded ? JSON.stringify(nlu) : nlu,
    nluMigration: { contract: NLU_VERSION, at: now, changes: [...previous, ...changes] },
  };
}
