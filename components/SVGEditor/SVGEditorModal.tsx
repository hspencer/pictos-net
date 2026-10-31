import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Undo, Redo, Download, ZoomIn, ZoomOut, Maximize2, Palette, Scan, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useSVGEditorStore } from '../../stores/svgEditorStore';
import { useTranslation } from '../../hooks/useTranslation';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import SemanticTree from './SemanticTree';
import SVGCanvas from './SVGCanvas';
import { StylePanel } from './StylePanel';
import { SelectionToolbar } from './SelectionToolbar';
import type { StyleDefinition } from '../../lib/style-editor/lib/types';
import type { GlobalConfig } from '../../types';
import { StyleEditor } from '../PictoForge/StyleEditor';
import { convertInlineAttrsToCssRules, citedClassNames, styleIsCited } from '../../utils/styleUtils';
import { bakeDocumentTransforms } from './editor/geometry';
import { handleToolbarKeyDown } from './editor/toolbarKeydown';

/**
 * Detects and removes a background rectangle or path that covers >=85% of the
 * SVG viewBox. VTracer often inserts a full-canvas fill as the first path.
 */
function removeBackgroundRect(svgString: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svgString;

    // Parse viewBox dimensions
    const vb = svgEl.getAttribute('viewBox');
    if (!vb) return svgString;
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length < 4) return svgString;
    const [, , vbW, vbH] = parts;
    const vbArea = vbW * vbH;
    if (vbArea <= 0) return svgString;

    // Find first visual child (skip defs, style, title, desc, metadata)
    const skipTags = new Set(['defs', 'style', 'title', 'desc', 'metadata']);
    let firstVisual: Element | null = null;
    for (const child of Array.from(svgEl.children)) {
        if (!skipTags.has(child.tagName.toLowerCase())) {
            firstVisual = child;
            break;
        }
    }
    if (!firstVisual) return svgString;

    let elArea = 0;
    const tag = firstVisual.tagName.toLowerCase();

    if (tag === 'rect') {
        const w = parseFloat(firstVisual.getAttribute('width') || '0');
        const h = parseFloat(firstVisual.getAttribute('height') || '0');
        elArea = w * h;
    } else if (tag === 'path') {
        // Approximate bbox from the d attribute by extracting numeric coordinates
        const d = firstVisual.getAttribute('d') || '';
        const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];
        if (nums.length >= 4) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            // Coordinates come in pairs
            for (let i = 0; i < nums.length - 1; i += 2) {
                const x = nums[i], y = nums[i + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            elArea = (maxX - minX) * (maxY - minY);
        }
    }

    if (elArea >= vbArea * 0.85) {
        firstVisual.remove();
        // Serialize the SVG element, not the document, to avoid XML declaration issues
        return new XMLSerializer().serializeToString(svgEl);
    }

    return svgString;
}

interface SVGEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialSvg: string;
    utterance: string;
    /** Resolves to an error message when the save did not land as intended. */
    onSave: (svg: string) => void | string | null | Promise<void | string | null>;
    styleDefs?: StyleDefinition[];
    svgSource?: 'raw' | 'structured' | 'draft' | null;
    config?: GlobalConfig;
    onUpdateConfig?: (config: GlobalConfig) => void;
    /** Classes the library's other pictograms cite (this row excluded). */
    classesInUse?: Set<string>;
}

export const SVGEditorModal: React.FC<SVGEditorModalProps> = ({
    isOpen,
    onClose,
    initialSvg,
    utterance,
    onSave,
    styleDefs = [],
    svgSource = null,
    config,
    onUpdateConfig,
    classesInUse,
}) => {
    const { t } = useTranslation();
    const { dialogProps } = useDialogA11y({ isOpen, onClose, label: t('svg.editor') });
    const [currentSvg, setCurrentSvg] = useState(initialSvg);
    const loadSVG = useSVGEditorStore(state => state.loadSVG);
    const setStyles = useSVGEditorStore(state => state.setStyles);
    const setSvgSource = useSVGEditorStore(state => state.setSvgSource);
    const svgDocument = useSVGEditorStore(state => state.svgDocument);
    const undo = useSVGEditorStore(state => state.undo);
    const redo = useSVGEditorStore(state => state.redo);
    const historyIndex = useSVGEditorStore(state => state.historyIndex);
    const historyLength = useSVGEditorStore(state => state.history.length);
    const hasUndo = historyIndex > 0;
    const hasRedo = historyIndex < historyLength - 1;
    const reset = useSVGEditorStore(state => state.reset);
    const [showStyleEditor, setShowStyleEditor] = useState(false);
    const viewport = useSVGEditorStore(state => state.viewport);
    const zoomIn = useSVGEditorStore(state => state.zoomIn);
    const zoomOut = useSVGEditorStore(state => state.zoomOut);
    const zoomToFit = useSVGEditorStore(state => state.zoomToFit);
    const styleDefinitions = useSVGEditorStore(state => state.styleDefinitions);
    const outlineMode = useSVGEditorStore(state => state.outlineMode);
    const semanticRefusal = useSVGEditorStore(state => state.semanticRefusal);
    const dismissSemanticRefusal = useSVGEditorStore(state => state.dismissSemanticRefusal);
    const toggleOutlineMode = useSVGEditorStore(state => state.toggleOutlineMode);

    // Classes created, edited or removed in the editor are library classes:
    // they land in this library's palette (config.svgStyleDefs). In use =
    // cited by another pictogram of the library or by this document.
    const libraryStyles = config?.svgStyleDefs ?? styleDefs;
    const setLibraryPalette = useSVGEditorStore(state => state.setLibraryPalette);
    const classesInUseHere = React.useMemo(() => {
        if (!classesInUse) return undefined;
        const out = new Set(classesInUse);
        citedClassNames(svgDocument ?? '').forEach(c => out.add(c));
        return out;
    }, [classesInUse, svgDocument]);
    useEffect(() => {
        if (!config || !onUpdateConfig) { setLibraryPalette(null); return; }
        const styles = config.svgStyleDefs ?? styleDefs;
        const inUse = classesInUseHere ?? citedClassNames(svgDocument ?? '');
        setLibraryPalette({
            save: (style) => {
                const same = (s: StyleDefinition) => s.id === style.id || s.selectors[0] === style.selectors[0];
                onUpdateConfig({ ...config, svgStyleDefs: styles.some(same) ? styles.map(s => (same(s) ? style : s)) : [...styles, style] });
            },
            remove: (styleId) => onUpdateConfig({ ...config, svgStyleDefs: styles.filter(s => s.id !== styleId) }),
            isInUse: (style) => styleIsCited(style, inUse),
        });
        return () => setLibraryPalette(null);
    }, [config, onUpdateConfig, styleDefs, classesInUseHere, svgDocument, setLibraryPalette]);

    // Track which toolbar item is active for roving tabindex
    const toolbarRef = useRef<HTMLDivElement>(null);

    // Collapsible side panels — more canvas, less surface.
    const [treeOpen, setTreeOpen] = useState(true);
    const [propsOpen, setPropsOpen] = useState(true);

    useEffect(() => {
        if (isOpen && initialSvg) {
            const preserveAppearance = svgSource === 'raw' || svgSource === 'draft';

            // Tell the store what mode we're in
            // Drafts use the editor's geometry-preserving mode, while the host
            // keeps their separate identity for saving. No library restyling.
            setSvgSource(svgSource === 'draft' ? 'raw' : svgSource);

            // Always remove background rect first
            let svg = svgSource === 'draft' ? initialSvg : removeBackgroundRect(initialSvg);

            if (preserveAppearance) {
                // Raw SVG: skip library style injection, keep inline fills sacred
                loadSVG(svg, undefined, true);
            } else {
                // Structured SVG: full pipeline with library styles
                if (styleDefs.length > 0) {
                    setStyles(styleDefs);
                }
                const cleanedSvg = convertInlineAttrsToCssRules(svg);
                loadSVG(cleanedSvg);
            }
        }

        // Cleanup on close
        return () => {
            if (!isOpen) {
                reset();
            }
        };
    }, [isOpen, initialSvg]);

    // Sync local state with store updates
    useEffect(() => {
        if (svgDocument) {
            setCurrentSvg(svgDocument);
        }
    }, [svgDocument]);

    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        // Read the live document, not the effect-synced copy: a save right
        // after the last commit must not miss it.
        const currentSvg = useSVGEditorStore.getState().svgDocument;
        if (!currentSvg || saving) return;
        setSaveError(null);
        setSaving(true);
        // Bake every remaining transform (element + group) into geometry via the
        // kernel, so edits survive when ESTRUCTURAR redistributes paths into new
        // groups. Non-destructive gestures already bake at commit; this is the
        // safety net for any lingering transform. Skip cheaply when there is none.
        const needsBake = currentSvg.includes('transform=');
        const svgToSave = needsBake ? bakeDocumentTransforms(currentSvg) : currentSvg;
        // A failed save keeps the editor open with the edit and says why:
        // an edit must never vanish behind a console message.
        try {
            const error = await onSave(svgToSave);
            if (typeof error === 'string' && error) setSaveError(error);
        } finally {
            setSaving(false);
        }
    };

    const handleExport = () => {
        if (!svgDocument) return;

        const blob = new Blob([svgDocument], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${utterance.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_edited.svg`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleZoomFit = useCallback(() => {
        zoomToFit(window.innerWidth, window.innerHeight);
    }, [zoomToFit]);

    // The refused group's human label, read from the (unchanged) document.
    const groupLabel = (id: string) => {
        const g = svgDocument ? new DOMParser().parseFromString(svgDocument, 'image/svg+xml').querySelector(`[id="${CSS.escape(id)}"]`) : null;
        return g?.getAttribute('aria-label') || id;
    };

    if (!isOpen) return null;

    return (
        <div id="svg-editor-modal" className="fixed inset-0 z-50" {...dialogProps}>
            {/* Canvas layer — fills entire screen behind everything */}
            <div id="canvas-stage" className="fixed inset-0 z-0">
                <SVGCanvas />
            </div>

            {/* Save that did not land */}
            {saveError && (
                <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-30 max-w-lg w-[calc(100%-2rem)] bg-red-50 border border-red-300 text-red-900 rounded-lg shadow-lg px-4 py-3 text-sm">
                    <p className="font-medium">{saveError}</p>
                    <button type="button" onClick={() => setSaveError(null)} className="mt-2 text-xs font-bold underline">{t('svgEditor.semanticRefusedDismiss')}</button>
                </div>
            )}

            {/* Refused structural edit (semantic guard) */}
            {semanticRefusal && (
                <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-30 max-w-lg w-[calc(100%-2rem)] bg-amber-50 border border-amber-300 text-amber-900 rounded-lg shadow-lg px-4 py-3 text-sm">
                    <p className="font-medium">{t(`svgEditor.semanticRefused.${semanticRefusal.kind}`, { name: groupLabel(semanticRefusal.target) })}</p>
                    <p className="mt-1 text-xs">{t('svgEditor.semanticRefusedHint')}</p>
                    <button type="button" onClick={dismissSemanticRefusal} className="mt-2 text-xs font-bold underline">{t('svgEditor.semanticRefusedDismiss')}</button>
                </div>
            )}

            {/* Left Panel: Semantic Tree (collapsible) */}
            {treeOpen ? (
                <aside
                    id="svg-editor-tree-panel"
                    className="fixed top-16 left-0 bottom-0 w-72 z-10 bg-white border-r border-slate-200 flex flex-col shadow-xl text-slate-700"
                >
                    <div id="svg-editor-tree-header" className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            {t('svg.editorLayers')}
                        </h3>
                        <button
                            onClick={() => setTreeOpen(false)}
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                            title={t('svgEditor.collapsePanel')}
                            aria-label={t('svgEditor.collapsePanel')}
                        >
                            <PanelLeftClose size={16} aria-hidden="true" />
                        </button>
                    </div>
                    <div id="svg-editor-tree-content" className="flex-1 overflow-y-auto p-2">
                        <SemanticTree />
                    </div>
                </aside>
            ) : (
                <button
                    onClick={() => setTreeOpen(true)}
                    className="fixed top-20 left-3 z-10 p-2 rounded-md bg-white border border-slate-200 shadow-lg text-slate-500 hover:text-slate-800 transition-colors"
                    title={t('svgEditor.expandPanel')}
                    aria-label={t('svgEditor.expandPanel')}
                >
                    <PanelLeftOpen size={18} aria-hidden="true" />
                </button>
            )}

            {/* Right Panel: Style Properties (collapsible) */}
            {propsOpen ? (
                <aside
                    id="svg-editor-properties-panel"
                    className="fixed top-16 right-0 bottom-0 w-80 z-10 border-l border-slate-200 bg-white flex flex-col shrink-0 shadow-lg text-slate-700"
                >
                    <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center justify-end">
                        <button
                            onClick={() => setPropsOpen(false)}
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                            title={t('svgEditor.collapsePanel')}
                            aria-label={t('svgEditor.collapsePanel')}
                        >
                            <PanelRightClose size={16} aria-hidden="true" />
                        </button>
                    </div>
                    <StylePanel styleDefs={libraryStyles} svgSource={svgSource === 'draft' ? 'raw' : svgSource} />
                </aside>
            ) : (
                <button
                    onClick={() => setPropsOpen(true)}
                    className="fixed top-20 right-3 z-10 p-2 rounded-md bg-white border border-slate-200 shadow-lg text-slate-500 hover:text-slate-800 transition-colors"
                    title={t('svgEditor.expandPanel')}
                    aria-label={t('svgEditor.expandPanel')}
                >
                    <PanelRightOpen size={18} aria-hidden="true" />
                </button>
            )}

            {/* Contextual Selection Toolbar */}
            <SelectionToolbar styleDefs={styleDefinitions} />

            {/* Header — top bar above everything */}
            <header
                id="svg-editor-header"
                className="fixed top-0 left-0 right-0 h-16 z-20 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6"
            >
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="text-white hover:text-slate-300" aria-label={t('actions.close')}>
                        <X size={24} aria-hidden="true" />
                    </button>
                    <div>
                        <h2 className="text-lg font-bold text-white font-mono leading-none">
                            {svgSource === 'draft' ? t('svgGenerator.editDraft') : t('svg.editor')}
                        </h2>
                        <span className="text-xs text-slate-400 font-mono">
                            {utterance}
                        </span>
                    </div>
                </div>

                {/* Global toolbar with WCAG arrow key navigation */}
                <div
                    ref={toolbarRef}
                    role="toolbar"
                    aria-label={t('svgEditor.editorToolbar')}
                    className="flex items-center gap-2"
                    onKeyDown={handleToolbarKeyDown}
                >
                    {/* Undo/Redo */}
                    <div className="flex bg-slate-700/50 rounded-md border border-slate-600">
                        <button
                            onClick={undo}
                            disabled={!hasUndo}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-r border-slate-600 rounded-l-md"
                            title={t('svgEditor.undo')}
                            aria-label={t('svgEditor.undo')}
                            data-toolbar-item
                            tabIndex={0}
                        >
                            <Undo size={16} aria-hidden="true" />
                        </button>
                        <button
                            onClick={redo}
                            disabled={!hasRedo}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-r-md"
                            title={t('svgEditor.redo')}
                            aria-label={t('svgEditor.redo')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <Redo size={16} aria-hidden="true" />
                        </button>
                    </div>

                    {/* Zoom controls */}
                    <div className="flex items-center bg-slate-700/50 rounded-md border border-slate-600">
                        <button
                            onClick={zoomOut}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors rounded-l-md"
                            title={t('svgEditor.zoomOut')}
                            aria-label={t('svgEditor.zoomOut')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <ZoomOut size={16} aria-hidden="true" />
                        </button>
                        <div className="min-w-[3.5rem] text-center tabular-nums text-slate-300 font-mono text-xs select-none px-1">
                            {Math.round(viewport.zoom * 100)}%
                        </div>
                        <button
                            onClick={zoomIn}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                            title={t('svgEditor.zoomIn')}
                            aria-label={t('svgEditor.zoomIn')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <ZoomIn size={16} aria-hidden="true" />
                        </button>
                        <button
                            onClick={handleZoomFit}
                            className={`p-2 transition-colors rounded-r-md border-l border-slate-600 ${
                                viewport.fitMode
                                    ? 'text-violet-400 bg-violet-500/20 hover:bg-violet-500/30'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                            }`}
                            title={t('svgEditor.zoomToFit')}
                            aria-label={t('svgEditor.zoomToFit')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <Maximize2 size={16} aria-hidden="true" />
                        </button>
                    </div>

                    {/* Outline mode toggle */}
                    <button
                        onClick={toggleOutlineMode}
                        className={`p-2 transition-colors rounded-md border border-slate-600 bg-slate-700/50 ${
                            outlineMode
                                ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                                : 'text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title={t('svgEditor.outlineMode')}
                        aria-label={t('svgEditor.outlineMode')}
                        aria-pressed={outlineMode}
                        data-toolbar-item
                        tabIndex={-1}
                    >
                        <Scan size={16} aria-hidden="true" />
                    </button>

                    {/* Style Editor */}
                    {config && onUpdateConfig && (
                        <button
                            onClick={() => setShowStyleEditor(true)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors rounded-md border border-slate-600 bg-slate-700/50"
                            title={t('styleEditor.title')}
                            aria-label={t('styleEditor.title')}
                            data-toolbar-item
                            tabIndex={-1}
                        >
                            <Palette size={16} aria-hidden="true" />
                        </button>
                    )}

                    {/* Export */}
                    <button
                        onClick={handleExport}
                        className="px-3 py-1.5 text-sm rounded bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
                        data-toolbar-item
                        tabIndex={-1}
                    >
                        <Download size={14} aria-hidden="true" />
                        {t('svg.editorExport')}
                    </button>

                    {/* Save: the host closes the editor only when the save lands */}
                    <button
                        onClick={() => { void handleSave(); }}
                        disabled={saving}
                        className="px-4 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg"
                        data-toolbar-item
                        tabIndex={-1}
                    >
                        {t('svg.editorSave')}
                    </button>
                </div>
            </header>

            {/* Style Editor overlay (z-[60] sits above svg-editor z-50) */}
            {showStyleEditor && config && onUpdateConfig && (
                <StyleEditor
                    config={config}
                    classesInUse={classesInUseHere}
                    onUpdateConfig={(newConfig) => {
                        onUpdateConfig(newConfig);
                        // Refresh styles in the SVG editor store
                        if (newConfig.svgStyleDefs) {
                            setStyles(newConfig.svgStyleDefs);
                        }
                    }}
                    onClose={() => setShowStyleEditor(false)}
                />
            )}
        </div>
    );
};
