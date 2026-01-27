
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
}

export const SVGGenerator: React.FC<SVGGeneratorProps> = ({ row, config, onLog }) => {
    const { t } = useTranslation();
    const { addSVG, getSVGByRowId, downloadSVG } = useSVGLibrary();
    const [status, setStatus] = useState<'idle' | 'vectorizing' | 'structuring' | 'completed' | 'error'>('idle');
    const [error, setError] = useState<string | undefined>();
    const [progress, setProgress] = useState(0);
    const [processStartTime, setProcessStartTime] = useState<number | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);

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

    // Handle SVG interaction (Block Editing)
    const handleSvgInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!existingSVG) return;

        const target = e.target as Element;
        const group = target.closest('g[role="group"]') || target.closest('.f, .k');

        if (group) {
            e.preventDefault();
            e.stopPropagation();

            const isF = group.classList.contains('f');
            const isK = group.classList.contains('k');

            if (isF) {
                group.classList.remove('f');
                group.classList.add('k');
            } else if (isK) {
                group.classList.remove('k');
                group.classList.add('f');
            } else {
                group.classList.add('f');
            }

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
                row.evaluation.semantics +
                row.evaluation.syntactics +
                row.evaluation.pragmatics +
                row.evaluation.clarity +
                row.evaluation.universality +
                row.evaluation.aesthetics
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

    const handleGenerate = async () => {
        if (!eligibility.eligible || !row.bitmap) return;

        try {
            setError(undefined);
            const startTime = performance.now();
            setProcessStartTime(Date.now());
            setElapsedTime(0);

            onLog('info', `Iniciando vectorización para: ${row.UTTERANCE}`);

            // Step 1: Vectorize
            setStatus('vectorizing');
            setProgress(0);

            const vStart = performance.now();
            const rawSvg = await vectorizeBitmap(
                row.bitmap.replace(/^data:image\/\w+;base64,/, ""),
                {},
                (p) => setProgress(p)
            );
            const vEnd = performance.now();
            onLog('success', `Vectorización completada en ${((vEnd - vStart) / 1000).toFixed(2)}s`);

            // Step 2: Structure with Gemini
            setStatus('structuring');
            setProgress(0); // Reset for next stage

            const nluData = typeof row.NLU === 'object' ? row.NLU as NLUData : undefined;
            if (!nluData) throw new Error("Invalid NLU data");

            onLog('info', `Estructurando SVG semántico...`);
            const sStart = performance.now();
            const result = await structureSVG({
                rawSvg,
                nlu: nluData,
                elements: row.elements || [],
                evaluation: row.evaluation || {} as EvaluationMetrics,
                utterance: row.UTTERANCE,
                config
            });
            const sEnd = performance.now();

            if (!result.success || !result.svg) {
                throw new Error(result.error || "Failed to structure SVG");
            }
            onLog('success', `Estructuración completada en ${((sEnd - sStart) / 1000).toFixed(2)}s`);

            // Step 3: Save to library
            addSVG({
                id: row.id, // Use row ID as SVG ID to maintain 1:1 relationship
                utterance: row.UTTERANCE,
                svg: result.svg,
                createdAt: new Date().toISOString(),
                sourceRowId: row.id,
                vcsciScore: row.evaluation ?
                    (row.evaluation.semantics + row.evaluation.syntactics + row.evaluation.pragmatics +
                        row.evaluation.clarity + row.evaluation.universality + row.evaluation.aesthetics) / 6
                    : 0,
                lang: nluData.lang
            });

            setStatus('completed');
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
                        Click parts to toggle style (.f/.k)
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
                        onClick={handleGenerate}
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
                            {status === 'structuring' ? 'Applying semantic schema with Gemini...' : 'Tracing bitmap paths...'}
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
                        onClick={handleGenerate}
                        className="bg-white border-2 border-violet-100 group-hover:border-violet-600 text-violet-900 group-hover:text-violet-700 px-6 py-2 font-bold uppercase text-xs tracking-widest transition-all shadow-sm group-hover:shadow-md rounded-full"
                    >
                        Generate SVG
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
