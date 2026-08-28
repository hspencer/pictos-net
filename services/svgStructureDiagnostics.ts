import type { SvgStructureDiagnostic } from '../types';

/** Known validator failures become localized diagnostics, never raw provider text. */
export function svgStructureDiagnostic(error: unknown): SvgStructureDiagnostic {
  const e = error as { diagnostic?: SvgStructureDiagnostic; message?: string; status?: number; providerStatus?: number; failureSource?: string };
  if (e?.diagnostic?.key) return e.diagnostic;
  const message = e?.message ?? String(error ?? '');
  const status = e?.providerStatus ?? e?.status;
  if (status === 401 || status === 403 || /unauthori[sz]ed|authentication|authorization|invalid.*key|missing auth/i.test(message)) return { key: 'providerAuthorization' };
  if (status === 429 || /quota|rate.?limit|resource_exhausted/i.test(message)) return { key: 'providerQuota' };
  if (/timed? ?out|timeout|network|fetch failed|failed to fetch/i.test(message)) return { key: 'providerUnavailable' };
  if (/Metadata schema violation:/.test(message)) return { key: 'metadataNeedsReview', fields: [...new Set(message.match(/\/[\w/~.-]+/g) ?? [])] };
  if (/accessible text|Root ARIA|Root role|SVG language/i.test(message)) return { key: 'accessibilityNeedsReview' };
  if (/Semantic group attributes/i.test(message)) return { key: 'groupAttributesNeedReview' };
  if (/canonical metadata|metadata key/i.test(message)) return { key: 'metadataNeedsReview' };
  if (/SVG semantic evidence differs/.test(message)) return { key: 'semanticInputsMismatch' };
  if (/SVG viewBox/.test(message)) return { key: 'invalidViewBox' };
  if (/binding|Unknown semantic group|Unassigned geometry|No geometry|Semantic group has no geometry|implicit actions/i.test(message)) {
    const element = message.match(/composition element: ([^\n]+)/)?.[1];
    return { key: 'bindingsNeedReview', ...(element ? { fields: [element] } : {}) };
  }
  if (/NLU|Utterance differs/.test(message)) return { key: 'nluNeedsReview' };
  if (/Composition|composition prompt|composition element id/.test(message)) return { key: 'compositionNeedsReview' };
  if (/inputs.*changed|datos.*cambiaron/i.test(message)) return { key: 'inputsChangedDuringGeneration' };
  if (/XML|SVG root|SVG\/ARIA reference|DTD|entities|external|resource|unsafe|active SVG|Event handlers|CSS|Duplicate.*id/i.test(message)) return { key: 'invalidSvg' };
  if (/rawSvg|No se encontraron paths/.test(message)) return { key: 'traceRequired' };
  if (/mapping|assign|groups|tool.use|JSON|parse|respuesta|grupo|modelo no devolvió/i.test(message)) return { key: 'invalidMapping' };
  return { key: 'structureFailed' };
}

export function formatSvgStructureError(error: unknown, t: (key: string) => string): string {
  return t(`svgGenerator.${svgStructureDiagnostic(error).key}`);
}
