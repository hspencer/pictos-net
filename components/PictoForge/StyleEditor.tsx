
import React, { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { X, Check, Minimize2, Palette, Layers, BoxSelect, Circle } from 'lucide-react';
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

export const StyleEditor: React.FC<StyleEditorProps> = ({ config, onUpdateConfig, onClose }) => {
    const { t } = useTranslation();
    const [activeClass, setActiveClass] = useState<'f' | 'k'>('f');

    // Ensure we have opacity in local state
    const [localStyles, setLocalStyles] = useState<{ f: SVGStyleConfig, k: SVGStyleConfig }>(() => ({
        f: { fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, ...config.svgStyles?.f },
        k: { fill: '#ffffff', stroke: 'none', strokeWidth: 0, opacity: 1, ...config.svgStyles?.k }
    }));

    const currentStyle = localStyles[activeClass];

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

    const handleUpdate = (updatedStyles: { f: SVGStyleConfig, k: SVGStyleConfig }) => {
        setLocalStyles(updatedStyles);
        onUpdateConfig({
            ...config,
            svgStyles: updatedStyles
        });
    };

    const applyPreset = (type: 'solid' | 'outline' | 'whiteBlack' | 'blackWhite') => {
        let newStyles = { ...localStyles };

        switch (type) {
            case 'solid':
                newStyles = {
                    f: { fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1 },
                    k: { fill: '#ffffff', stroke: 'none', strokeWidth: 0, opacity: 1 }
                };
                break;
            case 'outline':
                newStyles = {
                    f: { fill: 'none', stroke: '#000000', strokeWidth: 2, opacity: 1 },
                    k: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 }
                };
                break;
            case 'whiteBlack':
                newStyles = {
                    f: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
                    k: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 }
                };
                break;
            case 'blackWhite':
                newStyles = {
                    f: { fill: '#000000', stroke: '#ffffff', strokeWidth: 2, opacity: 1 },
                    k: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 }
                };
                break;
        }
        handleUpdate(newStyles);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[360px] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

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

                {/* Class Selector Circles */}
                <div className="p-6 flex justify-center gap-6 bg-slate-50/50">
                    {/* Foreground Circle (.f) */}
                    <div className="flex flex-col items-center gap-2">
                        <button
                            onClick={() => setActiveClass('f')}
                            className={`w-20 h-20 rounded-full border-2 transition-all shadow-sm flex items-center justify-center relative ${activeClass === 'f' ? 'border-violet-500 ring-4 ring-violet-100 scale-105' : 'border-slate-300 hover:border-slate-400'
                                }`}
                            style={{
                                backgroundColor: localStyles.f.fill === 'none' ? 'transparent' : localStyles.f.fill,
                                borderColor: localStyles.f.stroke === 'none' ? undefined : localStyles.f.stroke,
                                borderWidth: localStyles.f.stroke === 'none' ? 0 : localStyles.f.strokeWidth,
                                opacity: localStyles.f.opacity ?? 1
                            }}
                        >
                            {localStyles.f.fill === 'none' && <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwYXRoIGQ9Ik0wIDBoNHY0SDB6IiBmaWxsPSIjZjFmM2Y1Ii8+PHBhdGggZD0iTTQgMGg0djRINHoiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMCA0aDR2NEgwWiIgZmlsbD0iI2ZmZiIvPjxwYXRoIGQ9Ik00IDRoNHY0SDR6IiBmaWxsPSIjZjFmM2Y1Ii8+PC9zdmc+')] opacity-50 -z-10 rounded-full"></div>}
                            <span className={`text-sm font-bold ${localStyles.f.fill === '#000000' || localStyles.f.fill === 'black' ? 'text-white/50' : 'text-slate-900/50'
                                }`}>.f</span>
                        </button>
                        <span className="text-[10px] font-medium text-slate-500 uppercase">{t('styleEditor.sectionForeground')}</span>
                    </div>

                    {/* Key/Contrast Circle (.k) */}
                    <div className="flex flex-col items-center gap-2">
                        <button
                            onClick={() => setActiveClass('k')}
                            className={`w-20 h-20 rounded-full border-2 transition-all shadow-sm flex items-center justify-center relative ${activeClass === 'k' ? 'border-violet-500 ring-4 ring-violet-100 scale-105' : 'border-slate-300 hover:border-slate-400'
                                }`}
                            style={{
                                backgroundColor: localStyles.k.fill === 'none' ? 'transparent' : localStyles.k.fill,
                                borderColor: localStyles.k.stroke === 'none' ? undefined : localStyles.k.stroke,
                                borderWidth: localStyles.k.stroke === 'none' ? 0 : localStyles.k.strokeWidth,
                                opacity: localStyles.k.opacity ?? 1
                            }}
                        >
                            {localStyles.k.fill === 'none' && <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwYXRoIGQ9Ik0wIDBoNHY0SDB6IiBmaWxsPSIjZjFmM2Y1Ii8+PHBhdGggZD0iTTQgMGg0djRINHoiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMCA0aDR2NEgwWiIgZmlsbD0iI2ZmZiIvPjxwYXRoIGQ9Ik00IDRoNHY0SDR6IiBmaWxsPSIjZjFmM2Y1Ii8+PC9zdmc+')] opacity-50 -z-10 rounded-full"></div>}
                            <span className={`text-sm font-bold ${localStyles.k.fill === '#000000' || localStyles.k.fill === 'black' ? 'text-white/50' : 'text-slate-900/50'
                                }`}>.k</span>
                        </button>
                        <span className="text-[10px] font-medium text-slate-500 uppercase">{t('styleEditor.sectionKey')}</span>
                    </div>
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

                {/* Controls */}
                <div className="p-4 space-y-4 max-h-[300px] overflow-y-auto">
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
                                <span className="text-[10px] font-mono text-slate-600">{(currentStyle.opacity ?? 1) * 100}%</span>
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
