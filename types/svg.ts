/**
 * SVG Pictogram Types
 * 
 * Type definitions for the SVG library feature.
 * SVGs are stored separately from RowData following SSoT (Single Source of Truth) principle.
 * 
 * @module types/svg
 */

/**
 * A structured SVG pictogram following mf-svg-schema
 * This is a self-contained artifact with all semantic and accessibility data embedded
 */
export interface SVGPictogram {
    /** Unique identifier (typically matches the source row ID) */
    id: string;

    /** Original communicative intent */
    utterance: string;

    /** Complete SVG string (mf-svg-schema compliant) */
    svg: string;

    /** ISO timestamp when the SVG was created */
    createdAt: string;

    /** Reference to the original RowData ID */
    sourceRowId: string;

    /** VCSCI average score at generation time */
    vcsciScore: number;

    /** Language of the utterance */
    lang?: string;
}

/**
 * SVG Library state
 */
export interface SVGLibraryState {
    /** Array of all SVG pictograms */
    svgs: SVGPictogram[];

    /** Loading state */
    isLoading: boolean;

    /** Error message if any */
    error?: string;
}

/**
 * SVG generation status for a single row
 */
export type SVGGenerationStatus = 'idle' | 'vectorizing' | 'structuring' | 'completed' | 'error';

/**
 * Progress info during SVG generation
 */
export interface SVGGenerationProgress {
    status: SVGGenerationStatus;
    progress: number; // 0-100
    stage?: 'vectorizing' | 'structuring';
    error?: string;
}
