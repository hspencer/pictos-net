/**
 * SelectionToolbar — floating toolbar shown when 1+ elements are selected.
 * Provides group, ungroup, duplicate, reorder, apply class, and delete actions.
 */

import React, { useState } from 'react';
import {
    Group, Ungroup, Paintbrush, Trash2, Copy,
    ArrowUp, ArrowDown, Plus, Minus, Spline, X, MousePointer2, Sparkles,
} from 'lucide-react';
import { useSVGEditorStore } from '../../stores/svgEditorStore';
import { useTranslation } from '../../hooks/useTranslation';
import type { StyleDefinition } from '../../lib/style-editor/lib/types';
import { StylePickerModal } from './StylePickerModal';
import { checkBooleanEligibility } from '../../utils/svgBooleanHelpers';
import type { BooleanOp } from '../../services/svgBooleanOps';
import { handleToolbarKeyDown } from './editor/toolbarKeydown';

// ── Boolean operation icons ──────────────────────────────────────────────────
// Lucide has no boolean-op iconography, so these are minimal inline SVGs
// matching Inkscape/Figma convention. 13×13 to match neighbouring button icons.
// Mask/clipPath ids are scoped via useId to avoid collisions across instances.

const ICON_SIZE = 13;

const UnionIcon: React.FC = () => (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="6" cy="8" r="4" fill="currentColor" />
        <circle cx="10" cy="8" r="4" fill="currentColor" />
    </svg>
);

const SubtractIcon: React.FC = () => {
    const maskId = React.useId();
    return (
        <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" aria-hidden="true">
            <mask id={maskId}>
                <rect width="16" height="16" fill="white" />
                <circle cx="10" cy="8" r="4" fill="black" />
            </mask>
            <circle cx="6" cy="8" r="4" fill="currentColor" mask={`url(#${maskId})`} />
            <circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="1.2 1.2" />
        </svg>
    );
};

const IntersectIcon: React.FC = () => {
    const clipId = React.useId();
    return (
        <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" aria-hidden="true">
            <defs>
                <clipPath id={clipId}>
                    <circle cx="6" cy="8" r="4" />
                </clipPath>
            </defs>
            <circle cx="6" cy="8" r="4" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="1.2 1.2" />
            <circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="1.2 1.2" />
            <circle cx="10" cy="8" r="4" fill="currentColor" clipPath={`url(#${clipId})`} />
        </svg>
    );
};

const BOOL_ICON: Record<BooleanOp, React.FC> = {
    union: UnionIcon,
    subtract: SubtractIcon,
    intersect: IntersectIcon,
};

const LEFT_PANEL = 288;
const RIGHT_PANEL = 320;

// ── ToolbarStylePicker — reads styleDefs from store ──────────────────────────

const ToolbarStylePicker: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    elementId: string;
    currentClasses: string[];
}> = ({ isOpen, onClose, elementId, currentClasses }) => {
    const styleDefinitions = useSVGEditorStore(state => state.styleDefinitions);
    return (
        <StylePickerModal
            isOpen={isOpen}
            onClose={onClose}
            elementId={elementId}
            styleDefs={styleDefinitions}
            currentClasses={currentClasses}
        />
    );
};

// ── PathEditToolbar — shown when pathEditMode is active ───────────────────────

const PathEditToolbar: React.FC = () => {
    const { t } = useTranslation();
    const exitPathEditMode = useSVGEditorStore(state => state.exitPathEditMode);
    const selectedNodeIndex = useSVGEditorStore(state => state.selectedNodeIndex);
    const pathEditTool = useSVGEditorStore(state => state.pathEditTool);
    const setPathEditTool = useSVGEditorStore(state => state.setPathEditTool);
    const toggleNodeSmooth = useSVGEditorStore(state => state.toggleNodeSmooth);
    const applySimplifyOperation = useSVGEditorStore(state => state.applySimplifyOperation);
    const pathEditMode = useSVGEditorStore(state => state.pathEditMode);

    const handleSimplify = () => {
        const result = applySimplifyOperation();
        if (!result.ok && result.reason) {
            console.warn('[simplify]', result.reason);
        }
    };

    // Simplify only meaningful for path-like editable elements.
    const simplifyEnabled = pathEditMode?.elementType === 'path'
        || pathEditMode?.elementType === 'polygon'
        || pathEditMode?.elementType === 'polyline';

    const centerX = LEFT_PANEL + (window.innerWidth - LEFT_PANEL - RIGHT_PANEL) / 2;
    const btnClass = "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-800 rounded transition-colors";
    const activeBtnClass = "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-400 rounded transition-colors";

    return (
        <div
            role="toolbar"
            aria-label={t('svgEditor.pathEditToolbar')}
            className="fixed z-[15] flex items-center gap-1 bg-violet-900 rounded-lg shadow-xl border border-violet-700 px-2 py-1.5 text-white"
            style={{ top: 76, left: centerX, transform: 'translateX(-50%)' }}
            onKeyDown={handleToolbarKeyDown}
        >
            <span className="text-xs font-mono text-violet-300 px-2">
                {t('svgEditor.nodeEditMode')}
            </span>

            <div className="w-px h-5 bg-violet-600" />

            {/* Sticky tool mode toggles */}
            <button
                onClick={() => setPathEditTool('select')}
                className={pathEditTool === 'select' ? activeBtnClass : btnClass}
                title={t('svgEditor.select')}
                data-toolbar-item
                tabIndex={0}
            >
                <MousePointer2 size={13} aria-hidden="true" />
            </button>

            <button
                onClick={() => setPathEditTool(pathEditTool === 'add' ? 'select' : 'add')}
                className={pathEditTool === 'add' ? activeBtnClass : btnClass}
                title={t('svgEditor.addNodeMode')}
                data-toolbar-item
                tabIndex={-1}
            >
                <Plus size={13} aria-hidden="true" />
                {t('svgEditor.addNodeMode')}
            </button>

            <button
                onClick={() => setPathEditTool(pathEditTool === 'delete' ? 'select' : 'delete')}
                className={pathEditTool === 'delete' ? activeBtnClass : btnClass}
                title={t('svgEditor.deleteNodeMode')}
                data-toolbar-item
                tabIndex={-1}
            >
                <Minus size={13} aria-hidden="true" />
                {t('svgEditor.deleteNodeMode')}
            </button>

            <div className="w-px h-5 bg-violet-600" />

            <button
                onClick={toggleNodeSmooth}
                disabled={selectedNodeIndex == null}
                className={`${btnClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                title={t('svgEditor.toggleSmooth')}
                data-toolbar-item
                tabIndex={-1}
            >
                <Spline size={13} aria-hidden="true" />
            </button>

            <div className="w-px h-5 bg-violet-600" />

            {/* Simplify — refit polylines to Bezier curves on the path being edited */}
            <button
                onClick={handleSimplify}
                disabled={!simplifyEnabled}
                className={`${btnClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                title={t('svgEditor.simplifyTooltip')}
                aria-label={t('svgEditor.simplify')}
                data-toolbar-item
                tabIndex={-1}
            >
                <Sparkles size={13} aria-hidden="true" />
                {t('svgEditor.simplify')}
            </button>

            <div className="w-px h-5 bg-violet-600" />

            <button
                onClick={exitPathEditMode}
                className={btnClass}
                title={t('svgEditor.exitNodeEdit')}
                data-toolbar-item
                tabIndex={-1}
            >
                <X size={13} aria-hidden="true" />
                {t('svgEditor.exitNodeEdit')}
            </button>
        </div>
    );
};

// ── SelectionToolbar ─────────────────────────────────────────────────────────

interface SelectionToolbarProps {
    styleDefs: StyleDefinition[];
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({ styleDefs }) => {
    const { t } = useTranslation();
    const {
        selectedElementId,
        selectedElementIds,
        groupElements,
        ungroupElement,
        deleteElement,
        clearSelection,
        duplicateElement,
        bringForward,
        sendBackward,
        svgDocument,
        pathEditMode,
        applyBooleanOperation,
        applySimplifyOperation,
    } = useSVGEditorStore();

    const [isPickerOpen, setIsPickerOpen] = useState(false);

    // If in path edit mode, show the node editing toolbar instead
    if (pathEditMode) return <PathEditToolbar />;

    const ids = Array.from(selectedElementIds);
    const singleId = ids.length === 1 ? ids[0] : (selectedElementIds.size === 0 ? selectedElementId : null);
    const hasSelection = ids.length > 0 || !!selectedElementId;

    if (!hasSelection) return null;

    // Check if single selection is a <g> element (for ungroup)
    const isGroup = (() => {
        if (!singleId || !svgDocument) return false;
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
        const el = doc.querySelector(`#${CSS.escape(singleId)}`);
        return el?.tagName.toLowerCase() === 'g';
    })();

    const allIds = ids.length > 0 ? ids : (selectedElementId ? [selectedElementId] : []);

    const handleGroup = () => {
        if (allIds.length >= 2) groupElements(allIds);
    };

    const handleUngroup = () => {
        if (singleId && isGroup) ungroupElement(singleId);
    };

    const handleDelete = () => {
        allIds.forEach(id => deleteElement(id));
        clearSelection();
    };

    const handleDuplicate = () => {
        if (singleId) duplicateElement(singleId);
    };

    const handleBringForward = () => {
        if (singleId) bringForward(singleId);
    };

    const handleSendBackward = () => {
        if (singleId) sendBackward(singleId);
    };

    // Boolean operation handlers + per-op eligibility (for tooltip / disabled).
    const booleanEligibility = (op: BooleanOp) =>
        svgDocument ? checkBooleanEligibility(op, allIds, svgDocument) : { ok: false, reason: '' };

    const handleBoolean = (op: BooleanOp) => {
        const result = applyBooleanOperation(op);
        if (!result.ok && result.reason) {
            // Best-effort feedback: use the toolbar tooltip area for now.
            // A toast component would be the proper home; deferred.
            console.warn(`[boolean ${op}]`, result.reason);
        }
    };

    const handleSimplify = () => {
        const result = applySimplifyOperation();
        if (!result.ok && result.reason) {
            console.warn('[simplify]', result.reason);
        }
    };

    // Simplify is enabled when at least one <path> is in the selection.
    const simplifyEligible = (() => {
        if (!svgDocument || allIds.length === 0) return false;
        const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
        return allIds.some(id => {
            const el = doc.querySelector(`#${CSS.escape(id)}`);
            return el?.tagName.toLowerCase() === 'path';
        });
    })();

    const getCurrentClasses = (id: string): string[] => {
        if (!svgDocument || !id) return [];
        const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
        const el = doc.getElementById(id);
        return (el?.getAttribute('class') || '').split(' ').filter(Boolean);
    };

    // Center between panels
    const centerX = LEFT_PANEL + (window.innerWidth - LEFT_PANEL - RIGHT_PANEL) / 2;

    const btnClass = "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded transition-colors";
    const divider = <div className="w-px h-5 bg-slate-200" />;

    return (
        <>
            <div
                role="toolbar"
                aria-label={t('svgEditor.selectionToolbar')}
                className="fixed z-[15] flex items-center gap-1 bg-white rounded-lg shadow-xl border border-slate-200 px-2 py-1.5"
                style={{ top: 76, left: centerX, transform: 'translateX(-50%)' }}
                onKeyDown={handleToolbarKeyDown}
            >
                {/* Group — 2+ selected */}
                {allIds.length >= 2 && (
                    <button
                        onClick={handleGroup}
                        className={btnClass}
                        title={t('svgEditor.group')}
                        aria-label={t('svgEditor.group')}
                        data-toolbar-item
                        tabIndex={0}
                    >
                        <Group size={13} aria-hidden="true" />
                        {t('svgEditor.group')}
                    </button>
                )}

                {/* Ungroup — 1 selected <g> */}
                {singleId && isGroup && (
                    <button
                        onClick={handleUngroup}
                        className={btnClass}
                        title={t('svgEditor.ungroup')}
                        aria-label={t('svgEditor.ungroup')}
                        data-toolbar-item
                        tabIndex={-1}
                    >
                        <Ungroup size={13} aria-hidden="true" />
                        {t('svgEditor.ungroup')}
                    </button>
                )}

                {(allIds.length >= 2 || (singleId && isGroup)) && divider}

                {/* Boolean operations — multi-selection only */}
                {/* @see specs/svg-boolean-operations.allium */}
                {allIds.length >= 2 && (() => {
                    const ops: BooleanOp[] = allIds.length === 2
                        ? ['union', 'subtract', 'intersect']
                        : ['union', 'intersect'];
                    return (
                        <>
                            {ops.map(op => {
                                const Icon = BOOL_ICON[op];
                                const elig = booleanEligibility(op);
                                const label = t(
                                    op === 'union' ? 'svgEditor.boolUnion'
                                    : op === 'subtract' ? 'svgEditor.boolSubtract'
                                    : 'svgEditor.boolIntersect'
                                );
                                return (
                                    <button
                                        key={op}
                                        onClick={() => handleBoolean(op)}
                                        disabled={!elig.ok}
                                        className={`${btnClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                                        title={elig.ok ? label : ((elig as { ok: false; reason: string }).reason || label)}
                                        aria-label={label}
                                        data-toolbar-item
                                        tabIndex={-1}
                                    >
                                        <Icon />
                                        {label}
                                    </button>
                                );
                            })}
                            {divider}
                        </>
                    );
                })()}

                {/* Simplify — any <path> in selection */}
                {simplifyEligible && (
                    <>
                        <button
                            onClick={handleSimplify}
                            className={btnClass}
                            title={t('svgEditor.simplifyTooltip')}
                            aria-label={t('svgEditor.simplify')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <Sparkles size={13} aria-hidden="true" />
                            {t('svgEditor.simplify')}
                        </button>
                        {divider}
                    </>
                )}

                {/* Duplicate — single selection */}
                {singleId && (
                    <button
                        onClick={handleDuplicate}
                        className={btnClass}
                        title={t('svgEditor.duplicate')}
                        aria-label={t('svgEditor.duplicate')}
                        data-toolbar-item
                        tabIndex={-1}
                    >
                        <Copy size={13} aria-hidden="true" />
                    </button>
                )}

                {/* Bring Forward / Send Backward — single selection */}
                {singleId && (
                    <>
                        <button
                            onClick={handleBringForward}
                            className={btnClass}
                            title={t('svgEditor.bringForward')}
                            aria-label={t('svgEditor.bringForward')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <ArrowUp size={13} aria-hidden="true" />
                        </button>
                        <button
                            onClick={handleSendBackward}
                            className={btnClass}
                            title={t('svgEditor.sendBackward')}
                            aria-label={t('svgEditor.sendBackward')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <ArrowDown size={13} aria-hidden="true" />
                        </button>
                    </>
                )}

                {divider}

                {/* Apply Class — opens StylePickerModal */}
                <button
                    onClick={() => setIsPickerOpen(true)}
                    className={btnClass}
                    title={t('svgEditor.applyClass')}
                    aria-label={t('svgEditor.applyClass')}
                    data-toolbar-item
                    tabIndex={-1}
                >
                    <Paintbrush size={13} aria-hidden="true" />
                    {t('svgEditor.applyClass')}
                </button>

                {divider}

                {/* Delete */}
                <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded transition-colors"
                    title={t('svgEditor.deleteSelected')}
                    aria-label={t('svgEditor.deleteSelected')}
                    data-toolbar-item
                    tabIndex={-1}
                >
                    <Trash2 size={13} aria-hidden="true" />
                </button>

                <div className="ml-1 text-xs text-slate-500 tabular-nums">
                    {allIds.length}
                </div>
            </div>

            {/* StylePickerModal — outside toolbar div for proper z-index layering */}
            {singleId && (
                <ToolbarStylePicker
                    isOpen={isPickerOpen}
                    onClose={() => setIsPickerOpen(false)}
                    elementId={singleId}
                    currentClasses={getCurrentClasses(singleId)}
                />
            )}
        </>
    );
};
