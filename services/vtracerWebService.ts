/**
 * vtracerWebService — VTracer 1.0 core (pinned 1.0.0-alpha.4, 2500df7) in the
 * browser, through the PICTOS binding in lib/vtracer-web.
 *
 * Unlike vtracerService (legacy 0.6 webapp WASM, DOM-coupled, colour-only),
 * this returns REGIONS with explicit provenance: every traced path names the
 * region it came from, and regions are never merged by colour behind the
 * caller's back. Default compositing is mosaic: a visible, seam-free partition
 * where holes are real holes.
 *
 * Units are the core's own (filterSpeckle = px side length, cornerThreshold =
 * degrees). Do NOT feed it buildWasmParams from vtracerService.
 *
 * ponytail: runs on the main thread (~100 ms at 1024² on the reference
 * machine). Move to a Worker, cancelled by terminate(), if it ever blocks the UI.
 * Used in: svgStructureService.vectorizeAndStructure.
 */

import init, { TraceSession } from '../lib/vtracer-web/pkg/vtracer_web.js';

export const VTRACER_WEB_ENGINE = { core: 'vtracer 1.0.0-alpha.4', rev: '2500df76b5aea0ac22d15296b22722442f825c5b' };

export interface TraceOptions {
    compositing?: 'mosaic' | 'stacked';
    clustering?: 'color-cluster' | 'bw' | 'watershed';
    mode?: 'spline' | 'polygon' | 'pixel';
    filterSpeckle?: number;
    colorPrecision?: number;
    layerDifference?: number;
    cornerThreshold?: number;
    lengthThreshold?: number;
    spliceThreshold?: number;
    simplify?: number;
    pathPrecision?: number;
}

export interface TraceRegion { regionId: number; color: string; bbox: [number, number, number, number]; area: number }
export interface TracedRegionPath { regionId: number; color: string; d: string }

let ready: Promise<unknown> | null = null;

/** Segment a bitmap once; finish() may then be re-run with new curve options
 *  without re-segmenting. Call free() when done. */
export async function openTraceSession(bitmap: HTMLImageElement | ImageBitmap, maxSide = 1024, options: TraceOptions = {}): Promise<TraceSession> {
    ready ??= init();
    await ready;
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return new TraceSession(new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer), w, h, options);
}
