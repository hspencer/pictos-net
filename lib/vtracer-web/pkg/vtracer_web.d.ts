/* tslint:disable */
/* eslint-disable */

export class TraceSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Trace every region with the given curve options (clustering options are
     * ignored: the cached segmentation is reused). Each path names its region;
     * a region may yield several paths (disjoint visible islands in mosaic)
     * or none (empty, or fully covered in mosaic).
     */
    finish(options: any): any;
    height(): number;
    /**
     * Segment a raw RGBA8 buffer (`width * height * 4` bytes).
     */
    constructor(rgba: Uint8Array | number[], width: number, height: number, options: any);
    /**
     * A region's coverage inside its bbox, row-major, 1 = inside.
     */
    region_mask(region_id: number): Uint8Array;
    /**
     * Regions in paint order (bottom to top): id, colour, bbox, pixel area.
     */
    regions(): any;
    width(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tracesession_free: (a: number, b: number) => void;
    readonly tracesession_finish: (a: number, b: any) => [number, number, number];
    readonly tracesession_height: (a: number) => number;
    readonly tracesession_new: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly tracesession_region_mask: (a: number, b: number) => [number, number, number, number];
    readonly tracesession_regions: (a: number) => [number, number, number];
    readonly tracesession_width: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
