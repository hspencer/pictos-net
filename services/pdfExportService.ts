/**
 * PDF export service — see specs/pdf-export.allium
 *
 * Composes a multi-page PDF of the library's pictograms, intended for
 * printing and cutting into cards for AAC use. Letter portrait, two
 * columns, ~89mm pictogram width, faint grey cut guide, full
 * (never-truncated) utterance below each pictogram.
 */

import { jsPDF } from 'jspdf';
import type { RowData, GlobalConfig } from '../types';
import { validDownstreamArtifact } from '../utils/rowArtifacts';
import { sentenceCase, sanitizeFilename } from '../utils/textFormat';

// ---------- Layout constants (millimetres) ----------

const PAGE_W_MM = 215.9;          // Letter portrait
const PAGE_H_MM = 279.4;

const MARGIN_MM = 15;
const COLUMN_GUTTER_MM = 8;
const ROW_GUTTER_MM = 10;

const HEADER_HEIGHT_MM = 12;
const FOOTER_HEIGHT_MM = 8;
const HEADER_RULE_GAP_MM = 2;

// Internal padding between the cut-guide rectangle and the cell content.
// The rectangle now encloses pictogram AND utterance, so we need a bit of
// breathing room on all sides.
const CELL_PAD_X_MM = 3;
const CELL_PAD_Y_MM = 3;
const PICTO_CAPTION_GAP_MM = 3;   // between pictogram and utterance text

const CUT_GUIDE_STROKE_MM = 0.2;
const CUT_GUIDE_GREY = 153;       // ~60% grey (255 * 0.6)

const FOOTER_RULE_GAP_MM = 2;

// Typography — uses Lexend (loaded lazily, see loadLexendBase64). Slightly
// larger body than v1 to read well from print distance. Captions are set in
// sentence case (mixed case word shapes are more legible than all-caps).
const UTTERANCE_FONT_SIZE_PT = 13;
const UTTERANCE_LINE_HEIGHT_FACTOR = 1.25;
const HEADER_FONT_SIZE_PT = 10;
const FOOTER_FONT_SIZE_PT = 9;

// Step-number badge (sequence export). Small grey number on a faint white chip,
// drawn in the top-right corner of the cell — matches the grid-view chip.
const BADGE_FONT_SIZE_PT = 9;
const BADGE_GREY = 120;
const BADGE_CHIP_PAD_X_MM = 1.2;
const BADGE_CHIP_PAD_Y_MM = 0.8;

const PDF_FONT_NAME = 'Lexend';
const PDF_FONT_FILE = 'Lexend.ttf';
const PDF_FONT_URL = '/fonts/Lexend.ttf';

// Rasterisation (print-grade DPI for the cell width)
const TARGET_DPI = 300;
const MM_PER_INCH = 25.4;

// Derived
const PRINTABLE_W_MM = PAGE_W_MM - 2 * MARGIN_MM;            // 185.9mm
const COLUMN_W_MM = (PRINTABLE_W_MM - COLUMN_GUTTER_MM) / 2; // 88.95mm
const PICTO_W_MM = COLUMN_W_MM - 2 * CELL_PAD_X_MM;          // ~82.95mm
const CONTENT_TOP_MM = MARGIN_MM + HEADER_HEIGHT_MM + HEADER_RULE_GAP_MM;
const CONTENT_BOTTOM_MM = PAGE_H_MM - MARGIN_MM - FOOTER_HEIGHT_MM - FOOTER_RULE_GAP_MM;

// ---------- Types ----------

export type PdfProgressPhase = 'preparing' | 'rendering';

export interface PdfProgress {
  phase: PdfProgressPhase;
  totalCells: number;
  renderedCells: number;
  totalPages: number;
  currentPage: number;
  currentUtterance: string;
}

export interface PdfExportOptions {
  rows: RowData[];
  config: GlobalConfig;
  /** Optional i18n translator. Called as t(key, params?). */
  t?: (key: string, params?: Record<string, string | number>) => string;
  onProgress?: (p: PdfProgress) => void;
  signal?: AbortSignal;
  /**
   * Optional header title used instead of `config.name`. Used by the sequence
   * export to print the sequence name where the library name would normally go.
   */
  titleOverride?: string;
  /**
   * Optional per-cell badge. When it returns a non-empty value, the value is
   * drawn small in the top-right corner of the cell (mirrors the grid-view step
   * number chip). Used by the sequence export to stamp each step's position.
   */
  badgeFor?: (row: RowData) => string | number | null;
}

export interface PdfExportResult {
  blob: Blob;
  totalCells: number;
  totalPages: number;
}

export class PdfExportCancelledError extends Error {
  constructor() {
    super('PDF export cancelled');
    this.name = 'PdfExportCancelledError';
  }
}

// ---------- Helpers ----------

const mmToPt = (mm: number) => (mm * 72) / MM_PER_INCH;
const ptToMm = (pt: number) => (pt * MM_PER_INCH) / 72;



const parseAspectRatio = (ratio: string): number => {
  const [w, h] = (ratio || '1:1').split(':').map(Number);
  if (!w || !h) return 1;
  return w / h;
};

type ArtifactPick = { kind: 'estructurado' | 'trazado' | 'bitmap'; data: string };
const pickArtifact = (row: RowData): ArtifactPick | null =>
  validDownstreamArtifact(row) ?? null;

/** Rasterise an SVG string to a PNG data URL at the requested pixel size. */
async function rasterizeSvg(svgString: string, widthPx: number, heightPx: number): Promise<string> {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterisation failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    // White background so cut cards are not see-through on coloured paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new PdfExportCancelledError();
};

/** Locale-aware uppercase. Keeps Spanish diacritics (ñ → Ñ, á → Á, etc.).
 *  Used only for page furniture (header, page label, credits/license). */
const upper = (s: string): string => (s || '').toLocaleUpperCase();

/** Convert an ArrayBuffer to base64 without spreading the whole array
 *  (the spread operator stack-overflows on >100kB buffers). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** Module-level cache so the font is only fetched & encoded once per session. */
let cachedFontBase64: string | null = null;
async function loadLexendBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(PDF_FONT_URL);
  if (!res.ok) throw new Error(`Failed to load Lexend font (${res.status})`);
  const buf = await res.arrayBuffer();
  cachedFontBase64 = arrayBufferToBase64(buf);
  return cachedFontBase64;
}

/** Register Lexend with the jsPDF instance and select it as the active font. */
async function registerLexend(doc: jsPDF): Promise<void> {
  const b64 = await loadLexendBase64();
  doc.addFileToVFS(PDF_FONT_FILE, b64);
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, 'normal');
  doc.setFont(PDF_FONT_NAME, 'normal');
}

// ---------- Main ----------

interface CellPlan {
  row: RowData;
  artifact: ArtifactPick;
  pictoHeightMm: number;
  utteranceLines: string[];
  utteranceHeightMm: number;
  cellHeightMm: number; // picto + gap + utterance
}

interface RowPlan {
  left: CellPlan;
  right?: CellPlan;
  heightMm: number; // max of the two
  pageIndex: number; // 0-based
}

export async function exportLibraryToPdf(options: PdfExportOptions): Promise<PdfExportResult> {
  const { rows, config, t, onProgress, signal, titleOverride, badgeFor } = options;

  // Filter: only rows with at least one artifact.
  const eligible: { row: RowData; artifact: ArtifactPick }[] = [];
  for (const row of rows) {
    const artifact = pickArtifact(row);
    if (artifact) eligible.push({ row, artifact });
  }

  if (eligible.length === 0) {
    throw new Error('No eligible pictograms to export');
  }

  // Initialise jsPDF — use millimetres so all the layout constants apply directly.
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });

  // Load and register Lexend before measuring text (utterance wrap depends on
  // the active font metrics).
  await registerLexend(doc);

  // Picto dimensions in mm. The pictogram now sits inside the cut-guide
  // rectangle (which spans the full column), so picto width = column width
  // minus the horizontal padding on each side.
  const aspect = parseAspectRatio(config.aspectRatio);
  const pictoWidthMm = PICTO_W_MM;
  const pictoHeightMm = pictoWidthMm / aspect;

  // Pixel target for rasterisation, sized to print at TARGET_DPI.
  const pictoWidthPx = Math.round((pictoWidthMm / MM_PER_INCH) * TARGET_DPI);
  const pictoHeightPx = Math.round((pictoHeightMm / MM_PER_INCH) * TARGET_DPI);

  // Phase A — compute cell heights so we can paginate and total pages up front.
  onProgress?.({
    phase: 'preparing',
    totalCells: eligible.length,
    renderedCells: 0,
    totalPages: 0,
    currentPage: 0,
    currentUtterance: '',
  });

  doc.setFont(PDF_FONT_NAME, 'normal');
  doc.setFontSize(UTTERANCE_FONT_SIZE_PT);
  const utteranceLineHeightMm = ptToMm(UTTERANCE_FONT_SIZE_PT) * UTTERANCE_LINE_HEIGHT_FACTOR;

  const cellPlans: CellPlan[] = eligible.map(({ row, artifact }) => {
    const rawUtterance = row.UTTERANCE || '';
    const utterance = sentenceCase(rawUtterance);
    const lines = utterance.length === 0
      ? ['']
      : (doc.splitTextToSize(utterance, pictoWidthMm) as string[]);
    const utteranceHeightMm = Math.max(1, lines.length) * utteranceLineHeightMm;
    // Full cell height = top pad + picto + caption gap + utterance + bottom pad
    const cellHeightMm =
      CELL_PAD_Y_MM +
      pictoHeightMm +
      PICTO_CAPTION_GAP_MM +
      utteranceHeightMm +
      CELL_PAD_Y_MM;
    return {
      row,
      artifact,
      pictoHeightMm,
      utteranceLines: lines,
      utteranceHeightMm,
      cellHeightMm,
    };
  });

  // Pair cells left/right and paginate by accumulating row heights.
  const rowPlans: RowPlan[] = [];
  for (let i = 0; i < cellPlans.length; i += 2) {
    const left = cellPlans[i];
    const right = cellPlans[i + 1];
    rowPlans.push({
      left,
      right,
      heightMm: Math.max(left.cellHeightMm, right?.cellHeightMm ?? 0),
      pageIndex: 0, // assigned next
    });
  }

  let cursorY = CONTENT_TOP_MM;
  let pageIndex = 0;
  for (const rp of rowPlans) {
    const needed = rp.heightMm + (cursorY > CONTENT_TOP_MM ? ROW_GUTTER_MM : 0);
    if (cursorY + needed > CONTENT_BOTTOM_MM && cursorY > CONTENT_TOP_MM) {
      pageIndex += 1;
      cursorY = CONTENT_TOP_MM;
    }
    rp.pageIndex = pageIndex;
    cursorY += (cursorY > CONTENT_TOP_MM ? ROW_GUTTER_MM : 0) + rp.heightMm;
  }
  const totalPages = pageIndex + 1;

  // Phase B — render. jsPDF starts at page 1 already.
  const drawPageFurniture = (currentPage1Based: number) => {
    // Header strip
    doc.setFont(PDF_FONT_NAME, 'normal');
    doc.setFontSize(HEADER_FONT_SIZE_PT);
    doc.setTextColor(120, 120, 120);
    const headerY = MARGIN_MM + HEADER_HEIGHT_MM - 4;
    const headerTitle = upper(((titleOverride ?? config.name) || '').trim() || 'PICTOS');
    doc.text(headerTitle, MARGIN_MM, headerY);
    const pageLabel = upper(
      t
        ? t('pdfExport.progress', { page: currentPage1Based, total: totalPages })
        : `Page ${currentPage1Based} of ${totalPages}`
    );
    doc.text(pageLabel, PAGE_W_MM - MARGIN_MM, headerY, { align: 'right' });
    // Header rule
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.15);
    const ruleY = MARGIN_MM + HEADER_HEIGHT_MM;
    doc.line(MARGIN_MM, ruleY, PAGE_W_MM - MARGIN_MM, ruleY);

    // Footer (only if at least one field is non-empty)
    const credits = upper((config.credits || '').trim());
    const license = upper((config.license || '').trim());
    if (credits || license) {
      doc.setFontSize(FOOTER_FONT_SIZE_PT);
      doc.setTextColor(140, 140, 140);
      const footerY = PAGE_H_MM - MARGIN_MM - 1;
      if (credits) doc.text(credits, MARGIN_MM, footerY);
      if (license) doc.text(license, PAGE_W_MM - MARGIN_MM, footerY, { align: 'right' });
      const fRuleY = PAGE_H_MM - MARGIN_MM - FOOTER_HEIGHT_MM;
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.1);
      doc.line(MARGIN_MM, fRuleY, PAGE_W_MM - MARGIN_MM, fRuleY);
    }

    // Reset for content
    doc.setTextColor(0, 0, 0);
  };

  const drawCell = async (cell: CellPlan, x: number, y: number, alignedHeight: number) => {
    // Rasterise the artifact to PNG.
    let pngDataUrl: string;
    if (cell.artifact.kind === 'bitmap') {
      pngDataUrl = cell.artifact.data;
    } else {
      pngDataUrl = await rasterizeSvg(cell.artifact.data, pictoWidthPx, pictoHeightPx);
    }
    checkAborted(signal);

    // Cut guide — encloses the whole cell (pictogram + utterance). Drawn
    // first so that text and image render on top of any aliasing pixels.
    const rectHeight = alignedHeight; // row's unified height
    doc.setDrawColor(CUT_GUIDE_GREY, CUT_GUIDE_GREY, CUT_GUIDE_GREY);
    doc.setLineWidth(CUT_GUIDE_STROKE_MM);
    doc.rect(x, y, COLUMN_W_MM, rectHeight);

    // Pictogram — top of the cell, inset by the cell padding.
    const pictoX = x + CELL_PAD_X_MM;
    const pictoY = y + CELL_PAD_Y_MM;
    doc.addImage(pngDataUrl, 'PNG', pictoX, pictoY, pictoWidthMm, pictoHeightMm, undefined, 'FAST');

    // Utterance — multi-line, centred horizontally inside the cell.
    doc.setFont(PDF_FONT_NAME, 'normal');
    doc.setFontSize(UTTERANCE_FONT_SIZE_PT);
    doc.setTextColor(20, 20, 20);
    const captionBaselineY =
      pictoY + pictoHeightMm + PICTO_CAPTION_GAP_MM + ptToMm(UTTERANCE_FONT_SIZE_PT) * 0.9;
    cell.utteranceLines.forEach((line, idx) => {
      const lineY = captionBaselineY + idx * utteranceLineHeightMm;
      doc.text(line, x + COLUMN_W_MM / 2, lineY, { align: 'center' });
    });

    // Optional step-number badge — small grey number on a faint white chip in
    // the top-left corner, drawn last so it sits above the pictogram (mirrors
    // the grid-view chip). Used by the sequence export.
    const badge = badgeFor?.(cell.row);
    if (badge != null && String(badge).length > 0) {
      const label = String(badge);
      doc.setFont(PDF_FONT_NAME, 'normal');
      doc.setFontSize(BADGE_FONT_SIZE_PT);
      const textWmm = doc.getTextWidth(label);
      const chipW = textWmm + 2 * BADGE_CHIP_PAD_X_MM;
      const chipH = ptToMm(BADGE_FONT_SIZE_PT) + 2 * BADGE_CHIP_PAD_Y_MM;
      const chipX = x + CELL_PAD_X_MM;
      const chipY = y + CELL_PAD_Y_MM;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(chipX, chipY, chipW, chipH, 0.6, 0.6, 'F');
      doc.setTextColor(BADGE_GREY, BADGE_GREY, BADGE_GREY);
      const badgeBaselineY = chipY + BADGE_CHIP_PAD_Y_MM + ptToMm(BADGE_FONT_SIZE_PT) * 0.85;
      doc.text(label, chipX + BADGE_CHIP_PAD_X_MM, badgeBaselineY, { align: 'left' });
      doc.setTextColor(0, 0, 0);
    }
  };

  let renderedCells = 0;
  drawPageFurniture(1);
  let currentPageIndex = 0;
  let cursor = CONTENT_TOP_MM;
  let firstRowOnPage = true;

  for (const rp of rowPlans) {
    if (rp.pageIndex !== currentPageIndex) {
      doc.addPage();
      currentPageIndex = rp.pageIndex;
      drawPageFurniture(currentPageIndex + 1);
      cursor = CONTENT_TOP_MM;
      firstRowOnPage = true;
    }
    if (!firstRowOnPage) cursor += ROW_GUTTER_MM;

    // Left cell
    onProgress?.({
      phase: 'rendering',
      totalCells: eligible.length,
      renderedCells,
      totalPages,
      currentPage: currentPageIndex + 1,
      currentUtterance: rp.left.row.UTTERANCE || '',
    });
    await drawCell(rp.left, MARGIN_MM, cursor, rp.heightMm);
    renderedCells += 1;
    checkAborted(signal);

    // Right cell (optional)
    if (rp.right) {
      onProgress?.({
        phase: 'rendering',
        totalCells: eligible.length,
        renderedCells,
        totalPages,
        currentPage: currentPageIndex + 1,
        currentUtterance: rp.right.row.UTTERANCE || '',
      });
      const rightX = MARGIN_MM + COLUMN_W_MM + COLUMN_GUTTER_MM;
      await drawCell(rp.right, rightX, cursor, rp.heightMm);
      renderedCells += 1;
      checkAborted(signal);
    }

    cursor += rp.heightMm;
    firstRowOnPage = false;
  }

  // Final progress tick
  onProgress?.({
    phase: 'rendering',
    totalCells: eligible.length,
    renderedCells,
    totalPages,
    currentPage: currentPageIndex + 1,
    currentUtterance: '',
  });

  const blob = doc.output('blob');
  return { blob, totalCells: eligible.length, totalPages };
}

/** Build the canonical filename for an exported PDF. */
export function pdfExportFilename(config: GlobalConfig, date: Date = new Date()): string {
  const safeName = sanitizeFilename(config.name || '') || 'pictonet';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${safeName}_pictos_${yyyy}-${mm}-${dd}.pdf`;
}

/** Trigger a browser download for a generated PDF blob. */
export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download finishes in older browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
