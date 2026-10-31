import React, { useState } from 'react';
import { StyleEditor as NewStyleEditor } from '../../lib/style-editor/lib/StyleEditor';
import type { StyleDefinition, KeyframeDefinition, ShapeType } from '../../lib/style-editor/lib/types';
import { INITIAL_STYLES } from '../../lib/style-editor/lib/constants';
import { INITIAL_KEYFRAMES } from '../../lib/style-editor/lib/keyframeConstants';
import { GlobalConfig } from '../../types';
import { useTranslation } from '../../hooks/useTranslation';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { X, Download, RotateCcw, Square, Circle, Triangle, Slash, Activity, Heart, Eraser } from 'lucide-react';
import { generateCssString } from '../../lib/style-editor/lib/utils/cssGenerator';
import { styleIsCited } from '../../utils/styleUtils';

interface StyleEditorProps {
    config: GlobalConfig;
    onUpdateConfig: (newConfig: GlobalConfig) => void;
    onClose: () => void;
    /** Classes the library's pictograms cite: those styles cannot be removed. */
    classesInUse?: Set<string>;
}

const ALL_SHAPES: ShapeType[] = ['square', 'circle', 'triangle', 'line', 'path', 'heart'];
const shapeIcons: Record<ShapeType, React.ComponentType<{ size?: number }>> = {
    square: Square, circle: Circle, triangle: Triangle,
    line: Slash, path: Activity, heart: Heart,
};

export const StyleEditor: React.FC<StyleEditorProps> = ({ config, onUpdateConfig, onClose, classesInUse }) => {
    const { t } = useTranslation();
    // Remounts the inner editor after a change made from outside it (its
    // style list is initialised once from props).
    const [revision, setRevision] = useState(0);
    const styles = config.svgStyleDefs ?? INITIAL_STYLES;
    const unused = classesInUse ? styles.filter(s => !styleIsCited(s, classesInUse)) : [];
    const deleteBlockedReason = (style: StyleDefinition) =>
        classesInUse && styleIsCited(style, classesInUse) ? t('styleEditor.styleInUse') : null;
    const { dialogProps } = useDialogA11y({ isOpen: true, onClose, label: t('styleEditor.title') });
    const [previewShape, setPreviewShape] = useState<ShapeType>('square');

    // Use new keyframes immediately — if stored keyframes lack var() syntax (old format),
    const effectiveKeyframes: KeyframeDefinition[] = (() => {
        const stored = config.svgKeyframes;
        if (!stored || stored.length === 0) return INITIAL_KEYFRAMES;
        return stored.some(kf => kf.keyframes.includes('var(')) ? stored : INITIAL_KEYFRAMES;
    })();

    const handleStylesChange = (styles: StyleDefinition[]) => {
        onUpdateConfig({ ...config, svgStyleDefs: styles });
    };

    const handleKeyframesChange = (keyframes: KeyframeDefinition[]) => {
        onUpdateConfig({ ...config, svgKeyframes: keyframes });
    };

    const handleRestoreDefaults = () => {
        if (confirm(t('styleEditor.restoreConfirm'))) {
            onUpdateConfig({ ...config, svgStyleDefs: INITIAL_STYLES, svgKeyframes: INITIAL_KEYFRAMES });
            setRevision(r => r + 1);
        }
    };

    // Each library may keep a smaller stock; base styles return with
    // "restore defaults" and every new library starts from them.
    const handleRemoveUnused = () => {
        if (!unused.length || !confirm(t('styleEditor.removeUnusedConfirm', { count: unused.length }))) return;
        onUpdateConfig({ ...config, svgStyleDefs: styles.filter(s => !unused.includes(s)) });
        setRevision(r => r + 1);
    };

    const handleExportCss = () => {
        const styles = config.svgStyleDefs ?? INITIAL_STYLES;
        const keyframes = config.svgKeyframes ?? INITIAL_KEYFRAMES;
        const css = generateCssString(styles, keyframes);
        const blob = new Blob([css], { type: 'text/css' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'svg-styles.css';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <>
            {/* Backdrop */}
            <div
                id="style-editor-backdrop"
                className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel centrado — 80% ancho, 85vh alto */}
            <div id="style-editor-modal" className="fixed inset-0 z-[61] flex items-center justify-center p-[7vh_10vw] pointer-events-none">
                <div
                    id="style-editor-panel"
                    className="w-full h-full bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto animate-in fade-in zoom-in-95 duration-200"
                    onClick={e => e.stopPropagation()}
                    {...dialogProps}
                >
                    {/* Modal header */}
                    <header id="style-editor-modal-header" className="flex-none h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 z-20">
                        <div>
                            <h2 className="text-base font-bold text-gray-900 leading-none">{t('styleEditor.title')}</h2>
                            <span className="text-xs text-gray-500">{t('styleEditor.subtitle')}</span>
                        </div>

                        {/* Shape selector */}
                        <div className="flex bg-gray-100 p-1 rounded-lg items-center">
                            {ALL_SHAPES.map((shape) => {
                                const Icon = shapeIcons[shape];
                                return (
                                    <button
                                        key={shape}
                                        onClick={() => setPreviewShape(shape)}
                                        className={`p-1.5 rounded-md transition-all ${previewShape === shape ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                                        title={shape}
                                    >
                                        <Icon size={16} />
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex items-center gap-2">
                            {classesInUse && (
                                <button
                                    onClick={handleRemoveUnused}
                                    disabled={!unused.length}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded border border-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t('styleEditor.removeUnusedTitle')}
                                >
                                    <Eraser size={13} /> {t('styleEditor.removeUnused', { count: unused.length })}
                                </button>
                            )}
                            <button
                                onClick={handleRestoreDefaults}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded border border-gray-200 transition-colors"
                                title={t('styleEditor.restoreDefaults')}
                            >
                                <RotateCcw size={13} /> {t('styleEditor.restoreDefaults')}
                            </button>
                            <button
                                onClick={handleExportCss}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-200 transition-colors"
                                title={t('styleEditor.exportCss')}
                            >
                                <Download size={13} /> {t('styleEditor.exportCss')}
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-red-500 transition-colors"
                                title={t('styleEditor.close')}
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </header>

                    {/* Style editor content — lib header hidden, we provide our own */}
                    <div className="flex-1 overflow-hidden relative">
                        <NewStyleEditor
                            key={revision}
                            initialStyles={styles}
                            deleteBlockedReason={deleteBlockedReason}
                            initialKeyframes={effectiveKeyframes}
                            onStylesChange={handleStylesChange}
                            onKeyframesChange={handleKeyframesChange}
                            hideHeader={true}
                            hideExport={true}
                            externalShape={previewShape}
                            onShapeChange={setPreviewShape}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};
