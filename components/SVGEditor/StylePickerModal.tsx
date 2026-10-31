import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import { useSVGEditorStore } from '../../stores/svgEditorStore';
import type { StyleDefinition } from '../../lib/style-editor/lib/types';
import StylePreviewCard from '../../lib/style-editor/lib/components/StylePreviewCard';
import EditModal from '../../lib/style-editor/lib/components/EditModal';
import { generateCssString } from '../../lib/style-editor/lib/utils/cssGenerator';
import { INITIAL_KEYFRAMES } from '../../lib/style-editor/lib/keyframeConstants';
import { useTranslation } from '../../hooks/useTranslation';
import { useDialogA11y } from '../../hooks/useDialogA11y';

interface StylePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    elementId: string;
    styleDefs: StyleDefinition[];
    currentClasses: string[];
}

/**
 * Floating palette for citing/unciting library classes on a single SVG element.
 * "Define new class" opens the rich EditModal from @style-editor/lib and saves
 * the class to the library palette. A class nothing in the library cites can
 * be removed from the palette (base classes too: every library may keep a
 * smaller stock; new libraries still start from the full base set).
 * @see CSS_STYLING_ARCHITECTURE.md — CITE / UNCITE
 */
export const StylePickerModal: React.FC<StylePickerModalProps> = ({
    isOpen,
    onClose,
    elementId,
    styleDefs,
    currentClasses,
}) => {
    const { t } = useTranslation();
    const { citeClass, unciteClass, saveStyleDefinition, removeStyleDefinition, libraryPalette } = useSVGEditorStore();
    const storeStyleDefs = useSVGEditorStore(state => state.styleDefinitions);
    const { dialogProps } = useDialogA11y({ isOpen, onClose, label: t('svgEditor.selectStyle') });

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Merge: store takes precedence (includes locally defined classes)
    const allStyleDefs = useMemo(() => {
        const bySelector = new Map<string, StyleDefinition>();
        styleDefs.forEach(s => bySelector.set(s.selectors[0] ?? s.id, s));
        storeStyleDefs.forEach(s => bySelector.set(s.selectors[0] ?? s.id, s));
        return Array.from(bySelector.values());
    }, [styleDefs, storeStyleDefs]);

    const previewCSS = useMemo(
        () => generateCssString(allStyleDefs, INITIAL_KEYFRAMES),
        [allStyleDefs],
    );

    if (!isOpen) return null;

    const handleToggle = (cls: string, isCited: boolean) => {
        // Preserve scroll position across the re-render triggered by cite/uncite
        const scrollTop = scrollRef.current?.scrollTop ?? 0;
        if (isCited) {
            unciteClass(elementId, cls);
        } else {
            citeClass(elementId, cls);
        }
        requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
        });
    };

    const handleSaveNewClass = (styleDef: StyleDefinition) => {
        const className = styleDef.selectors[0]?.replace(/^\./, '') ?? '';
        if (!className) return;
        saveStyleDefinition(styleDef);
        citeClass(elementId, className);
        setIsEditModalOpen(false);
    };

    // Portalled out of the side panel's stacking context, which would leave
    // the palette under the floating selection toolbar.
    return createPortal(
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/40" />
            <div
                ref={scrollRef}
                className="relative bg-white rounded-xl shadow-2xl p-4 w-[38rem] max-w-[90vw] max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
                {...dialogProps}
            >
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {t('svgEditor.selectStyle')}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                        aria-label={t('actions.close')}
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>

                <style>{previewCSS}</style>

                {allStyleDefs.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">{t('svgEditor.noStylesDefined')}</p>
                ) : (
                    <div className="grid grid-cols-4 gap-2">
                        {allStyleDefs.map((styleDef) => {
                            const cls = styleDef.selectors[0]?.replace(/^\./, '') ?? '';
                            const isCited = currentClasses.includes(cls);
                            const removable = !!libraryPalette && !isCited && !libraryPalette.isInUse(styleDef);
                            return (
                                <div key={styleDef.id} className="relative group/style">
                                    <button
                                        onClick={() => handleToggle(cls, isCited)}
                                        title={isCited ? `${t('svgEditor.uncite')} .${cls}` : `${t('svgEditor.cite')} .${cls}`}
                                        className={`w-full rounded-lg p-2 transition-all text-left ${
                                            isCited
                                                ? 'ring-2 ring-violet-500 bg-violet-50'
                                                : 'bg-slate-100 hover:ring-1 hover:ring-slate-300'
                                        }`}
                                    >
                                        <StylePreviewCard
                                            styleDef={styleDef}
                                            shape="square"
                                            onClick={() => {}}
                                        />
                                    </button>
                                    {removable && (
                                        <button
                                            onClick={() => removeStyleDefinition(styleDef.id)}
                                            className="absolute top-1 right-1 p-1 rounded bg-white/90 text-slate-500 hover:text-red-600 hover:bg-red-50 shadow-sm opacity-0 group-hover/style:opacity-100 focus:opacity-100 transition-opacity"
                                            title={t('svgEditor.removeUnusedStyle', { cls })}
                                            aria-label={t('svgEditor.removeUnusedStyle', { cls })}
                                        >
                                            <Trash2 size={11} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-center">
                    <button
                        onClick={() => setIsEditModalOpen(true)}
                        className="text-xs text-violet-600 hover:text-violet-800 hover:underline flex items-center gap-1"
                    >
                        <Plus size={11} aria-hidden="true" />
                        {t('svgEditor.defineNewClass')}
                    </button>
                </div>
            </div>

            <EditModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                styleDef={null}
                onSave={handleSaveNewClass}
                onDelete={() => {}}
                keyframes={INITIAL_KEYFRAMES}
            />
        </div>,
        document.body,
    );
};
