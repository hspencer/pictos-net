import React, { useState, useRef, useEffect } from 'react';
import { Plus, MoreHorizontal, Edit, Copy, FileDown, Trash2, ExternalLink } from 'lucide-react';
import { Board, BoardCell, GridDimensions, FITZGERALD_BG } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface BoardListProps {
  boards: Board[];
  activeLibraryId: string;
  onOpen: (id: string) => void;
  onCreate: (board: Board) => void;
  onSave: (board: Board) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExportPdf: (id: string, format: 'letter' | 'tabloid') => void;
}

const GRID_PRESETS: { rows: number; cols: number }[] = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 4, cols: 6 },
  { rows: 5, cols: 6 },
  { rows: 6, cols: 6 },
  { rows: 6, cols: 8 },
];

function relativeDate(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t('board.today');
  if (days === 1) return t('board.yesterday');
  if (days < 7) return t('board.daysAgo', { days });
  if (days < 30) return t('board.weeksAgo', { weeks: Math.floor(days / 7) });
  return t('board.monthsAgo', { months: Math.floor(days / 30) });
}

function makeCells(grid: GridDimensions): BoardCell[] {
  const cells: BoardCell[] = [];
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++)
      cells.push({ id: crypto.randomUUID(), position: { rowIndex: r, colIndex: c }, color: 'gris', rowId: null });
  return cells;
}

function resizeGrid(cells: BoardCell[], newGrid: GridDimensions): BoardCell[] {
  const kept = cells.filter(c =>
    c.position.rowIndex < newGrid.rows && c.position.colIndex < newGrid.cols
  );
  const occupied = new Set(kept.map(c => `${c.position.rowIndex},${c.position.colIndex}`));
  for (let r = 0; r < newGrid.rows; r++)
    for (let c = 0; c < newGrid.cols; c++)
      if (!occupied.has(`${r},${c}`))
        kept.push({ id: crypto.randomUUID(), position: { rowIndex: r, colIndex: c }, color: 'gris', rowId: null });
  return kept;
}

// ── BoardThumbnail ────────────────────────────────────────────────────────────

function BoardThumbnail({ board }: { board: Board }) {
  const displayCols = Math.min(board.grid.cols, 8);
  const displayRows = Math.min(board.grid.rows, Math.ceil(40 / displayCols));
  const ordered = [...board.cells]
    .sort((a, b) =>
      a.position.rowIndex !== b.position.rowIndex
        ? a.position.rowIndex - b.position.rowIndex
        : a.position.colIndex - b.position.colIndex,
    )
    .slice(0, displayCols * displayRows);

  return (
    <div
      className="h-20 bg-slate-100 rounded-t-xl p-1.5 overflow-hidden"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${displayCols}, 1fr)`, gap: '2px' }}
    >
      {ordered.map(cell => (
        <div key={cell.id} className="rounded-sm" style={{ backgroundColor: FITZGERALD_BG[cell.color] }} />
      ))}
    </div>
  );
}

// ── BoardConfigModal ──────────────────────────────────────────────────────────

function BoardConfigModal({ board, activeLibraryId, onCreate, onSave, onDelete, onClose }: {
  board?: Board;
  activeLibraryId: string;
  onCreate: (board: Board) => void;
  onSave: (board: Board) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!board;
  const nameRef = useRef<HTMLInputElement>(null);

  const findPreset = (g: GridDimensions) =>
    GRID_PRESETS.find(p => p.rows === g.rows && p.cols === g.cols);

  const [name, setName]               = useState(board?.name ?? '');
  const [selectedPreset, setPreset]   = useState(board ? (findPreset(board.grid) ?? GRID_PRESETS[2]) : GRID_PRESETS[2]);
  const [custom, setCustom]           = useState(isEdit && !findPreset(board!.grid));
  const [customRows, setCustomRows]   = useState(board?.grid.rows ?? 4);
  const [customCols, setCustomCols]   = useState(board?.grid.cols ?? 5);
  const [showLabels, setShowLabels]   = useState(board?.showLabels ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const grid = custom ? { rows: customRows, cols: customCols } : selectedPreset;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    if (isEdit && board) {
      onSave({
        ...board,
        name: trimmed,
        grid,
        cells: resizeGrid(board.cells, grid),
        showLabels,
        modifiedAt: now,
      });
    } else {
      onCreate({
        id: crypto.randomUUID(),
        libraryId: activeLibraryId,
        name: trimmed,
        grid,
        cells: makeCells(grid),
        showLabels,
        createdAt: now,
        modifiedAt: now,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-sm font-bold text-slate-900 mb-5">
          {isEdit ? t('board.editTitle') : t('board.createNew')}
        </h2>

        {confirmDelete ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">{t('board.deleteConfirm', { name: board!.name })}</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">
                {t('actions.cancel')}
              </button>
              <button type="button" onClick={() => { onDelete(board!.id); onClose(); }}
                className="px-4 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">
                {t('board.delete')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('board.nameLabel')}</label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('board.untitled')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>

            {/* Grid size */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">{t('board.gridLabel')}</label>
              <div className="flex flex-wrap gap-2">
                {GRID_PRESETS.map(p => (
                  <button
                    key={`${p.rows}x${p.cols}`}
                    type="button"
                    onClick={() => { setPreset(p); setCustom(false); }}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors border ${
                      !custom && selectedPreset.rows === p.rows && selectedPreset.cols === p.cols
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700'
                    }`}
                  >
                    {p.rows}×{p.cols}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustom(true)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                    custom
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700'
                  }`}
                >
                  {t('board.gridCustom')}
                </button>
              </div>
              {custom && (
                <div className="flex items-center gap-3 mt-3">
                  <label className="text-xs text-slate-500">{t('board.gridRows')}</label>
                  <input type="number" min={1} value={customRows}
                    onChange={e => setCustomRows(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 border border-slate-200 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                  <span className="text-slate-400">×</span>
                  <label className="text-xs text-slate-500">{t('board.gridCols')}</label>
                  <input type="number" min={1} value={customCols}
                    onChange={e => setCustomCols(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 border border-slate-200 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">
                {grid.rows} × {grid.cols} = {grid.rows * grid.cols} celdas
              </p>
            </div>

            {/* Show labels */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={e => setShowLabels(e.target.checked)}
                className="w-3.5 h-3.5 accent-violet-600"
              />
              <span className="text-xs text-slate-600">{t('board.showLabels')}</span>
            </label>

            {/* Footer actions */}
            <div className="flex items-center justify-between pt-2">
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  <Trash2 size={12} /> {t('board.delete')}
                </button>
              ) : <div />}
              <div className="flex gap-2">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors">
                  {t('actions.cancel')}
                </button>
                <button type="submit" disabled={!name.trim()}
                  className="px-4 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {isEdit ? t('actions.save') : t('actions.create')}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── BoardCard ─────────────────────────────────────────────────────────────────

function BoardCard({ board, onOpen, onEdit, onDuplicate, onExportPdf }: {
  board: Board;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onExportPdf: (format: 'letter' | 'tabloid') => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl hover:border-violet-400 hover:shadow-lg transition-all cursor-pointer group"
      onClick={() => !menuOpen && onOpen()}
    >
      <BoardThumbnail board={board} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2" onClick={e => e.stopPropagation()}>
          <h3
            className="font-bold text-sm text-slate-900 leading-tight flex-1 min-w-0 truncate"
            title={board.name}
          >
            {board.name}
          </h3>
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              aria-label={t('actions.options')}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[190px] py-1">
                <button
                  onClick={e => { e.stopPropagation(); onOpen(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <ExternalLink size={12} /> {t('board.open')}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onEdit(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <Edit size={12} /> {t('board.modeEdit')}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDuplicate(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <Copy size={12} /> {t('board.duplicate')}
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={e => { e.stopPropagation(); onExportPdf('letter'); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <FileDown size={12} /> {t('board.exportPdfLetter')}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onExportPdf('tabloid'); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <FileDown size={12} /> {t('board.exportPdfTabloid')}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
          <span className="text-xs text-slate-500">{board.grid.rows} × {board.grid.cols}</span>
          <span className="text-[10px] text-slate-400">{relativeDate(board.modifiedAt, t)}</span>
        </div>
      </div>
    </div>
  );
}

// ── CreateBoardCard ───────────────────────────────────────────────────────────

function CreateBoardCard({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onCreate}
      className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition-all min-h-[160px] group"
    >
      <Plus size={20} className="text-slate-300 group-hover:text-violet-500 transition-colors" />
      <span className="text-xs font-semibold text-slate-400 group-hover:text-violet-600 transition-colors text-center px-4">
        {t('board.createNew')}
      </span>
    </div>
  );
}

// ── BoardList ─────────────────────────────────────────────────────────────────

type ModalState = { mode: 'create' } | { mode: 'edit'; board: Board } | null;

export function BoardList({
  boards, activeLibraryId, onOpen, onCreate, onSave, onDelete, onDuplicate, onExportPdf,
}: BoardListProps) {
  const { t } = useTranslation();
  const [modal, setModal] = useState<ModalState>(null);

  return (
    <div id="board-list" className="py-8 space-y-6 animate-in fade-in duration-300">
      {boards.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">{t('board.empty')}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {boards.map(board => (
          <BoardCard
            key={board.id}
            board={board}
            onOpen={() => onOpen(board.id)}
            onEdit={() => setModal({ mode: 'edit', board })}
            onDuplicate={() => onDuplicate(board.id)}
            onExportPdf={format => onExportPdf(board.id, format)}
          />
        ))}
        <CreateBoardCard onCreate={() => setModal({ mode: 'create' })} />
      </div>

      {modal && (
        <BoardConfigModal
          board={modal.mode === 'edit' ? modal.board : undefined}
          activeLibraryId={activeLibraryId}
          onCreate={board => { onCreate(board); setModal(null); }}
          onSave={board => { onSave(board); setModal(null); }}
          onDelete={id => { onDelete(id); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
