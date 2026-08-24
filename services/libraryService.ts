/**
 * libraryService.ts
 *
 * Pure localStorage CRUD for the multi-library system.
 * No React hooks — safe to call from anywhere.
 *
 * Storage key layout:
 *   pictonet_libraries          — LibraryMeta[]  (index)
 *   pictonet_active_lib         — string          (active library id)
 *   pictonet_lib_{id}_meta      — RowData[]       (rows without binaries)
 *   pictonet_lib_{id}_config    — GlobalConfig
 *   pictonet_lib_{id}_seqs      — Sequence[]
 *   pictonet_lib_{id}_boards    — Board[]
 *
 * Legacy keys (read-only, only used by migration):
 *   pictonet_v19_storage        — old single-library RowData[]
 *   pictonet_v19_config         — old single-library GlobalConfig
 */

import JSZip from 'jszip';
import type { RowData, GlobalConfig, LibraryMeta, Sequence, Board } from '../types';
import { rekeyBoardsForLibrary } from './libraryTransferService';

// ── Storage keys ────────────────────────────────────────────────────────────

export const LIBRARIES_INDEX_KEY = 'pictonet_libraries';
export const ACTIVE_LIBRARY_KEY  = 'pictonet_active_lib';
export const libMetaKey   = (id: string) => `pictonet_lib_${id}_meta`;
export const libConfigKey = (id: string) => `pictonet_lib_${id}_config`;
export const libSeqsKey      = (id: string) => `pictonet_lib_${id}_seqs`;
export const libBoardsKey    = (id: string) => `pictonet_lib_${id}_boards`;
export const libPreviewsKey  = (id: string) => `pictonet_lib_${id}_previews`;

// Legacy keys — used only by needsMigration() and migrateFromSingleLibrary()
export const LEGACY_STORAGE_KEY = 'pictonet_v19_storage';
export const LEGACY_CONFIG_KEY  = 'pictonet_v19_config';

// ── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Partial<GlobalConfig> = {
  lang: 'es-419',
  license: 'CC BY 4.0',
  visualStylePrompt: '',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeFilename(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

function stripBinaryFields(rows: RowData[]): RowData[] {
  return rows.map(({ bitmap: _b, rawSvg: _r, structuredSvg: _s, ...meta }) => meta as RowData);
}


// ── Index CRUD ──────────────────────────────────────────────────────────────

export function getLibraryIndex(): LibraryMeta[] {
  try {
    const raw = localStorage.getItem(LIBRARIES_INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LibraryMeta[];
  } catch {
    return [];
  }
}

export function saveLibraryIndex(index: LibraryMeta[]): void {
  localStorage.setItem(LIBRARIES_INDEX_KEY, JSON.stringify(index));
}

// ── Library CRUD ─────────────────────────────────────────────────────────────

export function createLibrary(name: string, initialConfig?: Partial<GlobalConfig>): LibraryMeta {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const meta: LibraryMeta = {
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    pictogramCount: 0,
    sequenceCount: 0,
    language: initialConfig?.lang,
  };

  const index = getLibraryIndex();
  index.unshift(meta);
  saveLibraryIndex(index);

  const config: Partial<GlobalConfig> = {
    ...DEFAULT_CONFIG,
    ...initialConfig,
    name,
  };
  localStorage.setItem(libConfigKey(id), JSON.stringify(config));
  localStorage.setItem(libMetaKey(id), JSON.stringify([]));
  localStorage.setItem(libSeqsKey(id), JSON.stringify([]));
  localStorage.setItem(libBoardsKey(id), JSON.stringify([]));

  return meta;
}

export function updateLibraryMeta(id: string, patch: Partial<LibraryMeta>): void {
  const index = getLibraryIndex();
  const i = index.findIndex(l => l.id === id);
  if (i === -1) return;
  index[i] = { ...index[i], ...patch };
  saveLibraryIndex(index);
}

export function deleteLibrary(id: string): void {
  const index = getLibraryIndex().filter(l => l.id !== id);
  saveLibraryIndex(index);

  // Remove all scoped keys for this library
  localStorage.removeItem(libMetaKey(id));
  localStorage.removeItem(libConfigKey(id));
  localStorage.removeItem(libSeqsKey(id));
  localStorage.removeItem(libBoardsKey(id));

  // Remove previews thumbnail cache
  localStorage.removeItem(libPreviewsKey(id));

  // Remove active pointer if it pointed at this library
  if (localStorage.getItem(ACTIVE_LIBRARY_KEY) === id) {
    localStorage.removeItem(ACTIVE_LIBRARY_KEY);
  }
}

export function duplicateLibrary(sourceId: string): LibraryMeta {
  const index = getLibraryIndex();
  const source = index.find(l => l.id === sourceId);
  const sourceName = source?.name ?? 'Librería';

  const rows = getLibraryRows(sourceId);
  const config = getLibraryConfig(sourceId);
  const seqs = getLibrarySequences(sourceId);
  const boards = getLibraryBoards(sourceId);

  const newMeta = createLibrary(`${sourceName} (copia)`, config ?? undefined);

  // Overwrite with proper data (createLibrary already wrote empty rows/seqs/boards)
  saveLibraryRows(newMeta.id, rows);
  saveLibrarySequences(newMeta.id, seqs);
  saveLibraryBoards(newMeta.id, boards.map(b => ({ ...b, libraryId: newMeta.id })));
  updateLibraryMeta(newMeta.id, {
    pictogramCount: rows.length,
    sequenceCount: seqs.length,
    boardCount: boards.length,
  });

  return newMeta;
}

// ── Row data ─────────────────────────────────────────────────────────────────

export function getLibraryRows(id: string): RowData[] {
  try {
    const raw = localStorage.getItem(libMetaKey(id));
    if (!raw) return [];
    return JSON.parse(raw) as RowData[];
  } catch {
    return [];
  }
}

export function saveLibraryRows(id: string, rows: RowData[]): void {
  localStorage.setItem(libMetaKey(id), JSON.stringify(stripBinaryFields(rows)));
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getLibraryConfig(id: string): GlobalConfig | null {
  try {
    const raw = localStorage.getItem(libConfigKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return null;
  }
}

export function saveLibraryConfig(id: string, config: GlobalConfig): void {
  localStorage.setItem(libConfigKey(id), JSON.stringify(config));
}

// ── Sequences ────────────────────────────────────────────────────────────────

export function getLibrarySequences(id: string): Sequence[] {
  try {
    const raw = localStorage.getItem(libSeqsKey(id));
    if (!raw) return [];
    return JSON.parse(raw) as Sequence[];
  } catch {
    return [];
  }
}

export function saveLibrarySequences(id: string, seqs: Sequence[]): void {
  localStorage.setItem(libSeqsKey(id), JSON.stringify(seqs));
}

// ── Boards ───────────────────────────────────────────────────────────────────

export function getLibraryBoards(id: string): Board[] {
  try {
    const raw = localStorage.getItem(libBoardsKey(id));
    if (!raw) return [];
    return JSON.parse(raw) as Board[];
  } catch {
    return [];
  }
}

export function saveLibraryBoards(id: string, boards: Board[]): void {
  localStorage.setItem(libBoardsKey(id), JSON.stringify(boards));
}

// ── Export / Import ──────────────────────────────────────────────────────────

export function exportLibraryJson(id: string): string {
  const index = getLibraryIndex();
  const meta = index.find(l => l.id === id);
  const rows = getLibraryRows(id);
  const config = getLibraryConfig(id);
  const sequences = getLibrarySequences(id);
  const boards = getLibraryBoards(id);

  return JSON.stringify({
    id,
    name: meta?.name ?? '',
    createdAt: meta?.createdAt ?? new Date().toISOString(),
    modifiedAt: meta?.modifiedAt ?? new Date().toISOString(),
    config,
    rows,
    sequences,
    boards,
  }, null, 2);
}

export function importLibraryJson(json: string): LibraryMeta {
  const data = JSON.parse(json) as {
    name?: string;
    config?: Partial<GlobalConfig>;
    rows?: RowData[];
    sequences?: Sequence[];
    boards?: Board[];
    createdAt?: string;
    modifiedAt?: string;
  };

  const existingNames = new Set(getLibraryIndex().map(l => l.name));
  const baseName = data.name || (data.config as any)?.name || 'Librería importada';
  const name = existingNames.has(baseName) ? `${baseName} (importada)` : baseName;

  const meta = createLibrary(name, data.config);

  if (Array.isArray(data.rows)) {
    saveLibraryRows(meta.id, data.rows);
    updateLibraryMeta(meta.id, { pictogramCount: data.rows.length });
  }

  if (Array.isArray(data.sequences)) {
    const reKeyed = data.sequences.map(seq => ({ ...seq, libraryId: meta.id }));
    saveLibrarySequences(meta.id, reKeyed);
    updateLibraryMeta(meta.id, { sequenceCount: data.sequences.length });
  }

  if (Array.isArray(data.boards)) {
    const reKeyed = rekeyBoardsForLibrary(data.boards, meta.id);
    saveLibraryBoards(meta.id, reKeyed);
    updateLibraryMeta(meta.id, { boardCount: data.boards.length });
  }

  return meta;
}

export async function backupAllLibraries(): Promise<Blob> {
  const index = getLibraryIndex();
  const zip = new JSZip();

  for (const lib of index) {
    const json = exportLibraryJson(lib.id);
    const filename = `${sanitizeFilename(lib.name) || lib.id}.json`;
    zip.file(filename, json);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function backupFilename(): string {
  return `PICTOS-Libraries-${new Date().toISOString().slice(0, 10)}.zip`;
}

// ── Migration ────────────────────────────────────────────────────────────────

export function needsMigration(): boolean {
  const hasLegacy = localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
  const hasIndex  = localStorage.getItem(LIBRARIES_INDEX_KEY) !== null;
  return hasLegacy && !hasIndex;
}

export function migrateFromSingleLibrary(): LibraryMeta {
  // Read legacy data
  let legacyRows: RowData[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) legacyRows = JSON.parse(raw) as RowData[];
  } catch { /* ignore */ }

  let legacyConfig: Partial<GlobalConfig> = {};
  try {
    const raw = localStorage.getItem(LEGACY_CONFIG_KEY);
    if (raw) legacyConfig = JSON.parse(raw) as Partial<GlobalConfig>;
  } catch { /* ignore */ }

  const name = (legacyConfig as GlobalConfig).name || 'Mi librería';
  const meta = createLibrary(name, legacyConfig);

  saveLibraryRows(meta.id, legacyRows);
  updateLibraryMeta(meta.id, { pictogramCount: legacyRows.length });

  // Note: legacy keys are NOT deleted here.
  // App.tsx will handle the IDB 'migrated' → real id renaming.
  // Legacy keys serve as a fallback if migration is interrupted.

  return meta;
}

// ── Preview thumbnails ────────────────────────────────────────────────────────
// Stores up to 3 tiny JPEG data URLs generated from the library's first rows.
// Updated asynchronously on save; stale previews are fine — home screen only.

export function getLibraryPreviews(id: string): string[] {
  try {
    const raw = localStorage.getItem(libPreviewsKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLibraryPreviews(id: string, thumbnails: string[]): void {
  try {
    localStorage.setItem(libPreviewsKey(id), JSON.stringify(thumbnails.slice(0, 3)));
  } catch {
    // Quota exceeded — previews are cosmetic, never block a save
  }
}
