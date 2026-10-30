/**
 * SVG Canvas Component
 * Renders SVG with CSS transform-based zoom/pan (infinite canvas).
 * Implements bounding box for selected elements.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { useSVGEditorStore } from '../../stores/svgEditorStore';
import { useTranslation } from '../../hooks/useTranslation';
import { normalizeSVG, parseSVGToDOM } from '../../utils/svgNormalizer';
import BoundingBox from './BoundingBox';
import PathEditor from './PathEditor';
import { updateDynamicStyles } from '../../lib/style-editor/lib/utils/cssGenerator';
import { geometryTouchesRect } from './editor/geometry';

/** Containers whose contents are not on-canvas art (never marquee-selectable). */
const NON_ART = 'defs, clipPath, mask, symbol, pattern, marker, style';

export default function SVGCanvas() {
    const { t } = useTranslation();
    const {
        svgDocument,
        loadSVG,
        updateSVGDOM,
        selectedElementId,
        selectElement,
        toggleSelection,
        selectedElementIds,
        selectElements,
        styleDefinitions,
        keyframes,
        svgSource,
        viewport,
        setViewport,
        zoomToFit,
        zoomToPoint,
        pathEditMode,
        outlineMode,
    } = useSVGEditorStore();

    const [refreshKey, setRefreshKey] = useState(0);
    const canvasStageRef = useRef<HTMLDivElement>(null);
    const svgContentRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);
    const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

    // Marquee selection state
    const [marquee, setMarquee] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const marqueeActive = useRef(false);

    // Pan state
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const spaceHeld = useRef(false);

    const ZOOM_STEP = 1.1;

    // Parse and render SVG when document changes
    useEffect(() => {
        if (svgDocument && svgContentRef.current) {
            const renderSvg = svgSource === 'raw' ? svgDocument : normalizeSVG(svgDocument).svg;
            const dom = parseSVGToDOM(renderSvg);

            if (dom) {
                updateSVGDOM(dom);
            }

            svgContentRef.current.innerHTML = renderSvg;
            const svg = svgContentRef.current.querySelector('svg');

            if (svg) {
                svg.style.width = '100%';
                svg.style.height = '100%';
                svg.style.display = 'block';
                setSvgElement(svg);

                let width = parseFloat(svg.getAttribute('width') || '');
                let height = parseFloat(svg.getAttribute('height') || '');

                if ((!width || !height) && svg.viewBox && svg.viewBox.baseVal) {
                    try {
                        if (svg.viewBox.baseVal.width) width = svg.viewBox.baseVal.width;
                        if (svg.viewBox.baseVal.height) height = svg.viewBox.baseVal.height;
                    } catch (e) { /* ignore */ }
                }

                if ((!width || !height) && svg.width && svg.height) {
                    try {
                        if (!width && svg.width.baseVal) width = svg.width.baseVal.value;
                        if (!height && svg.height.baseVal) height = svg.height.baseVal.value;
                    } catch (e) { /* ignore */ }
                }

                if ((!width || !height) && typeof svg.getBBox === 'function') {
                    try {
                        const bbox = svg.getBBox();
                        if (bbox.width && bbox.height) {
                            width = bbox.width;
                            height = bbox.height;
                        }
                    } catch {
                        // ignore bbox errors
                    }
                }

                if (!width || !height) {
                    width = 300;
                    height = 150;
                }
                console.debug('[SVGCanvas] detected canvas size:', width, 'x', height,
                    '| attr w:', svg.getAttribute('width'),
                    '| attr h:', svg.getAttribute('height'),
                    '| viewBox:', svg.getAttribute('viewBox'));
                setCanvasSize(prev =>
                    prev && prev.width === width && prev.height === height
                        ? prev
                        : { width, height }
                );

                // Ensure animated elements use their own bounding box as transform
                // reference, not the SVG viewBox (the default for SVG elements).
                // We look up each element's classes against styleDefinitions to
                // detect animation usage, then set transform-box/origin inline.
                svg.querySelectorAll('[class]').forEach(el => {
                    const classes = (el.getAttribute('class') || '').split(/\s+/);
                    let animOrigin: string | null = null;
                    for (const cls of classes) {
                        const def = styleDefinitions.find(s => s.selectors.includes(`.${cls}`));
                        if (def?.rules.some(r => r.property === 'animation')) {
                            const toRule = def.rules.find(r => r.property === 'transform-origin');
                            animOrigin = toRule?.value ?? 'center';
                            break;
                        }
                    }
                    if (animOrigin) {
                        (el as HTMLElement).style.transformBox = 'fill-box';
                        (el as HTMLElement).style.transformOrigin = animOrigin;
                    }
                });
            }
        }
    }, [svgDocument, svgSource, updateSVGDOM, styleDefinitions]);

    // Dynamic style injection
    useEffect(() => {
        if (svgSource === 'raw') {
            const existing = document.getElementById('dynamic-svg-styles');
            if (existing) existing.textContent = '';
            return;
        }

        if (!document.getElementById('dynamic-svg-styles')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'dynamic-svg-styles';
            document.head.appendChild(styleTag);
        }
        if (styleDefinitions && keyframes) {
            try {
                updateDynamicStyles(styleDefinitions, keyframes);
            } catch (e) {
                console.warn("Failed to update dynamic styles", e);
            }
        }
    }, [styleDefinitions, keyframes, svgSource]);

    // Outline mode: inject/remove high-specificity override CSS
    useEffect(() => {
        const STYLE_ID = 'svg-outline-mode-styles';
        let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

        if (outlineMode) {
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = STYLE_ID;
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = `
                #canvas-stage svg * {
                    fill: none !important;
                    stroke: #000000 !important;
                    stroke-width: 1px !important;
                    vector-effect: non-scaling-stroke !important;
                    opacity: 1 !important;
                    filter: none !important;
                    animation: none !important;
                }
            `;
        } else if (styleEl) {
            styleEl.remove();
        }

        return () => {
            const el = document.getElementById(STYLE_ID);
            if (el) el.remove();
        };
    }, [outlineMode]);

    // Set canvas dimensions in viewport and fit on *initial* load only
    const initialFitDone = useRef(false);
    useEffect(() => {
        if (!canvasSize) return;
        setViewport({ canvasWidth: canvasSize.width, canvasHeight: canvasSize.height });
        if (!initialFitDone.current) {
            initialFitDone.current = true;
            zoomToFit(window.innerWidth, window.innerHeight);
        }
    }, [canvasSize]);

    // Re-fit on window resize if fitMode is active
    useEffect(() => {
        const handleResize = () => {
            if (useSVGEditorStore.getState().viewport.fitMode) {
                zoomToFit(window.innerWidth, window.innerHeight);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [zoomToFit]);

    // Refresh bounding boxes when viewport or document changes
    useEffect(() => {
        if (!svgDocument) return;
        setRefreshKey(prev => prev + 1);
    }, [viewport.zoom, viewport.panX, viewport.panY, svgDocument]);

    // Click handler on SVG elements
    useEffect(() => {
        if (!svgElement) return;

        const handleSvgClick = (event: MouseEvent) => {
            if (marqueeActive.current) return;
            if (useSVGEditorStore.getState().pathEditMode) return;

            const target = event.target;
            if (!(target instanceof Element)) {
                selectElement(null);
                return;
            }

            if (target === svgElement) {
                selectElement(null);
                return;
            }

            const elementTarget = target.closest('[id]');
            let id: string | null = null;

            if (elementTarget && elementTarget !== svgElement) {
                id = elementTarget.getAttribute('id');
            } else {
                const groupTarget = target.closest('g[id]');
                if (groupTarget && groupTarget !== svgElement) {
                    id = groupTarget.getAttribute('id');
                }
            }

            if (id) {
                const current = useSVGEditorStore.getState().selectedElementIds;
                if (event.shiftKey) {
                    toggleSelection(id);
                } else if (current.size > 1 && current.has(id)) {
                    // A click on a member of a multi-selection keeps the selection
                    // and makes it the primary (VectorCraft's key object).
                    useSVGEditorStore.getState().selectElements([...Array.from(current).filter(x => x !== id), id]);
                } else {
                    selectElement(id);
                }
            } else {
                selectElement(null);
            }
        };

        svgElement.addEventListener('click', handleSvgClick);
        return () => {
            svgElement.removeEventListener('click', handleSvgClick);
        };
    }, [svgElement, selectElement, toggleSelection]);

    // Wheel handler: Ctrl/Meta + wheel = cursor-centered zoom, plain = pan
    useEffect(() => {
        const stage = canvasStageRef.current;
        if (!stage) return;

        const handler = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const stageRect = stage.getBoundingClientRect();
                const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
                zoomToPoint(factor, e.clientX, e.clientY, stageRect);
            } else {
                e.preventDefault();
                const { panX, panY } = useSVGEditorStore.getState().viewport;
                setViewport({
                    panX: panX - e.deltaX,
                    panY: panY - e.deltaY,
                    fitMode: false,
                });
            }
        };

        stage.addEventListener('wheel', handler, { passive: false });
        return () => stage.removeEventListener('wheel', handler);
    }, [zoomToPoint, setViewport]);

    // Space key tracking for pan mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as Element)?.closest('input, textarea, select')) return;
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                spaceHeld.current = true;
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                spaceHeld.current = false;
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.target as Element)?.closest('input, textarea, select')) return;

            const mod = e.metaKey || e.ctrlKey;

            if (mod && (e.key === '=' || e.key === '+')) {
                e.preventDefault();
                useSVGEditorStore.getState().zoomIn();
            } else if (mod && e.key === '-') {
                e.preventDefault();
                useSVGEditorStore.getState().zoomOut();
            } else if (mod && e.key === '0') {
                e.preventDefault();
                useSVGEditorStore.getState().zoomToFit(window.innerWidth, window.innerHeight);
            } else if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                useSVGEditorStore.getState().redo();
            } else if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                useSVGEditorStore.getState().undo();
            } else if (e.key === 'Escape') {
                const state = useSVGEditorStore.getState();
                if (state.pathEditMode) {
                    e.preventDefault();
                    state.exitPathEditMode();
                } else if (state.selectedElementId || state.selectedElementIds.size > 0) {
                    e.preventDefault();
                    state.clearSelection();
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                const state = useSVGEditorStore.getState();
                // In node-edit mode the path editor owns Delete/Backspace;
                // here Delete/Backspace removes the whole selection.
                if (!state.pathEditMode && state.selectedElementIds.size > 0) {
                    e.preventDefault();
                    state.deleteSelection();
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // Path edit mode — isolation: dim everything except the active element
    useEffect(() => {
        if (!svgElement) return;

        if (!pathEditMode) {
            svgElement.querySelectorAll<SVGElement>('[id]').forEach(el => {
                el.style.opacity = '';
                el.style.transition = '';
            });
            return;
        }

        svgElement.querySelectorAll<SVGElement>('[id]').forEach(el => {
            const id = el.getAttribute('id');
            if (id === pathEditMode.elementId) {
                el.style.opacity = '1';
                el.style.transition = 'opacity 0.2s ease';
            } else {
                el.style.opacity = '0.15';
                el.style.transition = 'opacity 0.2s ease';
            }
        });

        return () => {
            svgElement.querySelectorAll<SVGElement>('[id]').forEach(el => {
                el.style.opacity = '';
                el.style.transition = '';
            });
        };
    }, [svgElement, pathEditMode]);

    // Drag-to-pan handlers
    const handleStageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        // Middle mouse button or Space+left click starts panning
        if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
            e.preventDefault();
            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY };
            return;
        }

        // Only start marquee on left click on background
        if (e.button !== 0) return;
        if (useSVGEditorStore.getState().pathEditMode) return;
        if ((e.target as Element).closest('svg [id]')) return;

        const stage = canvasStageRef.current;
        if (!stage) return;

        const { zoom, panX, panY } = useSVGEditorStore.getState().viewport;
        const stageRect = stage.getBoundingClientRect();
        const svgX = (e.clientX - stageRect.left - panX) / zoom;
        const svgY = (e.clientY - stageRect.top - panY) / zoom;
        setMarquee({ startX: svgX, startY: svgY, endX: svgX, endY: svgY });
        marqueeActive.current = true;
    }, []);

    const handleStageMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isPanning.current) {
            const dx = e.clientX - panStart.current.x;
            const dy = e.clientY - panStart.current.y;
            panStart.current = { x: e.clientX, y: e.clientY };
            const { panX, panY } = useSVGEditorStore.getState().viewport;
            setViewport({ panX: panX + dx, panY: panY + dy, fitMode: false });
            return;
        }

        if (!marquee || !marqueeActive.current) return;

        const stage = canvasStageRef.current;
        if (!stage) return;

        const { zoom, panX, panY } = useSVGEditorStore.getState().viewport;
        const stageRect = stage.getBoundingClientRect();
        const svgX = (e.clientX - stageRect.left - panX) / zoom;
        const svgY = (e.clientY - stageRect.top - panY) / zoom;
        setMarquee(prev => prev ? { ...prev, endX: svgX, endY: svgY } : null);
    }, [marquee, setViewport]);

    const handleStageMouseUp = useCallback(() => {
        if (isPanning.current) {
            isPanning.current = false;
            return;
        }

        if (!marquee || !marqueeActive.current || !svgElement) {
            setMarquee(null);
            marqueeActive.current = false;
            return;
        }

        // Compute marquee rect in screen coords
        const left = Math.min(marquee.startX, marquee.endX);
        const top = Math.min(marquee.startY, marquee.endY);
        const width = Math.abs(marquee.endX - marquee.startX);
        const height = Math.abs(marquee.endY - marquee.startY);

        if (width > 5 && height > 5) {
            // Convert marquee (SVG-local coords) to screen coords for hit testing
            const { zoom, panX, panY } = useSVGEditorStore.getState().viewport;
            const stage = canvasStageRef.current;
            if (stage) {
                const stageRect = stage.getBoundingClientRect();
                const marqueeScreenRect = {
                    left: stageRect.left + panX + left * zoom,
                    top: stageRect.top + panY + top * zoom,
                    right: stageRect.left + panX + (left + width) * zoom,
                    bottom: stageRect.top + panY + (top + height) * zoom,
                };

                // The marquee touches visible geometry, not bounding boxes (as
                // VectorCraft's `marquee`): a path counts when its outline or fill
                // meets the rectangle; a group when one of its shapes does; only
                // text, images and other non-path art fall back to their box.
                const candidates = Array.from(svgElement.querySelectorAll('[id]'))
                    .filter(el => el !== svgElement && !el.closest(NON_ART));
                const touchedShapes = new Set<Element>();
                for (const el of candidates) {
                    if (el instanceof SVGGeometryElement) {
                        try {
                            if (geometryTouchesRect(el, marqueeScreenRect)) touchedShapes.add(el);
                        } catch { /* ignore measurement errors */ }
                    }
                }
                const hits: string[] = [];
                for (const el of candidates) {
                    let touched: boolean;
                    if (el instanceof SVGGeometryElement) {
                        touched = touchedShapes.has(el);
                    } else if (el instanceof SVGGElement) {
                        touched = Array.from(touchedShapes).some(s => el.contains(s));
                    } else {
                        const b = el.getBoundingClientRect();
                        touched = (b.width > 0 || b.height > 0) &&
                            b.left < marqueeScreenRect.right && b.right > marqueeScreenRect.left &&
                            b.top < marqueeScreenRect.bottom && b.bottom > marqueeScreenRect.top;
                    }
                    const id = el.getAttribute('id');
                    if (touched && id) hits.push(id);
                }

                if (hits.length > 0) {
                    selectElements(hits);
                } else {
                    // Marquee dragged over empty space → deselect.
                    useSVGEditorStore.getState().clearSelection();
                }
            }
        } else {
            // A plain click on empty background (not a drag) deselects.
            // handleStageMouseDown only arms a marquee off any element with an id,
            // so reaching here means the click landed on empty canvas.
            useSVGEditorStore.getState().clearSelection();
        }

        setMarquee(null);
        requestAnimationFrame(() => { marqueeActive.current = false; });
    }, [marquee, svgElement, selectElements]);

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (useSVGEditorStore.getState().pathEditMode) return;
        // Skip while a marquee just completed (the synthetic click that
        // follows mouseup would otherwise wipe the marquee selection).
        if (marqueeActive.current) return;
        const target = e.target as Element;
        // Clear only when the click landed on the stage div or the viewport
        // wrapper (i.e., truly outside the SVG canvas). Clicks inside the
        // SVG — including on its root background — are handled by the
        // native click listener attached to svgElement.
        if (target === canvasStageRef.current || target.id === 'canvas-viewport') {
            useSVGEditorStore.getState().clearSelection();
        }
    }, []);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result as string;
                loadSVG(content);
            };
            reader.readAsText(file);
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    // Cursor based on mode
    const getCursor = () => {
        if (isPanning.current) return 'grabbing';
        if (spaceHeld.current) return 'grab';
        return 'default';
    };

    if (!svgDocument) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-100">
                <div className="text-center">
                    <Upload className="w-16 h-16 mx-auto text-slate-500 mb-4" />
                    <h2 className="text-xl font-semibold mb-2 text-slate-900">{t('svgEditor.importSvg')}</h2>
                    <p className="text-sm text-slate-500 mb-4">
                        {t('svgEditor.importSvgHint')}
                    </p>
                    <div className="flex gap-2 justify-center">
                        <Button onClick={handleUploadClick}>
                            {t('svgEditor.chooseFile')}
                        </Button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".svg,image/svg+xml"
                        className="hidden"
                        onChange={handleFileUpload}
                    />
                </div>
            </div>
        );
    }

    return (
        <div
            ref={canvasStageRef}
            className="w-full h-full overflow-hidden bg-slate-100"
            style={{ cursor: getCursor() }}
            onClick={handleCanvasClick}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onMouseLeave={() => {
                if (isPanning.current) isPanning.current = false;
                if (marqueeActive.current) { setMarquee(null); marqueeActive.current = false; }
            }}
        >
            {/* Viewport transform layer */}
            <div
                id="canvas-viewport"
                style={{
                    position: 'absolute',
                    transformOrigin: '0 0',
                    transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                }}
            >
                {/* SVG content with white background */}
                <div
                    ref={svgContentRef}
                    className="bg-white shadow-[0_0_8px_rgba(0,0,0,0.12)] rounded-[0.15ex]"
                    style={canvasSize ? {
                        width: `${canvasSize.width}px`,
                        height: `${canvasSize.height}px`,
                        overflow: 'visible',
                    } : { overflow: 'visible' }}
                />

                {/* Bounding boxes for all selected elements (hidden during path edit) */}
                {svgElement && selectedElementIds.size > 0 && Array.from(selectedElementIds)
                    .filter(id => !pathEditMode || pathEditMode.elementId !== id)
                    .map(id => (
                    <BoundingBox
                        key={`${refreshKey}-${id}`}
                        svgElement={svgElement}
                        elementId={id}
                        containerElement={svgContentRef.current ?? svgElement}
                        onTransformComplete={() => setRefreshKey(prev => prev + 1)}
                    />
                ))}

                {/* Path Edit Mode — node handles */}
                {pathEditMode && svgElement && (
                    <PathEditor
                        svgElement={svgElement}
                        elementId={pathEditMode.elementId}
                    />
                )}

                {/* Marquee selection overlay (in SVG-local coords) */}
                {marquee && (
                    <div
                        className="absolute border border-dashed border-blue-500 bg-blue-500/10 pointer-events-none z-20"
                        style={{
                            left: `${Math.min(marquee.startX, marquee.endX)}px`,
                            top: `${Math.min(marquee.startY, marquee.endY)}px`,
                            width: `${Math.abs(marquee.endX - marquee.startX)}px`,
                            height: `${Math.abs(marquee.endY - marquee.startY)}px`,
                        }}
                    />
                )}
            </div>
        </div>
    );
}
