import type { RowData } from '../types';
import { assertValidSVG, createSvgReference, reviseSVG } from '../schemas/mf-svg-schema/index.js';

/** Captured application inputs, not a persisted second copy of the SVG. */
export function captureSvgSource(row: Partial<RowData>): string {
  return JSON.stringify([row.UTTERANCE, row.NLU, row.elements, row.prompt, row.rawSvg, row.bitmap, row.generationModel, row.generationQuality, row.structuredSvg]);
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
  return { structuredSvg: finalSvg, structuredSvgDiscarded: false, structuredSvgStatus: 'completed' as const, svgReference, svgSourceSnapshot: sourceSnapshot };
}

/** Central mutation gate: stale async results never overwrite newer row inputs.
 * Imported references are preserved claims; callers must verify before trusting. */
export function applySvgSafeUpdate(row: RowData, updates: Partial<RowData> & { svgSourceSnapshot?: string }): RowData {
  const { svgSourceSnapshot, ...fields } = updates;
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
  if (!promoting && captureSvgSource(next) !== captureSvgSource(row)) {
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
