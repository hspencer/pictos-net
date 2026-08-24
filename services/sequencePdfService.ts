/**
 * Sequence PDF export.
 *
 * Homologado con el exportador de "imprimibles" de la libreria: reutiliza el
 * mismo motor de layout (`exportLibraryToPdf`) para garantizar identicas
 * proporciones, tipografia y caption (toma el texto de `row.UTTERANCE`, no de
 * `step.utterance`). Las unicas diferencias propias de una secuencia son:
 *   - el encabezado muestra el nombre de la secuencia (titleOverride), y
 *   - cada celda lleva el numero de paso, pequeno, en la esquina superior
 *     izquierda (badgeFor), como en la vista de grilla.
 *
 * Se usa en App.tsx (handleSequencePrint).
 */

import type { Sequence, Step, RowData, GlobalConfig } from '../types';
import { exportLibraryToPdf } from './pdfExportService';

/**
 * Genera el PDF imprimible de una secuencia.
 * Solo se incluyen los pasos completos cuya RowData existe en la libreria, en
 * orden de `position`. Lanza si no hay ningun paso exportable.
 */
export async function exportSequenceToPdf(
  sequence: Sequence,
  libraryRows: RowData[],
  config: GlobalConfig,
  t?: (key: string, params?: Record<string, string | number>) => string,
): Promise<Blob> {
  // Pasos completos, en orden, con su RowData resuelta.
  const ordered = sequence.steps
    .filter(s => s.state === 'complete' && s.rowId)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(s => ({ step: s, row: libraryRows.find(r => r.id === s.rowId) }))
    .filter((x): x is { step: Step; row: RowData } => !!x.row);

  if (ordered.length === 0) throw new Error('No complete steps to export');

  const rows = ordered.map(x => x.row);

  // Mapa rowId -> numero de paso, para estampar el badge por celda.
  const positionByRowId = new Map<string, number>();
  ordered.forEach(({ step, row }) => positionByRowId.set(row.id, step.position));

  const { blob } = await exportLibraryToPdf({
    rows,
    config,
    t,
    titleOverride: sequence.name,
    badgeFor: (row) => positionByRowId.get(row.id) ?? null,
  });
  return blob;
}

/** Nombre de archivo canonico para el PDF de una secuencia. */
export function sequencePdfFilename(sequence: Sequence): string {
  const safe = (sequence.name || 'secuencia')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40)
    .toLowerCase();
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${safe}_${yyyy}-${mm}-${dd}.pdf`;
}
