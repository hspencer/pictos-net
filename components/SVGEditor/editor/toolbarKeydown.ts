import type React from 'react';

/**
 * WCAG roving-tabindex arrow-key navigation for a toolbar whose focusable
 * children carry `[data-toolbar-item]`. Shared by every editor toolbar
 * (editor header, selection toolbar) so the behaviour lives in one place.
 */
export function handleToolbarKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const toolbar = e.currentTarget;
    const items: HTMLElement[] = Array.from(
        toolbar.querySelectorAll('[data-toolbar-item]:not(:disabled)')
    );
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);
    let next = -1;

    switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
            e.preventDefault();
            next = idx < items.length - 1 ? idx + 1 : 0;
            break;
        case 'ArrowLeft':
        case 'ArrowUp':
            e.preventDefault();
            next = idx > 0 ? idx - 1 : items.length - 1;
            break;
        case 'Home':
            e.preventDefault();
            next = 0;
            break;
        case 'End':
            e.preventDefault();
            next = items.length - 1;
            break;
        default:
            return;
    }

    if (next >= 0) {
        items.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
        items[next].focus();
    }
}
