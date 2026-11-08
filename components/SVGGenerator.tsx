import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { Download, FileCode, Edit, Layers, Trash2, Scan } from 'lucide-react';
import { RowData, VisualElement, NLUData, StructuringMapping, DEFAULT_PHASE5_MODEL, SvgEditorSource } from '../types';
import { structureSVG, assembleAndVerify, canStructureSVG, vectorizeAndStructure } from '../services/svgStructureService';
import { captureSvgSource, prepareSvgPromotion, prepareSvgDraft, canCertifySVG, observedSvgProvenance } from '../services/svgCanonical';
import { formatSvgStructureError, svgStructureDiagnostic } from '../services/svgStructureDiagnostics';
import { applyConcepts, certifyDraft, CONCEPTS, draftIssues, removeElement, type ImplicitChoices } from '../services/svgDraftCertification';
import { createSvgReference } from '../schemas/pictos-svg-schema/index.js';
import { Phase5ReviewPanel } from './Phase5ReviewPanel';
import useSVGLibrary from '../hooks/useSVGLibrary';
import { GlobalConfig } from '../types';

import { generateStylesheet } from '../services/svgStructureService';
import { injectSvgA11y } from '../utils/svgAccessibility';

// Track active structuring processes across mount/unmount cycles.
// Key = row ID, value = start timestamp. Survives component unmount.
const activeStructuring = new Map<string, number>();

import { sanitizeFilename } from '../utils/textFormat';

interface SVGGeneratorProps {
    row: RowData;
    config: GlobalConfig;
    onLog: (type: 'info' | 'error' | 'success', message: string) => void;
    onUpdate: (updates: Partial<RowData>) => void;
    onOpenEditor?: (source?: SvgEditorSource) => void;
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
}

export const SVGGenerator: React.FC<SVGGeneratorProps> = ({ row, config, onLog, onUpdate, onOpenEditor, layout = 'stacked', onDiscardSvg, onOpenVectorizer, phase5Model = DEFAULT_PHASE5_MODEL }) => {
    const { t } = useTranslation();
    const { getSVGByRowId, removeSVGByRowId } = useSVGLibrary();
    const latestRow = useRef(row);
    latestRow.current = row;
    const pendingSource = useRef<{ row: RowData; config: GlobalConfig; model: string } | null>(null);
    const [status, setStatus] = useState<'idle' | 'traced' | 'structuring' | 'completed' | 'error'>(() =>
        row.structuredSvg && !row.structuredSvgDiscarded ? 'completed'
            : row.rawSvg && !row.rawSvgDiscarded ? 'traced' : 'idle');
    const [error, setError] = useState<{ key: string } | undefined>();
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
    const [confirmingDelete, setConfirmingDelete] = useState<'raw' | 'structured' | 'draft' | null>(null);
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

    // Geometric trace controls are independent of semantic admission to Phase 5.
    const bitmapRef = row.bitmapDiscarded ? undefined : row.bitmap;
    const structureEligibility = canStructureSVG(row);
    const certification = canCertifySVG(row);
    const review = structureEligibility.eligible ? certification : structureEligibility;
    const eligibilityMessage = review.reasonKey ? t(`svgGenerator.${review.reasonKey}`) : '';
    // At most one short line. Field pointers are for researchers: tooltip.
    const draftReasonKey = !row.structuredSvgDraftDiagnostic?.key || row.structuredSvgDraftDiagnostic.key === 'structureFailed' ? 'draftReasonUnavailable' : row.structuredSvgDraftDiagnostic.key;
    const structureNotice = row.structuredSvgDraft
        ? <DraftChecklist row={row} onUpdate={onUpdate} onLog={onLog} fallback={t(`svgGenerator.${draftReasonKey}`)} />
        // With a bitmap, TRAZAR and the joint action already answer "trace required".
        : !review.eligible && !(review.reasonKey === 'traceRequired' && bitmapRef) && <p role="status" className="text-xs text-amber-900" title={review.fields?.join(', ')}>{eligibilityMessage}</p>;

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
        setRawSvg(validRawSvg);
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
            setSubStatus(t('svg.applyingSemanticSchema'));
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
        const eligibility = canStructureSVG(latestRow.current);
        if (!eligibility.eligible) {
            onLog('error', t(`svgGenerator.${eligibility.reasonKey}`));
            return;
        }

        try {
            setError(undefined);
            const startTime = performance.now();
            setProcessStartTime(Date.now());
            setElapsedTime(0);

            // Structure with Gemini
            setStatus('structuring');
            setSubStatus(t('svgGenerator.preparingSemanticPrompt'));
            setStructureProgress(0);
            activeStructuring.set(row.id, Date.now());
            startHeartbeat();
            await new Promise(r => setTimeout(r, 600)); // UX Delay

            const nluData = row.NLU;

            onLog('info', t('svgGenerator.structuringWithModel', { model: phase5Model }));
            const sStart = performance.now();
            const result = await structureSVG({
                rawSvg: svg,
                nlu: nluData,
                elements: row.elements || [],
                utterance: row.UTTERANCE,
                prompt: row.prompt || '',
                provenance: observedSvgProvenance(row, phase5Model),
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

            if (result.draftSvg) {
                const update = prepareSvgDraft(row, result.draftSvg, result.diagnostic);
                if (captureSvgSource(latestRow.current) !== update.svgSourceSnapshot) throw new Error('SVG inputs changed during generation');
                onUpdate(update);
                activeStructuring.delete(row.id);
                setStatus(row.structuredSvg && !row.structuredSvgDiscarded ? 'completed' : 'traced');
                onLog('info', t('svgGenerator.draftReady'));
                return;
            }
            if (!result.success) throw Object.assign(new Error(result.error || 'Structuring failed'), { diagnostic: result.diagnostic });

            // Recording mode: mapping awaits user review
            if (result.pendingReview && result.mapping) {
                pendingSource.current = { row: structuredClone(row), config: structuredClone(config), model: phase5Model };
                onLog('info', t('svgGenerator.mappingReadyForReview'));
                setPendingMapping(result.mapping);
                activeStructuring.delete(row.id);
                setStatus('traced');
                return;
            }

            if (!result.svg) {
                throw new Error(t('svgGenerator.emptyStructureResult'));
            }

            const promotion = await prepareSvgPromotion(row, result.svg);
            if (captureSvgSource(latestRow.current) !== promotion.svgSourceSnapshot) throw new Error(t('svgGenerator.inputsChangedDuringGeneration'));
            onUpdate(promotion);
            onLog('success', t('svgGenerator.structureCompleted', { duration: ((sEnd - sStart) / 1000).toFixed(2) }));

            activeStructuring.delete(row.id);
            setStatus('completed');
            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            onLog('success', t('svgGenerator.processCompleted', { duration: totalTime }));

        } catch (err) {
            stopHeartbeat(0);
            activeStructuring.delete(row.id);
            console.error(err);
            setStatus('error');
            const msg = formatSvgStructureError(err, t);
            setError(svgStructureDiagnostic(err));
            onLog('error', t('svgGenerator.processFailed', { error: msg }));
        }
    };


    // Experimental joint VECTORIZAR+ESTRUCTURAR (plan VE5): bitmap → region
    // trace → one semantic request → structure. The region trace replaces the
    // row's trace (as a retrace would) in the same update as its result.
    const handleJoint = async () => {
        const sourceRow = latestRow.current;
        if (!bitmapRef || !keepsManualWork()) return;
        if (!Array.isArray(sourceRow.elements) || !sourceRow.elements.length) { onLog('error', t('svgGenerator.elementsRequired')); return; }
        const source = captureSvgSource(sourceRow);
        try {
            setError(undefined);
            setProcessStartTime(Date.now());
            setElapsedTime(0);
            setStatus('structuring');
            setSubStatus(t('svgGenerator.jointRunning'));
            setStructureProgress(0);
            activeStructuring.set(row.id, Date.now());
            startHeartbeat();
            const sStart = performance.now();
            const result = await vectorizeAndStructure({
                bitmap: bitmapRef,
                nlu: sourceRow.NLU,
                elements: sourceRow.elements,
                utterance: sourceRow.UTTERANCE,
                prompt: sourceRow.prompt || '',
                provenance: observedSvgProvenance(sourceRow, phase5Model),
                config,
                phase5Model,
                onProgress: (msg) => onLog('info', msg),
                onStatus: (st) => setSubStatus(st),
            });
            stopHeartbeat();
            if (captureSvgSource(latestRow.current) !== source) throw new Error(t('svgGenerator.inputsChangedDuringGeneration'));
            if (!result.rawSvg) throw Object.assign(new Error(result.error || 'Structuring failed'), { diagnostic: result.diagnostic });
            const trace = { rawSvg: result.rawSvg, rawSvgDiscarded: false };
            const traced = { ...sourceRow, ...trace };

            if (result.pendingReview && result.mapping) {
                onUpdate(trace);
                pendingSource.current = { row: structuredClone(traced), config: structuredClone(config), model: phase5Model };
                setPendingMapping(result.mapping);
                setStatus('traced');
                onLog('info', t('svgGenerator.mappingReadyForReview'));
                return;
            }
            // The update gate compares the snapshot with the row as it is now
            // (before the trace lands), so results carry the source snapshot.
            if (result.draftSvg) {
                onUpdate({ ...trace, ...prepareSvgDraft(sourceRow, result.draftSvg, result.diagnostic) });
                setStatus(sourceRow.structuredSvg && !sourceRow.structuredSvgDiscarded ? 'completed' : 'traced');
                onLog('info', t('svgGenerator.draftReady'));
                return;
            }
            if (!result.success || !result.svg) {
                onUpdate(trace); // the trace is usable even when structuring failed
                throw Object.assign(new Error(result.error || 'Structuring failed'), { diagnostic: result.diagnostic });
            }
            onUpdate({ ...trace, ...await prepareSvgPromotion(sourceRow, result.svg) });
            setStatus('completed');
            onLog('success', t('svgGenerator.structureCompleted', { duration: ((performance.now() - sStart) / 1000).toFixed(2) }));
        } catch (err) {
            stopHeartbeat(0);
            console.error(err);
            setStatus('error');
            setError(svgStructureDiagnostic(err));
            onLog('error', t('svgGenerator.processFailed', { error: formatSvgStructureError(err, t) }));
        } finally {
            activeStructuring.delete(row.id);
        }
    };

    // Recording mode: the reviewed mapping is assembled against the inputs it
    // was proposed for; any change since then voids it.
    const confirmReview = async (selectionOverrides: Map<string, boolean>, labelOverrides: Map<string, string>) => {
        const mapping = pendingMapping;
        setPendingMapping(null);
        const captured = pendingSource.current;
        pendingSource.current = null;
        if (!mapping || !captured || captureSvgSource(captured.row) !== captureSvgSource(latestRow.current)) { onLog('error', t('svgGenerator.inputsChangedDuringReview')); return; }
        const sourceRow = captured.row;
        const assembled = await assembleAndVerify(mapping, {
            rawSvg: sourceRow.rawSvg!,
            nlu: sourceRow.NLU,
            elements: sourceRow.elements || [],
            utterance: sourceRow.UTTERANCE,
            prompt: sourceRow.prompt || '',
            provenance: observedSvgProvenance(sourceRow, captured.model),
            config: captured.config,
            onProgress: (msg) => onLog('info', msg),
        }, selectionOverrides, labelOverrides);
        if (assembled.draftSvg) {
            onUpdate(prepareSvgDraft(sourceRow, assembled.draftSvg, assembled.diagnostic));
            onLog('info', t('svgGenerator.draftReady'));
        } else if (assembled.success && assembled.svg) {
            try {
                const promotion = await prepareSvgPromotion(sourceRow, assembled.svg);
                if (captureSvgSource(latestRow.current) !== promotion.svgSourceSnapshot) throw new Error(t('svgGenerator.inputsChangedDuringReview'));
                onUpdate(promotion);
            } catch (error) { onLog('error', formatSvgStructureError(error, t)); return; }
            onLog('success', t('svgGenerator.assembledAfterReview'));
        } else {
            onLog('error', formatSvgStructureError({ message: assembled.error, diagnostic: assembled.diagnostic }, t));
        }
    };

    // One view for the row list (stacked) and the focus view (columns): the
    // same tiles, each with its own edit / download / delete, then one action
    // row, then at most one short notice.
    const isColumns = layout === 'columns';
    const hasStructured = status === 'completed' && !!structuredSvgEntry;
    const canJoin = !!bitmapRef && Array.isArray(row.elements) && row.elements.length > 0;
    const SVG_FIT = 'w-full h-full svg-preview flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full';
    const tileSize = isColumns ? 'flex-1 min-h-[120px]' : 'w-full aspect-square';
    const secondaryButton = 'flex items-center justify-center gap-2 py-2 px-4 text-xs font-bold rounded border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors';
    const primaryButton = 'flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold uppercase tracking-widest rounded transition-colors shadow-md hover:shadow-lg disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed';

    const discard: Record<'raw' | 'structured' | 'draft', () => void> = {
        raw: () => { if (rawSvg) onDiscardSvg?.('svg_raw', rawSvg); setRawSvg(null); },
        structured: () => {
            if (row.structuredSvg) onDiscardSvg?.('svg_structured', row.structuredSvg);
            removeSVGByRowId(row.id);
            setStatus(rawSvg ? 'traced' : 'idle');
        },
        draft: () => onUpdate({ structuredSvgDraft: undefined, structuredSvgDraftDiagnostic: undefined }),
    };
    const TILE = {
        raw: { badge: 'svg.traceLabel', badgeClass: 'bg-amber-500', edit: 'svg.editRaw', download: 'svg.download', onDownload: downloadRawSvg },
        structured: { badge: 'svg.structureLabel', badgeClass: 'bg-emerald-600', edit: 'svg.editStructured', download: 'svg.download', onDownload: downloadStructuredSvg },
        draft: { badge: 'svg.draftLabel', badgeClass: 'bg-amber-600', edit: 'svgGenerator.editDraft', download: 'svgGenerator.downloadDraft', onDownload: () => triggerDownload(row.structuredSvgDraft!, '-draft') },
    };
    const iconButton = 'p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg';
    const tile = (kind: keyof typeof TILE, content: React.ReactNode) => {
        const m = TILE[kind];
        return (
            <div key={kind} className={`bg-white border ${kind === 'draft' ? 'border-amber-300' : 'border-slate-200'} flex items-center justify-center p-3 relative overflow-hidden group/tile ${tileSize}`}>
                <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none" />
                <div className={`absolute top-2 left-2 ${m.badgeClass} text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider pointer-events-none z-10 transition-opacity ${kind === 'draft' ? '' : 'opacity-0 group-hover/tile:opacity-100'}`}>
                    {t(m.badge)}
                </div>
                <div className="absolute bottom-2 right-2 flex gap-1.5 z-10 opacity-0 group-hover/tile:opacity-100 focus-within:opacity-100 transition-opacity">
                    {onOpenEditor && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenEditor(kind); }} className={iconButton} title={t(m.edit)} aria-label={t(m.edit)}>
                            <Edit size={12} />
                        </button>
                    )}
                    <button type="button" onClick={m.onDownload} className={iconButton} title={t(m.download)} aria-label={t(m.download)}>
                        <Download size={12} />
                    </button>
                    <button type="button" onClick={() => setConfirmingDelete(kind)} className={`${iconButton} hover:bg-rose-600`} title={t('actions.delete')} aria-label={t('actions.delete')}>
                        <Trash2 size={12} />
                    </button>
                </div>
                {confirmingDelete === kind && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 gap-2">
                        <button type="button" onClick={() => { discard[kind](); setConfirmingDelete(null); }} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded">
                            {t('actions.delete')}
                        </button>
                        <button type="button" onClick={() => setConfirmingDelete(null)} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold uppercase tracking-wider rounded">
                            {t('actions.cancel')}
                        </button>
                    </div>
                )}
                {content}
            </div>
        );
    };

    const tiles = [
        rawSvg && tile('raw', <div dangerouslySetInnerHTML={{ __html: injectSvgA11y(displayRawSvg, row.UTTERANCE) }} className={SVG_FIT} />),
        // The focus view has no bitmap beside it: show it as the source.
        isColumns && !rawSvg && bitmapRef && (
            <div key="bitmap" className={`bg-white border border-slate-200 flex items-center justify-center p-3 ${tileSize}`}>
                <img src={bitmapRef} alt={row.UTTERANCE} className="max-w-full max-h-full object-contain" />
            </div>
        ),
        hasStructured && tile('structured', <div dangerouslySetInnerHTML={{ __html: injectSvgA11y(displaySvg, row.UTTERANCE, row.prompt) }} className={SVG_FIT} />),
        row.structuredSvgDraft && tile('draft', <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(row.structuredSvgDraft)}`} alt={t('svg.draftLabel')} className="w-full h-full object-contain" />),
    ].filter(Boolean);

    const progressPanel = status === 'structuring' && (
        <div key="progress" className={`bg-slate-50 border border-slate-200 rounded px-4 py-3 flex flex-col justify-center ${isColumns ? 'flex-1' : ''}`}>
            <div className="flex items-center gap-3 mb-2">
                <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-violet-600 animate-spin flex-none" />
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">{t('svg.structuring')}</p>
                <span className="ml-auto text-xs font-mono text-violet-600 font-bold bg-violet-50 px-1.5 py-0.5 rounded">{elapsedTime.toFixed(1)}s</span>
            </div>
            <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                <div className="bg-violet-600 h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${structureProgress}%` }} />
            </div>
            <p className="text-xs text-slate-500 mt-1.5 truncate">{subStatus || t('svg.applyingSemanticSchema')}</p>
        </div>
    );
    const reviewPanel = pendingMapping && <Phase5ReviewPanel key="review" mapping={pendingMapping} onConfirm={confirmReview} />;
    // Columns keep the pair shape: an empty slot beside a lone trace.
    const placeholder = isColumns && tiles.length === 1 && !progressPanel && !reviewPanel && (
        <div key="placeholder" className="flex-1 min-h-[120px] border border-dashed border-slate-300 flex items-center justify-center">
            <Layers size={28} className="text-slate-300" aria-hidden="true" />
        </div>
    );

    // Re-structuring replaces a hand-edited draft or revision: say so first.
    const keepsManualWork = () => !(row.structuredSvgDraftDiagnostic?.key === 'draftEdited' || /"operation":\s*"manual_edit"/.test(row.structuredSvg ?? ''))
        || window.confirm(t('svgGenerator.restructureDiscardsEdits'));
    const restructure = () => {
        if (!keepsManualWork()) return;
        if (row.structuredSvg) onDiscardSvg?.('svg_structured', row.structuredSvg);
        removeSVGByRowId(row.id);
        setRawSvg(row.rawSvg!);
        handleFormat(row.rawSvg!);
    };
    const retraceButton = bitmapRef && onOpenVectorizer && rawSvg && (
        <button type="button" onClick={onOpenVectorizer} title={t('svg.retrace')} aria-label={t('svg.retrace')} className="p-3 bg-slate-50 hover:bg-violet-50 text-violet-700 border border-slate-200 rounded">
            <Scan size={14} aria-hidden="true" />
        </button>
    );
    const actions = status !== 'structuring' && !pendingMapping && (
        <div className="flex flex-wrap gap-2">
            {hasStructured ? (
                row.rawSvg && !row.rawSvgDiscarded && (
                    <button type="button" onClick={restructure} disabled={!structureEligibility.eligible} title={structureEligibility.eligible ? t('svg.reStructureTooltip') : eligibilityMessage} className={`flex-1 ${secondaryButton} uppercase tracking-widest`}>
                        <Layers size={14} aria-hidden="true" /> {t('svg.reStructure')}
                    </button>
                )
            ) : rawSvg ? (
                <>
                    <button type="button" onClick={() => handleFormat()} disabled={!structureEligibility.eligible} title={structureEligibility.eligible ? undefined : eligibilityMessage} className={primaryButton}>
                        <Layers size={15} aria-hidden="true" /> {t('svg.formatGemini')}
                    </button>
                    {canJoin && (
                        <button type="button" onClick={handleJoint} title={t('svg.structureFromBitmapTitle')} className={secondaryButton}>
                            <Layers size={14} aria-hidden="true" /> {t('svg.structureFromBitmap')}
                        </button>
                    )}
                </>
            ) : (
                <>
                    {canJoin && (
                        <button type="button" onClick={handleJoint} title={t('svg.structureFromBitmapTitle')} className={`w-full ${primaryButton}`}>
                            <Layers size={15} aria-hidden="true" /> {t('svg.structure')}
                        </button>
                    )}
                    {bitmapRef && onOpenVectorizer && (
                        <button type="button" onClick={onOpenVectorizer} title={t('svg.traceOnlyTitle')} className={canJoin ? `w-full ${secondaryButton}` : `w-full ${primaryButton}`}>
                            <Scan size={14} aria-hidden="true" /> {t(canJoin ? 'svg.traceOnly' : 'svg.traceSvg')}
                        </button>
                    )}
                </>
            )}
            {retraceButton}
        </div>
    );

    if (!tiles.length && !progressPanel && !bitmapRef) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                <FileCode size={32} className="text-slate-400 mb-3" />
                <p className="text-xs text-slate-500 text-center max-w-[200px]">{t('editor.noSvgRender')}</p>
            </div>
        );
    }

    return (
        <div className={isColumns ? 'flex flex-col h-full gap-3' : 'flex flex-col gap-3'}>
            {(tiles.length > 0 || progressPanel || reviewPanel) && (
                <div className={isColumns ? 'flex-1 flex flex-row gap-3 min-h-0' : 'flex flex-col gap-3'}>
                    {tiles}
                    {progressPanel}
                    {reviewPanel}
                    {placeholder}
                </div>
            )}
            {actions}
            {structureNotice}
            {error && <p role="alert" className="text-xs text-red-600">{t(`svgGenerator.${error.key}`)}</p>}
        </div>
    );
};

/**
 * Every reason a draft does not certify yet, named by element, with the one
 * repair the tile can make itself (declaring an Action implicit) and the
 * Certify action. Geometry repairs happen in the draft editor; saving there
 * certifies automatically once this list is empty.
 */
function DraftChecklist({ row, onUpdate, onLog, fallback }: {
    row: RowData; onUpdate: (u: Partial<RowData>) => void;
    onLog: (type: 'info' | 'error' | 'success', message: string) => void; fallback: string;
}) {
    const { t } = useTranslation();
    const [implicit, setImplicit] = useState<ImplicitChoices>({});
    const [concepts, setConcepts] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    // Listed without the implicit choices (so a choice stays visible and undoable);
    // Certify is enabled only when nothing remains once they apply.
    const issues = React.useMemo(() => draftIssues(row, row.structuredSvgDraft!),
        [row.structuredSvgDraft, row.NLU, row.elements, row.prompt, row.UTTERANCE]);
    const remaining = React.useMemo(() => Object.values(implicit).some(Boolean) ? draftIssues(row, row.structuredSvgDraft!, implicit) : issues,
        [issues, implicit]);
    const certify = async () => {
        setBusy(true);
        try {
            const parent = row.structuredSvg ? await createSvgReference(row.structuredSvg).catch(() => undefined) : undefined;
            onUpdate(await prepareSvgPromotion(row, certifyDraft(row, row.structuredSvgDraft!, implicit, parent?.sha256)));
            onLog('success', t('svgGenerator.draftCertified'));
        } catch (error) {
            onLog('error', formatSvgStructureError(error, t));
        } finally { setBusy(false); }
    };
    return (
        <div role="status" className="text-xs text-amber-900 space-y-1.5">
            {remaining.length === 0 && <p>{t('svgGenerator.draftCertifiable')}</p>}
            {issues.length > 0 && <>
                <p className="font-semibold">{t('svgGenerator.draftChecklist')}</p>
                <ul className="list-disc pl-4 space-y-1">
                    {issues.map((issue, i) => <li key={i}>
                        {issue.kind === 'inputs' && <>
                            {t(`svgGenerator.${issue.reasonKey}`)}
                            {issue.fields.length > 0 && <> {t(issue.reasonKey === 'nluNeedsReview' ? 'svgGenerator.issueInputFields' : 'svgGenerator.issueCompositionFields',
                                { fields: [...new Set(issue.fields.map(f => f.split('/').filter(Boolean).pop()))].join(', ') })}</>}
                        </>}
                        {issue.kind === 'concepts' && <>
                            {t('svgGenerator.issueConcepts')}
                            <span className="grid grid-cols-[auto_auto] gap-x-2 gap-y-1 mt-1 items-center w-fit">
                                {issue.elements.map(({ elementId, suggested }) => <React.Fragment key={elementId}>
                                    <span>{elementId}</span>
                                    <select className="border border-amber-300 rounded bg-white px-1" value={concepts[elementId] ?? suggested}
                                        onChange={e => setConcepts(prev => ({ ...prev, [elementId]: e.target.value }))}>
                                        {CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </React.Fragment>)}
                            </span>
                            <button type="button" className="mt-1 px-2 py-1 rounded border border-amber-400 bg-white font-semibold"
                                onClick={() => onUpdate({ elements: applyConcepts(row.elements ?? [],
                                    Object.fromEntries(issue.elements.map(e => [e.elementId, concepts[e.elementId] ?? e.suggested]))) })}>
                                {t('svgGenerator.applyConcepts')}
                            </button>
                        </>}
                        {issue.kind === 'loose' && t('svgGenerator.issueLoose', { count: issue.count, parents: issue.parents.join(', '),
                            ids: issue.ids.slice(0, 6).join(', ') + (issue.ids.length > 6 ? '…' : '') })}
                        {issue.kind === 'unknown' && t('svgGenerator.issueUnknown', { group: issue.groupId })}
                        {issue.kind === 'invalid' && <span title={issue.message}>{fallback}</span>}
                        {issue.kind === 'empty' && <>
                            {t('svgGenerator.issueEmpty', { element: issue.elementId })}
                            <button type="button" className="ml-1 underline decoration-dotted" title={t('svgGenerator.removeElementTitle')}
                                onClick={() => onUpdate(removeElement(row.elements ?? [], row.prompt ?? '', issue.elementId))}>
                                {t('svgGenerator.removeElement')}
                            </button>
                            {issue.performers.length > 0 && <label className="block mt-0.5">
                                {t('svgGenerator.issueImplicit')}{' '}
                                <select className="border border-amber-300 rounded bg-white px-1" value={implicit[issue.elementId] ?? ''}
                                    onChange={e => setImplicit(prev => ({ ...prev, [issue.elementId]: e.target.value }))}>
                                    <option value="">—</option>
                                    {issue.performers.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </label>}
                        </>}
                    </li>)}
                </ul>
                {issues.some(i => i.kind === 'loose' || i.kind === 'empty' || i.kind === 'unknown') && <p>{t('svgGenerator.draftFixInEditor')}</p>}
            </>}
            <button type="button" onClick={certify} disabled={busy || remaining.length > 0}
                className="px-3 py-1.5 rounded bg-violet-600 text-white font-bold uppercase tracking-wider disabled:bg-slate-200 disabled:text-slate-500">
                {t('svgGenerator.certifyDraft')}
            </button>
        </div>
    );
}
