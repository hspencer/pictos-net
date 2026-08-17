import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Pencil, Eye, Volume2, GripHorizontal } from 'lucide-react';
import { Board, BoardCell, RowData, FITZGERALD_BG } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { createPlayableAudioUrl, revokePlayableAudioUrl } from '../services/audioPlayback';
import { convertAudioToMp4 } from '../services/audioConvert';
import { CellEditor } from './CellEditor';

interface BoardEditorProps {
  board: Board;
  rows: RowData[];
  otherBoardCells: BoardCell[];
  onSave: (board: Board) => void;
  onBack: () => void;
  onUpdateRowAudio: (rowId: string, audio: string | undefined) => void;
}

type BoardMode = 'edit' | 'use';

export function BoardEditor({ board, rows, otherBoardCells, onSave, onBack, onUpdateRowAudio }: BoardEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BoardMode>('edit');
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [cells, setCells] = useState<BoardCell[]>(board.cells);
  const [playError, setPlayError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  // Keep a ref so updateCell always serialises the latest board metadata
  const boardRef = useRef(board);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceRef = useRef<{ stored: string; playable: string } | null>(null);
  const lastTouchRef = useRef<{ cellId: string; time: number } | null>(null);

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

  useEffect(() => () => {
    if (audioSourceRef.current) {
      revokePlayableAudioUrl(audioSourceRef.current.stored, audioSourceRef.current.playable);
    }
  }, []);

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

  function activateCell(cell: BoardCell) {
    if (mode === 'edit') {
      setSelectedCellId(prev => prev === cell.id ? null : cell.id);
      return;
    }
    if (!cell.rowId) return;
    const row = rows.find(r => r.id === cell.rowId);
    if (!row?.audio) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (audioSourceRef.current) {
      revokePlayableAudioUrl(audioSourceRef.current.stored, audioSourceRef.current.playable);
    }
    const playable = createPlayableAudioUrl(row.audio);
    audioSourceRef.current = { stored: row.audio, playable };
    audioRef.current = new Audio(playable);
    audioRef.current.play().catch(() => {
      setPlayError(cell.id);
      setTimeout(() => setPlayError(null), 1500);
    });
  }

  function handleCellClick(cell: BoardCell) {
    const lastTouch = lastTouchRef.current;
    if (lastTouch?.cellId === cell.id && Date.now() - lastTouch.time < 1000) {
      lastTouchRef.current = null;
      return;
    }
    activateCell(cell);
  }

  function handleCellTap(event: React.TouchEvent<HTMLButtonElement>, cell: BoardCell) {
    if (mode !== 'use') return;
    event.preventDefault();
    lastTouchRef.current = { cellId: cell.id, time: Date.now() };
    activateCell(cell);
  }

  const ordered = [...cells].sort((a, b) =>
    a.position.rowIndex !== b.position.rowIndex
      ? a.position.rowIndex - b.position.rowIndex
      : a.position.colIndex - b.position.colIndex,
  );

  // Cells whose linked row has audio stored in a non-mp4 format
  const rowsNeedingConversion = [...new Set(
    cells.flatMap(c => {
      if (!c.rowId) return [];
      const row = rows.find(r => r.id === c.rowId);
      return (row?.audio && !row.audio.startsWith('data:audio/mp4')) ? [c.rowId] : [];
    })
  )];

  async function handleConvertAll() {
    setConverting(true);
    for (const rowId of rowsNeedingConversion) {
      const row = rows.find(r => r.id === rowId);
      if (!row?.audio) continue;
      const converted = await convertAudioToMp4(row.audio);
      if (converted !== row.audio) onUpdateRowAudio(rowId, converted);
    }
    setConverting(false);
  }

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

        {/* Convert legacy webm audio to mp4 for iOS compatibility */}
        {rowsNeedingConversion.length > 0 && (
          <button
            onClick={handleConvertAll}
            disabled={converting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {converting ? t('board.convertingAudio') : t('board.convertAudioForIos')}
          </button>
        )}

        {/* Mode toggle */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
          <button
            onClick={() => setMode('edit')}
            aria-pressed="true"
            aria-label={t('board.modeEdit')}
            title={t('board.modeEdit')}
            className="p-1.5 rounded-md bg-white shadow-sm text-violet-700 transition-colors"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setMode('use')}
            aria-pressed="false"
            aria-label={t('board.modeUse')}
            title={t('board.modeUse')}
            className="p-1.5 rounded-md text-slate-400 transition-colors hover:text-slate-600"
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
                  onTouchEnd={event => handleCellTap(event, cell)}
                  className={`flex min-h-0 flex-col rounded-lg overflow-hidden transition-all border-2 ${
                    playError === cell.id
                      ? 'border-red-400'
                      : isSelected
                        ? 'border-violet-500 shadow-md'
                        : mode === 'edit'
                          ? 'border-transparent hover:border-slate-400'
                          : isClickable
                            ? 'border-transparent hover:brightness-95 active:scale-95'
                            : 'border-transparent cursor-default'
                  }`}
                  style={{ backgroundColor: FITZGERALD_BG[cell.color], touchAction: 'manipulation' }}
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
              allCells={[...otherBoardCells, ...cells]}
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
