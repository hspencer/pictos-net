import { create } from 'zustand';
import {
    INITIAL_STYLES,
    INITIAL_KEYFRAMES,
    generateCssString,
    type StyleDefinition,
    type KeyframeDefinition,
} from '@style-editor/lib';
import {
    getSvgStyleText,
    parseCssToStyleDefinitions,
    updateSvgStyleText,
    parseOverrideRules,
    serializeOverrideRules,
    extractLibraryRules,
    setOverrideRule,
    removeOverrideRule,
    type OverrideMap,
} from '../utils/styleUtils';
import { flattenGroupTransforms } from '../utils/svgNormalizer';
import { parsePathToNodes, serializeNodesToPath } from '../utils/pathParser';
import { applyBoolean, applyBooleanN, applySimplify, type BooleanOp } from '../services/svgBooleanOps';
import {
    getAbsolutePathData,
    checkBooleanEligibility,
    sortByDocumentOrder,
} from '../utils/svgBooleanHelpers';

export interface SVGElement {
    id: string;
    tagName: string;
    attributes: Record<string, string>;
    children: SVGElement[];
    parentId?: string;
}

export interface Viewport {
    zoom: number;        // 0.1 .. 8
    panX: number;        // px translate
    panY: number;
    fitMode: boolean;
    canvasWidth: number;   // natural SVG dimensions (set once on load)
    canvasHeight: number;
}

const ZOOM_STEP = 1.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const LEFT_PANEL = 288;
const RIGHT_PANEL = 320;
const HEADER_HEIGHT = 64;
const FIT_PADDING = 40;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const purgeEmptyGroups = (root: Element) => {
    Array.from(root.querySelectorAll('g')).reverse().forEach(g => {
        if (!Array.from(g.childNodes).some(n => n.nodeType === Node.ELEMENT_NODE)) g.remove();
    });
};

const DEFAULT_VIEWPORT: Viewport = {
    zoom: 1,
    panX: 0,
    panY: 0,
    fitMode: true,
    canvasWidth: 0,
    canvasHeight: 0,
};

export interface EditorState {
    // SVG Document
    svgDocument: string | null;
    svgDOM: SVGElement | null;

    // Source mode: 'raw' (VTracer output, inline fills sacred) or 'structured' (library styles)
    svgSource: 'raw' | 'structured' | null;

    // Selection — single element or multi-select
    selectedElementId: string | null;
    selectedElementIds: Set<string>;

    // Styles
    styleDefinitions: StyleDefinition[];
    keyframes: KeyframeDefinition[];
    stylesVersion: number;

    // Two-level CSS model (derived from svgDocument, kept in sync)
    // @see CSS_STYLING_ARCHITECTURE.md
    overrideMap: OverrideMap;
    libraryValues: Map<string, Record<string, string>>;

    // Path edit mode
    pathEditMode: {
        elementId: string;
        elementType: 'path' | 'polygon' | 'polyline' | 'line' | 'unsupported';
    } | null;
    selectedNodeIndex: number | null;
    pathEditTool: 'select' | 'add' | 'delete';

    // Display modes
    outlineMode: boolean;

    // Viewport state (excluded from undo/redo)
    viewport: Viewport;

    // History
    history: string[];
    historyIndex: number;

    // Callback for real-time sync with parent component
    onSvgChange?: (svg: string) => void;

    // Actions
    setSvgSource: (source: 'raw' | 'structured' | null) => void;
    loadSVG: (svg: string, onChange?: (svg: string) => void, isRaw?: boolean) => void;
    updateSVGDOM: (dom: SVGElement) => void;
    selectElement: (id: string | null) => void;
    updateElementId: (oldId: string, newId: string) => void;
    updateElement: (id: string, updates: Partial<SVGElement>) => void;
    updateElementAttributes: (id: string, attributes: Record<string, string | null>) => void;
    moveElement: (dragId: string, targetId: string, mode?: 'inside' | 'after' | 'before') => void;
    deleteElement: (id: string) => void;

    // Multi-select actions
    selectElements: (ids: string[]) => void;
    toggleSelection: (id: string) => void;
    clearSelection: () => void;

    // Grouping actions
    groupElements: (ids: string[]) => void;
    ungroupElement: (groupId: string) => void;

    // Boolean operations on the current selection.
    // @see specs/svg-boolean-operations.allium
    applyBooleanOperation: (op: BooleanOp) => { ok: boolean; reason?: string };

    // Simplify (smart paths): refit polylines back to Bezier curves with
    // Schneider's algorithm. Reduces node count and classifies vertices.
    // Operates on each selected geometric element independently.
    applySimplifyOperation: (tolerance?: number) => { ok: boolean; reason?: string };

    // Class application (additive, does NOT strip inline styles)
    addClassToElement: (elementId: string, className: string) => void;
    stripInlineStyles: (elementId: string) => void;
    setStyles: (styles: StyleDefinition[]) => void;
    setKeyframes: (keyframes: KeyframeDefinition[]) => void;
    setElementClasses: (id: string, classes: string[]) => void;
    addElementClasses: (id: string, classes: string[]) => void;
    removeElementClasses: (id: string, classes: string[]) => void;

    // Two-level style actions
    // @see CSS_STYLING_ARCHITECTURE.md
    citeClass: (elementId: string, className: string) => void;
    unciteClass: (elementId: string, className: string) => void;
    setLocalOverride: (elementId: string, className: string, declarations: Record<string, string>) => void;
    restoreClassToLibrary: (elementId: string, className: string) => void;
    defineLocalStyle: (className: string, declarations: Record<string, string>) => void;
    getResolvedClassValues: (elementId: string, className: string) => Record<string, string>;
    cleanupInlineAttrs: (elementId: string) => void;

    // Display mode actions
    toggleOutlineMode: () => void;

    // Viewport actions (not in undo/redo)
    setViewport: (partial: Partial<Viewport>) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    zoomToFit: (windowW: number, windowH: number) => void;
    zoomToPoint: (factor: number, clientX: number, clientY: number, stageRect: DOMRect) => void;

    // Element manipulation actions
    duplicateElement: (id: string) => void;
    bringForward: (id: string) => void;
    sendBackward: (id: string) => void;

    // Path edit mode actions
    enterPathEditMode: (elementId: string) => void;
    exitPathEditMode: () => void;
    updatePathData: (elementId: string, newPathData: string) => void;
    convertShapeToPath: (elementId: string) => void;
    setSelectedNodeIndex: (index: number | null) => void;
    setPathEditTool: (tool: 'select' | 'add' | 'delete') => void;
    toggleNodeSmooth: () => void;

    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    addToHistory: () => void;
    exportToSchema: () => string;
    reset: () => void;
}

/**
 * Ensures every SVG element has an `id` attribute and writes the result back
 * to the SVG string, keeping svgDocument in sync with what svgDOM will have.
 *
 * normalizeSVG (SVGCanvas) assigns random IDs in-memory but never persists
 * them to svgDocument, so updateElementId would silently fail if an element
 * has an ID only in svgDOM but not in the stored string. Calling this in
 * loadSVG prevents that mismatch.
 */
const assignMissingElementIds = (svg: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svg;
    let changed = false;
    svgEl.querySelectorAll('*').forEach(el => {
        if (!el.id) {
            el.id = 'el-' + Math.random().toString(36).substr(2, 9);
            changed = true;
        }
    });
    return changed ? new XMLSerializer().serializeToString(svgEl) : svg;
};

/**
 * Builds a flat className→{property:value} map from StyleDefinition[].
 * Used by StylePanel for drift detection between library values and local overrides.
 * @see CSS_STYLING_ARCHITECTURE.md — libraryValues
 */
const buildLibraryValuesMap = (styles: StyleDefinition[]): Map<string, Record<string, string>> => {
    const map = new Map<string, Record<string, string>>();
    styles.forEach(style => {
        const declarations: Record<string, string> = {};
        style.rules.forEach(rule => { declarations[rule.property] = rule.value; });
        style.selectors.forEach(selector => {
            if (!selector.startsWith('.')) return;
            const cls = selector.slice(1);
            map.set(cls, { ...(map.get(cls) ?? {}), ...declarations });
        });
    });
    return map;
};

const mergeStyles = (base: StyleDefinition[], extra: StyleDefinition[]) => {
    const byKey = new Map<string, StyleDefinition>();
    const keyFor = (s: StyleDefinition) => s.selectors.slice().sort().join(',');
    base.forEach((style) => {
        byKey.set(keyFor(style), style);
    });
    extra.forEach((style) => {
        byKey.set(keyFor(style), style);
    });
    return Array.from(byKey.values());
};

const getElementClassesFromSvg = (svg: string, id: string): string[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const element = doc.querySelector(`#${CSS.escape(id)}`);
    if (!element) return [];
    const classAttr = element.getAttribute('class') || '';
    return classAttr.split(' ').map((c) => c.trim()).filter(Boolean);
};

const updateElementClassesInSvg = (svg: string, id: string, classes: string[]): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const element = doc.querySelector(`#${CSS.escape(id)}`);
    if (!element) return svg;
    if (classes.length === 0) {
        element.removeAttribute('class');
    } else {
        element.setAttribute('class', classes.join(' '));
    }
    return new XMLSerializer().serializeToString(doc);
};

export const useSVGEditorStore = create<EditorState>((set, get) => {
    const commitSvg = (svg: string) => {
        set((state) => ({
            svgDocument: svg,
            history: [...state.history.slice(0, state.historyIndex + 1), svg],
            historyIndex: state.historyIndex + 1,
        }));

        // NEW: Notify parent component of changes
        const onChange = get().onSvgChange;
        if (onChange) {
            onChange(svg);
        }
    };

    const getUsedClassNamesFromSvg = (svg: string): Set<string> => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        const elementsWithClass = doc.querySelectorAll('[class]');
        const classes = new Set<string>();
        elementsWithClass.forEach((el) => {
            const classAttr = el.getAttribute('class') || '';
            classAttr
                .split(' ')
                .map((c) => c.trim())
                .filter(Boolean)
                .forEach((cls) => classes.add(cls));
        });
        return classes;
    };

    const getUsedStyles = (styles: StyleDefinition[], usedClasses: Set<string>) => {
        return styles.filter((style) =>
            style.selectors.some((selector) => {
                if (!selector.startsWith('.')) return false;
                const className = selector.replace('.', '');
                return usedClasses.has(className);
            })
        );
    };

    /**
     * Regenerates library rules from used classes, then re-appends any existing
     * local override rules so they are not lost during <style> reconstruction.
     * @see CSS_STYLING_ARCHITECTURE.md — Rebuild Cycle
     */
    const applyUsedStylesToSvg = (
        svg: string,
        styles: StyleDefinition[],
        keyframes: KeyframeDefinition[]
    ) => {
        // Preserve existing local override rules before regenerating the style block
        const currentCss = getSvgStyleText(svg);
        const overrides = parseOverrideRules(currentCss);
        const overrideCss = serializeOverrideRules(overrides).trim();

        const usedClasses = getUsedClassNamesFromSvg(svg);
        const usedStyles = getUsedStyles(styles, usedClasses);
        const libraryCss = generateCssString(usedStyles, keyframes).trim();

        // If there are no library styles and no overrides, remove the <style> element
        if (!libraryCss && !overrideCss) {
            return updateSvgStyleText(svg, '', true);
        }

        const parts: string[] = [];
        if (libraryCss) parts.push(libraryCss);
        if (overrideCss) parts.push(overrideCss);
        const combined = parts.join('\n\n/* --- local overrides --- */\n\n');

        return updateSvgStyleText(svg, combined, false);
    };

    const resolveStylesForSvg = (svg: string) => {
        const cssText = getSvgStyleText(svg);
        const parsed = cssText.trim() ? parseCssToStyleDefinitions(cssText) : [];
        const baseStyles = get().styleDefinitions.length > 0 ? get().styleDefinitions : INITIAL_STYLES;
        if (parsed.length > 0) {
            return mergeStyles(baseStyles, parsed);
        }
        return baseStyles;
    };

    return {
        svgDocument: null,
        svgDOM: null,
        svgSource: null,
        selectedElementId: null,
        selectedElementIds: new Set<string>(),
        styleDefinitions: INITIAL_STYLES,
        keyframes: INITIAL_KEYFRAMES,
        stylesVersion: 0,
        overrideMap: new Map(),
        libraryValues: new Map(),
        pathEditMode: null,
        selectedNodeIndex: null,
        pathEditTool: 'select',
        outlineMode: false,
        viewport: { ...DEFAULT_VIEWPORT },
        history: [],
        historyIndex: -1,
        onSvgChange: undefined,

        setSvgSource: (source) => set({ svgSource: source }),

        loadSVG: (svg: string, onChange?: (svg: string) => void, isRaw?: boolean) => {
            // Persist IDs to svgDocument so updateElementId can find elements
            // by ID. normalizeSVG in SVGCanvas assigns IDs only in-memory;
            // without this step those IDs exist in svgDOM but not svgDocument.
            const withIds = assignMissingElementIds(svg);

            if (isRaw) {
                // Raw SVG: skip style resolution and library injection,
                // keep inline fills sacred
                set((state) => ({
                    stylesVersion: state.stylesVersion + 1,
                    onSvgChange: onChange,
                    overrideMap: new Map(),
                    libraryValues: new Map(),
                }));
                commitSvg(withIds);
                return;
            }

            const styles = resolveStylesForSvg(withIds);
            const keyframes = get().keyframes.length > 0 ? get().keyframes : INITIAL_KEYFRAMES;
            const nextSvg = applyUsedStylesToSvg(withIds, styles, keyframes);
            const overrideMap = parseOverrideRules(getSvgStyleText(nextSvg));
            const libraryValues = buildLibraryValuesMap(styles);
            set((state) => ({
                styleDefinitions: styles,
                keyframes,
                stylesVersion: state.stylesVersion + 1,
                onSvgChange: onChange,
                overrideMap,
                libraryValues,
            }));
            commitSvg(nextSvg);
        },

        updateSVGDOM: (dom: SVGElement) => {
            set({ svgDOM: dom });
        },

        selectElement: (id: string | null) => {
            set({ selectedElementId: id, selectedElementIds: new Set() });
        },

        updateElementId: (oldId: string, newId: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(oldId)}`);
            if (!element) return;

            element.id = newId;
            let serialized = new XMLSerializer().serializeToString(doc);

            // Migrate override rules: #oldId.class { ... } → #newId.class { ... }
            const css = getSvgStyleText(serialized);
            const overrides = parseOverrideRules(css);
            if (overrides.has(oldId)) {
                overrides.set(newId, overrides.get(oldId)!);
                overrides.delete(oldId);
                const libRules = extractLibraryRules(css).trim();
                const overrideCss = serializeOverrideRules(overrides).trim();
                const parts: string[] = [];
                if (libRules) parts.push(libRules);
                if (overrideCss) parts.push(overrideCss);
                const combined = parts.join('\n\n/* --- local overrides --- */\n\n');
                serialized = updateSvgStyleText(serialized, combined, !combined.trim());
            }

            const nextSvg = applyUsedStylesToSvg(serialized, get().styleDefinitions, get().keyframes);
            const newOverrideMap = parseOverrideRules(getSvgStyleText(nextSvg));
            const wasSelected = get().selectedElementId === oldId;

            // Batch document, history, overrideMap and selectedElementId in one set
            set((state) => ({
                svgDocument: nextSvg,
                history: [...state.history.slice(0, state.historyIndex + 1), nextSvg],
                historyIndex: state.historyIndex + 1,
                overrideMap: newOverrideMap,
                selectedElementId: wasSelected ? newId : state.selectedElementId,
            }));
            const onChange = get().onSvgChange;
            if (onChange) onChange(nextSvg);
        },

        updateElement: (id: string, updates: Partial<SVGElement>) => {
            const { svgDOM } = get();
            if (!svgDOM) return;

            const updateNode = (element: SVGElement): SVGElement => {
                if (element.id === id) {
                    return { ...element, ...updates };
                }
                return {
                    ...element,
                    children: element.children.map(updateNode),
                };
            };

            const updatedDOM = updateNode(svgDOM);
            set({ svgDOM: updatedDOM });
        },

        updateElementAttributes: (id: string, attributes: Record<string, string | null>) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(id)}`);
            if (!element) return;

            Object.entries(attributes).forEach(([key, value]) => {
                if (value === null) {
                    element.removeAttribute(key);
                } else {
                    element.setAttribute(key, value);
                }
            });

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
        },

        moveElement: (dragId: string, targetId: string, mode: 'inside' | 'after' | 'before' = 'after') => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const dragElement = doc.querySelector(`#${CSS.escape(dragId)}`);
            const targetElement = doc.querySelector(`#${CSS.escape(targetId)}`);

            if (!dragElement || !targetElement || dragElement === targetElement) return;
            if (dragElement.contains(targetElement)) return;

            if (mode === 'inside') {
                targetElement.appendChild(dragElement);
            } else if (mode === 'before') {
                const parent = targetElement.parentNode;
                if (!parent) return;
                parent.insertBefore(dragElement, targetElement);
            } else {
                const parent = targetElement.parentNode;
                if (!parent) return;
                parent.insertBefore(dragElement, targetElement.nextSibling);
            }

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
        },

        deleteElement: (id: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(id)}`);
            if (!element) return;
            element.remove();

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
            set({ selectedElementId: null });
        },

        setStyles: (styles: StyleDefinition[]) => {
            set({ styleDefinitions: styles });
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const keyframes = get().keyframes;
            const updatedSvg = applyUsedStylesToSvg(svgDocument, styles, keyframes);
            commitSvg(updatedSvg);
        },

        setKeyframes: (keyframes: KeyframeDefinition[]) => {
            set({ keyframes });
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const styles = get().styleDefinitions;
            const updatedSvg = applyUsedStylesToSvg(svgDocument, styles, keyframes);
            commitSvg(updatedSvg);
        },

        setElementClasses: (id: string, classes: string[]) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const updatedSvg = updateElementClassesInSvg(svgDocument, id, classes);
            const nextSvg = applyUsedStylesToSvg(
                updatedSvg,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
        },

        addElementClasses: (id: string, classes: string[]) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const current = getElementClassesFromSvg(svgDocument, id);
            const next = [...current];
            classes.forEach((cls) => {
                if (!next.includes(cls)) next.push(cls);
            });
            const updatedSvg = updateElementClassesInSvg(svgDocument, id, next);
            const nextSvg = applyUsedStylesToSvg(
                updatedSvg,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
        },

        removeElementClasses: (id: string, classes: string[]) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const current = getElementClassesFromSvg(svgDocument, id);
            const next = current.filter((cls) => !classes.includes(cls));
            const updatedSvg = updateElementClassesInSvg(svgDocument, id, next);
            const nextSvg = applyUsedStylesToSvg(
                updatedSvg,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
        },

        // ── Multi-select actions ──────────────────────────────────────────────

        selectElements: (ids: string[]) => {
            set({
                selectedElementIds: new Set(ids),
                selectedElementId: ids.length === 1 ? ids[0] : ids.length > 0 ? ids[0] : null,
            });
        },

        toggleSelection: (id: string) => {
            const state = get();
            const current = new Set(state.selectedElementIds);
            // Bridge single-select → multi-select: if there's a single
            // selectedElementId not yet in the multi-set, include it before
            // toggling. Without this, shift+click after a normal click would
            // drop the previously-selected element.
            if (current.size === 0 && state.selectedElementId && state.selectedElementId !== id) {
                current.add(state.selectedElementId);
            }
            if (current.has(id)) {
                current.delete(id);
            } else {
                current.add(id);
            }
            set({
                selectedElementIds: current,
                selectedElementId: current.size === 1 ? Array.from(current)[0] : current.size > 0 ? id : null,
            });
        },

        clearSelection: () => {
            set({ selectedElementIds: new Set(), selectedElementId: null });
        },

        // ── Group / Ungroup actions ────────────────────────────────────────────

        groupElements: (ids: string[]) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument || ids.length < 2) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');

            // Collect elements in document order
            const elements: Element[] = [];
            ids.forEach(id => {
                const el = doc.querySelector(`#${CSS.escape(id)}`);
                if (el) elements.push(el);
            });
            if (elements.length < 2) return;

            // Create group at position of first element
            const groupId = 'grupo-' + Math.random().toString(36).substr(2, 5);
            const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.id = groupId;

            // Insert group before the first element
            const firstEl = elements[0];
            firstEl.parentNode?.insertBefore(group, firstEl);

            // Move all elements into the group (preserves order)
            elements.forEach(el => group.appendChild(el));

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
            set({ selectedElementId: groupId, selectedElementIds: new Set([groupId]) });
        },

        ungroupElement: (groupId: string) => {
            let svgDocument = get().svgDocument;
            if (!svgDocument) return;

            // Bake the group's transform into its children BEFORE ungrouping.
            // This ensures children inherit the group's position/scale/rotation
            // and stay in their visual positions after the group is removed.
            svgDocument = flattenGroupTransforms(svgDocument, [groupId]);

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const group = doc.querySelector(`#${CSS.escape(groupId)}`);
            if (!group || group.tagName.toLowerCase() !== 'g') return;

            const parent = group.parentNode;
            if (!parent) return;

            // Move children out before the group, preserving order
            while (group.firstChild) {
                parent.insertBefore(group.firstChild, group);
            }
            group.remove();

            const svgEl = doc.querySelector('svg');
            if (svgEl) purgeEmptyGroups(svgEl);

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
            set({ selectedElementId: null, selectedElementIds: new Set() });
        },

        // ── Boolean operations ─────────────────────────────────────────────────
        // @see specs/svg-boolean-operations.allium
        applyBooleanOperation: (op: BooleanOp) => {
            const { svgDocument, selectedElementIds, selectedElementId } = get();
            if (!svgDocument) return { ok: false, reason: 'No SVG loaded' };

            const ids = selectedElementIds.size > 0
                ? Array.from(selectedElementIds)
                : selectedElementId ? [selectedElementId] : [];

            const eligibility = checkBooleanEligibility(op, ids, svgDocument);
            if (!eligibility.ok) return eligibility;

            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const svgRoot = doc.querySelector('svg');
            if (!svgRoot) return { ok: false, reason: 'Invalid SVG document' };

            // Resolve operands and Base.
            // For union/intersect: Base = first selected.
            // For subtract: Base = bottom-Z (bitten); Top = top-Z (biter).
            let baseId: string;
            let topId: string | null = null;
            if (op === 'subtract') {
                const sorted = sortByDocumentOrder(ids, svgDocument);
                baseId = sorted[0];
                topId = sorted[1];
            } else {
                baseId = ids[0];
            }

            const baseEl = doc.querySelector(`#${CSS.escape(baseId)}`);
            if (!baseEl) return { ok: false, reason: 'Base element missing' };

            // Capture operand element references up front. Querying by id
            // later (after the result <path> is inserted with the Base's id)
            // would match the new path instead of the original element,
            // because two elements would briefly share the same id.
            const operandData: Array<{ id: string; d: string; el: Element }> = [];
            for (const id of ids) {
                const el = doc.querySelector(`#${CSS.escape(id)}`);
                if (!el) return { ok: false, reason: `Element ${id} missing` };
                const d = getAbsolutePathData(el, svgRoot);
                if (!d) return { ok: false, reason: `Element ${id} has no usable geometry` };
                operandData.push({ id, d, el });
            }

            // Compute the result.
            let resultD: string | null = null;
            if (op === 'union') {
                resultD = applyBooleanN('union', operandData.map(o => o.d));
            } else if (op === 'intersect') {
                resultD = applyBooleanN('intersect', operandData.map(o => o.d));
            } else {
                const baseD = operandData.find(o => o.id === baseId)!.d;
                const topD = operandData.find(o => o.id === topId)!.d;
                resultD = applyBoolean('subtract', baseD, topD);
            }

            if (resultD === null) {
                return { ok: false, reason: 'Operation produced an empty shape' };
            }

            // Replace the Base in-place with a <path> carrying the result.
            // Other operands are removed. Result is placed at the SVG root
            // (V1: collapse toward root; DCA logic comes later).
            const surviving = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
            // Inherit Base identity (id, classes) per spec.
            const baseClass = baseEl.getAttribute('class');
            if (baseClass) surviving.setAttribute('class', baseClass);
            // Preserve presentation attributes that survive at the path level.
            // (Class-driven fills already covered above; these handle the
            // common case where VTracer wrote inline fills.)
            for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity']) {
                const v = baseEl.getAttribute(attr);
                if (v) surviving.setAttribute(attr, v);
            }
            surviving.setAttribute('id', baseId);
            surviving.setAttribute('d', resultD);
            // For subtract and union, the result may be a compound path with
            // sub-paths that represent holes. evenodd reliably renders holes
            // regardless of winding order, which paper.js's reorient does not
            // always preserve through the d-string round-trip.
            // Setting both as attribute and inline style: presentation attrs
            // have lower CSS specificity than type-selector rules in <style>,
            // so the inline style guarantees evenodd wins.
            if (op === 'subtract' || op === 'union') {
                surviving.setAttribute('fill-rule', 'evenodd');
                const existingStyle = surviving.getAttribute('style') || '';
                surviving.setAttribute(
                    'style',
                    `${existingStyle ? existingStyle + ';' : ''}fill-rule:evenodd`
                );
            }

            // Resolve the insertion anchor (Base's top-level ancestor under
            // root) BEFORE removing operands.
            const rootNode: Node = svgRoot;
            let baseTopAncestor: Element = baseEl;
            while (baseTopAncestor.parentNode && baseTopAncestor.parentNode !== rootNode) {
                baseTopAncestor = baseTopAncestor.parentNode as Element;
            }
            const insertReference = baseTopAncestor.nextSibling;

            // Remove every operand FIRST, then insert the result. Doing it the
            // other way around briefly creates two elements sharing the same
            // id (Base.id), and a later querySelector would match the new
            // path instead of the original Base.
            for (const { el } of operandData) {
                el.remove();
            }

            // Insert the new path at the Base's z-position.
            svgRoot.insertBefore(surviving, insertReference);

            purgeEmptyGroups(svgRoot);

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);

            // Result selection: the surviving Base.
            set({ selectedElementId: baseId, selectedElementIds: new Set([baseId]) });
            return { ok: true };
        },

        // ── Simplify (smart paths) ─────────────────────────────────────────────
        // Refit polylines back to Bezier curves with paper.js's Schneider-fit
        // simplifier. Operates on each selected <path> in place; non-path
        // elements are skipped (they don't have polyline noise to clean up).
        applySimplifyOperation: (tolerance: number = 0.5) => {
            const { svgDocument, selectedElementIds, selectedElementId, pathEditMode } = get();
            if (!svgDocument) return { ok: false, reason: 'No SVG loaded' };

            // While in path edit mode the canonical "selection" is the path
            // being edited. Fall back to it when the regular selection is empty.
            const ids = selectedElementIds.size > 0
                ? Array.from(selectedElementIds)
                : selectedElementId ? [selectedElementId]
                : pathEditMode?.elementId ? [pathEditMode.elementId]
                : [];
            if (ids.length === 0) return { ok: false, reason: 'No selection' };

            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const svgRoot = doc.querySelector('svg');
            if (!svgRoot) return { ok: false, reason: 'Invalid SVG document' };

            let touched = 0;
            for (const id of ids) {
                const el = doc.querySelector(`#${CSS.escape(id)}`);
                if (!el) continue;
                if (el.tagName.toLowerCase() !== 'path') continue;
                const currentD = el.getAttribute('d');
                if (!currentD) continue;
                const simplified = applySimplify(currentD, tolerance);
                if (!simplified) continue;
                el.setAttribute('d', simplified);
                touched++;
            }

            if (touched === 0) {
                return { ok: false, reason: 'Selection has no <path> elements to simplify' };
            }

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized,
                get().styleDefinitions,
                get().keyframes
            );
            commitSvg(nextSvg);
            return { ok: true };
        },

        addClassToElement: (elementId: string, className: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const current = getElementClassesFromSvg(svgDocument, elementId);
            if (current.includes(className)) return;

            // Additive: add class WITHOUT stripping inline fills
            let svg = updateElementClassesInSvg(svgDocument, elementId, [...current, className]);

            const isRaw = get().svgSource === 'raw';
            if (!isRaw) {
                svg = applyUsedStylesToSvg(svg, get().styleDefinitions, get().keyframes);
                set({ overrideMap: parseOverrideRules(getSvgStyleText(svg)) });
            }
            commitSvg(svg);
        },

        stripInlineStyles: (elementId: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');

            const stripEl = (el: Element) => {
                ['fill', 'stroke', 'stroke-width', 'opacity', 'style'].forEach(attr => el.removeAttribute(attr));
                // Recurse into children
                Array.from(el.children).forEach(child => stripEl(child));
            };

            const el = doc.querySelector(`#${CSS.escape(elementId)}`);
            if (!el) return;
            stripEl(el);
            const svg = new XMLSerializer().serializeToString(doc);
            commitSvg(svg);
        },

        // ── Two-level CSS model actions ────────────────────────────────────────

        /**
         * CITE: Adds className to element, instantiates its library rule in
         * <style>, and strips any remaining inline presentation attrs.
         * @see CSS_STYLING_ARCHITECTURE.md — CITE step
         */
        citeClass: (elementId: string, className: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const current = getElementClassesFromSvg(svgDocument, elementId);
            if (current.includes(className)) return; // already cited

            // Add class to element
            let svg = updateElementClassesInSvg(svgDocument, elementId, [...current, className]);

            // Regenerate <style> with the new class (preserves overrides)
            svg = applyUsedStylesToSvg(svg, get().styleDefinitions, get().keyframes);

            // Strip any lingering inline presentation attrs from this element
            const parser = new DOMParser();
            const doc = parser.parseFromString(svg, 'image/svg+xml');
            const el = doc.querySelector(`#${CSS.escape(elementId)}`);
            if (el) {
                ['fill', 'stroke', 'stroke-width', 'opacity', 'style'].forEach(attr => {
                    el.removeAttribute(attr);
                });
                svg = new XMLSerializer().serializeToString(doc);
            }

            set({ overrideMap: parseOverrideRules(getSvgStyleText(svg)) });
            commitSvg(svg);
        },

        /**
         * UNCITE: Removes className from element, deletes its local override rule,
         * and garbage-collects the library rule if no element uses the class anymore.
         * @see CSS_STYLING_ARCHITECTURE.md — UNCITE + Garbage Collection
         */
        unciteClass: (elementId: string, className: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const current = getElementClassesFromSvg(svgDocument, elementId);
            const remaining = current.filter(c => c !== className);
            let svg = updateElementClassesInSvg(svgDocument, elementId, remaining);

            // Remove any local override rule for this (elementId, className)
            svg = removeOverrideRule(svg, elementId, className);

            // GC: rebuild <style> — unused class rules are dropped automatically
            svg = applyUsedStylesToSvg(svg, get().styleDefinitions, get().keyframes);

            set({ overrideMap: parseOverrideRules(getSvgStyleText(svg)) });
            commitSvg(svg);
        },

        /**
         * MODIFY: Writes property overrides for (elementId, className) into the
         * <style> block as a #id.class { ... } rule. Never writes inline attrs.
         * @see CSS_STYLING_ARCHITECTURE.md — Level 2: Local Overrides
         */
        setLocalOverride: (elementId: string, className: string, declarations: Record<string, string>) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const svg = setOverrideRule(svgDocument, elementId, className, declarations);
            set({ overrideMap: parseOverrideRules(getSvgStyleText(svg)) });
            commitSvg(svg);
        },

        /**
         * RESTORE: Removes the local override rule for (elementId, className),
         * reverting that element back to the library definition.
         * @see CSS_STYLING_ARCHITECTURE.md — Restore to Library
         */
        restoreClassToLibrary: (elementId: string, className: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const svg = removeOverrideRule(svgDocument, elementId, className);
            set({ overrideMap: parseOverrideRules(getSvgStyleText(svg)) });
            commitSvg(svg);
        },

        /**
         * Defines a new class locally (in-memory, for this session).
         * The CSS rule is written to the SVG <style> block the first time
         * the class gets cited on any element via citeClass().
         * @see CSS_STYLING_ARCHITECTURE.md
         */
        defineLocalStyle: (className: string, declarations: Record<string, string>) => {
            const newStyle: StyleDefinition = {
                id: 'local-' + Math.random().toString(36).slice(2, 7),
                selectors: [`.${className}`],
                rules: Object.entries(declarations)
                    .filter(([, v]) => v.trim() !== '')
                    .map(([property, value]) => ({
                        id: Math.random().toString(36).slice(2, 9),
                        property,
                        value,
                    })),
            };
            const current = get().styleDefinitions;
            const merged = [
                ...current.filter(s => !s.selectors.includes(`.${className}`)),
                newStyle,
            ];
            set({
                styleDefinitions: merged,
                libraryValues: buildLibraryValuesMap(merged),
            });
        },

        /**
         * Returns the resolved visual values for (elementId, className):
         * library defaults merged with any local overrides.
         * @see CSS_STYLING_ARCHITECTURE.md — Resolved Values
         */
        getResolvedClassValues: (elementId: string, className: string) => {
            const { libraryValues, overrideMap } = get();
            const base = libraryValues.get(className) ?? {};
            const overrides = overrideMap.get(elementId)?.get(className) ?? {};
            return { ...base, ...overrides };
        },

        /**
         * Strips all inline presentation attrs from a single element in the
         * current svgDocument. Safe to call on an already-clean element.
         * @see CSS_STYLING_ARCHITECTURE.md — Pipeline Cleanup
         */
        cleanupInlineAttrs: (elementId: string) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const el = doc.querySelector(`#${CSS.escape(elementId)}`);
            if (!el) return;
            ['fill', 'stroke', 'stroke-width', 'opacity', 'style'].forEach(attr => el.removeAttribute(attr));
            const svg = new XMLSerializer().serializeToString(doc);
            commitSvg(svg);
        },

        // ── Display mode actions ──────────────────────────────────────────────

        toggleOutlineMode: () => {
            set((state) => ({ outlineMode: !state.outlineMode }));
        },

        // ── Viewport actions (not in undo/redo) ─────────────────────────────

        setViewport: (partial) => {
            set({ viewport: { ...get().viewport, ...partial } });
        },

        zoomIn: () => {
            const { zoom } = get().viewport;
            set({ viewport: { ...get().viewport, zoom: clampZoom(zoom * ZOOM_STEP), fitMode: false } });
        },

        zoomOut: () => {
            const { zoom } = get().viewport;
            set({ viewport: { ...get().viewport, zoom: clampZoom(zoom / ZOOM_STEP), fitMode: false } });
        },

        zoomToFit: (windowW, windowH) => {
            const { canvasWidth, canvasHeight } = get().viewport;
            if (!canvasWidth || !canvasHeight) return;
            const availW = Math.max(1, windowW - LEFT_PANEL - RIGHT_PANEL - FIT_PADDING * 2);
            const availH = Math.max(1, windowH - HEADER_HEIGHT - FIT_PADDING * 2);
            const scale = clampZoom(Math.min(availW / canvasWidth, availH / canvasHeight));
            const panX = LEFT_PANEL + (availW - canvasWidth * scale) / 2 + FIT_PADDING;
            const panY = HEADER_HEIGHT + (availH - canvasHeight * scale) / 2 + FIT_PADDING;
            set({ viewport: { ...get().viewport, zoom: scale, panX, panY, fitMode: true } });
        },

        zoomToPoint: (factor, cx, cy, stageRect) => {
            const { zoom, panX, panY } = get().viewport;
            const mx = cx - stageRect.left;
            const my = cy - stageRect.top;
            const worldX = (mx - panX) / zoom;
            const worldY = (my - panY) / zoom;
            const newZoom = clampZoom(zoom * factor);
            set({ viewport: { ...get().viewport,
                zoom: newZoom,
                panX: mx - worldX * newZoom,
                panY: my - worldY * newZoom,
                fitMode: false,
            }});
        },

        // ── Element manipulation actions ──────────────────────────────────────

        duplicateElement: (id) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(id)}`);
            if (!element || !element.parentNode) return;

            const clone = element.cloneNode(true) as Element;
            const newId = 'el-' + Math.random().toString(36).substr(2, 9);
            clone.id = newId;

            // Offset the clone slightly
            if (clone instanceof SVGGraphicsElement) {
                const existing = clone.getAttribute('transform') || '';
                clone.setAttribute('transform', `${existing} translate(10, 10)`.trim());
            }

            element.parentNode.insertBefore(clone, element.nextSibling);

            const serialized = new XMLSerializer().serializeToString(doc);
            const isRaw = get().svgSource === 'raw';
            const nextSvg = isRaw ? serialized : applyUsedStylesToSvg(
                serialized, get().styleDefinitions, get().keyframes
            );
            commitSvg(nextSvg);
            set({ selectedElementId: newId, selectedElementIds: new Set([newId]) });
        },

        bringForward: (id) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(id)}`);
            if (!element || !element.parentNode) return;

            const next = element.nextElementSibling;
            if (next) {
                element.parentNode.insertBefore(element, next.nextSibling);
                const serialized = new XMLSerializer().serializeToString(doc);
                commitSvg(serialized);
            }
        },

        sendBackward: (id) => {
            const svgDocument = get().svgDocument;
            if (!svgDocument) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(svgDocument, 'image/svg+xml');
            const element = doc.querySelector(`#${CSS.escape(id)}`);
            if (!element || !element.parentNode) return;

            const prev = element.previousElementSibling;
            if (prev) {
                element.parentNode.insertBefore(element, prev);
                const serialized = new XMLSerializer().serializeToString(doc);
                commitSvg(serialized);
            }
        },

        // ── Path edit mode actions ────────────────────────────────────────────

        enterPathEditMode: (elementId: string) => {
            const { svgDocument } = get();
            if (!svgDocument) return;
            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const el = doc.getElementById(elementId);
            if (!el) return;
            const tag = el.tagName.toLowerCase();
            const supportedDirectly = ['path', 'polygon', 'polyline', 'line'];
            const unsupported = ['rect', 'circle', 'ellipse'];
            const elementType = supportedDirectly.includes(tag)
                ? tag as 'path' | 'polygon' | 'polyline' | 'line'
                : unsupported.includes(tag) ? 'unsupported' as const : 'unsupported' as const;
            set({ pathEditMode: { elementId, elementType }, selectedNodeIndex: null, pathEditTool: 'select' });
        },

        exitPathEditMode: () => {
            set({ pathEditMode: null, selectedNodeIndex: null, pathEditTool: 'select' });
        },

        updatePathData: (elementId: string, newPathData: string) => {
            const { svgDocument, svgSource } = get();
            if (!svgDocument) return;
            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const el = doc.getElementById(elementId);
            if (!el) return;
            const tag = el.tagName.toLowerCase();
            if (tag === 'path') el.setAttribute('d', newPathData);
            else if (tag === 'polygon' || tag === 'polyline') el.setAttribute('points', newPathData);
            else if (tag === 'line') {
                const [x1, y1, x2, y2] = newPathData.split(' ').map(Number);
                el.setAttribute('x1', String(x1)); el.setAttribute('y1', String(y1));
                el.setAttribute('x2', String(x2)); el.setAttribute('y2', String(y2));
            }
            const svg = new XMLSerializer().serializeToString(doc);
            const nextSvg = svgSource === 'raw' ? svg : applyUsedStylesToSvg(svg, get().styleDefinitions, get().keyframes);
            commitSvg(nextSvg);
        },

        convertShapeToPath: (elementId: string) => {
            const { svgDocument } = get();
            if (!svgDocument) return;
            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const el = doc.getElementById(elementId);
            if (!el) return;
            const tag = el.tagName.toLowerCase();
            const ns = 'http://www.w3.org/2000/svg';
            const path = doc.createElementNS(ns, 'path');
            Array.from(el.attributes).forEach(attr => {
                if (!['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry'].includes(attr.name)) {
                    path.setAttribute(attr.name, attr.value);
                }
            });
            let d = '';
            if (tag === 'rect') {
                const x = parseFloat(el.getAttribute('x') || '0');
                const y = parseFloat(el.getAttribute('y') || '0');
                const w = parseFloat(el.getAttribute('width') || '0');
                const h = parseFloat(el.getAttribute('height') || '0');
                d = `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
            } else if (tag === 'circle') {
                const cx = parseFloat(el.getAttribute('cx') || '0');
                const cy = parseFloat(el.getAttribute('cy') || '0');
                const r = parseFloat(el.getAttribute('r') || '0');
                d = `M${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} Z`;
            } else if (tag === 'ellipse') {
                const cx = parseFloat(el.getAttribute('cx') || '0');
                const cy = parseFloat(el.getAttribute('cy') || '0');
                const rx = parseFloat(el.getAttribute('rx') || '0');
                const ry = parseFloat(el.getAttribute('ry') || '0');
                d = `M${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} Z`;
            }
            if (d) {
                path.setAttribute('d', d);
                el.parentNode?.replaceChild(path, el);
                const svg = new XMLSerializer().serializeToString(doc);
                commitSvg(svg);
                set({ pathEditMode: { elementId, elementType: 'path' }, selectedNodeIndex: null });
            }
        },

        setSelectedNodeIndex: (index: number | null) => {
            set({ selectedNodeIndex: index });
        },

        setPathEditTool: (tool: 'select' | 'add' | 'delete') => {
            set({ pathEditTool: tool });
        },

        toggleNodeSmooth: () => {
            const { svgDocument, svgSource, pathEditMode, selectedNodeIndex, styleDefinitions, keyframes } = get();
            if (!svgDocument || !pathEditMode || selectedNodeIndex == null) return;

            const doc = new DOMParser().parseFromString(svgDocument, 'image/svg+xml');
            const el = doc.getElementById(pathEditMode.elementId);
            if (!el || el.tagName.toLowerCase() !== 'path') return;

            const d = el.getAttribute('d');
            if (!d) return;

            const nodes = parsePathToNodes(d);
            const node = nodes[selectedNodeIndex];
            if (!node || node.command === 'M' || node.command === 'Z') return;

            const hasHandles = node.cp1 || node.cp2;

            if (!hasHandles || node.kind === 'anchor-corner') {
                // Corner → Smooth: convert to C with 1/3-offset control points
                const prev = selectedNodeIndex > 0 ? nodes[selectedNodeIndex - 1] : null;
                const next = selectedNodeIndex < nodes.length - 1 ? nodes[selectedNodeIndex + 1] : null;

                // Convert incoming segment (prev → this) to cubic
                if (prev) {
                    node.command = 'C';
                    node.cp1 = {
                        x: prev.anchor.x + (node.anchor.x - prev.anchor.x) / 3,
                        y: prev.anchor.y + (node.anchor.y - prev.anchor.y) / 3,
                    };
                    node.cp2 = {
                        x: prev.anchor.x + (node.anchor.x - prev.anchor.x) * 2 / 3,
                        y: prev.anchor.y + (node.anchor.y - prev.anchor.y) * 2 / 3,
                    };
                }

                // Convert outgoing segment (this → next) to cubic, ensure smoothness
                if (next && (next.command === 'L' || next.command === 'M')) {
                    next.command = 'C';
                    // "out" handle: reflect in-handle through this anchor for collinearity
                    if (node.cp2) {
                        next.cp1 = {
                            x: 2 * node.anchor.x - node.cp2.x,
                            y: 2 * node.anchor.y - node.cp2.y,
                        };
                    } else {
                        next.cp1 = {
                            x: node.anchor.x + (next.anchor.x - node.anchor.x) / 3,
                            y: node.anchor.y + (next.anchor.y - node.anchor.y) / 3,
                        };
                    }
                    next.cp2 = {
                        x: node.anchor.x + (next.anchor.x - node.anchor.x) * 2 / 3,
                        y: node.anchor.y + (next.anchor.y - node.anchor.y) * 2 / 3,
                    };
                }

                node.kind = 'anchor-smooth';
            } else {
                // Smooth/Asymm → Corner: remove handles, revert to L
                node.command = 'L';
                node.cp1 = undefined;
                node.cp2 = undefined;
                node.kind = 'anchor-corner';
            }

            el.setAttribute('d', serializeNodesToPath(nodes));
            const svg = new XMLSerializer().serializeToString(doc);
            const nextSvg = svgSource === 'raw' ? svg : applyUsedStylesToSvg(svg, styleDefinitions, keyframes);
            commitSvg(nextSvg);
        },

        undo: () => {
            const { history, historyIndex } = get();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                const svg = history[newIndex];
                set((state) => ({
                    svgDocument: svg,
                    historyIndex: newIndex,
                    styleDefinitions: mergeStyles(
                        state.styleDefinitions.length > 0 ? state.styleDefinitions : INITIAL_STYLES,
                        parseCssToStyleDefinitions(getSvgStyleText(svg))
                    ),
                    keyframes: state.keyframes.length > 0 ? state.keyframes : INITIAL_KEYFRAMES,
                    overrideMap: parseOverrideRules(getSvgStyleText(svg)),
                }));
                const onChange = get().onSvgChange;
                if (onChange) onChange(svg);
            }
        },

        redo: () => {
            const { history, historyIndex } = get();
            if (historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                const svg = history[newIndex];
                set((state) => ({
                    svgDocument: svg,
                    historyIndex: newIndex,
                    styleDefinitions: mergeStyles(
                        state.styleDefinitions.length > 0 ? state.styleDefinitions : INITIAL_STYLES,
                        parseCssToStyleDefinitions(getSvgStyleText(svg))
                    ),
                    keyframes: state.keyframes.length > 0 ? state.keyframes : INITIAL_KEYFRAMES,
                    overrideMap: parseOverrideRules(getSvgStyleText(svg)),
                }));
                const onChange = get().onSvgChange;
                if (onChange) onChange(svg);
            }
        },

        canUndo: () => {
            const { historyIndex } = get();
            return historyIndex > 0;
        },

        canRedo: () => {
            const { history, historyIndex } = get();
            return historyIndex < history.length - 1;
        },

        addToHistory: () => {
            const { svgDocument, history, historyIndex } = get();
            if (svgDocument) {
                set({
                    history: [...history.slice(0, historyIndex + 1), svgDocument],
                    historyIndex: historyIndex + 1,
                });
            }
        },

        exportToSchema: () => {
            const { svgDocument } = get();
            return svgDocument || '';
        },

        reset: () => {
            set({
                svgDocument: null,
                svgDOM: null,
                svgSource: null,
                selectedElementId: null,
                selectedElementIds: new Set<string>(),
                styleDefinitions: INITIAL_STYLES,
                keyframes: INITIAL_KEYFRAMES,
                stylesVersion: 0,
                overrideMap: new Map(),
                libraryValues: new Map(),
                pathEditMode: null,
                selectedNodeIndex: null,
                pathEditTool: 'select',
                outlineMode: false,
                viewport: { ...DEFAULT_VIEWPORT },
                history: [],
                historyIndex: -1,
                onSvgChange: undefined,
            });
        },
    };
});
