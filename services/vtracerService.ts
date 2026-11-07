/**
 * VTracer Service - Raster to Vector Conversion
 *
 * Uses the official vtracer-webapp WASM (visioncortex) which provides both
 * ColorImageConverter (hierarchical clustering) and BinaryImageConverter.
 *
 * The WASM API is DOM-coupled: it reads pixels from a <canvas> element and
 * writes <path> elements directly to an <svg> element, both referenced by ID.
 *
 * Value transformations (JS UI values -> WASM params):
 *   - corner_threshold, splice_threshold: degrees -> radians
 *   - filter_speckle: squared (UI value^2)
 *   - color_precision: inverted (8 - UI value)
 *
 * @module services/vtracerService
 */

import type { ColorImageConverter, BinaryImageConverter } from '../lib/vtracer-wasm/vtracer_webapp';
import { posterize } from './posterize';

// Re-export the converter types for use in VectorizerModal
export type Converter = ColorImageConverter | BinaryImageConverter;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface VectorizerConfig {
    /** Curve fitting mode. Default: 'spline' */
    mode?: 'polygon' | 'spline' | 'none';
    /** 'color' for multi-color hierarchical clustering, 'bw' for binary trace. Default: 'color' */
    colorMode?: 'color' | 'bw';
    /** Hierarchical mode (color only). 'stacked' layers overlap; 'cutout' shapes don't. Default: 'stacked' */
    hierarchical?: 'stacked' | 'cutout';
    /** Color precision: significant bits per RGB channel (1-8). Higher = more colors. Default: 6 */
    colorPrecision?: number;
    /** Min color difference between gradient layers (0-255). Higher = fewer layers. Default: 16 */
    layerDifference?: number;
    /** Discard patches smaller than X pixels (0-16 UI value, squared for WASM). Default: 4 */
    filterSpeckle?: number;
    /** Min angle (degrees) to be a corner (0-180). Default: 60 */
    cornerThreshold?: number;
    /** Max segment length for subdivision (1-10). Default: 4.0 */
    lengthThreshold?: number;
    /** Max smoothing iterations. Default: 10 */
    maxIterations?: number;
    /** Min angle displacement (degrees) to splice splines (0-180). Default: 45 */
    spliceThreshold?: number;
    /** Decimal precision for path coordinates (1-8). Default: 8 */
    pathPrecision?: number;
    /** Flatten to this many colours (k-means + majority filter) before tracing; 0 = off. Default: 10 */
    paletteSize?: number;
}

export const DEFAULT_CONFIG: Required<VectorizerConfig> = {
    mode: 'spline',
    colorMode: 'color',
    hierarchical: 'stacked',
    colorPrecision: 6,
    layerDifference: 16,
    filterSpeckle: 4,
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 8,
    paletteSize: 10,
};

export interface VectorizerResult {
    svg: string;
    warnings: string[];
    layersTraced: number;
    layersTotal: number;
    tiersUsed: number;
    usedConfig: VectorizerConfig;
}

/** Presets for common use cases */
export const PRESETS: Record<string, Partial<VectorizerConfig>> = {
    bw: {
        colorMode: 'bw', mode: 'spline', filterSpeckle: 4,
        cornerThreshold: 60, spliceThreshold: 45,
    },
    pictogram: {
        colorMode: 'color', hierarchical: 'stacked',
        colorPrecision: 6, layerDifference: 16, filterSpeckle: 4,
        cornerThreshold: 60, mode: 'spline', paletteSize: 10,
    },
    poster: {
        colorMode: 'color', hierarchical: 'stacked',
        colorPrecision: 8, layerDifference: 25, filterSpeckle: 4,
        cornerThreshold: 60, mode: 'spline', paletteSize: 14,
    },
    photo: {
        colorMode: 'color', hierarchical: 'stacked',
        colorPrecision: 8, layerDifference: 48, filterSpeckle: 10,
        cornerThreshold: 180, mode: 'spline', paletteSize: 0,
    },
};

// ---------------------------------------------------------------------------
// WASM lazy loading
// ---------------------------------------------------------------------------

let wasmInit: typeof import('../lib/vtracer-wasm/vtracer_webapp').default | null = null;
let ColorImageConverterClass: typeof ColorImageConverter | null = null;
let BinaryImageConverterClass: typeof BinaryImageConverter | null = null;
let wasmReady = false;

async function ensureWasm(): Promise<void> {
    if (wasmReady) return;
    const mod = await import('../lib/vtracer-wasm/vtracer_webapp');
    wasmInit = mod.default;
    ColorImageConverterClass = mod.ColorImageConverter;
    BinaryImageConverterClass = mod.BinaryImageConverter;
    await wasmInit('/wasm/vtracer/vtracer_webapp_bg.wasm');
    wasmReady = true;
}

export function isVectorizerAvailable(): boolean {
    return true; // WASM is always available (lazy-loaded)
}

// ---------------------------------------------------------------------------
// Value transformations (UI -> WASM)
// ---------------------------------------------------------------------------

function deg2rad(deg: number): number {
    return deg / 180 * Math.PI;
}

function buildWasmParams(canvasId: string, svgId: string, config: Required<VectorizerConfig>): string {
    return JSON.stringify({
        canvas_id: canvasId,
        svg_id: svgId,
        mode: config.mode,
        hierarchical: config.hierarchical,
        corner_threshold: deg2rad(config.cornerThreshold),
        length_threshold: config.lengthThreshold,
        max_iterations: config.maxIterations,
        splice_threshold: deg2rad(config.spliceThreshold),
        filter_speckle: config.filterSpeckle * config.filterSpeckle,
        color_precision: 8 - config.colorPrecision,
        layer_difference: config.layerDifference,
        path_precision: config.pathPrecision,
    });
}

// ---------------------------------------------------------------------------
// Image utilities (kept from original)
// ---------------------------------------------------------------------------

async function downscaleBitmapIfNeeded(base64: string, maxDim = 1024): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { width, height } = img;
            if (width <= maxDim && height <= maxDim) {
                resolve(base64);
                return;
            }
            const scale = maxDim / Math.max(width, height);
            const newW = Math.round(width * scale);
            const newH = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = newW;
            canvas.height = newH;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(base64); return; }
            ctx.drawImage(img, 0, 0, newW, newH);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Failed to load image for downscaling'));
        img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    });
}

// ---------------------------------------------------------------------------
// Core conversion (tick loop with batched frames)
// ---------------------------------------------------------------------------

interface ConversionResult {
    warnings: string[];
}

async function runConversion(
    canvasId: string,
    svgId: string,
    config: Required<VectorizerConfig>,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
): Promise<ConversionResult> {
    await ensureWasm();

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const params = buildWasmParams(canvasId, svgId, config);
    const isBw = config.colorMode === 'bw';

    const converter = isBw
        ? BinaryImageConverterClass!.new_with_string(params)
        : ColorImageConverterClass!.new_with_string(params);

    converter.init();

    return new Promise((resolve, reject) => {
        const warnings: string[] = [];

        function tick() {
            // Check abort before each tick batch
            if (signal?.aborted) {
                try { converter.free(); } catch { /* ignore */ }
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            try {
                let done = false;
                const startTick = performance.now();
                // Batch multiple ticks within 25ms frames for smooth progress
                while (!(done = converter.tick()) && performance.now() - startTick < 25) {
                    // keep ticking
                }
                const progress = converter.progress();
                onProgress?.(progress);

                if (!done) {
                    setTimeout(tick, 1);
                } else {
                    converter.free();
                    resolve({ warnings });
                }
            } catch (err) {
                try { converter.free(); } catch { /* ignore */ }
                reject(err);
            }
        }

        setTimeout(tick, 1);
    });
}

// ---------------------------------------------------------------------------
// Interactive API (for VectorizerModal — uses visible DOM elements)
// ---------------------------------------------------------------------------

/**
 * Trace using visible canvas/svg elements in the VectorizerModal.
 * The WASM writes paths progressively to the SVG element.
 * After completion, caller serializes the SVG from the DOM.
 */
export async function traceInteractive(
    canvasId: string,
    svgId: string,
    config: Partial<VectorizerConfig>,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
): Promise<ConversionResult> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config } as Required<VectorizerConfig>;
    return runConversion(canvasId, svgId, finalConfig, onProgress, signal);
}

// ---------------------------------------------------------------------------
// One-shot API (creates hidden DOM elements, returns SVG string)
// ---------------------------------------------------------------------------

let hiddenCounter = 0;

/**
 * Convert a bitmap (base64 PNG) to SVG using the official vtracer WASM.
 * Creates temporary hidden DOM elements for the WASM to operate on.
 *
 * With fallback: if spline mode fails, retries with polygon mode.
 */
export async function vectorizeBitmap(
    base64Png: string,
    config: Partial<VectorizerConfig> = {},
    onProgress?: (percent: number) => void,
): Promise<VectorizerResult> {
    const safeBase64 = await downscaleBitmapIfNeeded(base64Png);
    const finalConfig = { ...DEFAULT_CONFIG, ...config } as Required<VectorizerConfig>;

    const id = ++hiddenCounter;
    const canvasId = `__vtracer_canvas_${id}`;
    const svgId = `__vtracer_svg_${id}`;

    // Create hidden canvas and SVG elements
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';

    const canvas = document.createElement('canvas');
    canvas.id = canvasId;
    container.appendChild(canvas);

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.id = svgId;
    container.appendChild(svgEl);

    document.body.appendChild(container);

    try {
        // Draw bitmap to canvas
        const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('No 2d context')); return; }
                ctx.drawImage(img, 0, 0);
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => reject(new Error('Failed to load bitmap'));
            img.src = safeBase64.startsWith('data:') ? safeBase64 : `data:image/png;base64,${safeBase64}`;
        });

        svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svgEl.setAttribute('width', String(width));
        svgEl.setAttribute('height', String(height));
        svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Try with requested config
        let result: ConversionResult;
        let tiersUsed = 1;
        let usedConfig = finalConfig;

        try {
            result = await runConversion(canvasId, svgId, finalConfig, onProgress);
        } catch (err) {
            // Fallback: retry with polygon mode
            console.warn('[vtracer] Tier 1 failed, retrying with polygon:', err);
            usedConfig = { ...finalConfig, mode: 'polygon' };
            tiersUsed = 2;

            // Clear SVG and redraw canvas
            while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
            const ctx = canvas.getContext('2d');
            const img = new Image();
            await new Promise<void>((resolve) => {
                img.onload = () => {
                    ctx!.drawImage(img, 0, 0);
                    resolve();
                };
                img.src = safeBase64.startsWith('data:') ? safeBase64 : `data:image/png;base64,${safeBase64}`;
            });
            onProgress?.(0);
            result = await runConversion(canvasId, svgId, usedConfig, onProgress);
            result.warnings.push('Tier 1 failed — fell back to polygon mode');
        }

        // Serialize SVG from DOM
        const svg = new XMLSerializer().serializeToString(svgEl);
        const pathCount = svgEl.querySelectorAll('path').length;

        return {
            svg,
            warnings: result.warnings,
            layersTraced: pathCount,
            layersTotal: pathCount,
            tiersUsed,
            usedConfig,
        };
    } finally {
        document.body.removeChild(container);
    }
}

/**
 * Draw a base64 image onto a canvas element by ID.
 * Used by VectorizerModal to prepare the canvas for WASM.
 */
export async function drawBitmapToCanvas(
    base64: string,
    canvasId: string,
): Promise<{ width: number; height: number }> {
    const safeBase64 = await downscaleBitmapIfNeeded(base64);
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`Canvas #${canvasId} not found`);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('No 2d context')); return; }
            ctx.drawImage(img, 0, 0);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => reject(new Error('Failed to load bitmap'));
        img.src = safeBase64.startsWith('data:') ? safeBase64 : `data:image/png;base64,${safeBase64}`;
    });
}

/**
 * Copy `src` into `dst` (the canvas the WASM reads), flattened to `paletteSize`
 * colours first when > 0. The visible original stays untouched.
 */
export function prepareForTrace(src: HTMLCanvasElement, dst: HTMLCanvasElement, paletteSize: number): void {
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d')!;
    const image = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
    if (paletteSize > 0) image.data.set(posterize(image.data, image.width, image.height, paletteSize));
    ctx.putImageData(image, 0, 0);
}

/**
 * Prepare the WASM module (can be called ahead of time to avoid latency).
 */
export async function preloadWasm(): Promise<void> {
    return ensureWasm();
}
