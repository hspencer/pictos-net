
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { Download, RefreshCw, AlertCircle, FileCode, Check } from 'lucide-react';
import { RowData, VisualElement, NLUData, EvaluationMetrics } from '../types';
import { vectorizeBitmap } from '../services/vtracerService';
import { structureSVG, canGenerateSVG } from '../services/svgStructureService';
import useSVGLibrary from '../hooks/useSVGLibrary';
import { GlobalConfig } from '../types';

import { generateStylesheet } from '../services/svgStructureService';

interface SVGGeneratorProps {
    row: RowData;
    config: GlobalConfig;
    onLog: (type: 'info' | 'error' | 'success', message: string) => void;
    onUpdate: (updates: Partial<RowData>) => void;
}

export const SVGGenerator: React.FC<SVGGeneratorProps> = ({ row, config, onLog, onUpdate }) => {
    const { t } = useTranslation();
    const { addSVG, getSVGByRowId, downloadSVG } = useSVGLibrary();
    const [status, setStatus] = useState<'idle' | 'vectorizing' | 'traced' | 'structuring' | 'completed' | 'error'>('idle');
    const [error, setError] = useState<string | undefined>();
    const [progress, setProgress] = useState(0);
    const [processStartTime, setProcessStartTime] = useState<number | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [subStatus, setSubStatus] = useState<string>('');
    const [rawSvg, setRawSvg] = useState<string | null>(row.rawSvg || null); // Load from row or null

    // Check if SVG already exists in library
    const existingSVG = getSVGByRowId(row.id);

    // Calculate eligibility (re-runs strictly when row updates)
    const eligibility = canGenerateSVG({
        bitmap: row.bitmap,
        NLU: row.NLU,
        elements: row.elements,
        evaluation: row.evaluation
    });

    // Dynamic Style Injection (Visual only)
    const displaySvg = React.useMemo(() => {
        if (!existingSVG) return '';
        const currentStyles = generateStylesheet(config);
        return existingSVG.svg
            .replace(/<style>[\s\S]*?<\/style>/i, `<style>${currentStyles}</style>`)
            .replace(/<g /g, '<g tabindex="0" style="cursor: pointer;" ');
    }, [existingSVG, config]);

    // Raw SVG with basic styling for visualization
    const displayRawSvg = React.useMemo(() => {
        if (!rawSvg) return '';

        try {
            // Parse SVG to DOM
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
            const svgEl = doc.querySelector('svg');

            if (!svgEl) return rawSvg;

            // Parse aspect ratio from config (e.g., '16:9' -> 16/9)
            const [widthRatio, heightRatio] = config.aspectRatio.split(':').map(Number);
            const targetAspectRatio = widthRatio / heightRatio;

            // Calculate bounding box from all paths
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            // Extract coordinates from transform attributes and path data
            const paths = svgEl.querySelectorAll('path');
            paths.forEach(path => {
                const transform = path.getAttribute('transform');
                const d = path.getAttribute('d');

                if (transform) {
                    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                    if (match) {
                        const tx = parseFloat(match[1]);
                        const ty = parseFloat(match[2]);
                        minX = Math.min(minX, tx);
                        minY = Math.min(minY, ty);
                        maxX = Math.max(maxX, tx);
                        maxY = Math.max(maxY, ty);
                    }
                }

                if (d) {
                    // Extract all numbers from path data
                    const coords = d.match(/-?\d+\.?\d*/g);
                    if (coords) {
                        coords.forEach(coord => {
                            const val = parseFloat(coord);
                            minX = Math.min(minX, val);
                            minY = Math.min(minY, val);
                            maxX = Math.max(maxX, val);
                            maxY = Math.max(maxY, val);
                        });
                    }
                }
            });

            // Calculate content dimensions
            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;
            const contentCenterX = (minX + maxX) / 2;
            const contentCenterY = (minY + maxY) / 2;

            // Add 5% padding around content
            const paddingFactor = 0.05;
            const paddedContentWidth = contentWidth * (1 + paddingFactor * 2);
            const paddedContentHeight = contentHeight * (1 + paddingFactor * 2);

            // Calculate viewBox dimensions that respect target aspect ratio
            // We want to fit the content within a box that has the target aspect ratio
            let viewBoxWidth, viewBoxHeight;

            const contentAspectRatio = paddedContentWidth / paddedContentHeight;

            if (contentAspectRatio > targetAspectRatio) {
                // Content is wider than target - fit by width
                viewBoxWidth = paddedContentWidth;
                viewBoxHeight = viewBoxWidth / targetAspectRatio;
            } else {
                // Content is taller than target - fit by height
                viewBoxHeight = paddedContentHeight;
                viewBoxWidth = viewBoxHeight * targetAspectRatio;
            }

            // Center the viewBox around the content center
            const viewBoxX = contentCenterX - viewBoxWidth / 2;
            const viewBoxY = contentCenterY - viewBoxHeight / 2;

            // Set viewBox and dimensions
            svgEl.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
            svgEl.setAttribute('width', '100%');
            svgEl.setAttribute('height', '100%');
            svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            // Apply fill and stroke to paths
            paths.forEach(path => {
                if (!path.getAttribute('fill') || path.getAttribute('fill') === '#000000') {
                    path.setAttribute('fill', '#000');
                }
                if (!path.getAttribute('stroke')) {
                    path.setAttribute('stroke', 'none');
                }
            });

            return new XMLSerializer().serializeToString(svgEl);
        } catch (error) {
            console.error('Error processing raw SVG:', error);
            return rawSvg;
        }
    }, [rawSvg, config.aspectRatio]);

    // Download raw SVG
    const downloadRawSvg = () => {
        if (!rawSvg) return;
        const blob = new Blob([rawSvg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${row.UTTERANCE.replace(/\s+/g, '_').substring(0, 30)}_raw.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Handle SVG interaction (Block Editing)
    const handleSvgInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!existingSVG) return;

        const target = e.target as Element;
        const group = target.closest('g[role="group"]') || target.closest('[class*=""]');

        if (group) {
            e.preventDefault();
            e.stopPropagation();

            // Get all available classes from config
            const availableClasses = Object.keys(config.svgStyles || { f: {}, k: {} });

            // Find current class
            let currentClassIndex = -1;
            for (let i = 0; i < availableClasses.length; i++) {
                if (group.classList.contains(availableClasses[i])) {
                    currentClassIndex = i;
                    break;
                }
            }

            // Remove current class and add next one (cycle through)
            if (currentClassIndex >= 0) {
                group.classList.remove(availableClasses[currentClassIndex]);
            }
            const nextIndex = (currentClassIndex + 1) % availableClasses.length;
            group.classList.add(availableClasses[nextIndex]);

            const svgRoot = e.currentTarget.querySelector('svg');
            if (svgRoot) {
                const s = new XMLSerializer();
                const newSvgContent = s.serializeToString(svgRoot);

                addSVG({
                    ...existingSVG,
                    svg: newSvgContent
                });
            }
        }
    };



    // Timer Effect
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if ((status === 'vectorizing' || status === 'structuring') && processStartTime) {
            interval = setInterval(() => {
                setElapsedTime((Date.now() - processStartTime) / 1000);
            }, 100);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [status, processStartTime]);

    // Debugging: Monitor row updates and eligibility
    useEffect(() => {
        if (row.evaluation) {
            const avg = (
                row.evaluation.clarity +
                row.evaluation.recognizability +
                row.evaluation.semantic_transparency +
                row.evaluation.pragmatic_fit +
                row.evaluation.cultural_adequacy +
                row.evaluation.cognitive_accessibility
            ) / 6;

            console.log('[SVGGenerator] Evaluation Updated:', {
                id: row.id,
                avg: avg.toFixed(2),
                eligible: eligibility.eligible,
                reason: eligibility.reason
            });
        }
    }, [row.evaluation, eligibility]);

    useEffect(() => {
        if (existingSVG) {
            setStatus('completed');
        } else {
            // Reset status if we switched rows or deleted SVG
            setStatus('idle');
        }
    }, [existingSVG, row.id]);

    // Sync rawSvg state when row changes
    useEffect(() => {
        if (row.rawSvg && !rawSvg) {
            setRawSvg(row.rawSvg);
            setStatus('traced');
        }
    }, [row.id, row.rawSvg]);

    const handleTrace = async () => {
        if (!eligibility.eligible || !row.bitmap) return;

        try {
            setError(undefined);
            const startTime = performance.now();
            setProcessStartTime(Date.now());
            setElapsedTime(0);

            onLog('info', `Iniciando vectorización para: ${row.UTTERANCE}`);

            // Step 1: Vectorize
            setStatus('vectorizing');
            setSubStatus('Vectorizando bitmap (vtracer)...');
            setProgress(0);
            await new Promise(r => setTimeout(r, 600)); // UX Delay

            const vStart = performance.now();
            const tracedSvg = await vectorizeBitmap(
                row.bitmap.replace(/^data:image\/\w+;base64,/, ""),
                {},
                (p) => setProgress(p)
            );
            const vEnd = performance.now();
            onLog('success', `Vectorización completada en ${((vEnd - vStart) / 1000).toFixed(2)}s`);

            // Store raw SVG in local state and persist to row
            setRawSvg(tracedSvg);
            onUpdate({ rawSvg: tracedSvg });
            setStatus('traced');
            setProcessStartTime(null);
            setElapsedTime(0);

        } catch (err) {
            console.error(err);
            setStatus('error');
            const msg = err instanceof Error ? err.message : "Unknown error";
            setError(msg);
            onLog('error', `Fallo en vectorización: ${msg}`);
        }
    };

    const handleFormat = async () => {
        if (!rawSvg) return;

        try {
            setError(undefined);
            const startTime = performance.now();
            setProcessStartTime(Date.now());
            setElapsedTime(0);

            // Step 2: Structure with Gemini
            setStatus('structuring');
            setSubStatus('Preparando prompt semántico...');
            setProgress(0);
            await new Promise(r => setTimeout(r, 600)); // UX Delay

            const nluData = typeof row.NLU === 'object' ? row.NLU as NLUData : undefined;
            if (!nluData) throw new Error("Invalid NLU data");

            onLog('info', `Estructurando SVG semántico con referencia visual...`);
            const sStart = performance.now();
            const result = await structureSVG({
                rawSvg,
                bitmap: row.bitmap || '', // Pass original bitmap as visual reference
                nlu: nluData,
                elements: row.elements || [],
                evaluation: row.evaluation || {} as EvaluationMetrics,
                utterance: row.UTTERANCE,
                config,
                onProgress: (msg) => onLog('info', msg),
                onStatus: (s) => {
                    switch (s) {
                        case 'sending': setSubStatus('Enviando imagen + SVG a Gemini...'); break;
                        case 'receiving': setSubStatus('Recibiendo estructura semántica...'); break;
                        case 'sanitizing': setSubStatus('Sanitizando y aplicando estilos...'); break;
                        default: setSubStatus(s);
                    }
                }
            });

            const sEnd = performance.now();

            if (!result.success || !result.svg) {
                throw new Error(result.error || "Failed to structure SVG");
            }
            onLog('success', `Estructuración completada en ${((sEnd - sStart) / 1000).toFixed(2)}s`);

            // Step 3: Save to library and persist to row
            addSVG({
                id: row.id, // Use row ID as SVG ID to maintain 1:1 relationship
                utterance: row.UTTERANCE,
                svg: result.svg,
                createdAt: new Date().toISOString(),
                sourceRowId: row.id,
                icapScore: row.evaluation ?
                    (row.evaluation.clarity + row.evaluation.recognizability + row.evaluation.semantic_transparency +
                        row.evaluation.pragmatic_fit + row.evaluation.cultural_adequacy + row.evaluation.cognitive_accessibility) / 6
                    : 0,
                lang: nluData.lang
            });

            // Persist structured SVG to row
            onUpdate({ structuredSvg: result.svg });

            setStatus('completed');
            setRawSvg(null); // Clear local raw SVG state
            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            onLog('success', `Proceso SVG finalizado. Tiempo total: ${totalTime}s`);

        } catch (err) {
            console.error(err);
            setStatus('error');
            const msg = err instanceof Error ? err.message : "Unknown error";
            setError(msg);
            onLog('error', `Fallo SVG: ${msg}`);
        }
    };

    if (!eligibility.eligible) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 bg-slate-50 border border-slate-100 rounded text-center opacity-75">
                <AlertCircle size={24} className="text-slate-300 mb-2" />
                <p className="text-xs text-slate-400 font-medium mb-1">SVG Generation Unavailable</p>
                <p className="text-[10px] text-slate-400 font-mono">
                    {eligibility.reason || "Requirements not met"}
                </p>
            </div>
        );
    }

    if (status === 'completed' && existingSVG) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 bg-white border border-slate-200 flex items-center justify-center p-4 relative mb-3 overflow-hidden group/svg-preview">
                    <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover/svg-preview:opacity-100 transition-opacity bg-black/70 text-white text-[10px] px-2 py-1 rounded pointer-events-none z-10 font-medium">
                        Click parts to cycle through styles
                    </div>
                    <div
                        dangerouslySetInnerHTML={{ __html: displaySvg }}
                        onClick={handleSvgInteraction}
                        className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full cursor-pointer"
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => downloadSVG(existingSVG.id)}
                        className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 px-4 text-[10px] font-bold uppercase tracking-widest rounded transition-colors"
                    >
                        <Download size={14} /> SVG
                    </button>

                    <button
                        onClick={handleTrace}
                        title="Regenerate SVG"
                        className="flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>

                <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-emerald-600 font-medium">
                    <Check size={12} /> mf-svg-schema compliant
                </div>
            </div>
        );
    }

    // New: Show raw traced SVG with Format button
    if (status === 'traced' && rawSvg) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 bg-white border border-slate-200 flex items-center justify-center p-4 relative mb-3 overflow-hidden">
                    <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                    <div className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider">
                        Raw Trace
                    </div>
                    <div
                        dangerouslySetInnerHTML={{ __html: displayRawSvg }}
                        className="w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleFormat}
                        className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white py-3 px-4 text-xs font-bold uppercase tracking-widest rounded transition-colors shadow-md hover:shadow-lg"
                    >
                        <FileCode size={16} /> Format with Gemini
                    </button>

                    <button
                        onClick={downloadRawSvg}
                        title="Download raw SVG"
                        className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 px-3 rounded transition-colors border border-slate-200"
                    >
                        <Download size={14} />
                    </button>

                    <button
                        onClick={handleTrace}
                        title="Re-trace bitmap"
                        className="flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 py-2 px-3 rounded transition-colors border border-slate-200"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>

                <div className="mt-2 text-center text-[10px] text-slate-500">
                    Raw vectorization complete. Click <strong>Format</strong> to apply semantic structure.
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 border border-dashed border-slate-300 rounded-lg bg-slate-50 hover:bg-white transition-colors group">
            {(status === 'vectorizing' || status === 'structuring') ? (
                <div className="text-center w-full">
                    <div className="mb-3 mx-auto w-8 h-8 rounded-full border-2 border-slate-200 border-t-violet-600 animate-spin"></div>
                    <p className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-1">
                        {status === 'vectorizing' ? 'Vectorizing...' : 'Structuring...'}
                    </p>
                    <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden mt-2">
                        <div
                            className="bg-violet-600 h-full transition-all duration-300 ease-out"
                            style={{ width: status === 'vectorizing' ? `${progress}%` : '90%' }}
                        ></div>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                        <p className="text-[10px] text-slate-400">
                            {subStatus || (status === 'structuring' ? 'Applying semantic schema with Gemini...' : 'Tracing bitmap paths...')}
                        </p>
                        <span className="text-[10px] font-mono text-violet-600 font-bold bg-violet-50 px-1.5 py-0.5 rounded">
                            {elapsedTime.toFixed(1)}s
                        </span>
                    </div>
                </div>
            ) : (
                <>
                    <FileCode size={32} className="text-slate-300 group-hover:text-violet-500 mb-3 transition-colors" />
                    <button
                        onClick={handleTrace}
                        className="bg-white border-2 border-violet-100 group-hover:border-violet-600 text-violet-900 group-hover:text-violet-700 px-6 py-2 font-bold uppercase text-xs tracking-widest transition-all shadow-sm group-hover:shadow-md rounded-full"
                    >
                        Trace SVG
                    </button>
                    <p className="text-[10px] text-slate-400 mt-3 text-center max-w-[200px]">
                        Converts bitmap to semantic SVG using vtracer and Gemini Pro
                    </p>
                    {error && (
                        <div className="mt-3 text-[10px] text-red-500 flex items-center gap-1 bg-red-50 px-2 py-1 rounded">
                            <AlertCircle size={10} /> {error}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
