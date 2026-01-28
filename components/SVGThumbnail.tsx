/**
 * SVGThumbnail Component
 *
 * Displays a thumbnail preview of an SVG (raw or structured) with a context menu
 * for actions: Download, Retrace, and Process (structured conversion)
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, RefreshCw, FileCode, MoreVertical } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { processRawSVGForDisplay } from '../utils/svgViewport';

export type SVGType = 'raw' | 'structured';

export interface SVGThumbnailProps {
    svg: string;
    type: SVGType;
    utterance: string;
    onDownload: () => void;
    onRetrace: () => void;
    onProcess?: () => void; // Only for raw SVGs
    isProcessing?: boolean;
    processingStatus?: string;
    aspectRatio?: string; // For raw SVG viewport calculation (default: '1:1')
}

export const SVGThumbnail: React.FC<SVGThumbnailProps> = ({
    svg,
    type,
    utterance,
    onDownload,
    onRetrace,
    onProcess,
    isProcessing = false,
    processingStatus = '',
    aspectRatio = '1:1'
}) => {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Process raw SVG to ensure proper viewport
    const displaySvg = useMemo(() => {
        if (type === 'raw') {
            return processRawSVGForDisplay(svg, aspectRatio);
        }
        return svg;
    }, [svg, type, aspectRatio]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [menuOpen]);

    const badgeStyles = type === 'raw'
        ? 'bg-amber-500 text-white'
        : 'bg-emerald-600 text-white';

    const badgeLabel = type === 'raw' ? 'Raw' : 'Structured';

    return (
        <div className="relative group flex flex-col items-center">
            {/* Thumbnail Preview */}
            <div className={`w-24 h-24 border-2 rounded bg-white flex items-center justify-center p-2 relative overflow-hidden transition-colors ${isProcessing ? 'border-violet-500 animate-pulse' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>

                {/* SVG Badge */}
                <div className={`absolute top-1 left-1 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${badgeStyles} tracking-wider z-10`}>
                    {badgeLabel}
                </div>

                {/* Menu Button */}
                {!isProcessing && (
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="absolute top-1 right-1 p-1 bg-white/90 hover:bg-slate-100 rounded shadow-sm z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Actions"
                    >
                        <MoreVertical size={12} className="text-slate-600" />
                    </button>
                )}

                {/* SVG Preview */}
                <div
                    dangerouslySetInnerHTML={{ __html: displaySvg }}
                    className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                />

                {/* Processing Overlay */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin"></div>
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {menuOpen && (
                <div
                    ref={menuRef}
                    className="absolute top-0 right-0 mt-8 mr-0 w-40 bg-white border border-slate-200 rounded shadow-lg z-50 py-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Download */}
                    <button
                        onClick={() => {
                            onDownload();
                            setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                        <Download size={14} />
                        <span>{t('svg.download')}</span>
                    </button>

                    {/* Retrace */}
                    <button
                        onClick={() => {
                            onRetrace();
                            setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                        <RefreshCw size={14} />
                        <span>Retrace</span>
                    </button>

                    {/* Process (only for raw SVGs) */}
                    {type === 'raw' && onProcess && (
                        <button
                            onClick={() => {
                                onProcess();
                                setMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-violet-600 hover:bg-violet-50 transition-colors border-t border-slate-100"
                        >
                            <FileCode size={14} />
                            <span>Process</span>
                        </button>
                    )}
                </div>
            )}

            {/* Processing Status Message */}
            {isProcessing && processingStatus && (
                <div className="mt-2 text-[9px] text-violet-600 font-medium text-center max-w-[120px] leading-tight">
                    {processingStatus}
                </div>
            )}

            {/* Utterance Label (on hover) */}
            {!isProcessing && (
                <div className="absolute -bottom-6 left-0 right-0 text-[9px] text-slate-400 truncate text-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {utterance}
                </div>
            )}
        </div>
    );
};
