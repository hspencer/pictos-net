import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, rectSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronLeft, GripVertical, X, Printer, Download, Plus, List, LayoutGrid,
} from 'lucide-react';
import { Sequence, Step, RowData } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { sentenceCase } from '../utils/textFormat';

interface SequenceEditorProps {
  sequence: Sequence;
  onSave: (seq: Sequence) => void;
  onBack: () => void;
  /** App.tsx creates a blank RowData + returns a Step already linked to it. */
  onAddStep: () => Step;
  onPrint: (seq: Sequence) => void;
  onDownloadZip: (seq: Sequence) => void;
  /** Renders every step; receives the step, drag handle, 1-based position, and
   *  a callback to remove the step (and optionally its linked row). */
  renderLinkedRow?: (
    step: Step,
    dragHandle: React.ReactNode,
    position: number,
    deleteStep: () => void,
  ) => React.ReactNode;
  /** Grid view: library rows so compact cells can show pictogram thumbnails. */
  rows?: RowData[];
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (mode: 'list' | 'grid') => void;
}

// ── SortableStep ──────────────────────────────────────────────────────────────
// Thin sortable wrapper — all step content is delegated to renderLinkedRow.

function SortableStep({ step, onDelete, renderLinkedRow }: {
  step: Step;
  onDelete: () => void;
  renderLinkedRow: SequenceEditorProps['renderLinkedRow'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const { t } = useTranslation();

  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none"
      tabIndex={-1}
      aria-label={t('sequence.dragStep')}
    >
      <GripVertical size={14} />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      {renderLinkedRow
        ? renderLinkedRow(step, dragHandle, step.position, onDelete)
        : (
          <div className="flex items-center gap-2 p-3 border border-dashed border-slate-200 rounded text-xs text-slate-400">
            {dragHandle}
            <span className="flex-1">Paso {step.position}</span>
            <button onClick={onDelete} className="p-1 hover:text-red-500"><X size={12} /></button>
          </div>
        )
      }
    </div>
  );
}

// ── SequenceGridCell ──────────────────────────────────────────────────────────
// Compact pictogram cell used in grid view — mirrors PictogramGridCell layout.

function SequenceGridCell({ step, row, onDelete }: {
  step: Step;
  row?: RowData;
  onDelete: () => void;
}) {
  const svg = row?.structuredSvg || row?.rawSvg;
  const bmp = row?.bitmap;
  const { t } = useTranslation();
  // El texto del pictograma vive en row.UTTERANCE; step.utterance suele venir
  // nulo en pasos generados, por eso la grilla aparecia sin texto.
  const caption = row?.UTTERANCE || step.utterance || '';
  return (
    // Mirrors PictogramGridCell: tarjeta con area cuadrada arriba y pie de texto.
    <div className="relative border border-slate-200 hover:border-violet-300 bg-white shadow-sm hover:shadow-md transition-all flex flex-col group">
      {/* Area del pictograma — cuadrada, igual que PictogramGridCell */}
      <div className="relative aspect-square bg-slate-50 overflow-hidden">
        {svg ? (
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            className="w-full h-full object-contain p-4"
            alt={caption}
            loading="lazy"
          />
        ) : bmp ? (
          <img src={bmp} className="w-full h-full object-contain p-4" alt={caption} loading="lazy" />
        ) : (
          <div className="w-full h-full bg-slate-50" aria-hidden="true" />
        )}
        {/* Numero de paso — chip arriba a la izquierda */}
        <span className="absolute top-2 left-2 z-10 text-[10px] font-bold text-slate-400 bg-white/90 rounded px-1 leading-tight tabular-nums">
          {step.position}
        </span>
        {/* Eliminar — arriba a la derecha, al hover */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 z-10 p-1 bg-white/80 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={t('sequence.deleteStep')}
        >
          <X size={12} />
        </button>
      </div>

      {/* Pie — texto del pictograma, igual que PictogramGridCell (3 lineas, sin corte) */}
      <div className="p-3">
        <p className="text-xs font-medium text-slate-900 tracking-wide text-center line-clamp-3 min-h-[4.5rem] flex items-center justify-center">
          {sentenceCase(caption) || '...'}
        </p>
      </div>
    </div>
  );
}

// Sortable wrapper for grid mode
function SortableGridStep({ step, row, onDelete }: {
  step: Step;
  row?: RowData;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
      <SequenceGridCell step={step} row={row} onDelete={onDelete} />
    </div>
  );
}

// ── SequenceEditor ────────────────────────────────────────────────────────────

export function SequenceEditor({
  sequence, onSave, onBack, onAddStep, onPrint, onDownloadZip, renderLinkedRow,
  rows, viewMode = 'list', onViewModeChange,
}: SequenceEditorProps) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<Step[]>(sequence.steps);
  const [seqName, setSeqName] = useState(sequence.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Re-sync when switching to a different sequence
  useEffect(() => {
    setSteps(sequence.steps);
    setSeqName(sequence.name);
  }, [sequence.id]);

  // Sync external step updates (e.g., row generation completed in App.tsx).
  // Uses a functional updater to break the auto-save ↔ sync feedback loop:
  // when App.tsx reflects our own save back as a new array reference with
  // identical data, returning `prev` prevents a re-render and no further
  // auto-save fires.
  useEffect(() => {
    setSteps(prev => {
      if (prev.length !== sequence.steps.length) return sequence.steps;
      const changed = sequence.steps.some((s, i) =>
        prev[i].id !== s.id ||
        prev[i].rowId !== s.rowId ||
        prev[i].utterance !== s.utterance ||
        prev[i].state !== s.state ||
        prev[i].position !== s.position
      );
      return changed ? sequence.steps : prev;
    });
  }, [sequence.steps]);

  // Auto-save on every local change
  useEffect(() => {
    onSave({
      ...sequence,
      name: seqName,
      steps,
      modifiedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, seqName]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps(prev => {
      const oldIdx = prev.findIndex(s => s.id === active.id);
      const newIdx = prev.findIndex(s => s.id === over.id);
      const moved = arrayMove(prev, oldIdx, newIdx);
      return moved.map((s: Step, i: number): Step => Object.assign({}, s, { position: i + 1 }));
    });
  };

  const deleteStep = useCallback((id: string) => {
    setSteps(prev =>
      prev.filter(s => s.id !== id).map((s, i) => ({ ...s, position: i + 1 }))
    );
  }, []);

  const addStep = () => {
    const newStep = onAddStep();
    setSteps(prev => [...prev, { ...newStep, position: prev.length + 1 }]);
  };

  const commitName = () => {
    const name = seqName.trim();
    if (!name) setSeqName(sequence.name);
    setIsEditingName(false);
  };

  const startEditingName = () => {
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const linkedSteps = steps.filter(s => s.rowId !== null);
  const canExport = linkedSteps.length > 0;
  const currentSeq = { ...sequence, name: seqName, steps, modifiedAt: new Date().toISOString() };

  return (
    <div className="py-4 space-y-6 animate-in fade-in duration-300">

      {/* Header — back link above title, exports to the right */}
      <div className="space-y-1">

        {/* Back button — sits above the title, not beside it */}
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-700 transition-colors"
        >
          <ChevronLeft size={12} />
          {t('sequence.back')}
        </button>

        {/* Title row + export actions */}
        <div className="flex items-center gap-4">

          {/* Sequence name — same amber-bg style as the row utterance field */}
          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={seqName}
                onChange={e => setSeqName(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') { setSeqName(sequence.name); setIsEditingName(false); }
                }}
                autoFocus
                className="w-full text-2xl font-bold text-slate-900 bg-amber-50 border-none outline-none focus:ring-0 rounded px-1 leading-tight"
              />
            ) : (
              <h2
                onClick={startEditingName}
                className="text-2xl font-bold text-slate-900 cursor-text hover:bg-amber-50 transition-colors rounded px-1 truncate leading-tight"
                title={seqName}
              >
                {seqName}
              </h2>
            )}
          </div>

          {/* Export actions + view toggle */}
          <div className="flex items-center gap-3 shrink-0">
            {onViewModeChange && (
              <div className="flex items-center gap-1 border-r border-slate-100 pr-3">
                <button
                  onClick={() => onViewModeChange('list')}
                  title={t('library.viewList')}
                  aria-pressed={viewMode === 'list'}
                  className={`transition-colors ${viewMode === 'list' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  <List size={14} aria-hidden="true" />
                </button>
                <button
                  onClick={() => onViewModeChange('grid')}
                  title={t('library.viewGrid')}
                  aria-pressed={viewMode === 'grid'}
                  className={`transition-colors ${viewMode === 'grid' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <button
              onClick={() => onPrint(currentSeq)}
              disabled={!canExport}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Printer size={14} />
              {t('sequence.printSequence')}
            </button>
            <button
              onClick={() => onDownloadZip(currentSeq)}
              disabled={!canExport}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              {t('sequence.downloadPictogramas')}
            </button>
          </div>
        </div>

        {/* Step count — below the title row */}
        <p className="text-xs text-slate-400 px-1">
          {t('sequence.stepsCount', { count: steps.length, complete: linkedSteps.length })}
        </p>
      </div>

      {/* Sortable step list — list or grid layout */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {viewMode === 'grid' ? (
          <SortableContext items={steps.map(s => s.id)} strategy={rectSortingStrategy}>
            <div id="sequence-steps" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {steps.map(step => (
                <SortableGridStep
                  key={step.id}
                  step={step}
                  row={rows?.find(r => r.id === step.rowId)}
                  onDelete={() => deleteStep(step.id)}
                />
              ))}
            </div>
          </SortableContext>
        ) : (
          <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div id="sequence-steps" className="space-y-2">
              {steps.map(step => (
                <SortableStep
                  key={step.id}
                  step={step}
                  onDelete={() => deleteStep(step.id)}
                  renderLinkedRow={renderLinkedRow}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </DndContext>

      {/* Add step */}
      <button
        onClick={addStep}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-violet-600 transition-colors py-2"
      >
        <Plus size={14} />
        {t('sequence.addStep')}
      </button>

      {!canExport && steps.length > 0 && (
        <p className="text-xs text-slate-400 italic">{t('sequence.noCompleteSteps')}</p>
      )}
    </div>
  );
}
