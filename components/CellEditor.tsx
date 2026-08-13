import React, { useState, useRef, useEffect } from 'react';
import { X, Mic, Square, RefreshCw } from 'lucide-react';
import { BoardCell, FitzgeraldColor, RowData } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface CellEditorProps {
  cell: BoardCell;
  rows: RowData[];
  /** All boards' cells in this library — used to detect shared-audio note */
  allCells: BoardCell[];
  onUpdateCell: (patch: Partial<BoardCell>) => void;
  onUpdateRowAudio: (rowId: string, audio: string | undefined) => void;
  onClose: () => void;
}

const FITZGERALD_COLORS: { key: FitzgeraldColor; bg: string; label: string }[] = [
  { key: 'amarillo', bg: '#FEF08A', label: 'Personas' },
  { key: 'verde',    bg: '#BBF7D0', label: 'Verbos' },
  { key: 'azul',     bg: '#BFDBFE', label: 'Adjetivos' },
  { key: 'naranja',  bg: '#FED7AA', label: 'Sustantivos' },
  { key: 'rosa',     bg: '#FBCFE8', label: 'Funcionales' },
  { key: 'morado',   bg: '#DDD6FE', label: 'Social' },
  { key: 'gris',     bg: '#E2E8F0', label: 'Sistema' },
];

type RecordState = 'idle' | 'requesting' | 'countdown' | 'recording';

export function CellEditor({ cell, rows, allCells, onUpdateCell, onUpdateRowAudio, onClose }: CellEditorProps) {
  const { t } = useTranslation();
  const linkedRow = rows.find(r => r.id === cell.rowId) ?? null;

  // Autocomplete state
  const [query, setQuery] = useState(linkedRow?.UTTERANCE ?? '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const openDropdown = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
    setShowSuggestions(true);
  };

  // Audio recording state
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingCancelledRef = useRef(false);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep query in sync if parent changes the linked row
  useEffect(() => {
    setQuery(linkedRow?.UTTERANCE ?? '');
    setShowSuggestions(false);
  }, [cell.rowId]);

  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const suggestions = query.trim().length > 0
    ? rows.filter(r =>
        r.id !== cell.rowId &&
        normalize(r.UTTERANCE).includes(normalize(query))
      ).slice(0, 8)
    : [];

  // How many other cells (in any board) reference the same row
  const sharedCount = linkedRow
    ? allCells.filter(c => c.id !== cell.id && c.rowId === linkedRow.id).length
    : 0;

  async function startCountdown() {
    setMicError(null);
    setRecordState('requesting');
    recordingCancelledRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingCancelledRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;

      setRecordState('countdown');
      setCountdown(3);
      let n = 3;
      countdownRef.current = setInterval(() => {
        n--;
        if (n > 0) {
          setCountdown(n);
        } else {
          clearInterval(countdownRef.current!);
          startRecording();
        }
      }, 1000);
    } catch {
      if (!recordingCancelledRef.current) {
        setMicError(t('board.micDenied'));
        setRecordState('idle');
      }
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setMicError(t('board.micDenied'));
      setRecordState('idle');
      return;
    }

    try {
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        if (recordingCancelledRef.current) {
          recordingCancelledRef.current = false;
          chunksRef.current = [];
          streamRef.current?.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          setRecordState('idle');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (cell.rowId) onUpdateRowAudio(cell.rowId, reader.result as string);
        };
        reader.readAsDataURL(blob);
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setRecordState('idle');
      };
      recorder.start();
      setRecordState('recording');
    } catch {
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setMicError(t('board.micDenied'));
      setRecordState('idle');
    }
  }

  function stopRecording() {
    recordingCancelledRef.current = false;
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    recordingCancelledRef.current = true;
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setRecordState('idle');
    setMicError(null);
  }

  // Cleanup on unmount
  useEffect(() => () => {
    recordingCancelledRef.current = true;
    if (countdownRef.current) clearInterval(countdownRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <div className="w-72 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Celda</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto">
        {/* Color section */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Color</p>
          <div className="grid grid-cols-3 gap-2">
            {FITZGERALD_COLORS.map(({ key, bg, label }) => (
              <button
                key={key}
                onClick={() => onUpdateCell({ color: key })}
                title={label}
                className={`rounded-lg h-10 transition-all border-2 ${
                  cell.color === key ? 'border-slate-700 scale-105 shadow-sm' : 'border-transparent hover:border-slate-300'
                }`}
                style={{ backgroundColor: bg }}
              />
            ))}
          </div>
        </div>

        {/* Pictogram section */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pictograma</p>
          <div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={t('board.searchRow')}
              onChange={e => { setQuery(e.target.value); openDropdown(); }}
              onFocus={openDropdown}
              onBlur={() => setShowSuggestions(false)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            {showSuggestions && suggestions.length > 0 && dropdownPos && (
              <div
                className="fixed bg-white border border-slate-200 rounded-lg shadow-lg z-[9999] max-h-48 overflow-y-auto"
                style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
              >
                {suggestions.map(row => (
                  <button
                    key={row.id}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      onUpdateCell({ rowId: row.id });
                      setQuery(row.UTTERANCE);
                      setShowSuggestions(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                  >
                    {(row.structuredSvg || row.rawSvg) ? (
                      <div className="w-8 h-8 flex-shrink-0 [&>svg]:w-full [&>svg]:h-full"
                        dangerouslySetInnerHTML={{ __html: row.structuredSvg || row.rawSvg || '' }} />
                    ) : row.bitmap ? (
                      <img src={row.bitmap} className="w-8 h-8 flex-shrink-0 object-contain" alt="" />
                    ) : (
                      <div className="w-8 h-8 flex-shrink-0 bg-slate-100 rounded" />
                    )}
                    <span className="truncate">{row.UTTERANCE}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {linkedRow && (
            <div className="mt-2 flex items-center gap-2">
              <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center">
                {(linkedRow.structuredSvg || linkedRow.rawSvg) ? (
                  <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: linkedRow.structuredSvg || linkedRow.rawSvg || '' }} />
                ) : linkedRow.bitmap ? (
                  <img src={linkedRow.bitmap} className="w-full h-full object-contain" alt="" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{linkedRow.UTTERANCE}</p>
                <button
                  onClick={() => { onUpdateCell({ rowId: null }); setQuery(''); }}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors mt-0.5"
                >
                  {t('board.clearRow')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Audio section — only when a row is linked */}
        {linkedRow && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Audio</p>

            {micError && (
              <p className="text-xs text-red-500 mb-2">{micError}</p>
            )}

            {recordState === 'requesting' && (
              <p className="text-xs text-slate-500 py-3">{t('board.requestingMic')}</p>
            )}

            {recordState === 'countdown' && (
              <div className="flex flex-col items-center gap-2 py-3">
                <span className="text-4xl font-bold text-violet-600">{countdown}</span>
                <button onClick={cancelRecording} className="text-xs text-slate-400 hover:text-red-500">Cancelar</button>
              </div>
            )}

            {recordState === 'recording' && (
              <div className="flex flex-col items-center gap-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-medium text-red-600">{t('board.recording')}</span>
                </div>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Square size={12} /> Detener
                </button>
                <button onClick={cancelRecording} className="text-xs text-slate-400 hover:text-slate-600">Cancelar</button>
              </div>
            )}

            {recordState === 'idle' && (
              <>
                {linkedRow.audio ? (
                  <div className="space-y-2">
                    <audio controls src={linkedRow.audio} className="w-full h-8" style={{ height: 32 }} />
                    <button
                      onClick={startCountdown}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 transition-colors"
                    >
                      <RefreshCw size={12} /> {t('board.replaceAudio')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startCountdown}
                    className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-600 hover:border-violet-300 hover:text-violet-700 transition-colors"
                  >
                    <Mic size={14} /> {t('board.addAudio')}
                  </button>
                )}

                {sharedCount > 0 && (
                  <p className="text-xs text-slate-400 mt-2 italic">{t('board.sharedAudioNote')}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
