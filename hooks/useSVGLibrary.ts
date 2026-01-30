/**
 * useSVGLibrary Hook
 * 
 * Manages the separate SVG library storage following the SSoT principle.
 * SVGs are stored independently from RowData in localStorage.
 * 
 * @module hooks/useSVGLibrary
 */

import { useState, useEffect, useCallback } from 'react';
import type { SVGPictogram, SVGLibraryState } from '../types/svg';

/** localStorage key for SVG library */
const SVG_LIBRARY_KEY = 'pictonet_svg_lib';

/** Helper function to sanitize filename for downloads */
const sanitizeFilename = (text: string, maxLength: number = 30): string => {
  return text
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]/gi, '_') // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .substring(0, maxLength)
    .toLowerCase();
};

/**
 * Custom hook for managing the SVG pictogram library
 * 
 * @example
 * ```tsx
 * const { svgs, addSVG, removeSVG, getSVGByRowId, exportSVGs } = useSVGLibrary();
 * 
 * // Add a new SVG
 * addSVG({
 *   id: 'svg-123',
 *   utterance: 'Quiero agua',
 *   svg: '<svg>...</svg>',
 *   sourceRowId: 'row-123',
 *   icapScore: 4.5,
 *   createdAt: new Date().toISOString()
 * });
 * 
 * // Check if SVG exists for a row
 * const existingSVG = getSVGByRowId('row-123');
 * ```
 */
export function useSVGLibrary() {
    const [state, setState] = useState<SVGLibraryState>({
        svgs: [],
        isLoading: true,
        error: undefined
    });

    // Load SVGs from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(SVG_LIBRARY_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as SVGPictogram[];
                setState({
                    svgs: Array.isArray(parsed) ? parsed : [],
                    isLoading: false
                });
            } else {
                setState({ svgs: [], isLoading: false });
            }
        } catch (error) {
            console.error('Failed to load SVG library:', error);
            setState({
                svgs: [],
                isLoading: false,
                error: 'Failed to load SVG library'
            });
        }
    }, []);

    // Persist to localStorage whenever svgs change (excluding bitmaps to save space)
    useEffect(() => {
        if (!state.isLoading) {
            try {
                // Strip bitmaps from SVGs before saving (they're too large for localStorage)
                // Bitmaps are only saved in manual exports
                const svgsWithoutBitmaps = state.svgs.map(svg => ({
                    ...svg,
                    bitmap: undefined, // Remove bitmap to save space
                }));

                localStorage.setItem(SVG_LIBRARY_KEY, JSON.stringify(svgsWithoutBitmaps));
            } catch (error) {
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    console.error('localStorage quota exceeded - SVG library too large');
                    // Don't show alert here, let the main App.tsx handle user notification
                } else {
                    console.error('Failed to save SVG library:', error);
                }
            }
        }
    }, [state.svgs, state.isLoading]);

    /**
     * Add a new SVG to the library
     * If an SVG with the same sourceRowId exists, it will be replaced
     */
    const addSVG = useCallback((svg: SVGPictogram) => {
        setState(prev => {
            // Remove existing SVG for the same row (if any)
            const filtered = prev.svgs.filter(s => s.sourceRowId !== svg.sourceRowId);
            return {
                ...prev,
                svgs: [...filtered, svg]
            };
        });
    }, []);

    /**
     * Remove an SVG from the library by ID
     */
    const removeSVG = useCallback((id: string) => {
        setState(prev => ({
            ...prev,
            svgs: prev.svgs.filter(s => s.id !== id)
        }));
    }, []);

    /**
     * Remove SVG by source row ID
     */
    const removeSVGByRowId = useCallback((rowId: string) => {
        setState(prev => ({
            ...prev,
            svgs: prev.svgs.filter(s => s.sourceRowId !== rowId)
        }));
    }, []);

    /**
     * Get SVG by source row ID
     */
    const getSVGByRowId = useCallback((rowId: string): SVGPictogram | undefined => {
        return state.svgs.find(s => s.sourceRowId === rowId);
    }, [state.svgs]);

    /**
     * Check if an SVG exists for a given row
     */
    const hasSVG = useCallback((rowId: string): boolean => {
        return state.svgs.some(s => s.sourceRowId === rowId);
    }, [state.svgs]);

    /**
     * Export all SVGs as a JSON array
     */
    const exportSVGs = useCallback((): string => {
        return JSON.stringify(state.svgs, null, 2);
    }, [state.svgs]);

    /**
     * Export a single SVG as a file (returns Blob)
     */
    const exportSingleSVG = useCallback((id: string): Blob | null => {
        const svg = state.svgs.find(s => s.id === id);
        if (!svg) return null;
        return new Blob([svg.svg], { type: 'image/svg+xml' });
    }, [state.svgs]);

    /**
     * Download a single SVG file
     */
    const downloadSVG = useCallback((id: string, filename?: string) => {
        const svg = state.svgs.find(s => s.id === id);
        if (!svg) return;

        const blob = new Blob([svg.svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${sanitizeFilename(svg.utterance)}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [state.svgs]);

    /**
     * Clear all SVGs from the library
     */
    const clearLibrary = useCallback(() => {
        setState(prev => ({ ...prev, svgs: [] }));
    }, []);

    /**
     * Import SVGs from JSON
     */
    const importSVGs = useCallback((json: string, mode: 'replace' | 'merge' = 'merge') => {
        try {
            const imported = JSON.parse(json) as SVGPictogram[];
            if (!Array.isArray(imported)) {
                throw new Error('Invalid SVG library format');
            }

            setState(prev => {
                if (mode === 'replace') {
                    return { ...prev, svgs: imported };
                }
                // Merge: keep existing, add new (by sourceRowId)
                const existingIds = new Set(prev.svgs.map(s => s.sourceRowId));
                const newSvgs = imported.filter(s => !existingIds.has(s.sourceRowId));
                return { ...prev, svgs: [...prev.svgs, ...newSvgs] };
            });

            return { success: true, count: imported.length };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to import SVGs'
            };
        }
    }, []);

    return {
        // State
        svgs: state.svgs,
        isLoading: state.isLoading,
        error: state.error,
        count: state.svgs.length,

        // CRUD operations
        addSVG,
        removeSVG,
        removeSVGByRowId,
        getSVGByRowId,
        hasSVG,
        clearLibrary,

        // Import/Export
        exportSVGs,
        exportSingleSVG,
        downloadSVG,
        importSVGs
    };
}

export default useSVGLibrary;
