/**
 * Semantic Tree Component
 * Displays SVG DOM as expandable/collapsible tree with editable IDs
 */

import { useSVGEditorStore } from '../../stores/svgEditorStore';
import React, { useMemo, useState, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, Edit2, Check, X, Trash2, GripVertical } from 'lucide-react';
import { Input } from '../ui/input';
import type { SVGElement } from '../../stores/svgEditorStore';
import type { StyleDefinition } from '../../lib/style-editor/lib/types';
import { useTranslation } from '../../hooks/useTranslation';
import { StylePickerModal } from './StylePickerModal';

type DropMode = 'before' | 'after' | 'inside';

interface TreeNodeProps {
    node: SVGElement;
    level: number;
    styleDefs: StyleDefinition[];
    getStyleInfo: (node: SVGElement) => {
        classes: { name: string; fill: string | null; stroke: string | null }[];
        inlineFill: string | null;
    };
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
    onDragOverNode: (node: SVGElement, mode: DropMode) => void;
    onDropNode: (node: SVGElement, mode: DropMode) => void;
    dragOverId: string | null;
    dragMode: DropMode | null;
    onShiftClick: (id: string) => void;
}

const SKIP_TAGS = new Set(['defs', 'metadata', 'title', 'desc', 'style']);

const buildVisualGroupTree = (node: SVGElement): SVGElement[] => {
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return [];

    const children = node.children.flatMap((child) => buildVisualGroupTree(child));

    if (tag === 'svg') {
        return children;
    }

    return [{ ...node, children }];
};

function TreeNode({
    node,
    level,
    styleDefs,
    getStyleInfo,
    onDragStart,
    onDragEnd,
    onDragOverNode,
    onDropNode,
    dragOverId,
    dragMode,
    onShiftClick,
}: TreeNodeProps) {
    const { t } = useTranslation();
    const { selectedElementId, selectElement, updateElementId, deleteElement, pathEditMode } = useSVGEditorStore();
    const [isExpanded, setIsExpanded] = useState(true);
    const [isEditingId, setIsEditingId] = useState(false);
    const [editedId, setEditedId] = useState(node.id);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    const styleInfo = getStyleInfo(node);
    const classLabels = styleInfo.classes.map((cls) => `.${cls.name}`);
    const classText = classLabels.join(' ');

    const hasChildren = node.children && node.children.length > 0;
    const isContainer = node.tagName.toLowerCase() === 'g' || hasChildren;
    const isSelected = selectedElementId === node.id;
    const isMultiSelected = useSVGEditorStore(s => s.selectedElementIds.has(node.id));
    const isDragOver = dragOverId === node.id;
    const dragIndicator =
        isDragOver && dragMode === 'before'
            ? 'border-t-2 border-blue-500'
            : isDragOver && dragMode === 'after'
                ? 'border-b-2 border-blue-500'
                : isDragOver && dragMode === 'inside'
                    ? 'ring-2 ring-blue-400 bg-blue-50/50'
                    : '';

    const handleSaveId = useCallback(() => {
        const trimmed = editedId.trim();
        setIsEditingId(false);
        if (trimmed && trimmed !== node.id) {
            updateElementId(node.id, trimmed);
        } else {
            setEditedId(node.id);
        }
    }, [editedId, node.id, updateElementId]);

    const handleCancelEdit = useCallback(() => {
        setEditedId(node.id);
        setIsEditingId(false);
    }, [node.id]);

    const computeDropMode = useCallback((event: React.DragEvent<HTMLDivElement>): DropMode => {
        const rect = rowRef.current?.getBoundingClientRect();
        if (!rect) return 'after';
        const y = event.clientY - rect.top;
        const ratio = y / rect.height;
        if (isContainer) {
            if (ratio < 0.25) return 'before';
            if (ratio > 0.75) return 'after';
            return 'inside';
        }
        return ratio < 0.5 ? 'before' : 'after';
    }, [isContainer]);

    return (
        <div id={`tree-node-${node.id}`} className="select-none">
            <div
                ref={rowRef}
                className={`group flex items-center gap-1 px-2 py-1.5 hover:bg-slate-100 transition-colors text-slate-700 ${dragIndicator} ${isSelected || isMultiSelected ? 'bg-blue-100 text-blue-900' : ''}`}
                style={{ paddingLeft: `${level * 14 + 8}px` }}
                onClick={(e) => {
                    if (pathEditMode) return;
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                        onShiftClick(node.id);
                    } else {
                        selectElement(node.id);
                    }
                }}
                draggable={!isEditingId && !pathEditMode}
                onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', node.id);
                    onDragStart(node.id);
                }}
                onDragEnd={() => onDragEnd()}
                onDragOver={(event) => {
                    if (isEditingId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const mode = computeDropMode(event);
                    onDragOverNode(node, mode);
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    const mode = computeDropMode(event);
                    onDropNode(node, mode);
                }}
            >
                {/* Drag handle */}
                <div className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" title={t('svgEditor.dragToReorder')}>
                    <GripVertical className="w-3 h-3" />
                </div>

                {/* Expand/collapse toggle */}
                {hasChildren ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                        className="p-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200 shrink-0"
                        aria-label={isExpanded ? t('svgEditor.collapse') : t('svgEditor.expand')}
                    >
                        {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                            : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                ) : (
                    <div className="w-5 shrink-0" />
                )}

                {/* ID / edit field */}
                {isEditingId ? (
                    <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                            value={editedId}
                            onChange={(e) => setEditedId(e.target.value)}
                            className="h-6 w-28 text-xs font-mono"
                            autoFocus
                            onBlur={handleSaveId}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                                if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); }
                            }}
                        />
                        <button
                            className="p-1 rounded text-emerald-600 hover:bg-emerald-50 shrink-0"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={handleSaveId}
                            title={t('actions.confirm')}
                        >
                            <Check className="w-3 h-3" />
                        </button>
                        <button
                            className="p-1 rounded text-slate-500 hover:bg-slate-100 shrink-0"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={handleCancelEdit}
                            title={t('actions.cancel')}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ) : (
                    <>
                        <span
                            className="text-xs font-semibold text-slate-800 cursor-text truncate"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditingId(true);
                                setEditedId(node.id);
                            }}
                            title={t('svgEditor.doubleClickRename')}
                        >
                            {node.id}
                        </span>
                        {classText && (
                            <span className="text-xs text-violet-500 truncate font-mono ml-1">{classText}</span>
                        )}
                        {/* Inline fill indicator for raw SVGs without classes */}
                        {!classText && styleInfo.inlineFill && (
                            <div
                                className="w-3 h-3 rounded-sm border border-slate-300 shrink-0 ml-1"
                                style={{ backgroundColor: styleInfo.inlineFill }}
                                title={`fill: ${styleInfo.inlineFill}`}
                            />
                        )}
                    </>
                )}

                {/* Style dots — click to open style picker */}
                {!isEditingId && (
                    <button
                        className="ml-auto flex items-center gap-0.5 shrink-0 rounded hover:bg-violet-50 px-0.5 py-0.5 transition-colors"
                        title={t('svgEditor.selectStyle')}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (pathEditMode) return;
                            selectElement(node.id);
                            setIsPickerOpen(true);
                        }}
                    >
                        {styleInfo.classes.length === 0 ? (
                            <div className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300">
                                <svg width="8" height="8" viewBox="0 0 10 10">
                                    <circle cx="5" cy="5" r="4" fill="transparent" stroke="#94a3b8" />
                                    <line x1="2" y1="8" x2="8" y2="2" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
                                </svg>
                            </div>
                        ) : (
                            styleInfo.classes.map((cls) => {
                                const fill = cls.fill ?? 'transparent';
                                const stroke = cls.stroke ?? (cls.fill ? 'rgba(0,0,0,0.35)' : '#94a3b8');
                                return (
                                    <div
                                        key={cls.name}
                                        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white"
                                        title={`.${cls.name}`}
                                    >
                                        <svg width="8" height="8" viewBox="0 0 10 10">
                                            <circle cx="5" cy="5" r="4" fill={fill} stroke={stroke} />
                                        </svg>
                                    </div>
                                );
                            })
                        )}
                    </button>
                )}

                {/* Style picker modal for this tree node */}
                <StylePickerModal
                    isOpen={isPickerOpen}
                    onClose={() => setIsPickerOpen(false)}
                    elementId={node.id}
                    styleDefs={styleDefs}
                    currentClasses={styleInfo.classes.map(c => c.name)}
                />

                {/* Action buttons (visible on hover) */}
                {!isEditingId && !isConfirmingDelete && (
                    <>
                        <button
                            className="p-1 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-700 hover:bg-slate-200 transition-opacity shrink-0"
                            onClick={(e) => { e.stopPropagation(); setIsEditingId(true); }}
                            title={t('svgEditor.rename')}
                            aria-label={t('svgEditor.rename')}
                        >
                            <Edit2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                            className="p-1 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 transition-opacity shrink-0"
                            onClick={(e) => { e.stopPropagation(); setIsConfirmingDelete(true); }}
                            title={t('svgEditor.delete')}
                            aria-label={t('svgEditor.delete')}
                        >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                    </>
                )}

                {/* Delete confirmation */}
                {isConfirmingDelete && (
                    <div className="flex items-center gap-1 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-rose-600 font-medium whitespace-nowrap">
                            {t('svgEditor.deleteConfirm')}
                        </span>
                        <button
                            className="p-1 rounded text-rose-600 hover:bg-rose-50"
                            onClick={() => { deleteElement(node.id); setIsConfirmingDelete(false); }}
                            title={t('actions.confirm')}
                        >
                            <Check className="w-3 h-3" />
                        </button>
                        <button
                            className="p-1 rounded text-slate-500 hover:bg-slate-100"
                            onClick={() => setIsConfirmingDelete(false)}
                            title={t('actions.cancel')}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {isExpanded && hasChildren && (
                <div>
                    {node.children.map((child) => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            styleDefs={styleDefs}
                            getStyleInfo={getStyleInfo}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                            onDragOverNode={onDragOverNode}
                            onDropNode={onDropNode}
                            dragOverId={dragOverId}
                            dragMode={dragMode}
                            onShiftClick={onShiftClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SemanticTree() {
    const { t } = useTranslation();
    const { svgDOM, styleDefinitions: styleDefs, moveElement, selectedElementIds, toggleSelection } = useSVGEditorStore();
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragMode, setDragMode] = useState<DropMode | null>(null);

    const visualGroups = useMemo(() => {
        if (!svgDOM) return [];
        return buildVisualGroupTree(svgDOM);
    }, [svgDOM]);

    const classStyleMap = useMemo(() => {
        const map = new Map<string, { fill: string | null; stroke: string | null }>();

        const getRuleValue = (rules: { property: string; value: string }[], property: string) => {
            for (let i = rules.length - 1; i >= 0; i -= 1) {
                if (rules[i].property.toLowerCase() === property) {
                    return rules[i].value.trim();
                }
            }
            return null;
        };

        styleDefs.forEach((style) => {
            const fill = getRuleValue(style.rules, 'fill');
            const stroke = getRuleValue(style.rules, 'stroke');

            if (!fill && !stroke) return;

            style.selectors.forEach((selector) => {
                if (!selector.startsWith('.')) return;
                const className = selector.replace('.', '');
                const previous = map.get(className);
                map.set(className, {
                    fill: fill ?? previous?.fill ?? null,
                    stroke: stroke ?? previous?.stroke ?? null,
                });
            });
        });
        return map;
    }, [styleDefs]);

    const getStyleInfo = useCallback(
        (node: SVGElement) => {
            const classAttr = node.attributes?.class || '';
            const classes = classAttr
                .split(' ')
                .map((c) => c.trim())
                .filter(Boolean)
                .map((cls) => ({
                    name: cls,
                    fill: classStyleMap.get(cls)?.fill ?? null,
                    stroke: classStyleMap.get(cls)?.stroke ?? null,
                }));
            const inlineFill = node.attributes?.fill || null;
            return { classes, inlineFill };
        },
        [classStyleMap]
    );

    if (!svgDOM) {
        return (
            <div className="p-4 text-center text-sm text-slate-500">
                <p>{t('svgEditor.noSvgLoaded')}</p>
                <p className="mt-2 text-xs">{t('svgEditor.noSvgHint')}</p>
            </div>
        );
    }

    const multiSelectCount = selectedElementIds.size;

    return (
        <div id="svg-editor-tree" className="py-1">
            {/* Multi-select badge */}
            {multiSelectCount > 1 && (
                <div className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border-b border-blue-100">
                    {t('svgEditor.multipleSelected', { count: String(multiSelectCount) })}
                </div>
            )}

            {visualGroups.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                    <p>{t('svgEditor.noElements')}</p>
                    <p className="mt-2 text-xs">{t('svgEditor.noElementsHint')}</p>
                </div>
            ) : (
                visualGroups.map((node) => (
                    <TreeNode
                        key={node.id}
                        node={node}
                        level={0}
                        styleDefs={styleDefs}
                        getStyleInfo={getStyleInfo}
                        onDragStart={(id) => setDraggingId(id)}
                        onDragEnd={() => {
                            setDraggingId(null);
                            setDragOverId(null);
                            setDragMode(null);
                        }}
                        onDragOverNode={(target, mode) => {
                            if (!draggingId || draggingId === target.id) return;
                            setDragOverId(target.id);
                            setDragMode(mode);
                        }}
                        onDropNode={(target, mode) => {
                            if (!draggingId || draggingId === target.id) return;
                            moveElement(draggingId, target.id, mode);
                            setDraggingId(null);
                            setDragOverId(null);
                            setDragMode(null);
                        }}
                        dragOverId={dragOverId}
                        dragMode={dragMode}
                        onShiftClick={(id) => toggleSelection(id)}
                    />
                ))
            )}
        </div>
    );
}
