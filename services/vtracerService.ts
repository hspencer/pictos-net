/**
 * VTracer Service - Raster to Vector Conversion
 * 
 * Uses the vectortracer WASM package to convert bitmap images (PNG)
 * into SVG vector graphics. This is the first step in the SVG pipeline.
 * 
 * @module services/vtracerService
 */

import {
    BinaryImageConverter,
    type BinaryImageConverterParams,
    type Options
} from "vectortracer";

/**
 * Configuration options for vectorization
 * These defaults are optimized for pictograms (high contrast, simple shapes)
 */
export interface VectorizerConfig {
    /** Curve fitting mode: 'polygon', 'spline', or 'none' */
    mode?: 'polygon' | 'spline' | 'none';
    /** Minimum momentary angle (degrees) to be considered a corner */
    cornerThreshold?: number;
    /** Minimum segment length for spline fitting */
    lengthThreshold?: number;
    /** Maximum iterations for path optimization */
    maxIterations?: number;
    /** Minimum angle displacement (degrees) to splice a spline */
    spliceThreshold?: number;
    /** Discard patches smaller than X pixels (noise removal) */
    filterSpeckle?: number;
    /** Decimal precision for path coordinates */
    pathPrecision?: number;
    /** Enable debug mode (slower) */
    debug?: boolean;
}

/** Default configuration optimized for pictograms */
const DEFAULT_CONFIG: VectorizerConfig = {
    mode: 'spline',           // Smooth curves for organic shapes
    filterSpeckle: 8,         // Remove more noise (pictograms are clean)
    cornerThreshold: 70,      // More aggressive corner detection
    lengthThreshold: 6.0,     // Longer minimum segments (cleaner paths)
    maxIterations: 15,        // More optimization for cleaner output
    spliceThreshold: 50,      // Higher splice threshold for smoother curves
    pathPrecision: 2,         // Less precision needed for pictograms
    debug: false,
};

/**
 * Convert a Base64 PNG image to ImageData
 * Uses OffscreenCanvas if available, falls back to regular canvas
 */
async function base64ToImageData(base64: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            // Try OffscreenCanvas first (better for web workers)
            let canvas: HTMLCanvasElement | OffscreenCanvas;
            let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

            if (typeof OffscreenCanvas !== 'undefined') {
                canvas = new OffscreenCanvas(img.width, img.height);
                ctx = canvas.getContext('2d');
            } else {
                canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx = canvas.getContext('2d');
            }

            if (!ctx) {
                reject(new Error('Failed to get canvas 2D context'));
                return;
            }

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            resolve(imageData);
        };

        img.onerror = () => {
            reject(new Error('Failed to load image from Base64'));
        };

        // Handle both with and without data URL prefix
        if (base64.startsWith('data:')) {
            img.src = base64;
        } else {
            img.src = `data:image/png;base64,${base64}`;
        }
    });
}

/**
 * Convert a bitmap image (Base64 PNG) to SVG using vtracer WASM
 * 
 * @param base64Png - Base64 encoded PNG image (with or without data URL prefix)
 * @param config - Optional vectorization configuration
 * @param onProgress - Optional progress callback (0-100)
 * @returns Promise that resolves to SVG string
 * 
 * @example
 * ```typescript
 * const svg = await vectorizeBitmap(row.bitmap);
 * console.log(svg); // '<svg ...>...</svg>'
 * ```
 */
/**
 * Internal worker function for vectorization
 */
async function vectorizeBitmapInternal(
    base64Png: string,
    config: VectorizerConfig,
    onProgress?: (progress: number) => void
): Promise<string> {
    const imageData = await base64ToImageData(base64Png);

    const converterParams: BinaryImageConverterParams = {
        debug: config.debug,
        mode: config.mode,
        filterSpeckle: config.filterSpeckle,
        cornerThreshold: config.cornerThreshold,
        lengthThreshold: config.lengthThreshold,
        maxIterations: config.maxIterations,
        spliceThreshold: config.spliceThreshold,
        pathPrecision: config.pathPrecision,
    };

    const svgOptions: Options = {
        invert: false,
        pathFill: '#000000',
        backgroundColor: undefined,
        attributes: undefined,
        scale: 1,
    };

    const converter = new BinaryImageConverter(imageData, converterParams, svgOptions);

    return new Promise((resolve, reject) => {
        try {
            converter.init();
            const tick = () => {
                try {
                    const done = converter.tick();
                    if (onProgress) {
                        const progress = converter.progress();
                        onProgress(Math.round(progress * 100));
                    }
                    if (!done) {
                        setTimeout(tick, 0);
                    } else {
                        const result = converter.getResult();
                        try { converter.free(); } catch (e) { console.warn("Free error:", e); }
                        resolve(result);
                    }
                } catch (err) {
                    try { converter.free(); } catch (e) { }
                    reject(err);
                }
            };
            setTimeout(tick, 0);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Convert a bitmap image to SVG with automatic fallback for stability
 */
export async function vectorizeBitmap(
    base64Png: string,
    config: Partial<VectorizerConfig> = {},
    onProgress?: (progress: number) => void
): Promise<string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    try {
        // First attempt with requested config (usually 'spline')
        return await vectorizeBitmapInternal(base64Png, finalConfig, onProgress);
    } catch (error) {
        // If it failed and we were using 'spline', try 'polygon' as fallback
        if (finalConfig.mode === 'spline') {
            console.warn("Vectorization with 'spline' mode failed, retrying with 'polygon' mode...", error);

            const fallbackConfig = { ...finalConfig, mode: 'polygon' as const };

            // Notify progress reset if applicable
            if (onProgress) onProgress(0);

            return await vectorizeBitmapInternal(base64Png, fallbackConfig, onProgress);
        }
        throw error;
    }
}

/**
 * Vectorize with a simple preset for pictograms
 */
export async function vectorizePictogram(base64Png: string): Promise<string> {
    return vectorizeBitmap(base64Png, {
        mode: 'spline',
        filterSpeckle: 6,
        cornerThreshold: 50,
        lengthThreshold: 3.0,
        pathPrecision: 2,
    });
}

/**
 * Check if vectortracer is available
 * Useful for feature detection
 */
export function isVectorizerAvailable(): boolean {
    try {
        // Just check if the import worked
        return typeof BinaryImageConverter !== 'undefined';
    } catch {
        return false;
    }
}
