
import React, { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { X, Check, Minimize2, Palette, Plus, Trash2, Circle, Edit2 } from 'lucide-react';
import { GlobalConfig, SVGStyleConfig } from '../../types';

interface StyleEditorProps {
    config: GlobalConfig;
    onUpdateConfig: (newConfig: GlobalConfig) => void;
    onClose: () => void;
}

const PRESET_COLORS = [
    { name: 'Black', value: '#000000' },
    { name: 'White', value: '#ffffff' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Slate', value: '#64748b' },
    { name: 'Transparent', value: 'none' },
];

const DEFAULT_STYLE: SVGStyleConfig = {
    fill: '#000000',
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1
};

export const StyleEditor: React.FC<StyleEditorProps> = ({ config, onUpdateConfig, onClose }) => {
    const { t } = useTranslation();

    // Initialize with existing styles or defaults
    const [localStyles, setLocalStyles] = useState<{ [key: string]: SVGStyleConfig }>(() => ({
        f: { ...DEFAULT_STYLE, ...config.svgStyles?.f },
        k: { fill: '#ffffff', stroke: 'none', strokeWidth: 0, opacity: 1, ...config.svgStyles?.k },
        ...config.svgStyles
    }));

    const [activeClass, setActiveClass] = useState<string>('f');
    const [editingClassName, setEditingClassName] = useState<string | null>(null);
    const [newClassName, setNewClassName] = useState('');

    const currentStyle = localStyles[activeClass] || DEFAULT_STYLE;
    const classNames = Object.keys(localStyles);

    const updateStyle = (key: keyof SVGStyleConfig, value: string | number) => {
        const updated = {
            ...localStyles,
            [activeClass]: {
                ...localStyles[activeClass],
                [key]: value
            }
        };
        handleUpdate(updated);
    };

    const handleUpdate = (updatedStyles: { [key: string]: SVGStyleConfig }) => {
        setLocalStyles(updatedStyles);
        onUpdateConfig({
            ...config,
            svgStyles: updatedStyles
        });
    };

    const addClass = () => {
        if (!newClassName || newClassName.trim() === '') return;
        const className = newClassName.trim().replace(/^\./, ''); // Remove leading dot if present
        if (localStyles[className]) return; // Already exists

        handleUpdate({
            ...localStyles,
            [className]: { ...DEFAULT_STYLE }
        });
        setActiveClass(className);
        setNewClassName('');
    };

    const removeClass = (className: string) => {
        if (className === 'f' || className === 'k') return; // Protect core classes
        const { [className]: removed, ...rest } = localStyles;
        handleUpdate(rest);
        if (activeClass === className) {
            setActiveClass('f');
        }
    };

    const renameClass = (oldName: string, newName: string) => {
        if (oldName === 'f' || oldName === 'k') return; // Protect core classes
        if (!newName || newName.trim() === '') return;
        const className = newName.trim().replace(/^\./, '');
        if (localStyles[className]) return; // Already exists

        const updated = { ...localStyles };
        updated[className] = updated[oldName];
        delete updated[oldName];
        handleUpdate(updated);
        if (activeClass === oldName) {
            setActiveClass(className);
        }
        setEditingClassName(null);
    };

    const applyPreset = (type: 'solid' | 'outline' | 'whiteBlack' | 'blackWhite') => {
        let newStyles = { ...localStyles };

        switch (type) {
            case 'solid':
                newStyles.f = { fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1 };
                newStyles.k = { fill: '#ffffff', stroke: 'none', strokeWidth: 0, opacity: 1 };
                break;
            case 'outline':
                newStyles.f = { fill: 'none', stroke: '#000000', strokeWidth: 2, opacity: 1 };
                newStyles.k = { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 };
                break;
            case 'whiteBlack':
                newStyles.f = { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 };
                newStyles.k = { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 };
                break;
            case 'blackWhite':
                newStyles.f = { fill: '#000000', stroke: '#ffffff', strokeWidth: 2, opacity: 1 };
                newStyles.k = { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 };
                break;
        }
        handleUpdate(newStyles);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[480px] max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">

                {/* Header */}
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Palette size={16} className="text-violet-600" />
                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            {t('styleEditor.title', { lang: config.author || 'User' })}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={16} />
                    </button>
                </div>

                {/* Presets */}
                <div className="px-4 py-3 border-b border-dashed border-slate-200">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{t('styleEditor.presets')}</label>
                    <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => applyPreset('solid')} title={t('styleEditor.presetSolid')} className="h-8 rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center">
                            <Circle size={14} fill="currentColor" className="text-slate-900" />
                        </button>
                        <button onClick={() => applyPreset('outline')} title={t('styleEditor.presetOutline')} className="h-8 rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center">
                            <Circle size={14} className="text-slate-900" />
                        </button>
                        <button onClick={() => applyPreset('whiteBlack')} title="White + Black Stroke" className="h-8 rounded bg-slate-800 hover:bg-slate-900 border border-slate-900 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-white border border-slate-400"></div>
                        </button>
                        <button onClick={() => applyPreset('blackWhite')} title="Black + White Stroke" className="h-8 rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-slate-900 border border-slate-300"></div>
                        </button>
                    </div>
                </div>

                {/* Class List */}
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Clases CSS</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {classNames.map(className => (
                            <div key={className} className="flex items-center gap-1">
                                {editingClassName === className ? (
                                    <input
                                        type="text"
                                        defaultValue={className}
                                        autoFocus
                                        onBlur={(e) => renameClass(className, e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') renameClass(className, e.currentTarget.value);
                                            if (e.key === 'Escape') setEditingClassName(null);
                                        }}
                                        className="px-2 py-1 text-xs border border-violet-300 rounded focus:outline-none focus:ring-1 focus:ring-violet-500"
                                    />
                                ) : (
                                    <button
                                        onClick={() => setActiveClass(className)}
                                        className={`px-3 py-1 text-xs rounded border transition-all ${activeClass === className
                                                ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                                                : 'bg-white text-slate-700 border-slate-200 hover:border-violet-300'
                                            }`}
                                    >
                                        .{className}
                                    </button>
                                )}
                                {className !== 'f' && className !== 'k' && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setEditingClassName(className)}
                                            className="p-1 text-slate-400 hover:text-violet-600 transition-colors"
                                            title="Renombrar"
                                        >
                                            <Edit2 size={12} />
                                        </button>
                                        <button
                                            onClick={() => removeClass(className)}
                                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                                            title="Eliminar"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Add New Class */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newClassName}
                            onChange={(e) => setNewClassName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addClass()}
                            placeholder="nueva-clase"
                            className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-500"
                        />
                        <button
                            onClick={addClass}
                            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded flex items-center gap-1 transition-colors"
                        >
                            <Plus size={12} /> Agregar
                        </button>
                    </div>
                </div>

                {/* Style Preview */}
                <div className="p-4 border-b border-slate-200 flex justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                    <div className="flex flex-col items-center gap-2">
                        <div
                            className="w-24 h-24 rounded-full border-2 transition-all shadow-lg"
                            style={{
                                backgroundColor: currentStyle.fill === 'none' ? 'transparent' : currentStyle.fill,
                                borderColor: currentStyle.stroke === 'none' ? '#e2e8f0' : currentStyle.stroke,
                                borderWidth: currentStyle.stroke === 'none' ? 2 : currentStyle.strokeWidth,
                                opacity: currentStyle.opacity ?? 1
                            }}
                        >
                            {currentStyle.fill === 'none' && (
                                <div className="w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwYXRoIGQ9Ik0wIDBoNHY0SDB6IiBmaWxsPSIjZjFmM2Y1Ii8+PHBhdGggZD0iTTQgMGg0djRINHoiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMCA0aDR2NEgwWiIgZmlsbD0iI2ZmZiIvPjxwYXRoIGQ9Ik00IDRoNHY0SDR6IiBmaWxsPSIjZjFmM2Y1Ii8+PC9zdmc+')] opacity-50 rounded-full"></div>
                            )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">.{activeClass}</span>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Fill Color */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{t('styleEditor.fill')}</label>
                        <div className="flex flex-wrap gap-2">
                            {PRESET_COLORS.map(c => (
                                <button
                                    key={c.name}
                                    title={c.name}
                                    onClick={() => updateStyle('fill', c.value)}
                                    className={`w-6 h-6 rounded-full border shadow-sm transition-transform hover:scale-110 ${currentStyle.fill === c.value ? 'ring-2 ring-violet-400 scale-110' : 'border-slate-200'
                                        }`}
                                    style={{ backgroundColor: c.value === 'none' ? 'transparent' : c.value }}
                                >
                                    {c.value === 'none' && <div className="w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxwYXRoIGQ9Ik0wIDBoMnYySDB6IiBmaWxsPSIjZWRlOWZlIi8+PHBhdGggZD0iTTIgMmgydjJUMnoiIGZpbGw9IiNlZGU5ZmUiLz48L3N2Zz4=')] opacity-50 rounded-full"></div>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Stroke Color */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{t('styleEditor.stroke')}</label>
                        <div className="flex flex-wrap gap-2">
                            {PRESET_COLORS.map(c => (
                                <button
                                    key={c.name}
                                    title={c.name}
                                    onClick={() => updateStyle('stroke', c.value)}
                                    className={`w-6 h-6 rounded-full border shadow-sm transition-transform hover:scale-110 ${currentStyle.stroke === c.value ? 'ring-2 ring-violet-400 scale-110' : 'border-slate-200'
                                        }`}
                                    style={{ borderColor: c.value === 'none' ? 'transparent' : c.value, borderWidth: 2 }}
                                >
                                    {c.value === 'none' && <div className="w-full h-full flex items-center justify-center text-slate-300"><Minimize2 size={12} /></div>}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* Stroke Width */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('styleEditor.width')}</label>
                                <span className="text-[10px] font-mono text-slate-600">{currentStyle.strokeWidth}px</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="10"
                                step="0.5"
                                value={currentStyle.strokeWidth}
                                onChange={(e) => updateStyle('strokeWidth', parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-violet-600"
                            />
                        </div>

                        {/* Opacity */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('styleEditor.opacity')}</label>
                                <span className="text-[10px] font-mono text-slate-600">{((currentStyle.opacity ?? 1) * 100).toFixed(0)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={currentStyle.opacity ?? 1}
                                onChange={(e) => updateStyle('opacity', parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-violet-600"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold py-2 px-4 rounded shadow-sm transition-colors flex items-center gap-2"
                    >
                        <Check size={14} /> {t('styleEditor.close')}
                    </button>
                </div>
            </div>
        </div>
    );
};
