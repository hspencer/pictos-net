import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Pencil, Eye, Volume2, GripHorizontal } from 'lucide-react';
import { Board, BoardCell, RowData, FITZGERALD_BG } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { CellEditor } from './CellEditor';

interface BoardEditorProps {
  board: Board;
  rows: RowData[];
  onSave: (board: Board) => void;
  onBack: () => void;
  onUpdateRowAudio: (rowId: string, audio: string | undefined) => void;
}

type BoardMode = 'edit' | 'use';

export function BoardEditor({ board, rows, onSave, onBack, onUpdateRowAudio }: BoardEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BoardMode>('edit');
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [cells, setCells] = useState<BoardCell[]>(board.cells);
  // Keep a ref so updateCell always serialises the latest board metadata
  const boardRef = useRef(board);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Floating panel — position and drag
  const [panelPos, setPanelPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 308) : 100,
    y: 80,
  }));
  const dragState = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { sx: e.clientX, sy: e.clientY, ox: panelPos.x, oy: panelPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      setPanelPos({
        x: Math.max(0, Math.min(window.innerWidth  - 288, dragState.current.ox + ev.clientX - dragState.current.sx)),
        y: Math.max(0, Math.min(window.innerHeight - 80,  dragState.current.oy + ev.clientY - dragState.current.sy)),
      });
    };
    const onUp = () => {
      dragState.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  useEffect(() => { boardRef.current = board; });

  // Re-init cells when the board itself changes (e.g. switching libraries)
  useEffect(() => {
    setCells(board.cells);
  }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === 'use') setSelectedCellId(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'use') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode('edit');
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mode]);

  const selectedCell = cells.find(c => c.id === selectedCellId) ?? null;

  function updateCell(id: string, patch: Partial<BoardCell>) {
    setCells(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...patch } : c);
      onSave({ ...boardRef.current, cells: next, modifiedAt: new Date().toISOString() });
      return next;
    });
  }

  function handleCellClick(cell: BoardCell) {
    if (mode === 'edit') {
      setSelectedCellId(prev => prev === cell.id ? null : cell.id);
      return;
    }
    if (!cell.rowId) return;
    const row = rows.find(r => r.id === cell.rowId);
    if (!row?.audio) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    audioRef.current = new Audio(row.audio);
    audioRef.current.play();
  }

  const ordered = [...cells].sort((a, b) =>
    a.position.rowIndex !== b.position.rowIndex
      ? a.position.rowIndex - b.position.rowIndex
      : a.position.colIndex - b.position.colIndex,
  );

  return (
    <div className={mode === 'use'
      ? 'fixed inset-0 z-[var(--z-modal)] flex flex-col bg-white p-1 sm:p-2 animate-in fade-in duration-200'
      : 'flex flex-col h-full animate-in fade-in duration-200'}
    >
      {mode === 'use' && (
        <button
          type="button"
          onClick={() => setMode('edit')}
          aria-label={t('board.exitUseMode')}
          title={t('board.exitUseMode')}
          className="fixed left-2 top-2 z-[var(--z-notification)] flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-md backdrop-blur transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      )}

      {/* Header */}
      {mode === 'edit' && <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
        >
          <ChevronLeft size={16} /> {t('board.back')}
        </button>

        <h1 className="text-sm font-bold text-slate-900 flex-1 truncate min-w-0">{board.name}</h1>

        {/* Mode toggle */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
          <button
            onClick={() => setMode('edit')}
            aria-pressed={mode === 'edit'}
            title={t('board.modeEdit')}
            className={`p-1.5 rounded-md transition-colors ${mode === 'edit' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setMode('use')}
            aria-pressed={mode === 'use'}
            title={t('board.modeUse')}
            className={`p-1.5 rounded-md transition-colors ${mode === 'use' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Eye size={15} />
          </button>
        </div>
      </div>}

      {/* Main area: grid always full-width; panel floats */}
      <div className={mode === 'use' ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-auto'}>
        <div
          className={mode === 'use' ? 'grid h-full w-full gap-1' : 'grid w-full gap-1'}
          style={{
            gridTemplateColumns: `repeat(${board.grid.cols}, minmax(0, 1fr))`,
            ...(mode === 'use'
              ? { gridTemplateRows: `repeat(${board.grid.rows}, minmax(0, 1fr))` }
              : {}),
          }}
        >
          {ordered.map(cell => {
              const row = rows.find(r => r.id === cell.rowId) ?? null;
              const isSelected  = selectedCellId === cell.id;
              const hasAudio    = Boolean(row?.audio);
              const isClickable = mode === 'use' ? (row !== null && hasAudio) : true;

              return (
                <button
                  key={cell.id}
                  onClick={() => handleCellClick(cell)}
                  className={`flex min-h-0 flex-col rounded-lg overflow-hidden transition-all border-2 ${
                    isSelected
                      ? 'border-violet-500 shadow-md'
                      : mode === 'edit'
                        ? 'border-transparent hover:border-slate-400'
                        : isClickable
                          ? 'border-transparent hover:brightness-95 active:scale-95'
                          : 'border-transparent cursor-default'
                  }`}
                  style={{ backgroundColor: FITZGERALD_BG[cell.color] }}
                  disabled={mode === 'use' && !isClickable}
                >
                  {/* Pictogram area */}
                  <div className={mode === 'use' ? 'relative min-h-0 w-full flex-1' : 'relative w-full aspect-square'}>
                    {row && (row.structuredSvg || row.rawSvg) && (
                      <div
                        className="absolute inset-0 p-1 [&>svg]:w-full [&>svg]:h-full"
                        dangerouslySetInnerHTML={{ __html: row.structuredSvg || row.rawSvg || '' }}
                      />
                    )}
                    {row && !row.structuredSvg && !row.rawSvg && row.bitmap && (
                      <div className="absolute inset-0 p-1 flex items-center justify-center">
                        <img src={row.bitmap} className="w-full h-full object-contain" alt="" />
                      </div>
                    )}
                    {hasAudio && (
                      <div className="absolute top-0.5 right-0.5 bg-white/70 rounded-full p-0.5">
                        <Volume2 size={8} className="text-slate-600" />
                      </div>
                    )}
                  </div>

                  {/* Caption strip */}
                  {(board.showLabels ?? true) && row && (
                    <div className="w-full px-0.5 py-0.5 bg-white/40">
                      <p
                        className="text-center text-slate-800 font-medium leading-tight truncate"
                        style={{ fontSize: 'clamp(0.45rem, 1vw, 0.6rem)' }}
                      >
                        {row.UTTERANCE}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </div>

      {/* Floating draggable CellEditor */}
      {mode === 'edit' && selectedCell && (
        <div
          className="fixed z-40 rounded-xl overflow-hidden shadow-2xl border border-slate-200 bg-white"
          style={{ left: panelPos.x, top: panelPos.y, maxHeight: 'calc(100vh - 100px)' }}
        >
          {/* Drag handle */}
          <div
            className="flex items-center justify-center h-5 bg-slate-100 border-b border-slate-200 cursor-grab active:cursor-grabbing"
            onMouseDown={handleDragStart}
          >
            <GripHorizontal size={14} className="text-slate-400" />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 140px)' }}>
            <CellEditor
              cell={selectedCell}
              rows={rows}
              allCells={cells}
              onUpdateCell={patch => updateCell(selectedCell.id, patch)}
              onUpdateRowAudio={onUpdateRowAudio}
              onClose={() => setSelectedCellId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
