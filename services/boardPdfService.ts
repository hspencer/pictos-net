/**
 * Board PDF export.
 *
 * Renders a communication board as a landscape PDF (Letter or Tabloid).
 * Each cell gets its Fitzgerald-key background colour, a rasterised
 * pictogram, and — when showLabels is true — the row utterance below.
 */

import { jsPDF } from 'jspdf';
import type { Board, RowData } from '../types';
import { FITZGERALD_BG } from '../types';

export type BoardPdfFormat = 'letter' | 'tabloid';

// Page dimensions in mm — landscape (width × height)
const PAGE_DIMS: Record<BoardPdfFormat, [number, number]> = {
  letter:  [279.4, 215.9],
  tabloid: [431.8, 279.4],
};

const MARGIN_MM   = 10;
const HEADER_MM   = 10;   // space above grid for board name
const FOOTER_MM   = 6;    // space below grid for credit
const CAPTION_MM  = 7;    // height below pictogram reserved for text
const CELL_PAD_MM = 1.5;
const TARGET_DPI  = 150;
const MM_PER_INCH = 25.4;

const PDF_FONT_NAME = 'Lexend';
const PDF_FONT_FILE = 'Lexend.ttf';
const PDF_FONT_URL  = '/fonts/Lexend.ttf';

// ── Helpers (mirrors pdfExportService pattern) ───────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(binary);
}

let cachedFontBase64: string | null = null;
async function loadLexendBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(PDF_FONT_URL);
  if (!res.ok) throw new Error(`Failed to load Lexend font (${res.status})`);
  cachedFontBase64 = arrayBufferToBase64(await res.arrayBuffer());
  return cachedFontBase64;
}

async function registerLexend(doc: jsPDF): Promise<void> {
  const b64 = await loadLexendBase64();
  doc.addFileToVFS(PDF_FONT_FILE, b64);
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, 'normal');
  doc.setFont(PDF_FONT_NAME, 'normal');
}

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
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function exportBoardToPdf(
  board: Board,
  rows: RowData[],
  format: BoardPdfFormat = 'letter',
): Promise<Blob> {
  const [pageW, pageH] = PAGE_DIMS[format];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] });
  await registerLexend(doc);

  const { rows: numRows, cols: numCols } = board.grid;
  const showLabels = board.showLabels ?? true;

  const gridLeft = MARGIN_MM;
  const gridTop  = MARGIN_MM + HEADER_MM;
  const gridW    = pageW - 2 * MARGIN_MM;
  const gridH    = pageH - 2 * MARGIN_MM - HEADER_MM - FOOTER_MM;
  const cellW    = gridW / numCols;
  const cellH    = gridH / numRows;
  const pictoH   = cellH - 2 * CELL_PAD_MM - (showLabels ? CAPTION_MM : 0);

  // Header
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(board.name, MARGIN_MM, MARGIN_MM + 6);
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  doc.text(dateStr, pageW - MARGIN_MM, MARGIN_MM + 6, { align: 'right' });

  // Footer
  doc.text('pictos.net', pageW / 2, pageH - MARGIN_MM / 2, { align: 'center' });

  const ordered = [...board.cells].sort((a, b) =>
    a.position.rowIndex !== b.position.rowIndex
      ? a.position.rowIndex - b.position.rowIndex
      : a.position.colIndex - b.position.colIndex,
  );

  const pixPerMm = TARGET_DPI / MM_PER_INCH;

  for (const cell of ordered) {
    const x = gridLeft + cell.position.colIndex * cellW;
    const y = gridTop  + cell.position.rowIndex * cellH;

    // Background fill
    const [r, g, b] = hexToRgb(FITZGERALD_BG[cell.color]);
    doc.setFillColor(r, g, b);
    doc.rect(x, y, cellW, cellH, 'F');

    const row = cell.rowId ? rows.find(rr => rr.id === cell.rowId) ?? null : null;

    // Pictogram
    if (row) {
      const svgStr = row.structuredSvg || row.rawSvg;
      const widthPx  = Math.round((cellW - 2 * CELL_PAD_MM) * pixPerMm);
      const heightPx = Math.round(pictoH * pixPerMm);
      try {
        let imgData: string | null = null;
        if (svgStr) {
          imgData = await rasterizeSvg(svgStr, widthPx, heightPx);
        } else if (row.bitmap) {
          imgData = row.bitmap;
        }
        if (imgData) {
          doc.addImage(imgData, 'PNG', x + CELL_PAD_MM, y + CELL_PAD_MM,
            cellW - 2 * CELL_PAD_MM, pictoH);
        }
      } catch {
        // cell shows colour only if rasterisation fails
      }
    }

    // Caption
    if (showLabels && row?.UTTERANCE) {
      const fontSize = Math.max(5, Math.min(9, cellW * 0.3));
      doc.setFontSize(fontSize);
      doc.setTextColor(30, 30, 30);
      doc.text(row.UTTERANCE, x + cellW / 2, y + cellH - CAPTION_MM / 2, {
        align: 'center',
        maxWidth: cellW - 2 * CELL_PAD_MM,
      });
    }

    // Subtle cell border
    const darken = (v: number) => Math.max(0, v - 24);
    doc.setDrawColor(darken(r), darken(g), darken(b));
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellW, cellH, 'S');
  }

  return doc.output('blob');
}

export function boardPdfFilename(board: Board, format: BoardPdfFormat): string {
  const safe = (board.name || 'tablero')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40)
    .toLowerCase();
  const d = new Date();
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `tablero_${safe}_${format}_${yyyy}-${mm}-${dd}.pdf`;
}
