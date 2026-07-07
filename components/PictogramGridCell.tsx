/**
 * PictogramGridCell — single cell of the Library's grid view.
 *
 * Layout:
 *   ┌────────────────────┐
 *   │                    │  pictogram area (square, 1:1)
 *   │      [picto]       │  showing structuredSvg → rawSvg → bitmap.
 *   │                    │  When none: a large Play button takes its place.
 *   └────────────────────┘
 *   utterance ▶ ① ② ③      footer: editable utterance + cascade + badges
 *
 * Click model (see specs/library-views.allium):
 *   - pictogram → focus modal at step nlu (Comprender)
 *   - badge N    → focus modal at step nlu | visual | bitmap
 *   - Play (any) → cascade
 *   - utterance  → inline edit
 */

import React, { useState } from 'react';
import { Play, Square, FileDown, Edit, Scan } from 'lucide-react';
import type { RowData, StepStatus } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { injectSvgA11y } from '../utils/svgAccessibility';
import { validRawSvg, validStructuredSvg, validBitmap } from '../utils/rowArtifacts';
import { sentenceCase } from '../utils/textFormat';

type FocusStep = 'nlu' | 'visual' | 'produce' | 'format';
type DisplayStage = 'none' | 'bitmap' | 'trazado' | 'estructurado';

interface Props {
  row: RowData;
  onUpdate: (updates: Partial<RowData>) => void;
  onCascade: () => void;
  onStop: () => void;
  onFocus: (step: FocusStep) => void;
  onOpenEditor: (source?: 'raw' | 'structured') => void;
  onOpenVectorizer?: () => void;
  onSettleField?: () => void;
}

const stageOf = (row: RowData): DisplayStage => {
  if (validStructuredSvg(row)) return 'estructurado';
  if (validRawSvg(row)) return 'trazado';
  if (validBitmap(row)) return 'bitmap';
  return 'none';
};

const StatusBadge: React.FC<{ step: number; status: StepStatus; label: string; onClick: () => void; }> = ({ step, status, label, onClick }) => {
  const styles: Record<StepStatus, string> = {
    idle:       'bg-slate-100 text-slate-500 border-slate-200',
    processing: 'bg-orange-600 text-white animate-pulse border-orange-500',
    completed:  'bg-emerald-50 text-emerald-700 border-emerald-300',
    outdated:   'bg-amber-50 text-amber-800 border-amber-300',
    error:      'bg-rose-50 text-rose-700 border-rose-300',
    review:     'bg-violet-50 text-violet-700 border-violet-300 animate-pulse',
  };
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={label}
      aria-label={label}
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all hover:scale-110 ${styles[status]}`}
    >
      {step}
    </button>
  );
};

export const PictogramGridCell: React.FC<Props> = ({
  row, onUpdate, onCascade, onStop, onFocus,
  onOpenEditor, onOpenVectorizer, onSettleField,
}) => {
  const { t } = useTranslation();
  const stage = stageOf(row);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditingUtterance, setIsEditingUtterance] = useState(false);

  const stageLabel: Record<DisplayStage, string> = {
    none: '',
    bitmap: t('library.stageBitmap'),
    trazado: t('library.stageRaw'),
    estructurado: t('library.stageStructured'),
  };

  const downloadCurrent = () => {
    const slug = row.UTTERANCE.replace(/\s+/g, '_').toLowerCase() || 'pictogram';
    const structured = validStructuredSvg(row);
    const raw = validRawSvg(row);
    const bmp = validBitmap(row);
    if (stage === 'estructurado' && structured) {
      const blob = new Blob([structured], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${slug}.svg`; a.click();
      URL.revokeObjectURL(url);
    } else if (stage === 'trazado' && raw) {
      const blob = new Blob([raw], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${slug}.svg`; a.click();
      URL.revokeObjectURL(url);
    } else if (stage === 'bitmap' && bmp) {
      const a = document.createElement('a');
      a.href = bmp; a.download = `${slug}.png`; a.click();
    }
  };

  const renderPictogram = () => {
    const structured = validStructuredSvg(row);
    const raw = validRawSvg(row);
    const bmp = validBitmap(row);
    if (stage === 'estructurado' && structured) {
      return (
        <div
          className="w-full h-full flex items-center justify-center p-4"
          dangerouslySetInnerHTML={{ __html: injectSvgA11y(structured, row.UTTERANCE, row.prompt) }}
        />
      );
    }
    if (stage === 'trazado' && raw) {
      return (
        <div
          className="w-full h-full flex items-center justify-center p-4"
          dangerouslySetInnerHTML={{ __html: injectSvgA11y(raw, row.UTTERANCE, row.prompt) }}
        />
      );
    }
    if (stage === 'bitmap' && bmp) {
      return (
        <img
          src={bmp}
          alt={row.UTTERANCE}
          className="w-full h-full object-contain p-4"
        />
      );
    }
    // No image: big Play button takes the pictogram slot.
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCascade(); }}
        className="w-full h-full flex items-center justify-center group/play"
        title={t('actions.runFullPipeline')}
        aria-label={t('actions.runFullPipeline')}
      >
        <span className="w-20 h-20 rounded-full border-2 border-orange-400 group-hover/play:border-orange-600 group-hover/play:bg-orange-50 flex items-center justify-center transition-all">
          <Play size={36} className="text-orange-500 group-hover/play:text-orange-700 ml-1" aria-hidden="true" />
        </span>
      </button>
    );
  };

  const isProcessing = row.status === 'processing';

  return (
    <div
      id={`picto-cell-${row.id}`}
      className="border border-slate-200 hover:border-violet-300 bg-white shadow-sm hover:shadow-md transition-all flex flex-col"
    >
      {/* Pictogram area (top) — square, click → NLU */}
      <div
        className="relative aspect-square bg-slate-50 cursor-pointer overflow-hidden"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => { if (stage !== 'none') onFocus(stage === 'bitmap' ? 'produce' : 'format'); }}
        role={stage !== 'none' ? 'button' : undefined}
        aria-label={stage !== 'none' ? t('library.openInFocus', { utterance: row.UTTERANCE }) : undefined}
        tabIndex={stage !== 'none' ? 0 : -1}
        onKeyDown={(e) => { if (stage !== 'none' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onFocus(stage === 'bitmap' ? 'produce' : 'format'); } }}
      >
        {renderPictogram()}

        {/* Hover overlay: stage pill + actions */}
        {stage !== 'none' && isHovered && (
          <>
            <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 text-white text-[10px] font-medium uppercase tracking-wider rounded" aria-hidden="true">
              {stageLabel[stage]}
            </div>
            <div className="absolute bottom-2 right-2 flex gap-1">
              {/* Vectorize — only available for bitmap stage */}
              {stage === 'bitmap' && onOpenVectorizer && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenVectorizer(); }}
                  className="p-2 bg-black/60 hover:bg-violet-700 text-white rounded-full shadow-lg transition-colors"
                  title={t('svg.traceSvg')}
                  aria-label={t('svg.traceSvg')}
                >
                  <Scan size={14} aria-hidden="true" />
                </button>
              )}
              {/* Edit SVG — only for traced/structured stages */}
              {(stage === 'trazado' || stage === 'estructurado') && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenEditor(stage === 'estructurado' ? 'structured' : 'raw'); }}
                  className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg transition-colors"
                  title={t('svg.editor')}
                  aria-label={t('svg.editor')}
                >
                  <Edit size={14} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadCurrent(); }}
                className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg transition-colors"
                title={t('actions.download')}
                aria-label={t('actions.download')}
              >
                <FileDown size={14} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer (bottom) — utterance + Play + badges */}
      <div className="p-3 flex flex-col gap-2">
        {isEditingUtterance ? (
          <textarea
            value={sentenceCase(row.UTTERANCE)}
            onChange={(e) => onUpdate({
              UTTERANCE: e.target.value,
              nluStatus: 'outdated', visualStatus: 'outdated', bitmapStatus: 'outdated',
            })}
            onBlur={() => { setIsEditingUtterance(false); onSettleField?.(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
              if (e.key === 'Escape') setIsEditingUtterance(false);
            }}
            autoFocus
            rows={3}
            className="text-xs font-medium text-slate-900 tracking-wide bg-amber-50 border border-amber-200 rounded p-2 outline-none focus:ring-2 focus:ring-violet-300 resize-none text-center w-full min-h-[4.5rem]"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsEditingUtterance(true); }}
            className="text-xs font-medium text-slate-900 tracking-wide hover:bg-amber-50 rounded p-2 text-center line-clamp-3 cursor-text w-full min-h-[4.5rem] flex items-center justify-center"
          >
            {sentenceCase(row.UTTERANCE) || t('library.untitled')}
          </button>
        )}

        <div className="flex items-center justify-between gap-2">
          {/* Cascade Play / Stop */}
          {isProcessing ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              className="p-1.5 bg-orange-600 text-white hover:bg-orange-700 rounded-full shadow-sm animate-pulse"
              title={t('actions.stopProcess')}
              aria-label={t('actions.stopProcess')}
            >
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCascade(); }}
              className="p-1.5 border border-orange-400 hover:border-orange-600 text-orange-500 hover:text-orange-700 rounded-full bg-white shadow-sm"
              title={t('actions.runFullPipeline')}
              aria-label={t('actions.runFullPipeline')}
            >
              <Play size={14} aria-hidden="true" />
            </button>
          )}

          {/* Pipeline badges — each opens focus modal at its step */}
          <div className="flex gap-1.5">
            <StatusBadge step={1} status={row.nluStatus}    label={t('pipeline.understand')} onClick={() => onFocus('nlu')} />
            <StatusBadge step={2} status={row.visualStatus} label={t('pipeline.compose')}    onClick={() => onFocus('visual')} />
            <StatusBadge step={3} status={row.bitmapStatus} label={t('pipeline.produce')}    onClick={() => onFocus('produce')} />
          </div>
        </div>
      </div>
    </div>
  );
};
