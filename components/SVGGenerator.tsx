
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { Download, AlertCircle, FileCode, Edit, Layers, Trash2, Scan } from 'lucide-react';
import { RowData, VisualElement, NLUData, StructuringMapping, PHASE5_MODELS, DEFAULT_PHASE5_MODEL } from '../types';
import { structureSVG, assembleFromMapping, canStructureSVG } from '../services/svgStructureService';
import { Phase5ReviewPanel } from './Phase5ReviewPanel';
import useSVGLibrary from '../hooks/useSVGLibrary';
import { GlobalConfig } from '../types';

import { generateStylesheet } from '../services/svgStructureService';
import { injectSvgA11y } from '../utils/svgAccessibility';

// Track active structuring processes across mount/unmount cycles.
// Key = row ID, value = start timestamp. Survives component unmount.
const activeStructuring = new Map<string, number>();

// Helper function to sanitize filename for downloads
const sanitizeFilename = (text: string, maxLength: number = 30): string => {
    return text
        .normalize('NFD') // Decompose accented characters
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^a-z0-9]/gi, '_') // Replace non-alphanumeric with underscore
        .replace(/_+/g, '_') // Collapse multiple underscores
        .replace(/^_|_$/g, '') // Remove leading/trailing underscores
        .substring(0, maxLength)
        .toLowerCase();
};

interface SVGGeneratorProps {
    row: RowData;
    config: GlobalConfig;
    onLog: (type: 'info' | 'error' | 'success', message: string) => void;
    onUpdate: (updates: Partial<RowData>) => void;
    onOpenEditor?: (source?: 'raw' | 'structured') => void;
    /**
     * Layout direction for the dual-preview "completed" state.
     *  'stacked' (default) — raw above structured, used inside narrow row columns.
     *  'columns' — raw left, structured right; used by FocusViewModal's format step.
     * See specs/library-views.allium.
     */
    layout?: 'stacked' | 'columns';
    /**
     * Called just before an SVG artifact is discarded (replaced or cleared)
     * by an action triggered from this component (Re-Estructurar today;
     * extensible to Re-trace and per-section deletes). The host computes
     * SvgMetrics on the discarded content and emits a discard event.
     * See specs/intervention-recording.allium § ReStructurarDiscardsStructured.
     */
    onDiscardSvg?: (phase: 'svg_raw' | 'svg_structured', previousSvg: string) => void;
    /** Opens the VectorizerModal so the user can re-trace the bitmap → rawSvg. */
    onOpenVectorizer?: () => void;
    /** Session-only vision model for Phase 5 structuring. Not persisted. */
    phase5Model?: string;
    /** Called when the user changes the Phase 5 model via the selector. */
    onPhase5ModelChange?: (model: string) => void;
}

export const SVGGenerator: React.FC<SVGGeneratorProps> = ({ row, config, onLog, onUpdate, onOpenEditor, layout = 'stacked', onDiscardSvg, onOpenVectorizer, phase5Model = DEFAULT_PHASE5_MODEL, onPhase5ModelChange }) => {
    const { t } = useTranslation();
    const { addSVG, getSVGByRowId, removeSVGByRowId } = useSVGLibrary();
    const [status, setStatus] = useState<'idle' | 'traced' | 'structuring' | 'completed' | 'error'>('idle');
    const [error, setError] = useState<string | undefined>();
    const [progress, setProgress] = useState(0);
    const [processStartTime, setProcessStartTime] = useState<number | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [subStatus, setSubStatus] = useState<string>('');
    // Local display state for the raw SVG. Initialised from row.rawSvg
    // ONLY when the artifact is still valid (not discarded). If the user
    // previously discarded it, the data persists on the row for telemetry
    // but the editor starts hidden — re-trace re-validates it.
    const [rawSvg, setRawSvg] = useState<string | null>(
      row.rawSvgDiscarded ? null : (row.rawSvg || null)
    );
    const [confirmingDelete, setConfirmingDelete] = useState<'raw' | 'structured' | null>(null);
    const [structureProgress, setStructureProgress] = useState(0);
    const [pendingMapping, setPendingMapping] = useState<StructuringMapping | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // row.structuredSvg is the authoritative source (updated by parent via updateRow).
    // The local SVG library may be stale because each useSVGLibrary() instance has
    // independent state loaded only on mount. We use the library only to inherit
    // metadata (lang, createdAt) if available, but the SVG content always comes from the prop.
    const structuredSvgEntry = React.useMemo(() => {
        const libSvg = getSVGByRowId(row.id);

        // A discarded structuredSvg is not surfaced to the editor / library
        // view; the data is kept on the row only for telemetry & research.
        if (row.structuredSvg && !row.structuredSvgDiscarded) {
            return {
                id: libSvg?.id ?? `svg-${row.id}`,
                utterance: row.UTTERANCE,
                svg: row.structuredSvg,
                sourceRowId: row.id,
                createdAt: libSvg?.createdAt ?? new Date().toISOString(),
                lang: libSvg?.lang,
            };
        }

        if (libSvg) return libSvg;

        return undefined;
    }, [row.id, row.structuredSvg, row.structuredSvgDiscarded, row.UTTERANCE, getSVGByRowId]);

    // Redraw needs only a reference image, so structuring is eligible from a
    // bitmap alone (no trace required) — or from a valid rawSvg. The bitmap is
    // the preferred redraw reference.
    const bitmapRef = row.bitmapDiscarded ? undefined : row.bitmap;
    const structureEligibility = canStructureSVG({
        rawSvg: row.rawSvgDiscarded ? undefined : row.rawSvg,
        bitmap: bitmapRef,
        NLU: row.NLU,
        elements: row.elements,
    });

    // Dynamic Style Injection (Visual only)
    const displaySvg = React.useMemo(() => {
        if (!structuredSvgEntry) return '';
        const currentStyles = generateStylesheet(config);
        return structuredSvgEntry.svg
            .replace(/<style>[\s\S]*?<\/style>/i, `<style>${currentStyles}</style>`);
    }, [structuredSvgEntry, config]);

    // Raw SVG prepared for display.
    // The viewBox from vtracer (or assembled multicolor SVG) is authoritative and
    // should already match the source bitmap pixel dimensions. If it's missing
    // (legacy SVGs, unexpected vtracer output), we compute a rough fallback from
    // the translate() transforms on each path.
    const displayRawSvg = React.useMemo(() => {
        if (!rawSvg) return '';
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
            const svgEl = doc.querySelector('svg');
            if (!svgEl) return rawSvg;

            if (!svgEl.hasAttribute('viewBox')) {
                // Compute a viewBox from translate() transforms as a fallback.
                // Each path is positioned at translate(tx, ty) in pixel space.
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                svgEl.querySelectorAll('path').forEach(path => {
                    const t = path.getAttribute('transform') || '';
                    const m = t.match(/translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
                    if (m) {
                        minX = Math.min(minX, +m[1]);
                        minY = Math.min(minY, +m[2]);
                        maxX = Math.max(maxX, +m[1]);
                        maxY = Math.max(maxY, +m[2]);
                    }
                });
                if (isFinite(minX)) {
                    // Add generous padding to accommodate path extents beyond their origins
                    const pad = Math.max(80, (maxX - minX) * 0.15);
                    svgEl.setAttribute('viewBox',
                        `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
                }
            }

            svgEl.setAttribute('width', '100%');
            svgEl.setAttribute('height', '100%');
            svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            return new XMLSerializer().serializeToString(svgEl);
        } catch {
            return rawSvg;
        }
    }, [rawSvg]);

    // Download helpers — use the SVG string directly instead of relying on
    // the library lookup (which can miss due to ID mismatch or stale state).
    const triggerDownload = (svgString: string, suffix: string) => {
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(row.UTTERANCE)}${suffix}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadRawSvg = () => {
        if (rawSvg) triggerDownload(rawSvg, '_raw');
    };

    const downloadStructuredSvg = () => {
        if (structuredSvgEntry?.svg) triggerDownload(structuredSvgEntry.svg, '');
    };

    // Strip hardcoded inline styles from the raw traced SVG so CSS classes take effect
    const cleanInlineStyles = () => {
        if (!rawSvg) return;
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
            const INLINE_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'style'];
            doc.querySelectorAll('*').forEach(el => {
                INLINE_ATTRS.forEach(attr => el.removeAttribute(attr));
            });
            const cleaned = new XMLSerializer().serializeToString(doc.documentElement);
            setRawSvg(cleaned);
            onUpdate({ rawSvg: cleaned });
        } catch (err) {
            console.error('cleanInlineStyles error:', err);
        }
    };

    // Timer Effect
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (status === 'structuring' && processStartTime) {
            interval = setInterval(() => {
                setElapsedTime((Date.now() - processStartTime) / 1000);
            }, 100);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [status, processStartTime]);

    // Cleanup heartbeat on unmount
    useEffect(() => {
        return () => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        };
    }, []);


    // Determine status based on what SVG data is available for this row.
    // Priority: structuredSvg > active structuring > rawSvg > idle
    useEffect(() => {
        // A discarded rawSvg counts as "no valid trace" for the purposes
        // of this view (the data persists on the row for telemetry).
        const validRawSvg = row.rawSvgDiscarded ? null : (row.rawSvg || null);
        if (structuredSvgEntry) {
            // Structuring finished while we were unmounted
            activeStructuring.delete(row.id);
            setStatus('completed');
        } else if (activeStructuring.has(row.id)) {
            // Remounted while structuring is still in progress — restore UI
            const startedAt = activeStructuring.get(row.id)!;
            setRawSvg(validRawSvg);
            setStatus('structuring');
            setProcessStartTime(startedAt);
            setElapsedTime((Date.now() - startedAt) / 1000);
            setSubStatus('Estructurando SVG semántico...');
            // Restart heartbeat from an estimated progress based on elapsed time
            if (!heartbeatRef.current) {
                const elapsed = (Date.now() - startedAt) / 1000;
                const estimatedProgress = elapsed < 5 ? Math.min(elapsed * 5, 25)
                    : elapsed < 30 ? Math.min(25 + (elapsed - 5) * 1.8, 70)
                    : Math.min(70 + (elapsed - 30) * 0.3, 88);
                setStructureProgress(estimatedProgress);
                startHeartbeat();
            }
        } else if (validRawSvg) {
            setRawSvg(validRawSvg);
            setStatus('traced');
        } else {
            setStatus('idle');
        }
    }, [structuredSvgEntry, row.id, row.rawSvg, row.rawSvgDiscarded]); // eslint-disable-line react-hooks/exhaustive-deps

    const startHeartbeat = () => {
        const start = Date.now();
        heartbeatRef.current = setInterval(() => {
            const elapsed = (Date.now() - start) / 1000;
            setStructureProgress(prev => {
                if (prev >= 92) return prev;
                // Fast progression: Gemini Flash typically responds in < 3s
                if (elapsed < 1) return Math.min(prev + 10, 30);
                if (elapsed < 3) return Math.min(prev + 8, 70);
                if (elapsed < 8) return Math.min(prev + 3, 85);
                return Math.min(prev + 0.5, 92);
            });
        }, 200);
    };

    const stopHeartbeat = (finalValue = 100) => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        setStructureProgress(finalValue);
    };

    const handleFormat = async (svgOverride?: string) => {
        const svg = svgOverride || rawSvg;
        if (!svg) return;

        try {
            setError(undefined);
            const startTime = performance.now();
            setProcessStartTime(Date.now());
            setElapsedTime(0);

            // Structure with Gemini
            setStatus('structuring');
            setSubStatus('Preparando prompt semántico...');
            setStructureProgress(0);
            activeStructuring.set(row.id, Date.now());
            startHeartbeat();
            await new Promise(r => setTimeout(r, 600)); // UX Delay

            const nluData = typeof row.NLU === 'object' ? row.NLU as NLUData : undefined;
            if (!nluData) throw new Error("Invalid NLU data");

            onLog('info', `Estructurando SVG semántico [modelo: ${phase5Model}]…`);
            const sStart = performance.now();
            const result = await structureSVG({
                rawSvg: svg,
                nlu: nluData,
                elements: row.elements || [],
                utterance: row.UTTERANCE,
                config,
                phase5Model,
                // Redraw reference: the source bitmap shows clean intent (solid
                // strokes) vs the noisy trace. Omitted if discarded → falls back
                // to a clean raster of rawSvg.
                referenceImage: bitmapRef,
                onProgress: (msg) => onLog('info', msg),
                onStatus: (s) => setSubStatus(s),
            });

            stopHeartbeat();
            const sEnd = performance.now();

            if (!result.success) {
                throw new Error(result.error || 'Failed to structure SVG');
            }

            // Recording mode: mapping awaits user review
            if (result.pendingReview && result.mapping) {
                onLog('info', `Mapeo listo — esperando revisión (modo grabación)`);
                setPendingMapping(result.mapping);
                setStatus('idle');
                return;
            }

            if (!result.svg) {
                throw new Error('ESTRUCTURAR devolvió resultado vacío');
            }

            onLog('success', `Estructuración completada en ${((sEnd - sStart) / 1000).toFixed(2)}s`);

            addSVG({
                id: row.id,
                utterance: row.UTTERANCE,
                svg: result.svg,
                createdAt: new Date().toISOString(),
                sourceRowId: row.id,
                lang: nluData.lang,
            });

            onUpdate({ structuredSvg: result.svg, structuredSvgDiscarded: false });

            activeStructuring.delete(row.id);
            setStatus('completed');
            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            onLog('success', `Proceso SVG finalizado. Tiempo total: ${totalTime}s`);

        } catch (err) {
            stopHeartbeat(0);
            activeStructuring.delete(row.id);
            console.error(err);
            setStatus('error');
            const msg = err instanceof Error ? err.message : "Unknown error";
            setError(msg);
            onLog('error', `Fallo SVG: ${msg}`);
        }
    };


    // In the Claude+Recraft pipeline, rawSvg comes from Recraft (phase 3) — not from VTracer.
    // Show the component when structuredSvg already exists OR when rawSvg is available to structure.
    if (!structuredSvgEntry && !structureEligibility.eligible) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 bg-slate-50 border border-slate-100 rounded text-center opacity-75">
                <AlertCircle size={24} className="text-slate-500 mb-2" />
                <p className="text-xs text-slate-500 font-medium mb-1">{t('svgGenerator.unavailable')}</p>
                <p className="text-xs text-slate-500 font-mono">
                    {structureEligibility.reason || "Requirements not met"}
                </p>
            </div>
        );
    }

    if (status === 'completed' && structuredSvgEntry) {
        const isColumns = layout === 'columns';
        const previewWrapperClass = isColumns
            ? 'flex-1 flex flex-row gap-3 min-h-0'
            : 'flex flex-col gap-3';
        // Stacked (row column): every pictogram is a full-width square so bitmap
        // and SVG artifacts render at the same size and use all available width.
        // Columns (maximized focus view): share the available height side by side.
        const sectionSquareClass = isColumns ? '' : 'w-full aspect-square';
        const rawSectionStyle = isColumns
            ? { flex: '1 1 0%', minHeight: 80 }
            : undefined;
        const structuredSectionStyle = isColumns
            ? { flex: '1 1 0%', minHeight: 120 }
            : undefined;
        return (
            <div className={isColumns ? "flex flex-col h-full" : "flex flex-col"}>
              <div className={previewWrapperClass}>
                {/* Raw traced SVG — compact preview (only when rawSvg exists) */}
                {rawSvg && (
                    <div className={`bg-white border border-slate-200 flex items-center justify-center p-3 relative overflow-hidden group/raw-compact ${sectionSquareClass}`} style={rawSectionStyle}>
                        <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                        <div className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider pointer-events-none z-10 opacity-0 group-hover/raw-compact:opacity-100 transition-opacity">
                            {t('svg.traceLabel')}
                        </div>
                        <div className="absolute bottom-1.5 right-1.5 flex gap-1.5 z-10 opacity-0 group-hover/raw-compact:opacity-100 transition-opacity">
                            {onOpenEditor && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenEditor('raw'); }}
                                    className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg"
                                    title="Editar SVG trazado"
                                >
                                    <Edit size={12} />
                                </button>
                            )}
                            <button
                                onClick={downloadRawSvg}
                                className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg"
                                title="Download raw SVG"
                            >
                                <Download size={12} />
                            </button>
                            <button
                                onClick={() => setConfirmingDelete('raw')}
                                className="p-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-full shadow-lg"
                                title={t('actions.delete')}
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                        {confirmingDelete === 'raw' && (
                            <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 gap-2">
                                <button
                                    onClick={() => {
                                        // Discard: keep the binary on the row
                                        // (for telemetry) but mark it invalid
                                        // and hide it locally. The App-level
                                        // onDiscardSvg handler sets
                                        // rawSvgDiscarded=true.
                                        if (rawSvg) onDiscardSvg?.('svg_raw', rawSvg);
                                        setRawSvg(null);
                                        setConfirmingDelete(null);
                                    }}
                                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded"
                                >
                                    {t('actions.delete')}
                                </button>
                                <button
                                    onClick={() => setConfirmingDelete(null)}
                                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold uppercase tracking-wider rounded"
                                >
                                    {t('actions.cancel')}
                                </button>
                            </div>
                        )}
                        <div
                            dangerouslySetInnerHTML={{ __html: injectSvgA11y(displayRawSvg, row.UTTERANCE) }}
                            className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                        />
                    </div>
                )}

                {/* Structured SVG — main preview */}
                <div className={`bg-white border border-slate-200 flex items-center justify-center p-4 relative overflow-hidden group/svg-preview ${sectionSquareClass}`} style={structuredSectionStyle}>
                    <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                    <div className="absolute top-2 left-2 bg-emerald-600 text-white text-xs px-2 py-1 rounded font-bold uppercase tracking-wider pointer-events-none z-10 opacity-0 group-hover/svg-preview:opacity-100 transition-opacity">
                        {t('svg.structureLabel')}
                    </div>
                    <div className="absolute bottom-2 right-2 flex gap-2 z-10 opacity-0 group-hover/svg-preview:opacity-100 transition-opacity">
                        {onOpenEditor && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenEditor('structured'); }}
                                className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg backdrop-blur-sm transition-all"
                                title="Editar SVG estructurado"
                            >
                                <Edit size={14} />
                            </button>
                        )}
                        <button
                            onClick={downloadStructuredSvg}
                            className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg backdrop-blur-sm transition-all"
                            title="Descargar SVG"
                        >
                            <Download size={14} />
                        </button>
                        <button
                            onClick={() => setConfirmingDelete('structured')}
                            className="p-2 bg-black/60 hover:bg-rose-600 text-white rounded-full shadow-lg backdrop-blur-sm transition-all"
                            title={t('actions.delete')}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                    {confirmingDelete === 'structured' && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 gap-2">
                            <button
                                onClick={() => {
                                    // Discard the structured SVG. Binary
                                    // stays on the row; the App-level
                                    // onDiscardSvg sets
                                    // structuredSvgDiscarded=true.
                                    if (row.structuredSvg) onDiscardSvg?.('svg_structured', row.structuredSvg);
                                    removeSVGByRowId(row.id);
                                    setConfirmingDelete(null);
                                    if (rawSvg) {
                                        setStatus('traced');
                                    } else {
                                        setStatus('idle');
                                    }
                                }}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded"
                            >
                                {t('actions.delete')}
                            </button>
                            <button
                                onClick={() => setConfirmingDelete(null)}
                                className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold uppercase tracking-wider rounded"
                            >
                                {t('actions.cancel')}
                            </button>
                        </div>
                    )}
                    <div
                        dangerouslySetInnerHTML={{ __html: injectSvgA11y(displaySvg, row.UTTERANCE, row.prompt) }}
                        className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                    />
                </div>
              </div>

                {isColumns ? (
                    /* Format step (focused view): per-column action rows */
                    <div className="flex gap-3 mt-3">
                        {/* Left column (trazado) actions */}
                        <div className="flex-1 flex gap-2">
                            {rawSvg && onOpenEditor && (
                                <button
                                    onClick={() => onOpenEditor('raw')}
                                    className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200 text-xs font-bold uppercase tracking-widest"
                                    title={t('svg.editor')}
                                >
                                    <Edit size={13} aria-hidden="true" /> {t('svg.editor')}
                                </button>
                            )}
                            {onOpenVectorizer && !!row.bitmap && !row.bitmapDiscarded && (
                                <button
                                    onClick={onOpenVectorizer}
                                    title={t('svg.retrace')}
                                    aria-label={t('svg.retrace')}
                                    className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-violet-50 text-slate-500 hover:text-violet-700 py-2 px-3 rounded transition-colors border border-slate-200 hover:border-violet-300 text-xs font-bold uppercase tracking-widest"
                                >
                                    <Scan size={13} aria-hidden="true" /> {t('svg.retrace')}
                                </button>
                            )}
                        </div>
                        {/* Right column (estructurado) actions */}
                        <div className="flex-1 flex gap-2 justify-end">
                            {onOpenEditor && (
                                <button
                                    onClick={() => onOpenEditor('structured')}
                                    className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200 text-xs font-bold uppercase tracking-widest"
                                    title={t('svg.editor')}
                                >
                                    <Edit size={13} aria-hidden="true" /> {t('svg.editor')}
                                </button>
                            )}
                            {row.rawSvg && !row.rawSvgDiscarded && (
                                <button
                                    onClick={() => {
                                        if (row.structuredSvg) {
                                            onDiscardSvg?.('svg_structured', row.structuredSvg);
                                        }
                                        removeSVGByRowId(row.id);
                                        setRawSvg(row.rawSvg!);
                                        handleFormat(row.rawSvg!);
                                    }}
                                    className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200 text-xs font-bold uppercase tracking-widest"
                                    title={t('svg.reStructureTooltip')}
                                >
                                    <Layers size={13} aria-hidden="true" /> {t('svg.reStructure')}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    /* Stacked mode (row list): single restructure button */
                    <div className="flex gap-2">
                        {row.rawSvg && !row.rawSvgDiscarded && (
                            <button
                                onClick={() => {
                                    if (row.structuredSvg) {
                                        onDiscardSvg?.('svg_structured', row.structuredSvg);
                                    }
                                    removeSVGByRowId(row.id);
                                    setRawSvg(row.rawSvg!);
                                    handleFormat(row.rawSvg!);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200 text-xs font-bold uppercase tracking-widest"
                                title={t('svg.reStructureTooltip')}
                            >
                                <Layers size={14} aria-hidden="true" /> {t('svg.reStructure')}
                            </button>
                        )}
                    </div>
                )}

            </div>
        );
    }

    // Show raw traced SVG with Format button
    if (status === 'traced' && rawSvg) {
        const isColumns = layout === 'columns';

        // Columns layout (format step in FocusViewModal): left = trazado, right = Estructurar CTA
        if (isColumns) {
            return (
                <div className="flex flex-col h-full">
                    <div className="flex-1 flex flex-row gap-3 min-h-0">
                        {/* Left column: trazado preview */}
                        <div className="flex-1 bg-white border border-slate-200 flex items-center justify-center p-4 relative overflow-hidden group/raw-preview" style={{ minHeight: 80 }}>
                            <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                            <div className="absolute top-2 right-2 bg-amber-500 text-white text-xs px-2 py-1 rounded font-bold uppercase tracking-wider pointer-events-none z-10 opacity-0 group-hover/raw-preview:opacity-100 transition-opacity">
                                {t('svg.traceLabel')}
                            </div>
                            <div className="absolute bottom-2 right-2 flex gap-2 z-10 opacity-0 group-hover/raw-preview:opacity-100 transition-opacity">
                                {onOpenEditor && (
                                    <button onClick={(e) => { e.stopPropagation(); onOpenEditor('raw'); }} className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg" title={t('svg.editor')}>
                                        <Edit size={14} />
                                    </button>
                                )}
                                <button onClick={downloadRawSvg} className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg" title={t('svg.download')}>
                                    <Download size={14} />
                                </button>
                            </div>
                            <div
                                dangerouslySetInnerHTML={{ __html: injectSvgA11y(displayRawSvg, row.UTTERANCE) }}
                                className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                            />
                        </div>
                        {/* Right column: Estructurar CTA */}
                        <div className="flex-1 bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center p-6 gap-3" style={{ minHeight: 80 }}>
                            {pendingMapping ? (
                                <Phase5ReviewPanel
                                    mapping={pendingMapping}
                                    onConfirm={(selectionOverrides, labelOverrides) => {
                                        setPendingMapping(null);
                                        const nluData = typeof row.NLU === 'object' ? row.NLU as NLUData : undefined;
                                        if (!nluData) { onLog('error', 'NLU no disponible para ensamblar'); return; }
                                        const assembled = assembleFromMapping(pendingMapping, {
                                            rawSvg: row.rawSvg!,
                                            nlu: nluData,
                                            elements: row.elements || [],
                                            utterance: row.UTTERANCE,
                                            config,
                                            onProgress: (msg) => onLog('info', msg),
                                        }, selectionOverrides, labelOverrides);
                                        if (assembled.success && assembled.svg) {
                                            addSVG({ id: row.id, utterance: row.UTTERANCE, svg: assembled.svg, createdAt: new Date().toISOString(), sourceRowId: row.id, lang: nluData.lang });
                                            onUpdate({ structuredSvg: assembled.svg, structuredSvgDiscarded: false });
                                            onLog('success', 'SVG estructurado ensamblado tras revisión');
                                        } else {
                                            onLog('error', assembled.error || 'Fallo en ensamblado tras revisión');
                                        }
                                    }}
                                />
                            ) : (
                                <>
                                    <Layers size={28} className="text-slate-300" aria-hidden="true" />
                                    <button
                                        onClick={() => handleFormat()}
                                        disabled={!structureEligibility.eligible}
                                        title={structureEligibility.eligible ? undefined : structureEligibility.reason}
                                        aria-label={t('svg.formatGemini')}
                                        className={`flex items-center justify-center gap-2 py-3 px-6 text-xs font-bold uppercase tracking-widest rounded transition-colors shadow-md ${structureEligibility.eligible ? 'bg-violet-600 hover:bg-violet-700 text-white hover:shadow-lg' : 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none'}`}
                                    >
                                        <Layers size={14} aria-hidden="true" /> {t('svg.formatGemini')}
                                    </button>
                                    <select
                                        value={phase5Model}
                                        onChange={e => onPhase5ModelChange?.(e.target.value)}
                                        className="text-xs text-slate-500 border border-slate-200 rounded px-2 py-1 bg-white hover:border-slate-300 cursor-pointer"
                                        title="Modelo para ESTRUCTURAR (sesión)"
                                    >
                                        {PHASE5_MODELS.map(m => (
                                            <option key={m.id} value={m.id}>{m.label}</option>
                                        ))}
                                    </select>
                                </>
                            )}
                        </div>
                    </div>
                    {/* Per-column action rows */}
                    <div className="flex gap-3 mt-3">
                        <div className="flex-1 flex gap-2">
                            {onOpenEditor && (
                                <button onClick={() => onOpenEditor('raw')} className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200 text-xs font-bold uppercase tracking-widest" title={t('svg.editor')}>
                                    <Edit size={13} aria-hidden="true" /> {t('svg.editor')}
                                </button>
                            )}
                            {onOpenVectorizer && !!row.bitmap && !row.bitmapDiscarded && (
                                <button onClick={onOpenVectorizer} title={t('svg.retrace')} aria-label={t('svg.retrace')} className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-violet-50 text-slate-500 hover:text-violet-700 py-2 px-3 rounded transition-colors border border-slate-200 hover:border-violet-300 text-xs font-bold uppercase tracking-widest">
                                    <Scan size={13} aria-hidden="true" /> {t('svg.retrace')}
                                </button>
                            )}
                        </div>
                        <div className="flex-1" />
                    </div>
                </div>
            );
        }

        return (
            <div className="flex flex-col">
                <div className="bg-white border border-slate-200 flex items-center justify-center p-4 relative mb-3 overflow-hidden group/raw-preview w-full aspect-square">
                    <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                    <div className="absolute top-2 right-2 bg-amber-500 text-white text-xs px-2 py-1 rounded font-bold uppercase tracking-wider pointer-events-none z-10 opacity-0 group-hover/raw-preview:opacity-100 transition-opacity">
                        {t('svg.traceLabel')}
                    </div>
                    {/* Download, Edit & Delete overlay — bottom on hover */}
                    <div className="absolute bottom-2 right-2 flex gap-2 z-10 opacity-0 group-hover/raw-preview:opacity-100 transition-opacity">
                        {onOpenEditor && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenEditor('raw'); }}
                                className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg"
                                title="Editar SVG trazado"
                            >
                                <Edit size={14} />
                            </button>
                        )}
                        <button
                            onClick={downloadRawSvg}
                            className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg"
                            title="Download raw SVG"
                        >
                            <Download size={14} />
                        </button>
                        <button
                            onClick={() => setConfirmingDelete('raw')}
                            className="p-2 bg-black/60 hover:bg-rose-600 text-white rounded-full shadow-lg"
                            title={t('actions.delete')}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                    {confirmingDelete === 'raw' && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 gap-2">
                            <button
                                onClick={() => {
                                    setRawSvg(null);
                                    onUpdate({ rawSvg: undefined });
                                    setConfirmingDelete(null);
                                    setStatus('idle');
                                }}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded"
                            >
                                {t('actions.delete')}
                            </button>
                            <button
                                onClick={() => setConfirmingDelete(null)}
                                className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold uppercase tracking-wider rounded"
                            >
                                {t('actions.cancel')}
                            </button>
                        </div>
                    )}
                    <div
                        dangerouslySetInnerHTML={{ __html: injectSvgA11y(displayRawSvg, row.UTTERANCE) }}
                        className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => handleFormat()}
                        disabled={!structureEligibility.eligible}
                        title={structureEligibility.eligible ? undefined : structureEligibility.reason}
                        aria-label={t('svg.formatGemini')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-xs font-bold uppercase tracking-widest rounded transition-colors shadow-md ${structureEligibility.eligible ? 'bg-violet-600 hover:bg-violet-700 text-white hover:shadow-lg' : 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-none'}`}
                    >
                        <Layers size={16} aria-hidden="true" /> {t('svg.formatGemini')}
                    </button>

                    {onOpenVectorizer && !!row.bitmap && !row.bitmapDiscarded && (
                        <button
                            onClick={onOpenVectorizer}
                            title={t('svg.retrace')}
                            aria-label={t('svg.retrace')}
                            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-violet-50 text-slate-500 hover:text-violet-700 py-2 px-3 rounded transition-colors border border-slate-200 hover:border-violet-300 text-xs"
                        >
                            <Scan size={13} aria-hidden="true" />
                        </button>
                    )}

                </div>

                <div className="mt-1 text-center text-xs text-slate-500">
                    {t('svg.traceDone')}
                </div>
            </div>
        );
    }

    // Structuring in progress — keep rawSvg visible with progress bar below
    if (status === 'structuring' && rawSvg) {
        return (
            <div className="flex flex-col">
                <div
                    className="bg-white border border-slate-200 flex items-center justify-center p-4 relative mb-3 overflow-hidden w-full aspect-square"
                >
                    <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none" />
                    <div className="absolute top-2 right-2 bg-amber-500 text-white text-xs px-2 py-1 rounded font-bold uppercase tracking-wider pointer-events-none z-10">
                        {t('svg.traceLabel')}
                    </div>
                    <div
                        dangerouslySetInnerHTML={{ __html: injectSvgA11y(displayRawSvg, row.UTTERANCE) }}
                        className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                    />
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-violet-600 animate-spin flex-none" />
                        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                            {t('svg.structuring')}
                        </p>
                        <div className="ml-auto flex items-center gap-2">
                            {onOpenEditor && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenEditor('raw'); }}
                                    className="p-1.5 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 rounded border border-slate-200 transition-colors"
                                    title="Editar SVG trazado"
                                >
                                    <Edit size={12} />
                                </button>
                            )}
                            <span className="text-xs font-mono text-violet-600 font-bold bg-violet-50 px-1.5 py-0.5 rounded">
                                {elapsedTime.toFixed(1)}s
                            </span>
                        </div>
                    </div>
                    <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                        <div
                            className="bg-violet-600 h-full rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${structureProgress}%` }}
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 truncate">
                        {subStatus || 'Aplicando esquema semántico con Gemini...'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 border border-dashed border-slate-300 rounded-lg bg-slate-50 hover:bg-white transition-colors group">
            {status === 'structuring' ? (
                <div className="text-center w-full">
                    <div className="mb-3 mx-auto w-8 h-8 rounded-full border-2 border-slate-200 border-t-violet-600 animate-spin"></div>
                    <p className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">
                        {t('svg.structuring')}
                    </p>
                    <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden mt-2">
                        <div
                            className="bg-violet-600 h-full transition-all duration-300 ease-out"
                            style={{ width: `${structureProgress}%` }}
                        ></div>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                        <p className="text-xs text-slate-500">
                            {subStatus || t('svg.structuring')}
                        </p>
                        <span className="text-xs font-mono text-violet-600 font-bold bg-violet-50 px-1.5 py-0.5 rounded">
                            {elapsedTime.toFixed(1)}s
                        </span>
                    </div>
                </div>
            ) : (
                <>
                    <FileCode size={32} className="text-slate-400 mb-3" />
                    <p className="text-xs text-slate-500 text-center max-w-[200px]">
                        {t('editor.noSvgRender')}
                    </p>
                    {error && (
                        <div className="mt-3 text-xs text-red-500 flex items-center gap-1 bg-red-50 px-2 py-1 rounded">
                            <AlertCircle size={10} aria-hidden="true" /> {error}
                        </div>
                    )}
                </>
            )}
        </div>

    );
};
