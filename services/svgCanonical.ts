import type { RowData, SvgEditorSource, SvgStructureDiagnostic } from '../types';
import { assertSemanticInputs, assertValidSVG, createSvgReference, reviseSVG, inspectPassiveSVG } from '../schemas/mf-svg-schema/index.js';
import { validateGeneration } from '../schemas/nlu-schema/index.js';
import { validateDocument as validateComposition } from '../schemas/pictogram-composition-schema/index.js';

export interface SvgStructureEligibility {
  eligible: boolean;
  reasonKey?: 'traceRequired' | 'nluNeedsReview' | 'compositionNeedsReview' | 'semanticInputsMismatch' | 'elementsRequired' | 'invalidElementTree';
  fields?: string[];
}

/** Only operational requirements block visual structuring; certification is separate. */
export function canStructureSVG(row: Partial<RowData>): SvgStructureEligibility {
  if (!row.rawSvg || row.rawSvgDiscarded) return { eligible: false, reasonKey: 'traceRequired' };
  if (!Array.isArray(row.elements) || !row.elements.length) return { eligible: false, reasonKey: 'elementsRequired' };
  const ids = new Set<string>();
  const visit = (nodes: unknown): boolean => Array.isArray(nodes) && nodes.every(node => {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || /[\s"'<>#]/.test(node.id) || ids.has(node.id)) return false;
    ids.add(node.id);
    return node.children === undefined || visit(node.children);
  });
  return visit(row.elements) ? { eligible: true } : { eligible: false, reasonKey: 'invalidElementTree' };
}

export function canCertifySVG(row: Partial<RowData>): SvgStructureEligibility {
  const fields = (errors: { instancePath?: string; params?: { missingProperty?: string } }[] | null) =>
    [...new Set((errors ?? []).map(e => `${e.instancePath || ''}${e.params?.missingProperty ? `/${e.params.missingProperty}` : ''}` || '/'))];
  if (!validateGeneration(row.NLU)) return { eligible: false, reasonKey: 'nluNeedsReview', fields: fields(validateGeneration.errors) };
  const composition = { elements: row.elements, prompt: row.prompt };
  if (!validateComposition(composition)) return { eligible: false, reasonKey: 'compositionNeedsReview', fields: fields(validateComposition.errors) };
  try { assertSemanticInputs(row.NLU, composition, row.UTTERANCE); }
  catch { return { eligible: false, reasonKey: 'semanticInputsMismatch' }; }
  return { eligible: true };
}

export function prepareSvgDraft(row: RowData, svg: string, diagnostic?: SvgStructureDiagnostic) {
  inspectPassiveSVG(svg);
  return { structuredSvgDraft: svg, structuredSvgDraftDiagnostic: diagnostic, svgSourceSnapshot: captureSvgSource(row) };
}

/** Captured application inputs, not a persisted second copy of the SVG. */
export function captureSvgSource(row: Partial<RowData>): string {
  return JSON.stringify([row.UTTERANCE, row.NLU, row.elements, row.prompt, row.rawSvg, row.bitmap, row.generationModel, row.generationQuality, row.structuredSvg, row.structuredSvgDraft]);
}

/** Explicit draft selection must never silently open a different artifact. */
export function svgForEditing(row: RowData, preferred?: SvgEditorSource): { svg: string; source: SvgEditorSource } | undefined {
  const raw = row.rawSvgDiscarded ? undefined : row.rawSvg;
  const structured = row.structuredSvgDiscarded ? undefined : row.structuredSvg;
  const source = preferred === 'draft' ? 'draft'
    : preferred === 'raw' && raw ? 'raw'
    : structured ? 'structured' : 'raw';
  const svg = source === 'draft' ? row.structuredSvgDraft : source === 'structured' ? structured : raw;
  return svg ? { svg, source } : undefined;
}

/** Editing a draft cannot promote it or overwrite the original trace. */
export async function prepareSvgEditorUpdate(row: RowData, source: SvgEditorSource, svg: string) {
  if (source === 'structured') return prepareSvgPromotion(row, svg, true);
  if (source === 'draft') return prepareSvgDraft(row, svg, { key: 'draftEdited' });
  inspectPassiveSVG(svg);
  return { rawSvg: svg, rawSvgDiscarded: false };
}

export async function prepareSvgPromotion(row: RowData, svg: string, manualEdit = false) {
  const sourceSnapshot = captureSvgSource(row);
  // The previous reference is a claim: derive the parent from actual validated bytes.
  const parent = manualEdit && row.structuredSvg ? await createSvgReference(row.structuredSvg) : undefined;
  const finalSvg = manualEdit ? reviseSVG(svg, parent?.sha256) : svg;
  const metadata = assertValidSVG(finalSvg);
  const nlu = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
  if (metadata.nlu.utterance !== row.UTTERANCE) throw new Error('SVG semantic evidence differs from current row');
  if (JSON.stringify(metadata.nlu) !== JSON.stringify(nlu) || JSON.stringify(metadata.composition) !== JSON.stringify({ elements: row.elements, prompt: row.prompt })) throw new Error('SVG semantic evidence differs from current row');
  const svgReference = await createSvgReference(finalSvg);
  return { structuredSvg: finalSvg, structuredSvgDiscarded: false, structuredSvgStatus: 'completed' as const, svgReference, svgSourceSnapshot: sourceSnapshot, structuredSvgDraft: undefined, structuredSvgDraftDiagnostic: undefined };
}

/** Central mutation gate: stale async results never overwrite newer row inputs.
 * Imported references are preserved claims; callers must verify before trusting. */
export function applySvgSafeUpdate(row: RowData, updates: Partial<RowData> & { svgSourceSnapshot?: string }): RowData {
  const { svgSourceSnapshot, ...fields } = updates;
  if (typeof fields.structuredSvgDraft === 'string' && svgSourceSnapshot !== captureSvgSource(row)) return row;
  const promoting = typeof fields.structuredSvg === 'string' && fields.structuredSvg !== row.structuredSvg;
  if (promoting) {
    try {
      if (!fields.svgReference || svgSourceSnapshot !== captureSvgSource(row)) return row;
      const metadata = assertValidSVG(fields.structuredSvg);
      const nlu = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
      if (JSON.stringify(metadata.nlu) !== JSON.stringify(nlu) || JSON.stringify(metadata.composition) !== JSON.stringify({ elements: row.elements, prompt: row.prompt })) return row;
      if (metadata.nlu.utterance !== row.UTTERANCE) return row;
    } catch { return row; }
  }
  const next = { ...row, ...fields };
  // A draft edit changes the concurrency snapshot, not canonical authority.
  if (!promoting && captureSvgSource({ ...next, structuredSvgDraft: row.structuredSvgDraft }) !== captureSvgSource(row)) {
    next.svgReference = undefined;
    if (next.structuredSvg) next.structuredSvgStatus = 'outdated';
  }
  if (!next.structuredSvg || next.structuredSvgDiscarded) next.svgReference = undefined;
  return next;
}

export function observedSvgProvenance(row: RowData, structuringModel?: string) {
  const evidenceKeys = ['id', 'phase', 'createdAt', 'model', 'provider', 'contractId', 'contractVersion', 'contractHash', 'promptVersion', 'promptHash', 'inputHash', 'outputHash', 'requestId'];
  return {
    ...(row.phaseExecutions ? { phaseExecutions: row.phaseExecutions.map(execution => Object.fromEntries(evidenceKeys.filter(key => execution[key] !== undefined).map(key => [key, execution[key]]))) } : {}),
    ...(row.generationModel ? { generationModel: row.generationModel } : {}),
    ...(row.generationQuality ? { generationQuality: row.generationQuality } : {}),
    ...(structuringModel ? { structuringModel } : {}),
  };
}
