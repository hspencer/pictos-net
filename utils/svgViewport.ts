/**
 * SVG Viewport Utilities
 *
 * Functions to properly calculate and apply viewBox to SVG elements
 * ensuring all content is visible within the viewport.
 */

export interface ViewBoxConfig {
    aspectRatio: string; // e.g., "1:1", "16:9"
    padding?: number; // Percentage padding (default: 5%)
}

/**
 * Calculates the bounding box from SVG path elements
 * Uses manual path parsing to avoid DOM dependencies
 */
function calculateBoundingBox(svg: SVGSVGElement): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Get all path elements
    const paths = svg.querySelectorAll('path');

    paths.forEach(path => {
        // Get transform offset
        const transform = path.getAttribute('transform');
        let tx = 0, ty = 0;

        if (transform) {
            const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (match) {
                tx = parseFloat(match[1]) || 0;
                ty = parseFloat(match[2]) || 0;
            }
        }

        // Parse path data manually
        const d = path.getAttribute('d');
        if (d) {
            // Extract all coordinate pairs from path commands
            // Match patterns like M, L, H, V, C, S, Q, T, A followed by numbers
            const coords = d.match(/-?\d+\.?\d*/g);
            if (coords) {
                // Process coordinates in pairs (x, y)
                for (let i = 0; i < coords.length; i += 2) {
                    const x = parseFloat(coords[i]);
                    const y = parseFloat(coords[i + 1]);

                    if (!isNaN(x)) {
                        minX = Math.min(minX, x + tx);
                        maxX = Math.max(maxX, x + tx);
                    }
                    if (!isNaN(y)) {
                        minY = Math.min(minY, y + ty);
                        maxY = Math.max(maxY, y + ty);
                    }
                }
            }
        }
    });

    // Fallback if no valid bounds found
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;
    if (!isFinite(maxX)) maxX = 100;
    if (!isFinite(maxY)) maxY = 100;

    return { minX, minY, maxX, maxY };
}

/**
 * Applies proper viewBox to SVG element ensuring all content is visible
 * and respects the target aspect ratio
 */
export function applyViewBox(svgString: string, config: ViewBoxConfig): string {
    try {
        // Parse SVG string
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');

        if (!svgEl) return svgString;

        // Parse aspect ratio (e.g., "16:9" -> 16/9)
        const [widthRatio, heightRatio] = config.aspectRatio.split(':').map(Number);
        const targetAspectRatio = widthRatio / heightRatio;

        // Calculate bounding box
        const bounds = calculateBoundingBox(svgEl);
        const contentWidth = bounds.maxX - bounds.minX;
        const contentHeight = bounds.maxY - bounds.minY;

        if (contentWidth <= 0 || contentHeight <= 0) {
            // No valid content, return as is
            return svgString;
        }

        // Calculate center
        const contentCenterX = (bounds.minX + bounds.maxX) / 2;
        const contentCenterY = (bounds.minY + bounds.maxY) / 2;

        // Add padding
        const paddingFactor = config.padding || 0.05;
        const paddedWidth = contentWidth * (1 + paddingFactor * 2);
        const paddedHeight = contentHeight * (1 + paddingFactor * 2);

        // Calculate viewBox dimensions respecting aspect ratio
        let viewBoxWidth: number;
        let viewBoxHeight: number;

        const contentAspectRatio = paddedWidth / paddedHeight;

        if (contentAspectRatio > targetAspectRatio) {
            // Content is wider than target - fit by width
            viewBoxWidth = paddedWidth;
            viewBoxHeight = viewBoxWidth / targetAspectRatio;
        } else {
            // Content is taller than target - fit by height
            viewBoxHeight = paddedHeight;
            viewBoxWidth = viewBoxHeight * targetAspectRatio;
        }

        // Center the viewBox around content
        const viewBoxX = contentCenterX - viewBoxWidth / 2;
        const viewBoxY = contentCenterY - viewBoxHeight / 2;

        // Apply viewBox and dimensions
        svgEl.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
        svgEl.setAttribute('width', '100%');
        svgEl.setAttribute('height', '100%');
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // Apply default styles to paths
        const paths = svgEl.querySelectorAll('path');
        paths.forEach(path => {
            if (!path.getAttribute('fill') || path.getAttribute('fill') === '#000000') {
                path.setAttribute('fill', '#000');
            }
            if (!path.getAttribute('stroke')) {
                path.setAttribute('stroke', 'none');
            }
        });

        return new XMLSerializer().serializeToString(svgEl);
    } catch (error) {
        console.error('Error applying viewBox:', error);
        return svgString;
    }
}

/**
 * Process raw SVG for display in thumbnails and previews
 */
export function processRawSVGForDisplay(svgString: string, aspectRatio: string): string {
    return applyViewBox(svgString, { aspectRatio, padding: 0.1 });
}
