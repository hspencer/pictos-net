import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download, Check, AlertTriangle, Loader2, ChevronDown, ChevronRight, Scan } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import {
    traceInteractive,
    drawBitmapToCanvas,
    preloadWasm,
    DEFAULT_CONFIG,
    PRESETS,
    type VectorizerConfig,
    type VectorizerResult,
} from '../services/vtracerService';
import { parsePathToNodes } from '../utils/pathParser';
import { useTranslation } from '../hooks/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VectorizerModalProps {
    isOpen: boolean;
    bitmap: string;
    utterance: string;
    initialConfig?: Partial<VectorizerConfig>;
    onClose: () => void;
    onApply: (result: VectorizerResult) => void;
}

type TraceState = 'idle' | 'tracing' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CANVAS_ID = 'vtracer-canvas';

function downloadSvgBlob(svg: string, filename: string) {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function sanitizeName(s: string) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * Parse a CSS/SVG transform string and extract the cumulative translate offset.
 * Handles: translate(x,y), translate(x), matrix(a,b,c,d,e,f)
 */
function getTranslateOffset(el: Element): { tx: number; ty: number } {
    let tx = 0, ty = 0;
    let current: Element | null = el;
    while (current && current.tagName !== 'svg') {
        const tf = current.getAttribute('transform');
        if (tf) {
            // translate(x, y) or translate(x)
            const trMatch = tf.match(/translate\(\s*([-\d.e]+)[\s,]*([-\d.e]*)?\s*\)/);
            if (trMatch) {
                tx += parseFloat(trMatch[1]) || 0;
                ty += parseFloat(trMatch[2]) || 0;
            }
            // matrix(a,b,c,d,e,f) — e,f are the translate components
            const mMatch = tf.match(/matrix\(\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/);
            if (mMatch) {
                tx += parseFloat(mMatch[5]) || 0;
                ty += parseFloat(mMatch[6]) || 0;
            }
        }
        current = current.parentElement;
    }
    return { tx, ty };
}

/**
 * Inject red vertex circles into the SVG using DOM parsing.
 * Accounts for transform attributes on path elements and their ancestors.
 */
function injectVertexOverlay(svgHtml: string): string {
    const doc = new DOMParser().parseFromString(svgHtml, 'image/svg+xml');
    const svgEl = doc.documentElement;

    // Determine dot size from viewBox
    const vb = svgEl.getAttribute('viewBox');
    if (!vb) return svgHtml;
    const [, , vbW, vbH] = vb.split(/\s+/).map(Number);
    const r = Math.max(vbW || 1, vbH || 1) * 0.004;
    const sw = r * 0.4;

    const paths = svgEl.querySelectorAll('path');
    if (paths.length === 0) return svgHtml;

    const NS = 'http://www.w3.org/2000/svg';

    // Collect circles in a fragment so they render on top of all paths
    const overlay = doc.createElementNS(NS, 'g');
    overlay.setAttribute('data-vertex-overlay', '1');

    paths.forEach(path => {
        const d = path.getAttribute('d');
        if (!d) return;

        // Accumulate translate transforms from the path and its ancestors
        const { tx, ty } = getTranslateOffset(path);

        const nodes = parsePathToNodes(d);
        for (const node of nodes) {
            if (node.kind === 'anchor-close') continue;
            const circle = doc.createElementNS(NS, 'circle');
            circle.setAttribute('data-vertex', '1');
            circle.setAttribute('cx', String(node.anchor.x + tx));
            circle.setAttribute('cy', String(node.anchor.y + ty));
            circle.setAttribute('r', String(r));
            circle.setAttribute('fill', '#ef4444');
            circle.setAttribute('stroke', '#fff');
            circle.setAttribute('stroke-width', String(sw));
            overlay.appendChild(circle);
        }
    });

    svgEl.appendChild(overlay);
    return new XMLSerializer().serializeToString(doc);
}

// ---------------------------------------------------------------------------
// LabeledSlider
// ---------------------------------------------------------------------------

interface LabeledSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    leftLabel: string;
    rightLabel: string;
    debugValue?: boolean;
    onChange: (v: number) => void;
    disabled?: boolean;
}

function LabeledSlider({
    label, value, min, max, step, leftLabel, rightLabel, debugValue = true, onChange, disabled
}: LabeledSliderProps) {
    return (
        <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{label}</p>
                {debugValue && (
                    <span className="text-xs font-mono text-slate-500">{value}</span>
                )}
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ accentColor: '#7c3aed', backgroundColor: '#e2e8f0' }}
            />
            <div className="flex justify-between mt-1">
                <span className="text-xs text-slate-500">{leftLabel}</span>
                <span className="text-xs text-slate-500">{rightLabel}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SegmentGroup
// ---------------------------------------------------------------------------

interface SegmentGroupProps<T extends string> {
    label: string;
    value: T;
    options: { label: string; value: T; title?: string }[];
    onChange: (v: T) => void;
    disabled?: boolean;
}

function SegmentGroup<T extends string>({
    label, value, options, onChange, disabled
}: SegmentGroupProps<T>) {
    const { t } = useTranslation();
    return (
        <div className="mb-4">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
            <div className="flex rounded overflow-hidden border border-slate-200 text-xs">
                {options.map((opt, i) => (
                    <button
                        key={String(opt.value)}
                        disabled={disabled}
                        title={opt.title}
                        onClick={() => onChange(opt.value)}
                        className={`flex-1 px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium
                            ${i > 0 ? 'border-l border-slate-200' : ''}
                            ${value === opt.value
                                ? 'bg-violet-600 text-white'
                                : 'bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// PresetChips
// ---------------------------------------------------------------------------

const PRESET_LABELS: { key: string; label: string }[] = [
    { key: 'bw', label: 'B&W' },
    { key: 'pictogram', label: 'Pictogram' },
    { key: 'poster', label: 'Poster' },
    { key: 'photo', label: 'Photo' },
];

function PresetChips({
    onSelect, disabled
}: { onSelect: (config: Partial<VectorizerConfig>) => void; disabled?: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="mb-4">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500 mb-1.5">{t('vectorizer.presets')}</p>
            <div className="flex flex-wrap gap-1.5">
                {PRESET_LABELS.map(({ key, label }) => (
                    <button
                        key={key}
                        disabled={disabled}
                        onClick={() => onSelect(PRESETS[key])}
                        className="px-3 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-600 rounded hover:border-violet-300 hover:text-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t(`vectorizer.${key}` as any, { defaultValue: label })}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const VectorizerModal: React.FC<VectorizerModalProps> = ({
    isOpen,
    bitmap,
    utterance,
    initialConfig,
    onClose,
    onApply,
}) => {
    const { t } = useTranslation();
    const { dialogProps } = useDialogA11y({ isOpen, onClose, label: `Vectorizer — ${utterance}` });

    const [config, setConfig] = useState<VectorizerConfig>({
        ...DEFAULT_CONFIG,
        ...initialConfig,
    });
    const [traceState, setTraceState] = useState<TraceState>('idle');
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<VectorizerResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
    const [canvasReady, setCanvasReady] = useState(false);
    const [resultSvgHtml, setResultSvgHtml] = useState('');
    const [outlinePreview, setOutlinePreview] = useState(false);

    const isMounted = useRef(false);
    const rafRef = useRef<number | null>(null);
    const pendingProgress = useRef<number>(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeTraceRef = useRef<Promise<void> | null>(null);

    // Hidden SVG element for WASM to write paths into (outside React's control)
    const HIDDEN_SVG_ID = 'vtracer-svg-hidden';

    const updateConfig = useCallback((partial: Partial<VectorizerConfig>) => {
        setConfig(prev => ({ ...prev, ...partial }));
    }, []);

    // Preload WASM and prepare canvas on open
    useEffect(() => {
        isMounted.current = true;
        if (!isOpen) return;

        setConfig({ ...DEFAULT_CONFIG, ...initialConfig });
        setTraceState('idle');
        setResult(null);
        setErrorMsg('');
        setCanvasReady(false);
        setResultSvgHtml('');

        // Preload WASM while image loads
        preloadWasm();

        // Create hidden SVG container for WASM (outside React's control)
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
        const hiddenSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        hiddenSvg.id = HIDDEN_SVG_ID;
        hiddenSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        hiddenContainer.appendChild(hiddenSvg);
        document.body.appendChild(hiddenContainer);

        // Draw bitmap to canvas after DOM is ready
        const timer = setTimeout(async () => {
            try {
                const dims = await drawBitmapToCanvas(bitmap, CANVAS_ID);
                if (!isMounted.current) return;
                setImageDims(dims);
                // Only set viewBox; the WASM reads canvas.width/height (not svg.width/height)
                // to determine coordinate space. Leaving explicit width/height off the svg
                // lets CSS size it freely in the preview without a 1024px intrinsic lock.
                hiddenSvg.setAttribute('viewBox', `0 0 ${dims.width} ${dims.height}`);
                console.debug('[VectorizerModal] canvas dims:', dims.width, 'x', dims.height);
                setCanvasReady(true);
            } catch (err) {
                console.error('[VectorizerModal] Failed to draw bitmap:', err);
            }
        }, 50);

        return () => {
            isMounted.current = false;
            clearTimeout(timer);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            if (debounceRef.current !== null) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
            // Abort any in-progress trace so its converter is freed
            if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
            }
            // Remove hidden SVG container
            try { document.body.removeChild(hiddenContainer); } catch { /* already removed */ }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Auto-retrace whenever config changes (debounced)
    useEffect(() => {
        if (!canvasReady || !isOpen) return;
        if (debounceRef.current !== null) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            runTrace(config);
        }, 500);
        return () => {
            if (debounceRef.current !== null) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, canvasReady]);

    const runTrace = useCallback(async (cfg: VectorizerConfig) => {
        if (!isMounted.current) return;

        // Abort any in-progress trace and wait for its converter to be freed
        if (abortRef.current) {
            abortRef.current.abort();
        }
        if (activeTraceRef.current) {
            await activeTraceRef.current.catch(() => {});
        }

        const controller = new AbortController();
        abortRef.current = controller;

        setTraceState('tracing');
        setProgress(0);
        setErrorMsg('');
        setResultSvgHtml('');

        // Clear previous paths from the hidden SVG (viewBox attribute is preserved)
        const hiddenSvg = document.getElementById(HIDDEN_SVG_ID);
        if (hiddenSvg) {
            while (hiddenSvg.firstChild) hiddenSvg.removeChild(hiddenSvg.firstChild);
        }

        // Canvas already has valid pixel data from the initial draw.
        // Do NOT call drawBitmapToCanvas here — it resets canvas.width which
        // clears pixel data; if the subsequent image reload fails the WASM
        // reads an empty canvas and produces 0 paths.

        if (controller.signal.aborted) return;

        const tracePromise = (async () => {
            try {
                await traceInteractive(
                    CANVAS_ID,
                    HIDDEN_SVG_ID,
                    cfg,
                    (p) => {
                        pendingProgress.current = p;
                        if (rafRef.current === null) {
                            rafRef.current = requestAnimationFrame(() => {
                                rafRef.current = null;
                                if (isMounted.current) setProgress(pendingProgress.current);
                            });
                        }
                    },
                    controller.signal,
                );
                if (!isMounted.current || controller.signal.aborted) return;

                // Re-enforce viewBox from the actual canvas pixel dimensions. The WASM
                // writes paths in canvas pixel coordinates, so the viewBox must match
                // canvas.width / canvas.height exactly. We restore it here in case the
                // initial value was stale (dims state vs real canvas) or the WASM touched
                // any attribute on the SVG element.
                const canvasEl = document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
                if (hiddenSvg && canvasEl) {
                    const cw = canvasEl.width;
                    const ch = canvasEl.height;
                    hiddenSvg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
                    // Remove explicit width/height attrs so CSS can freely size the SVG
                    // without being clamped by a 1024px intrinsic size in flex layout.
                    hiddenSvg.removeAttribute('width');
                    hiddenSvg.removeAttribute('height');
                    console.debug('[VectorizerModal] post-trace viewBox enforced:', `0 0 ${cw} ${ch}`);
                }

                // Serialize the hidden SVG and store for display
                const svg = hiddenSvg ? new XMLSerializer().serializeToString(hiddenSvg) : '';
                const pathCount = hiddenSvg?.querySelectorAll('path').length ?? 0;
                setResultSvgHtml(svg);

                const res: VectorizerResult = {
                    svg,
                    warnings: [],
                    layersTraced: pathCount,
                    layersTotal: pathCount,
                    tiersUsed: 1,
                    usedConfig: cfg,
                };
                setResult(res);
                setTraceState('done');
            } catch (err) {
                if (!isMounted.current || controller.signal.aborted) return;
                if (err instanceof DOMException && err.name === 'AbortError') return;
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[vtracer] Trace failed:', msg);
                setErrorMsg(msg);
                setTraceState('error');
            }
        })();

        activeTraceRef.current = tracePromise;
        await tracePromise;
    }, []);

    const handleApply = () => {
        if (result) { onApply(result); onClose(); }
    };

    const handleDownload = () => {
        if (result?.svg) downloadSvgBlob(result.svg, `${sanitizeName(utterance)}_vectorized.svg`);
    };

    const handlePreset = (preset: Partial<VectorizerConfig>) => {
        setConfig({ ...DEFAULT_CONFIG, ...preset });
    };

    const isTracing = traceState === 'tracing';
    const mode = config.mode ?? 'spline';
    const colorMode = config.colorMode ?? 'color';

    if (!isOpen) return null;

    return (
        <div
            id="vectorizer-modal"
            className="fixed inset-0 z-[50] flex flex-col bg-white animate-in fade-in duration-150"
            {...dialogProps}
        >
            {/* Header */}
            <header className="flex items-center justify-between px-6 h-14 border-b border-slate-200 shrink-0 bg-white">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-slate-900 font-bold text-sm uppercase tracking-widest">{t('vectorizer.title')}</span>
                    <span className="text-slate-500 text-sm truncate">— "{utterance}"</span>
                    {traceState === 'done' && result && (
                        <span className="text-xs font-mono text-slate-500 ml-2">
                            {result.layersTraced} paths
                            {resultSvgHtml && ` · ${(new Blob([resultSvgHtml]).size / 1024).toFixed(0)} KB`}
                            {result.tiersUsed > 1 && ` · tier ${result.tiersUsed}`}
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                    title="Close"
                    aria-label="Close"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            </header>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">

                {/* Left: Controls */}
                <div
                    id="vectorizer-controls"
                    className="w-72 shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col overflow-y-auto"
                >
                    <div className="flex-1 p-5">

                        {/* Presets */}
                        <PresetChips onSelect={handlePreset} disabled={isTracing} />

                        {/* Curve mode */}
                        <SegmentGroup
                            label={t('vectorizer.curveMode')}
                            value={mode as 'polygon' | 'spline'}
                            disabled={isTracing}
                            options={[
                                { label: t('vectorizer.polygon'), value: 'polygon' as const, title: 'Sharp corners, geometric shapes' },
                                { label: t('vectorizer.spline'), value: 'spline' as const, title: 'Smooth curves' },
                            ]}
                            onChange={v => updateConfig({ mode: v })}
                        />

                        {/* Color mode */}
                        <SegmentGroup
                            label={t('vectorizer.colorMode')}
                            value={colorMode as 'color' | 'bw'}
                            disabled={isTracing}
                            options={[
                                { label: t('vectorizer.color'), value: 'color' as const, title: 'Multi-color hierarchical clustering' },
                                { label: t('vectorizer.bw'), value: 'bw' as const, title: 'Single black binary trace' },
                            ]}
                            onChange={v => updateConfig({ colorMode: v })}
                        />

                        {/* Color-specific params */}
                        {colorMode === 'color' && (
                            <>
                                <SegmentGroup
                                    label={t('vectorizer.hierarchical')}
                                    value={(config.hierarchical ?? 'stacked') as 'stacked' | 'cutout'}
                                    disabled={isTracing}
                                    options={[
                                        { label: t('vectorizer.stacked'), value: 'stacked' as const, title: 'Layered overlapping shapes' },
                                        { label: t('vectorizer.cutout'), value: 'cutout' as const, title: 'Non-overlapping shapes' },
                                    ]}
                                    onChange={v => updateConfig({ hierarchical: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.colorPrecision')}
                                    value={config.colorPrecision ?? 6}
                                    min={1} max={8} step={1}
                                    leftLabel={t('vectorizer.fewerColors')}
                                    rightLabel={t('vectorizer.moreColors')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ colorPrecision: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.layerDifference')}
                                    value={config.layerDifference ?? 16}
                                    min={0} max={128} step={4}
                                    leftLabel={t('vectorizer.moreLayers')}
                                    rightLabel={t('vectorizer.fewerLayers')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ layerDifference: v })}
                                />
                            </>
                        )}

                        {/* Advanced (collapsible) */}
                        <button
                            onClick={() => setAdvancedOpen(v => !v)}
                            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-slate-500 hover:text-slate-600 transition-colors mt-1 mb-3 w-full"
                        >
                            {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {t('vectorizer.advanced')}
                        </button>

                        {advancedOpen && (
                            <div className="border-t border-slate-200 pt-4">
                                <LabeledSlider
                                    label={t('vectorizer.noiseRemoval')}
                                    value={config.filterSpeckle ?? 4}
                                    min={0} max={16} step={1}
                                    leftLabel={t('vectorizer.keepDetail')}
                                    rightLabel={t('vectorizer.removeSpecks')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ filterSpeckle: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.cornerSharpness')}
                                    value={config.cornerThreshold ?? 60}
                                    min={10} max={180} step={5}
                                    leftLabel={t('vectorizer.smooth')}
                                    rightLabel={t('vectorizer.sharpCorners')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ cornerThreshold: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.pathDetail')}
                                    value={config.lengthThreshold ?? 4}
                                    min={1} max={10} step={0.5}
                                    leftLabel={t('vectorizer.moreDetail')}
                                    rightLabel={t('vectorizer.simplified')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ lengthThreshold: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.pathJoining')}
                                    value={config.spliceThreshold ?? 45}
                                    min={10} max={90} step={5}
                                    leftLabel={t('vectorizer.keepSeparate')}
                                    rightLabel={t('vectorizer.joinPaths')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ spliceThreshold: v })}
                                />
                                <LabeledSlider
                                    label={t('vectorizer.coordinatePrecision')}
                                    value={config.pathPrecision ?? 8}
                                    min={1} max={8} step={1}
                                    leftLabel={t('vectorizer.compact')}
                                    rightLabel={t('vectorizer.precise')}
                                    disabled={isTracing}
                                    onChange={v => updateConfig({ pathPrecision: v })}
                                />
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="p-5 border-t border-slate-200 space-y-2 shrink-0">
                        <button
                            onClick={handleDownload}
                            disabled={!result?.svg || isTracing}
                            className="w-full flex items-center justify-center gap-2 border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Download size={12} aria-hidden="true" />
                            {t('vectorizer.download')}
                        </button>

                        <button
                            onClick={handleApply}
                            disabled={!result?.svg || isTracing}
                            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Check size={12} aria-hidden="true" />
                            {t('vectorizer.apply')}
                        </button>
                    </div>
                </div>

                {/* Right: Split preview */}
                <div
                    id="vectorizer-preview"
                    className="flex-1 flex flex-col overflow-hidden bg-white"
                >
                    {/* Progress bar */}
                    {isTracing && (
                        <div className="shrink-0 px-6 py-3 border-b border-slate-200 flex items-center gap-4 bg-slate-50">
                            <Loader2 size={14} className="animate-spin text-violet-500 shrink-0" />
                            <div className="flex-1">
                                <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                    <div
                                        className="bg-violet-500 h-full transition-all duration-300 ease-out"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                            <span className="text-xs font-mono text-violet-600 shrink-0">{progress}%</span>
                        </div>
                    )}

                    {/* Warning banner */}
                    {traceState === 'done' && result && result.warnings.length > 0 && (
                        <div className="shrink-0 px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
                            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                            <div className="text-xs text-amber-700">
                                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                            </div>
                        </div>
                    )}

                    {/* Error banner */}
                    {traceState === 'error' && (
                        <div className="shrink-0 px-6 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
                            <AlertTriangle size={12} className="text-red-500 shrink-0" />
                            <p className="text-xs text-red-600 font-mono break-all">{errorMsg}</p>
                        </div>
                    )}

                    {/* Split panels */}
                    <div className="flex-1 flex overflow-hidden">
                        {/* Original bitmap (canvas — WASM reads from here) */}
                        <div
                            id="vectorizer-original"
                            className="flex-1 flex flex-col overflow-hidden border-r border-slate-200"
                        >
                            <p className="text-xs font-medium uppercase tracking-widest text-slate-500 px-4 py-2 border-b border-slate-200 shrink-0 bg-slate-50">
                                {t('vectorizer.original')}
                            </p>
                            <div className="flex-1 flex items-center justify-center p-6 overflow-auto bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23f1f5f9%22%2F%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23f1f5f9%22%2F%3E%3C%2Fsvg%3E')]">
                                <canvas
                                    id={CANVAS_ID}
                                    className="max-w-full max-h-full object-contain drop-shadow-sm"
                                />
                            </div>
                        </div>

                        {/* SVG result — rendered from serialized trace output */}
                        <div
                            id="vectorizer-result"
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 shrink-0 bg-slate-50">
                                <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
                                    {t('vectorizer.result')}
                                </p>
                                {resultSvgHtml && (
                                    <button
                                        onClick={() => setOutlinePreview(v => !v)}
                                        className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors ${
                                            outlinePreview
                                                ? 'bg-amber-400 text-amber-900'
                                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                                        }`}
                                        title={t('vectorizer.outline')}
                                    >
                                        <Scan size={12} aria-hidden="true" />
                                        {t('vectorizer.outline')}
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23f1f5f9%22%2F%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23f1f5f9%22%2F%3E%3C%2Fsvg%3E')]">
                                {resultSvgHtml ? (
                                    <div
                                        className={`w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:drop-shadow-sm ${
                                            outlinePreview
                                                ? '[&_path]:!fill-none [&_path]:!stroke-black [&_path]:![stroke-width:1px] [&_path]:![vector-effect:non-scaling-stroke] [&_rect]:!fill-none [&_rect]:!stroke-black [&_rect]:![stroke-width:1px] [&_circle:not([data-vertex])]:!fill-none [&_circle:not([data-vertex])]:!stroke-black [&_circle:not([data-vertex])]:![stroke-width:1px] [&_ellipse]:!fill-none [&_ellipse]:!stroke-black [&_ellipse]:![stroke-width:1px] [&_polygon]:!fill-none [&_polygon]:!stroke-black [&_polygon]:![stroke-width:1px]'
                                                : ''
                                        }`}
                                        dangerouslySetInnerHTML={{
                                            __html: outlinePreview
                                                ? injectVertexOverlay(resultSvgHtml)
                                                : resultSvgHtml,
                                        }}
                                    />
                                ) : traceState === 'idle' ? (
                                    <p className="absolute text-xs text-slate-500">{t('vectorizer.starting')}</p>
                                ) : traceState === 'tracing' ? (
                                    <Loader2 size={32} className="animate-spin text-violet-300" />
                                ) : null}
                                {traceState === 'error' && (
                                    <div className="absolute flex flex-col items-center gap-3 text-slate-500">
                                        <AlertTriangle size={32} className="text-red-400" />
                                        <p className="text-xs text-red-500">{t('vectorizer.traceFailed')}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VectorizerModal;
