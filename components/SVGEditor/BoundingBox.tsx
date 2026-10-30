/**
 * Bounding Box — selection overlay with non-destructive Move, Scale and Rotate.
 *
 * A gesture is a single matrix built by the geometry kernel (translate / scale /
 * rotate). While dragging, the matrix is written to the rendered node's
 * `transform` only (live preview, geometry untouched). On mouse-up the transform
 * is baked into the element's geometry once, through the kernel, and committed as
 * one history step via `commitGeometry`. Primitives stay primitives unless a
 * rotation/skew forces promotion to <path> (see editor/geometry.ts).
 *
 * Modifiers follow specs/vector-editor.allium: Shift = proportional scale,
 * Alt = scale from centre, Shift (while rotating) = 45-degree steps. Rotation is
 * reached only through the dedicated rotate handle.
 */

import React, { useEffect, useState, useRef } from 'react';
import { useSVGEditorStore } from '../../stores/svgEditorStore';
import { useTranslation } from '../../hooks/useTranslation';
import {
    parseTransformToMatrix,
    translateMatrix,
    scaleMatrix,
    rotateMatrix,
    previewGesture,
    bakeElementTransform,
    flattenGroupTransforms,
} from './editor/geometry';

interface BoundingBoxProps {
    svgElement: SVGSVGElement;
    elementId: string;
    containerElement: Element;
    onTransformComplete?: () => void;
}

interface BBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

type HandleType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'rotate';

interface DragStart {
    clientX: number;
    clientY: number;
    bbox: BBox;                 // overlay bbox in SVG-root space at press
    baseTransform: string | null;
    center: { x: number; y: number };  // for rotate
    startAngle: number;                // for rotate (radians)
    moved: boolean;                    // past the drag threshold
}

/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

/** Swallow the click the browser fires after a drag, so it doesn't re-select or deselect. */
function swallowNextClick() {
    const h = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', h, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', h, true), 0);
}

/** The smallest resulting dimension (root units) a resize may shrink to. */
const MIN_DIM = 1;

/** Build the scale matrix for a resize handle (SVG-root space). */
function resizeMatrix(handle: HandleType, b: BBox, dx: number, dy: number, alt: boolean, shift: boolean): DOMMatrix {
    const movesLeft = handle === 'nw' || handle === 'sw' || handle === 'w';
    const movesRight = handle === 'ne' || handle === 'se' || handle === 'e';
    const movesTop = handle === 'nw' || handle === 'ne' || handle === 'n';
    const movesBottom = handle === 'sw' || handle === 'se' || handle === 's';

    let sx = 1, sy = 1;
    if (movesLeft || movesRight) {
        let newW = b.width + (movesRight ? dx : -dx);
        if (newW < MIN_DIM) newW = MIN_DIM;
        sx = newW / b.width;
    }
    if (movesTop || movesBottom) {
        let newH = b.height + (movesBottom ? dy : -dy);
        if (newH < MIN_DIM) newH = MIN_DIM;
        sy = newH / b.height;
    }

    // Shift on a corner constrains to a proportional scale.
    if (shift && (movesLeft || movesRight) && (movesTop || movesBottom)) {
        const s = Math.max(sx, sy);
        sx = s; sy = s;
    }

    // Origin: Alt scales from the centre; otherwise the opposite edge is fixed.
    const ox = alt ? b.x + b.width / 2 : movesLeft ? b.x + b.width : b.x;
    const oy = alt ? b.y + b.height / 2 : movesTop ? b.y + b.height : b.y;
    return scaleMatrix(sx, sy, ox, oy);
}

export default function BoundingBox({ svgElement, elementId, containerElement, onTransformComplete }: BoundingBoxProps) {
    const { t } = useTranslation();
    const zoom = useSVGEditorStore(state => state.viewport.zoom);
    const [bbox, setBbox] = useState<BBox | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
    const dragStartRef = useRef<DragStart | null>(null);
    const targetElementRef = useRef<SVGGraphicsElement | null>(null);

    useEffect(() => {
        updateBoundingBox();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svgElement, elementId, containerElement]);

    useEffect(() => {
        const handleResize = () => updateBoundingBox();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svgElement, elementId, containerElement]);

    /** Map a client point into SVG-root space (angle/position, zoom-invariant). */
    const toRootLocal = (clientX: number, clientY: number) => {
        const ctm = svgElement.getScreenCTM();
        if (!ctm) return null;
        const p = svgElement.createSVGPoint();
        p.x = clientX; p.y = clientY;
        return p.matrixTransform(ctm.inverse());
    };

    const updateBoundingBox = () => {
        const element = svgElement.querySelector(`#${CSS.escape(elementId)}`);
        if (element && element instanceof SVGGraphicsElement) {
            targetElementRef.current = element;
            try {
                const eb = element.getBBox();
                const corners = [
                    { x: eb.x, y: eb.y },
                    { x: eb.x + eb.width, y: eb.y },
                    { x: eb.x + eb.width, y: eb.y + eb.height },
                    { x: eb.x, y: eb.y + eb.height },
                ];
                const elementCTM = element.getScreenCTM();
                const svgCTM = svgElement.getScreenCTM();
                if (elementCTM && svgCTM) {
                    const relCTM = svgCTM.inverse().multiply(elementCTM);
                    const pts = corners.map((c) => {
                        const p = svgElement.createSVGPoint();
                        p.x = c.x; p.y = c.y;
                        return p.matrixTransform(relCTM);
                    });
                    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                    const minX = Math.min(...xs), maxX = Math.max(...xs);
                    const minY = Math.min(...ys), maxY = Math.max(...ys);
                    setBbox({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
                }
            } catch (error) {
                console.error('Error calculating bounding box:', error);
                setBbox(null);
            }
        } else {
            targetElementRef.current = null;
            setBbox(null);
        }
    };

    const handleMouseDown = (e: { clientX: number; clientY: number; stopPropagation(): void }, handle: HandleType) => {
        e.stopPropagation();
        if (!bbox || !targetElementRef.current) return;
        setIsDragging(true);
        setActiveHandle(handle);

        const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
        let startAngle = 0;
        if (handle === 'rotate') {
            const p = toRootLocal(e.clientX, e.clientY);
            if (p) startAngle = Math.atan2(p.y - center.y, p.x - center.x);
        }
        dragStartRef.current = {
            clientX: e.clientX,
            clientY: e.clientY,
            bbox: { ...bbox },
            baseTransform: targetElementRef.current.getAttribute('transform'),
            center,
            startAngle,
            moved: false,
        };
    };

    // A press that selected this element (SVGCanvas) continues as a move.
    useEffect(() => {
        const pending = useSVGEditorStore.getState().pendingPress;
        if (!bbox || !pending || pending.id !== elementId) return;
        useSVGEditorStore.getState().setPendingPress(null);
        handleMouseDown({ clientX: pending.clientX, clientY: pending.clientY, stopPropagation() {} }, 'move');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elementId, bbox]);

    // Move starts only from a press on this element's own painted geometry (the
    // browser's native hit-test), never from its bounding box: a click in an
    // empty, concave part of the box reaches whatever is visible there instead.
    // See specs/vector-editor.allium and VectorCraft's doc/src/hit.rs.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (e.button !== 0 || e.shiftKey) return;
            if (useSVGEditorStore.getState().pathEditMode) return;
            const t = e.target;
            if (!(t instanceof Element)) return;
            const own = svgElement.querySelector(`#${CSS.escape(elementId)}`);
            if (!own || !(own === t || own.contains(t))) return;
            e.preventDefault();
            handleMouseDown(e, 'move');
        };
        svgElement.addEventListener('mousedown', onDown);
        return () => svgElement.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svgElement, elementId, bbox]);

    const handleMouseMove = (e: MouseEvent) => {
        const ds = dragStartRef.current;
        const el = targetElementRef.current;
        if (!isDragging || !ds || !activeHandle || !el) return;

        if (!ds.moved) {
            if (Math.hypot(e.clientX - ds.clientX, e.clientY - ds.clientY) < DRAG_THRESHOLD) return;
            ds.moved = true;
        }

        const base = parseTransformToMatrix(ds.baseTransform);
        let gesture: DOMMatrix;

        if (activeHandle === 'rotate') {
            const p = toRootLocal(e.clientX, e.clientY);
            if (!p) return;
            let deg = ((Math.atan2(p.y - ds.center.y, p.x - ds.center.x) - ds.startAngle) * 180) / Math.PI;
            if (e.shiftKey) deg = Math.round(deg / 45) * 45;
            gesture = rotateMatrix(deg, ds.center.x, ds.center.y);
        } else if (activeHandle === 'move') {
            const dx = (e.clientX - ds.clientX) / zoom;
            const dy = (e.clientY - ds.clientY) / zoom;
            gesture = translateMatrix(dx, dy);
        } else {
            const dx = (e.clientX - ds.clientX) / zoom;
            const dy = (e.clientY - ds.clientY) / zoom;
            gesture = resizeMatrix(activeHandle, ds.bbox, dx, dy, e.altKey, e.shiftKey);
        }

        previewGesture(el, gesture, base, svgElement);
        updateBoundingBox();
    };

    /** Bake the rendered element's preview transform into geometry and commit once.
     *  If the commit does not land (element missing from the document, or the
     *  semantic guard refuses it), the on-screen preview is reverted: the
     *  canvas must never show an edit the document does not hold. */
    const commit = () => {
        const el = targetElementRef.current;
        if (!el) return;
        const revert = () => {
            const base = dragStartRef.current?.baseTransform ?? null;
            if (base) el.setAttribute('transform', base);
            else el.removeAttribute('transform');
        };
        const finalTransform = el.getAttribute('transform');
        const { svgDocument, commitGeometry } = useSVGEditorStore.getState();
        if (!svgDocument) return revert();

        const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
        if (doc.querySelector('parsererror')) return revert();
        const target = doc.querySelector(`[id="${CSS.escape(elementId)}"]`);
        if (!target) {
            console.warn(`[BoundingBox] ${elementId} is not in the document; gesture reverted`);
            return revert();
        }

        if (finalTransform) target.setAttribute('transform', finalTransform);
        else target.removeAttribute('transform');

        let serialized: string;
        if (target.tagName.toLowerCase() === 'g') {
            // Groups: distribute the transform into children (kernel-backed flatten).
            serialized = flattenGroupTransforms(new XMLSerializer().serializeToString(doc), [elementId]);
        } else {
            bakeElementTransform(target); // keep-primitive bake
            serialized = new XMLSerializer().serializeToString(doc);
        }
        serialized = serialized
            .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
            .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
        if (!commitGeometry(serialized)) revert();
    };

    const handleMouseUp = () => {
        // A press that never passed the threshold is a click: no gesture, no
        // history step; the click itself goes on to the selection logic.
        const moved = !!dragStartRef.current?.moved;
        if (isDragging && moved && targetElementRef.current) {
            commit();
            swallowNextClick();
        }
        setIsDragging(false);
        setActiveHandle(null);
        dragStartRef.current = null;
        updateBoundingBox();
        if (moved) onTransformComplete?.();
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDragging, activeHandle]);

    if (!bbox) return null;

    // Counter-scale so handles keep a constant screen size regardless of zoom
    const iz = 1 / zoom;
    const handleSvg = 12 * iz;
    const halfH = handleSvg / 2;
    const borderW = Math.max(1, iz);
    const rotStemH = 24 * iz;
    const rotBtnSvg = 20 * iz;
    const rotIconSvg = 12 * iz;

    const handleStyle: React.CSSProperties = {
        position: 'absolute',
        width: `${handleSvg}px`,
        height: `${handleSvg}px`,
        borderRadius: '50%',
        background: '#2563eb',
        border: `${borderW}px solid white`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        pointerEvents: 'auto',
    };

    // The frame is display-only (pointer-events: none): clicks inside the box
    // fall through to the visible art. Only the handles take the pointer.
    return (
        <div
            className="absolute pointer-events-none"
            style={{
                left: `${bbox.x}px`,
                top: `${bbox.y}px`,
                width: `${bbox.width}px`,
                height: `${bbox.height}px`,
                border: `${borderW}px solid #2563eb`,
                boxShadow: `0 0 0 ${borderW}px rgba(255,255,255,0.4)`,
                overflow: 'visible',
            }}
        >
            {/* Rotation stem + button */}
            <div style={{
                position: 'absolute',
                width: `${borderW}px`,
                height: `${rotStemH}px`,
                background: '#2563eb',
                left: '50%',
                top: `${-rotStemH}px`,
                transform: 'translateX(-50%)',
            }} />
            <div
                style={{
                    position: 'absolute',
                    width: `${rotBtnSvg}px`,
                    height: `${rotBtnSvg}px`,
                    background: 'white',
                    border: `${borderW}px solid #2563eb`,
                    borderRadius: '50%',
                    cursor: 'grab',
                    pointerEvents: 'auto',
                    zIndex: 50,
                    left: '50%',
                    top: `${-(rotStemH + rotBtnSvg * 0.65)}px`,
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#2563eb',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                }}
                onMouseDown={(e) => handleMouseDown(e, 'rotate')}
                title={t('svgEditor.rotate')}
            >
                <svg width={rotIconSvg} height={rotIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 5.5A10 10 0 1 1 11.26 2.8" />
                </svg>
            </div>

            {/* Resize handles — positioned with negative offsets in SVG-local units */}
            <div style={{ ...handleStyle, top: `${-halfH}px`, left: `${-halfH}px`, cursor: 'nwse-resize' }} onMouseDown={(e) => handleMouseDown(e, 'nw')} />
            <div style={{ ...handleStyle, top: `${-halfH}px`, right: `${-halfH}px`, cursor: 'nesw-resize' }} onMouseDown={(e) => handleMouseDown(e, 'ne')} />
            <div style={{ ...handleStyle, bottom: `${-halfH}px`, left: `${-halfH}px`, cursor: 'nesw-resize' }} onMouseDown={(e) => handleMouseDown(e, 'sw')} />
            <div style={{ ...handleStyle, bottom: `${-halfH}px`, right: `${-halfH}px`, cursor: 'nwse-resize' }} onMouseDown={(e) => handleMouseDown(e, 'se')} />
            <div style={{ ...handleStyle, top: `${-halfH}px`, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }} onMouseDown={(e) => handleMouseDown(e, 'n')} />
            <div style={{ ...handleStyle, bottom: `${-halfH}px`, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }} onMouseDown={(e) => handleMouseDown(e, 's')} />
            <div style={{ ...handleStyle, left: `${-halfH}px`, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }} onMouseDown={(e) => handleMouseDown(e, 'w')} />
            <div style={{ ...handleStyle, right: `${-halfH}px`, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }} onMouseDown={(e) => handleMouseDown(e, 'e')} />
        </div>
    );
}
