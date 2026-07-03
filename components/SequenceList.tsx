import React, { useState, useRef, useEffect } from 'react';
import { Plus, MoreHorizontal, Edit, Trash2 } from 'lucide-react';
import { Sequence, RowData } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface SequenceListProps {
  sequences: Sequence[];
  libraryRows: RowData[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function relativeDate(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t('sequence.today');
  if (days === 1) return t('sequence.yesterday');
  if (days < 7) return t('sequence.daysAgo', { days });
  if (days < 30) return t('sequence.weeksAgo', { weeks: Math.floor(days / 7) });
  return t('sequence.monthsAgo', { months: Math.floor(days / 30) });
}

// ── SequenceCard ──────────────────────────────────────────────────────────────

function SequenceCard({ seq, libraryRows, onOpen, onDelete, onRename }: {
  seq: Sequence;
  libraryRows: RowData[];
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(seq.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const commitRename = () => {
    const name = editName.trim();
    if (name && name !== seq.name) onRename(name);
    setIsEditing(false);
  };

  const completeCount = seq.steps.filter(s => s.state === 'complete').length;

  // First 3 steps that have a linked row with imagery
  const thumbRows = seq.steps
    .filter(s => s.rowId)
    .map(s => libraryRows.find(r => r.id === s.rowId) ?? null)
    .filter((r): r is RowData => r !== null)
    .slice(0, 3);

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl hover:border-violet-400 hover:shadow-lg transition-all cursor-pointer group"
      onClick={() => !menuOpen && !isEditing && onOpen()}
    >
      {/* Thumbnail strip — 3 equal slots. overflow-hidden lives HERE (not on
          the card root) so the 3-dot dropdown below is never clipped. */}
      <div className="flex h-24 bg-slate-100 rounded-t-xl overflow-hidden">
        {[0, 1, 2].map(i => {
          const row = thumbRows[i];
          const svg = row ? (row.structuredSvg || row.rawSvg) : null;
          const bmp = row?.bitmap;
          return (
            <div key={i} className="w-1/3 h-full bg-slate-100 overflow-hidden flex items-center justify-center border-r last:border-r-0 border-slate-200">
              {svg ? (
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                  className="w-full h-full object-contain"
                  loading="lazy"
                  alt=""
                />
              ) : bmp ? (
                <img src={bmp} className="w-full h-full object-contain" loading="lazy" alt="" />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Card body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2" onClick={e => e.stopPropagation()}>
          {isEditing ? (
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditName(seq.name); setIsEditing(false); }
              }}
              className="font-bold text-sm text-slate-900 bg-transparent border-b border-violet-400 outline-none flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <h3
              className="font-bold text-sm text-slate-900 leading-tight flex-1 min-w-0 truncate"
              onDoubleClick={() => { setIsEditing(true); setEditName(seq.name); }}
              title={seq.name}
            >
              {seq.name}
            </h3>
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              aria-label="Opciones"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[140px] py-1">
                <button
                  onClick={e => { e.stopPropagation(); onOpen(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <Edit size={12} />{t('sequence.open')}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setIsEditing(true); setEditName(seq.name); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <Edit size={12} />{t('sequence.rename')}
                </button>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left"
                  >
                    <Trash2 size={12} />{t('sequence.delete')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
          <span className="text-xs text-violet-600 font-semibold">
            {t('sequence.stepsCount', { count: seq.steps.length, complete: completeCount })}
          </span>
          <span className="text-[10px] text-slate-400">{relativeDate(seq.modifiedAt, t)}</span>
        </div>
      </div>
    </div>
  );
}

// ── CreateSequenceCard ────────────────────────────────────────────────────────

function CreateSequenceCard({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onCreate}
      className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition-all min-h-[120px] group"
    >
      <Plus size={20} className="text-slate-300 group-hover:text-violet-500 transition-colors" />
      <span className="text-xs font-semibold text-slate-400 group-hover:text-violet-600 transition-colors text-center px-4">
        {t('sequence.createNew')}
      </span>
    </div>
  );
}

// ── SequenceList ──────────────────────────────────────────────────────────────

export function SequenceList({ sequences, libraryRows, onOpen, onCreate, onDelete, onRename }: SequenceListProps) {
  const { t } = useTranslation();

  return (
    <div className="py-8 space-y-6 animate-in fade-in duration-300">
      {sequences.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">{t('sequence.noSequences')}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sequences.map(seq => (
          <SequenceCard
            key={seq.id}
            seq={seq}
            libraryRows={libraryRows}
            onOpen={() => onOpen(seq.id)}
            onDelete={() => onDelete(seq.id)}
            onRename={name => onRename(seq.id, name)}
          />
        ))}
        <CreateSequenceCard onCreate={onCreate} />
      </div>
    </div>
  );
}
